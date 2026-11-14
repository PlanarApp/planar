import { hostname } from 'node:os';
import { dockerClient } from './docker.js';
import { createRunner, sweepWork, type Config } from './server.js';

const e = process.env;
const num = (v: string | undefined, def: number) => (v ? Number(v) : def);

const token = e.AI_RUNNER_TOKEN;
if (!token) {
  console.error('AI_RUNNER_TOKEN is required');
  process.exit(1);
}

const workDir = e.AI_RUNNER_WORK_DIR || '/ai-work';
const docker = dockerClient(e.DOCKER_HOST_SOCKET || '/var/run/docker.sock');

// the host path of workDir — from the runner's own mount (compose: ./ai-work:/ai-work); the hostname is the container id
const self = await docker('GET', `/containers/${hostname()}/json`);
const mount =
  self.status === 200 &&
  (JSON.parse(self.body) as { Mounts: { Source: string; Destination: string }[] }).Mounts.find(
    (m) => m.Destination === workDir,
  );
if (!mount) {
  console.error(
    `${workDir} must be a bind mount of the runner container (docker inspect: ${self.status})`,
  );
  process.exit(1);
}

const cfg: Config = {
  token,
  images: (e.AI_RUNNER_IMAGES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  maxCpus: num(e.AI_RUNNER_MAX_CPUS, 2),
  maxMemoryMb: num(e.AI_RUNNER_MAX_MEMORY_MB, 4096),
  maxPids: num(e.AI_RUNNER_MAX_PIDS, 512),
  agentNetwork: e.AI_RUNNER_AGENT_NETWORK || 'planar_agents',
  workDir,
  workHostDir: mount.Source,
};

createRunner(cfg, docker).listen(num(e.PORT, 8080), '0.0.0.0', () =>
  console.log('ai-runner listening'),
);

const sweep = () =>
  sweepWork(cfg, docker).catch((err: unknown) =>
    console.error('work sweep:', err instanceof Error ? err.message : err),
  );
void sweep();
setInterval(sweep, 10 * 60_000);
