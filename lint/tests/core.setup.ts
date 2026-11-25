import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const setup = () => {
  const built = spawnSync(process.execPath, [fileURLToPath(new URL('../build-core.mjs', import.meta.url))], { stdio: 'inherit' });

  if (built.error) throw built.error;
  if (built.status !== 0) throw new Error(`build-core.mjs exited ${String(built.status)}`);
};
