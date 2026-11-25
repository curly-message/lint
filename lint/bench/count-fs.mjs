// Counts what the command asks of the file system, and writes the count to
// descriptor 3 as it exits. A row loads it with `--import`.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import process from 'node:process';

let count = 0;

// A call on a path below where the command runs: the runtime loads the
// command's own modules with the same calls.
const counted = (holder, name) => {
  const call = holder[name];

  holder[name] = Object.assign((...args) => {
    if (String(args[0]).startsWith(process.cwd())) count += 1;

    return call(...args);
  }, call);
};

for (const name of ['lstatSync', 'readdirSync', 'readFileSync', 'statSync']) counted(fs, name);

// The command resolves a path by the system's own call.
counted(fs.realpathSync, 'native');

syncBuiltinESMExports();
process.on('exit', () => fs.writeSync(3, String(count)));
