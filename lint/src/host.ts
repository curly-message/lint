import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { command, CoreError, failure, Fault } from './core';
import { intlPlurals } from './plural';

/** Where the command runs, and where it writes its report and what it cannot read. */
export type IO = { cwd: string, out: (text: string) => void, err: (text: string) => void };

// A path that is not there: missing, below a file, or a loop of links.
const MISSING = new Set(['ENOENT', 'ENOTDIR', 'ELOOP']);

type Kinded = { isSymbolicLink: () => boolean, isDirectory: () => boolean, isFile: () => boolean };

// What a name is, as `rust/wasm/src/host.rs` reads it.
const kindOf = (found: Kinded) => (found.isSymbolicLink() ? 'l' : found.isDirectory() ? 'd' : found.isFile() ? 'f' : 'o');

// What the file system refuses is the command's to report, in the runtime's
// own words: an error it names by a code. Anything else thrown is no answer
// about the path.
const asked = (answer: () => string | Uint8Array) => {
  try {
    return answer();
  } catch (error) {
    const { code, message } = (error ?? {}) as { code?: unknown, message?: unknown };

    if (typeof code !== 'string') throw error;

    return new Fault(String(message), MISSING.has(code));
  }
};

// Each operation the command asks for, at the number
// `rust/wasm/src/host.rs` gives it.
const operations = ({ cwd, out, err }: IO): ((text: string) => string | Uint8Array)[] => [
  (path) => resolve(cwd, path),
  (path) => relative(cwd, path),
  (path) => kindOf(statSync(path)),
  (path) => kindOf(lstatSync(path)),
  (path) => realpathSync.native(path),
  // Each name after its kind, and before a character no name holds.
  (path) => readdirSync(path, { withFileTypes: true }).map((entry) => `${kindOf(entry)}${entry.name}\0`).join(''),
  (path) => readFileSync(path),
  (text) => {
    out(text);

    return '';
  },
  (text) => {
    err(text);

    return '';
  },
];

/**
 * Runs `curly-lint` with the arguments `argv` over the files of this
 * machine, and answers its exit code: 2 where the core could not finish.
 */
export const run = (argv: readonly string[], io: IO): number => {
  const answers = operations(io);

  try {
    return command(intlPlurals, argv, { separator: sep, ask: (op, text) => asked(() => answers[op](text)) });
  } catch (caught) {
    const error = failure(caught);

    if (!(error instanceof CoreError)) throw error;

    io.err(`${error.message}\n`);

    return 2;
  }
};
