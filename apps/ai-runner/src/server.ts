import { createHash, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { tar, type Docker } from './docker.js';

export type Config = {
  token: string;
  images: string[];
  maxCpus: number;
  maxMemoryMb: number;
  maxPids: number;
  agentNetwork: string;
  /** per-run /work dirs as the runner sees them */
  workDir: string;
  /** the same dir on the host: the bind source is resolved by the host docker */
  workHostDir: string;
};

const MAX_BODY = 2 * 1024 * 1024;
const MAX_CONTEXT = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const LABEL = 'planar.ai.run';

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: object = { error: 'bad_request' },
  ) {
    super(String(status));
  }
}

const bad = (error: string) => new HttpError(400, { error });
const digest = (s: string) => createHash('sha256').update(s).digest();

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req as AsyncIterable<Buffer>) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(413, { error: 'body_too_large' });
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function limit(v: unknown, def: number, max: number, name: string, int: boolean): number {
  if (v === undefined) return def;
  if (typeof v !== 'number' || !(v > 0) || (int && !Number.isInteger(v))) throw bad(`bad_${name}`);
  if (v > max) throw bad(`${name}_over_limit`);
  return v;
}

async function findRun(docker: Docker, runId: string): Promise<string[]> {
  const filters = encodeURIComponent(JSON.stringify({ label: [`${LABEL}=${runId}`] }));
  const r = await docker('GET', `/containers/json?all=true&filters=${filters}`);
  if (r.status !== 200) throw new Error(`docker list ${r.status}`);
  return (JSON.parse(r.body) as { Id: string }[]).map((c) => c.Id);
}

const dropWork = (cfg: Config, runId: string) =>
  rm(join(cfg.workDir, runId), { recursive: true, force: true });

/**
 * Removes /work dirs of runs without a container (AutoRemove after exit, a lost DELETE). Dirs younger than `minAgeMs`
 * are kept: between mkdir and docker create the run has no container yet.
 */
export async function sweepWork(cfg: Config, docker: Docker, minAgeMs = 5 * 60_000) {
  const names = await readdir(cfg.workDir).catch(() => [] as string[]);
  for (const name of names) {
    if (!UUID.test(name)) continue;
    const s = await stat(join(cfg.workDir, name)).catch(() => undefined);
    if (!s || Date.now() - s.mtimeMs < minAgeMs) continue;
    if (!(await findRun(docker, name)).length) await dropWork(cfg, name);
  }
}

