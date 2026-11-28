// Reads one version of a package out of Packagist's metadata:
// `node tools/p2.mjs <answer> <version>`, where <answer> is a file holding
// what `repo.packagist.org/p2/<vendor>/<name>.json` answered, prints the
// commit the version was read from and the URL its archive is served at, on
// one line, exits 1 where the answer does not hold the version, and 2 where
// it cannot be read.
//
// The answer is minified (`"minified": "composer/2.0"`): of a package's
// versions, only the first is written whole, and each one after it holds
// the keys that differ from the one before, `"__unset"` for a key the one
// before has and it has not. So a version is read by going through those
// before it.
import { readFileSync } from 'node:fs';

const [file, version] = process.argv.slice(2);

if (!file || !version) {
  process.stderr.write('usage: node tools/p2.mjs <answer> <version>\n');
  process.exit(2);
}

const unreadable = (error) => {
  process.stderr.write(`p2.mjs: ${file} could not be read as Packagist's answer: ${error.message}\n`);
  process.exit(2);
};

const expanded = (versions) => {
  let whole = {};

  return versions.map((entry) => {
    whole = Object.fromEntries(Object.entries({ ...whole, ...entry }).filter(([, value]) => value !== '__unset'));

    return whole;
  });
};

const found = (() => {
  try {
    const { minified, packages } = JSON.parse(readFileSync(file, 'utf8'));

    return Object.values(packages)
      .flatMap((versions) => (minified === 'composer/2.0' ? expanded(versions) : versions))
      .find((entry) => entry.version === version || entry.version === `v${version}`);
  } catch (error) {
    return unreadable(error);
  }
})();

if (!found) process.exit(1);

const reference = found.source?.reference;
const url = found.dist?.url;

if (!/^[0-9a-f]{40}$/.test(reference ?? '') || !/^https:\/\/\S+$/.test(url ?? '')) {
  process.stderr.write(`p2.mjs: ${version} names no commit or no archive: ${JSON.stringify({ source: found.source, dist: found.dist })}\n`);
  process.exit(2);
}

process.stdout.write(`${reference} ${url}\n`);
