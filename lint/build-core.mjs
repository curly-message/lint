import { spawnSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// Builds the core, `rust/wasm/`, for WebAssembly and copies the module to
// `core.wasm`, which the bundle inlines. A path of this machine in the bytes
// would differ from one build to the next, so each is written as a name.
const root = fileURLToPath(new URL('../', import.meta.url));
const rust = join(root, 'rust');
const remapped = { [root]: 'lint/', [process.env.CARGO_HOME ?? join(homedir(), '.cargo')]: 'cargo' };
const built = spawnSync('cargo', ['build', '-p', 'curly-message-lint-wasm', '--profile', 'wasm', '--target', 'wasm32-unknown-unknown', '--locked'], {
  cwd: rust,
  stdio: 'inherit',
  env: {
    ...process.env,
    // The form of `RUSTFLAGS` that takes a path with a space in it.
    CARGO_ENCODED_RUSTFLAGS: Object.entries(remapped).map(([from, to]) => `--remap-path-prefix=${from}=${to}`).join('\x1f'),
  },
});

if (built.error) throw built.error;
if (built.status !== 0) process.exit(built.status ?? 1);

copyFileSync(join(rust, 'target', 'wasm32-unknown-unknown', 'wasm', 'curly_message_lint_wasm.wasm'), fileURLToPath(new URL('core.wasm', import.meta.url)));