export function createRunner(cfg: Config, docker: Docker): Server {
  const find = (runId: string) => findRun(docker, runId);

  const create = async (raw: string) => {
    let b: { runId?: unknown; image?: unknown; env?: unknown; limits?: unknown; context?: unknown };
    try {
      b = JSON.parse(raw);
    } catch {
      throw bad('bad_json');
    }
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw bad('bad_body');
    const { runId, image, env = {}, limits = {}, context } = b;
    if (typeof runId !== 'string' || !UUID.test(runId)) throw bad('bad_run_id');
    if (typeof image !== 'string') throw bad('bad_image');
    if (!env || typeof env !== 'object' || Array.isArray(env)) throw bad('bad_env');
    const entries = Object.entries(env as Record<string, unknown>);
    if (entries.length > 64) throw bad('bad_env');
    for (const [k, v] of entries)
      if (
        !ENV_NAME.test(k) ||
        k.length > 64 ||
        typeof v !== 'string' ||
        Buffer.byteLength(v) > 16 * 1024
      )
        throw bad('bad_env');
    if (!limits || typeof limits !== 'object' || Array.isArray(limits)) throw bad('bad_limits');
    const lim = limits as Record<string, unknown>;
    const cpus = limit(lim.cpus, 1, cfg.maxCpus, 'cpus', false);
    const memoryMb = limit(lim.memoryMb, 2048, cfg.maxMemoryMb, 'memory', true);
    const pids = limit(lim.pids, 256, cfg.maxPids, 'pids', true);
    if (
      context !== undefined &&
      (typeof context !== 'string' || Buffer.byteLength(context) > MAX_CONTEXT)
    )
      throw bad('bad_context');
    // exact match only, checked before any docker call
    if (!cfg.images.includes(image)) throw new HttpError(403, { error: 'image_not_allowed' });

    if ((await find(runId)).length) throw new HttpError(409, { error: 'run_exists' });
    const memory = memoryMb * 1024 * 1024;
    const work = join(cfg.workDir, runId);
    await mkdir(work, { recursive: true });
    // the agent is non-root; mkdir's mode is cut by umask
    await chmod(work, 0o777);
    // HostConfig is fixed here: nothing from the request body reaches it except the checked limits
    const c = await docker(
      'POST',
      `/containers/create?name=${encodeURIComponent(`planar-ai-run-${runId}`)}`,
      JSON.stringify({
        Image: image,
        Env: entries.map(([k, v]) => `${k}=${v}`),
        Labels: { [LABEL]: runId },
        WorkingDir: '/work',
        HostConfig: {
          CapDrop: ['ALL'],
          SecurityOpt: ['no-new-privileges'],
          ReadonlyRootfs: true,
          Mounts: [
            // anonymous volume: writable under ReadonlyRootfs, putArchive works; removed with the container (AutoRemove)
            { Type: 'volume', Target: '/context' },
            // on disk, no size limit; removed by DELETE or sweepWork
            { Type: 'bind', Source: join(cfg.workHostDir, runId), Target: '/work' },
          ],
          AutoRemove: true,
          Tmpfs: { '/tmp': 'rw,nosuid,size=256m' },
          NetworkMode: cfg.agentNetwork,
          RestartPolicy: { Name: 'no' },
          Memory: memory,
          MemorySwap: memory,
          NanoCpus: Math.round(cpus * 1e9),
          PidsLimit: pids,
        },
      }),
    );
    // 409: the dir belongs to the other request's run
    if (c.status === 409) throw new HttpError(409, { error: 'run_exists' });
    if (c.status !== 201) {
      await dropWork(cfg, runId);
      throw new Error(`docker create ${c.status}`);
    }
    const containerId = (JSON.parse(c.body) as { Id: string }).Id;
    try {
      if (context !== undefined) {
        const a = await docker(
          'PUT',
          `/containers/${containerId}/archive?path=/context`,
          tar([{ name: 'context.json', data: Buffer.from(context) }]),
          'application/x-tar',
        );
        if (a.status !== 200) throw new Error(`docker archive ${a.status}`);
      }
      const s = await docker('POST', `/containers/${containerId}/start`);
      if (s.status !== 204) throw new Error(`docker start ${s.status}`);
    } catch (e) {
      await docker('DELETE', `/containers/${containerId}?force=true&v=true`).catch(() => undefined);
      await dropWork(cfg, runId);
      throw e;
    }
    return { containerId };
  };

  const state = async (runId: string) => {
    const [id] = await find(runId);
    if (!id) throw new HttpError(404, { error: 'not_found' });
    const r = await docker('GET', `/containers/${id}/json`);
    if (r.status === 404) throw new HttpError(404, { error: 'not_found' });
    if (r.status !== 200) throw new Error(`docker inspect ${r.status}`);
    const s = (JSON.parse(r.body) as { State: { Running: boolean; ExitCode: number } }).State;
    return s.Running ? { state: 'running' } : { state: 'exited', exitCode: s.ExitCode };
  };

  const remove = async (runId: string) => {
    for (const id of await find(runId)) {
      const r = await docker('DELETE', `/containers/${id}?force=true&v=true`);
      if (r.status !== 204 && r.status !== 404) throw new Error(`docker delete ${r.status}`);
    }
    await dropWork(cfg, runId);
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body?: object) => {
      res.writeHead(status, body ? { 'content-type': 'application/json' } : {});
      res.end(body && JSON.stringify(body));
    };
    const path = (req.url ?? '').split('?')[0];
    if (req.method === 'GET' && path === '/healthz') return send(200, { ok: true });

    const m = path.match(/^\/v1\/runs(?:\/([^/]+))?$/);
    const runId = m?.[1];
    const allowed = runId ? ['GET', 'DELETE'] : ['POST'];
    if (!m || !allowed.includes(req.method ?? '')) return send(404, { error: 'not_found' });

    const auth = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    if (!auth || !timingSafeEqual(digest(auth[1]), digest(cfg.token)))
      return send(401, { error: 'unauthorized' });

    if (!runId) return send(201, await create(await readBody(req)));
    if (!UUID.test(runId)) return send(404, { error: 'not_found' });
    if (req.method === 'GET') return send(200, await state(runId));
    await remove(runId);
    return send(204);
  };

  return createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (res.headersSent) return res.destroy();
      if (!(e instanceof HttpError))
        console.error('docker error:', e instanceof Error ? e.message : e);
      const err = e instanceof HttpError ? e : new HttpError(502, { error: 'docker_error' });
      res.writeHead(err.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(err.body));
    });
  });
}
