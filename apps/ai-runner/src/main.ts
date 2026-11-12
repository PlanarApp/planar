import { dockerClient } from './docker.js';
import { createRunner } from './server.js';

const e = process.env;
const num = (v: string | undefined, def: number) => (v ? Number(v) : def);

const token = e.AI_RUNNER_TOKEN;
if (!token) {
  console.error('AI_RUNNER_TOKEN is required');
  process.exit(1);
}

createRunner(
  {
    token,
    images: (e.AI_RUNNER_IMAGES ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    maxCpus: num(e.AI_RUNNER_MAX_CPUS, 2),
    maxMemoryMb: num(e.AI_RUNNER_MAX_MEMORY_MB, 4096),
    maxPids: num(e.AI_RUNNER_MAX_PIDS, 512),
    agentNetwork: e.AI_RUNNER_AGENT_NETWORK || 'planar_agents',
  },
  dockerClient(e.DOCKER_HOST_SOCKET || '/var/run/docker.sock'),
).listen(num(e.PORT, 8080), '0.0.0.0', () => console.log('ai-runner listening'));
