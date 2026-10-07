// Counts what the command asks of the file system, and writes the count to
// descriptor 3 as it exits. A row loads it with `--import`.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

let count = 0;

for (const name of ['readdir', 'readFile', 'realpath', 'stat']) {
  const call = fs.promises[name];

  fs.promises[name] = (...args) => {
    count += 1;

    return call(...args);
  };
}

syncBuiltinESMExports();
process.on('exit', () => fs.writeSync(3, String(count)));
