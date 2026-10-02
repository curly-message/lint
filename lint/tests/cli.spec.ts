import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from '../src/run';

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'curly-lint-'));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

const files = async (tree: Record<string, string>) => {
  for (const [path, text] of Object.entries(tree)) {
    await mkdir(join(cwd, dirname(path)), { recursive: true });
    await writeFile(join(cwd, path), text);
  }
};

const cli = async (...argv: string[]) => {
  let out = '';
  let err = '';
  const code = await run(argv, { cwd, out: (text) => { out += text; }, err: (text) => { err += text; } });

  return { code, out, err };
};

describe('curly-lint', () => {
  it('reports where each problem stands, and exits 1 on an error', async () => {
    await files({
      'locales/en/common.json': '{\n  "hi": "Hello, {{name}}!",\n  "files": "{{n:plural; one:file; other:files;}}"\n}\n',
      'locales/cs/common.json': '{\n  "hi": "Ahoj, {{name}",\n  "files": "{{n:plural; one:soubor; few:soubory; other:soubor\u016f;}}"\n}\n',
    });

    const { code, out } = await cli('locales');

    expect(code).toBe(1);
    expect(out.split('\n')).toEqual([
      'locales/cs/common.json:2:9  error  This message never reads `name`, which the `en` message reads.  parameter-mismatch',
      'locales/cs/common.json:2:16  error  `{{` opens no placeholder: nothing closes it on its line, so it renders as text.  unclosed-placeholder',
      'locales/cs/common.json:3:17  error  `cs` puts 0.5, 1.5 and 2.5 in `many`, and this selection has no `many` option, so those take the fallback chain.  missing-category',
      '',
      '3 problems (3 errors, 0 warnings)',
      '',
    ]);
  });

  it('exits 0 where only warnings are found, and --quiet shows errors alone', async () => {
    await files({ 'en.json': '{"a": "C:\\\\d"}' });

    expect(await cli('en.json')).toMatchObject({ code: 0, out: expect.stringContaining('inert-escape') as unknown });
    expect(await cli('en.json', '--quiet')).toMatchObject({ code: 0, out: '' });
  });

  it('writes JSON with --format json', async () => {
    await files({ 'en.json': '{"a": "{{v:zz}}"}' });

    const { code, out } = await cli('--format', 'json', '.');

    expect(code).toBe(1);
    expect(JSON.parse(out)).toEqual([{ file: 'en.json', line: 1, column: 12, endLine: 1, endColumn: 14, severity: 'error', code: 'unknown-modifier', message: expect.any(String) as unknown, locale: 'en', id: 'a' }]);
  });

  it('reads a locale given for every file, and modifiers the host registers', async () => {
    await files({ 'messages.json': '{"a": "{{n:plural; one:a; other:b;}} {{v:upper}}"}' });

    expect((await cli('messages.json')).code).toBe(1);
    expect((await cli('messages.json', '--modifier', 'upper')).code).toBe(0);
    expect((await cli('messages.json', '--modifier', 'upper', '--locale', 'cs')).out).toContain('missing-category');
    expect((await cli('messages.json', '--modifier', 'upper', '--no-intl')).out).toContain('`plural` is a modifier of the Intl level');
  });

  it('reports a duplicate member and a file that is not JSON', async () => {
    await files({ 'en.json': '{"a": "x", "a": "y"}', 'cs.json': '{"a": }' });

    const { code, out } = await cli('.');

    expect(code).toBe(1);
    expect(out).toContain('cs.json:1:7  error  Expected a value, found `}`.  unreadable-catalogue');
    expect(out).toContain('en.json:1:2  error  `a` is defined again later in this object, so this value is never read.  duplicate-id');
  });

  it('names a control character by its code point, so a report stays on one line', async () => {
    await files({ 'en.json': '{"a": "x\ny"}' });

    expect((await cli('en.json')).out.split('\n')[0]).toBe('en.json:1:9  error  Expected a control character to be escaped, found U+000A.  unreadable-catalogue');
  });

  it('reports a source file that is not JSON, and compares nothing under its namespace', async () => {
    await files({
      'locales/en/common.json': '{"hi": "Hello {{name}}",}',
      'locales/en/other.json': '{"bye": "Bye", "yes": "Yes"}',
      'locales/cs/common.json': '{"hi": "Ahoj {{jmeno}}"}',
      'locales/cs/other.json': '{"bye": "Nashle"}',
    });

    const { code, out, err } = await cli('--source', 'en', 'locales');

    expect({ code, err }).toEqual({ code: 1, err: '' });
    expect(out.split('\n')).toEqual([
      'locales/en/common.json:1:25  error  Expected a string, found `}`.  unreadable-catalogue',
      'locales/en/other.json:1:23  warning  `cs` has no message `other.yes`.  missing-message',
      '',
      '2 problems (1 error, 1 warning)',
      '',
    ]);
  });

  it('reports no message missing under the namespace of a file that is not JSON', async () => {
    await files({
      'locales/en/common.json': '{"hi": "Hello"}',
      'locales/en/other.json': '{"bye": "Bye"}',
      'locales/cs/common.json': '{"hi": "Ahoj",}',
      'locales/cs/other.json': '{}',
    });

    expect((await cli('locales')).out.split('\n').slice(0, 2)).toEqual([
      'locales/cs/common.json:1:15  error  Expected a string, found `}`.  unreadable-catalogue',
      'locales/en/other.json:1:9  warning  `cs` has no message `other.bye`.  missing-message',
    ]);
  });

  it('reads a file two arguments reach once', async () => {
    await files({ 'locales/en.json': '{"hi": "Hello"}' });

    expect(await cli('locales/en.json', 'locales')).toMatchObject({ code: 0, out: '' });
  });

  it('compares a locale whose file holds no message', async () => {
    await files({ 'en.json': '{"hi": "Hello"}', 'cs.json': '{}' });

    expect(await cli('.')).toMatchObject({ code: 0, out: expect.stringContaining('en.json:1:8  warning  `cs` has no message `hi`.  missing-message') as unknown });
  });

  it('counts no column for a byte order mark', async () => {
    await files({ 'en.json': '\ufeff{"a": "{{v:zz}}"}' });

    expect((await cli('en.json')).out).toContain('en.json:1:12  error');
  });

  it('reads `_` in a locale given as `-`, and refuses a locale or source that names none', async () => {
    await files({ 'messages.json': '{"a": "{{n:plural; one:soubor; few:soubory; other:soubor\u016f;}}"}', 'en.json': '{"a": "A"}' });

    expect((await cli('messages.json', '--locale', 'cs_CZ')).out).toContain('missing-category');
    expect(await cli('messages.json', '--locale', 'not a tag')).toMatchObject({ code: 2, err: expect.stringContaining('not a tag') as unknown });
    expect(await cli('en.json', '--source', 'fr')).toMatchObject({ code: 2, err: expect.stringContaining('`fr`') as unknown });
  });

  // Windows makes a symbolic link only with a privilege a test cannot count on.
  it.skipIf(process.platform === 'win32')('follows a linked directory once, and reports a file it cannot read', async () => {
    await files({ 'locales/en/common.json': '{"hi": "Hello {{name}}"}', 'shared/cs/common.json': '{"hi": "Ahoj {{jmeno}}"}', 'locales/de/common.json': '{"hi": "Hallo {{name}"}' });
    await symlink(join(cwd, 'shared/cs'), join(cwd, 'locales/cs'));
    await symlink(join(cwd, 'locales'), join(cwd, 'locales/en/loop'));
    await symlink(join(cwd, 'gone.json'), join(cwd, 'locales/old.json'));

    const { code, out, err } = await cli('locales');

    expect(code).toBe(2);
    expect(err).toContain('Cannot read locales/old.json');
    expect(out).toContain('locales/cs/common.json:1:14  error  `jmeno` is read here');
    expect(out).toContain('locales/de/common.json:1:15  error  `{{` opens no placeholder');
  });

  it('skips node_modules and hidden directories', async () => {
    await files({ 'node_modules/x/en.json': '{"a": "{{"}', '.cache/en.json': '{"a": "{{"}', 'en.json': '{"a": "ok"}' });

    expect(await cli('.')).toMatchObject({ code: 0, out: '' });
  });

  it('exits 2 on wrong arguments and on a path it cannot read', async () => {
    expect((await cli()).code).toBe(2);
    expect((await cli('--nope', '.')).code).toBe(2);
    expect((await cli('--format', 'xml', '.')).code).toBe(2);
    expect(await cli('missing')).toMatchObject({ code: 2, err: expect.stringContaining('Cannot read missing') as unknown });
    expect(await cli('--help')).toMatchObject({ code: 0, out: expect.stringContaining('Usage: curly-lint') as unknown });
  });
});
