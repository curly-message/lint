import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/run';
import type { Problem } from '../src/run';

// What the command asks of the file system, counted, and the ends of the
// paths it is refused, written with `/`, as a test cannot count on file
// permissions: the directories it cannot list, the files it cannot open, and
// the paths it cannot reach, as below a directory it cannot search.
const calls = vi.hoisted(() => ({ readdir: 0, realpath: 0, stat: 0 }));
const refused = vi.hoisted(() => new Set<string>());
const unreachable = vi.hoisted(() => new Set<string>());

vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  const counted = <T extends (...args: never[]) => unknown>(name: keyof typeof calls, call: T) => ((...args: Parameters<T>) => {
    calls[name] += 1;

    return call(...args);
  }) as T;
  const denied = (ends: Set<string>, path: unknown) => typeof path === 'string' && [...ends].some((end) => `/${path.split(/[\\/]/).join('/')}`.endsWith(`/${end}`));
  const refusal = (call: string, path: string) => Promise.reject(Object.assign(new Error(`EACCES: permission denied, ${call} '${path}'`), { code: 'EACCES' }));
  const readdir = ((path: string, options: never) => (denied(refused, path) ? refusal('scandir', path) : fs.readdir(path, options))) as typeof fs.readdir;
  const readFile = ((path: string, options: never) => (denied(refused, path) ? refusal('open', path) : fs.readFile(path, options))) as typeof fs.readFile;
  const stat = ((path: string, options: never) => (denied(unreachable, path) ? refusal('stat', path) : fs.stat(path, options))) as typeof fs.stat;

  return { ...fs, readdir: counted('readdir', readdir), readFile, realpath: counted('realpath', fs.realpath), stat: counted('stat', stat) };
});

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'curly-lint-'));
});

afterEach(async () => {
  refused.clear();
  unreachable.clear();
  await rm(cwd, { recursive: true, force: true });
});

const files = async (tree: Record<string, string>) => {
  for (const [path, text] of Object.entries(tree)) {
    await mkdir(join(cwd, dirname(path)), { recursive: true });
    await writeFile(join(cwd, path), text);
  }
};

// A link to a directory, which Windows makes as a junction without the
// privilege a symbolic link takes there.
const link = (target: string, path: string) => symlink(join(cwd, target), join(cwd, path), 'junction');

// What the command says where what a directory it cannot read holds leaves
// every locale uncompared.
const uncompared = /What a directory that cannot be read holds is unknown, so no locale is compared with another\.\n$/;

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

    const { code, out } = await cli('locales/{locale}/{namespace}.json');

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

  it('lists the files in the order they are read in, whatever the runtime\'s locale', async () => {
    await files({ 'a/x.json': '{"a": "{{"}', 'B/x.json': '{"b": "{{"}', 'a-b/x.json': '{"c": "{{"}', 'a_b/x.json': '{"d": "{{"}' });

    const order = async (...argv: string[]) => (await cli(...argv)).out.split('\n').map((line) => line.split(':')[0]).slice(0, -3);

    expect(await order('.')).toEqual(['B/x.json', 'a/x.json', 'a-b/x.json', 'a_b/x.json']);
    expect(await order('a_b', 'B')).toEqual(['a_b/x.json', 'B/x.json']);

    // Listed where it is read, not by the path it is shown at.
    await files({ 'q/x.json': '{"e": "{{"}', 'x.json': '{"f": "{{"}' });

    let out = '';
    await run(['..'], { cwd: join(cwd, 'q'), out: (text) => { out += text; }, err: () => undefined });
    expect(out.split('\n').map((line) => line.split(':')[0]).slice(0, -3)).toEqual(['../B/x.json', '../a/x.json', '../a-b/x.json', '../a_b/x.json', 'x.json', '../x.json']);
  });

  it('reads no locale off a path no pattern places one in', async () => {
    // `be` names Belarusian, and `nds` Low German where the host has rules
    // for it: neither is the locale of what these files hold.
    await files({
      'packages/be/messages.json': '{"items": "{{n:plural; one:item; other:items;}}"}',
      'messages/nds/strings.json': '{"items": "{{n:plural; one:item; other:items;}}"}',
    });

    expect(await cli('packages', 'messages')).toEqual({
      code: 0,
      out: '',
      err: '2 files have no locale, so their messages are linted without one, and compared with no other locale\'s. Name it in a pattern, as in curly-lint "locales/{locale}/{namespace}.json".\n',
    });
  });

  it('reads the namespace a pattern places before the locale', async () => {
    await files({
      'locales/admin/en.json': '{"title": "Users"}',
      'locales/admin/cs.json': '{"title": "U\u017eivatel\u00e9"}',
      'locales/shop/en.json': '{"title": "Cart", "buy": "Buy"}',
      'locales/shop/cs.json': '{"title": "Ko\u0161\u00edk"}',
    });

    expect(await cli('locales/{namespace}/{locale}.json')).toEqual({
      code: 0,
      out: 'locales/shop/en.json:1:26  warning  `cs` has no message `shop.buy`.  missing-message\n\n1 problem (0 errors, 1 warning)\n',
      err: '',
    });
  });

  it('reads a namespace of several names, and a locale beside it in one name', async () => {
    await files({
      'locales/en/admin/users.json': '{"title": "Users"}',
      'locales/cs/admin/users.json': '{}',
      'i18n/shop.en.json': '{"cart": "Cart"}',
      'i18n/shop.pt_BR.json': '{}',
      // No text parts a namespace from the locale here.
      'i18n/en.json': '{"x": "{{"}',
      'l10n/en.app/admin/users.json': '{"hi": "Hi", "bye": "Bye"}',
      'l10n/pt-BR.app/admin/users.json': '{"hi": "Oi"}',
      'prefixed/ns-admin/users.json': '{"x": "{{"}',
    });
    await link('l10n/pt-BR.app', 'l10n/pt.app');

    expect((await cli('locales/{locale}/{namespace}.json')).out).toBe('locales/en/admin/users.json:1:11  warning  `cs` has no message `admin.users.title`.  missing-message\n\n1 problem (0 errors, 1 warning)\n');
    expect((await cli('i18n/{namespace}.{locale}.json')).out).toBe('i18n/shop.en.json:1:10  warning  `pt-BR` has no message `shop.cart`.  missing-message\n\n1 problem (0 errors, 1 warning)\n');
    expect((await cli('l10n/{locale}.{namespace}.json')).out).toBe([
      'l10n/en.app/admin/users.json:1:21  warning  `pt-BR` has no message `app.admin.users.bye`.  missing-message',
      'l10n/en.app/admin/users.json:1:21  warning  `pt` has no message `app.admin.users.bye`.  missing-message',
      '',
      '2 problems (0 errors, 2 warnings)',
      '',
    ].join('\n'));
    expect(JSON.parse((await cli('prefixed/ns-{namespace}.json', '--locale', 'en', '--format', 'json')).out)).toMatchObject([{ file: 'prefixed/ns-admin/users.json', code: 'unclosed-placeholder', locale: 'en', id: 'admin.users.x' }]);
  });

  it('reads only the files whose paths the pattern places a locale in', async () => {
    await files({
      'locales/en.json': '{"a": "A"}',
      'locales/messages.en.json': '{"a": "{{"}',
      'locales/glossary.json': '{"a": "{{"}',
      'locales/package.json': '{"a": "{{"}',
      'locales/e.json': '{"a": "{{"}',
      'locales/en/common.json': '{"a": "{{"}',
      'app/messages.cs.json': '{"a": "{{n:plural; one:a; other:b;}}"}',
      'app/messages.json': '{"a": "{{"}',
      'app/other.cs.json': '{"a": "{{"}',
    });

    expect(await cli('locales/{locale}.json')).toEqual({ code: 0, out: '', err: '' });
    expect(await cli('app/messages.{locale}.json')).toMatchObject({ code: 1, out: expect.stringMatching(/^(app\/messages\.cs\.json:1:12 {2}error .* missing-category\n){2}\n2 problems/) as unknown, err: '' });
  });

  it('reads no directory deeper than a pattern without a namespace reaches', async () => {
    await files({ 'locales/en.json': '{"a": "A"}', 'locales/cs.json': '{}', 'locales/archive/2019/q1/en.json': '{"a": "{{"}' });
    // A link the pattern reads nothing through is not followed to learn
    // what it is.
    await link('locales/archive', 'locales/old');

    calls.readdir = calls.realpath = calls.stat = 0;
    expect(await cli('locales/{locale}.json')).toMatchObject({ code: 0, err: '' });
    expect(calls).toEqual({ readdir: 1, realpath: 1, stat: 1 });

    calls.readdir = calls.realpath = calls.stat = 0;
    expect(await cli('locales/{namespace}/{locale}.json')).toMatchObject({ code: 1, out: expect.stringContaining('locales/archive/2019/q1/en.json') as unknown });
    expect(calls).toEqual({ readdir: 4, realpath: 2, stat: 2 });
  });

  it('reads a pattern written with either separator, or from the root', async () => {
    await files({ 'locales/cs.json': '{"a": "{{n:plural; one:a; other:b;}}"}' });

    for (const pattern of ['locales\\{locale}.json', join(cwd, 'locales', '{locale}.json')]) {
      expect(await cli(pattern)).toMatchObject({ code: 1, out: expect.stringContaining('locales/cs.json:1:12  error  `cs` puts') as unknown, err: '' });
    }
  });

  it('refuses a pattern it cannot read, and one no file matches', async () => {
    await files({ 'ns-x.json': '{}' });

    expect(await cli('locales/{lng}.json')).toEqual({ code: 2, out: '', err: 'The pattern locales/{lng}.json holds a brace that opens neither {locale} nor {namespace}.\n' });
    expect(await cli('{locale}/{locale}.json')).toMatchObject({ code: 2, err: expect.stringContaining('holds {locale} twice') as unknown });
    expect(await cli('{namespace}-{locale}.json')).toMatchObject({ code: 2, err: expect.stringContaining('with nothing a locale cannot hold') as unknown });
    expect(await cli('locales/{locale}')).toMatchObject({ code: 2, err: expect.stringContaining('names no .json file') as unknown });
    expect(await cli('locales/{locale}/../x.json')).toMatchObject({ code: 2, err: expect.stringContaining('`..`') as unknown });
    expect(await cli('locales/{locale}//x.json')).toMatchObject({ code: 2, err: expect.stringContaining('an empty name') as unknown });
    // The text around a placeholder leaves it something to stand for, and a
    // namespace no empty name.
    expect(await cli('ns-{namespace}-x.json')).toEqual({ code: 2, out: '', err: 'No .json file matches the pattern ns-{namespace}-x.json.\n' });
    await files({ 'i18n/ns-/x.json': '{}' });
    expect(await cli('i18n/ns-{namespace}.json')).toEqual({ code: 2, out: '', err: 'No .json file matches the pattern i18n/ns-{namespace}.json.\n' });
  });

  it('reads a file as the pattern that reaches it does, whatever reaches it first', async () => {
    await files({ 'locales/en.json': '{"a": "{{n:plural; one:a; other:b;}}", "b": "B"}', 'locales/cs.json': '{"a": "{{n:plural; one:a; other:b;}}"}' });

    for (const argv of [['locales', 'locales/{locale}.json'], ['locales/{locale}.json', 'locales']]) {
      const { code, out, err } = await cli(...argv, '--locale', 'de');

      expect({ code, err }).toEqual({ code: 1, err: '' });
      expect(out.split('\n').map((line) => line.split('  ').at(-1))).toEqual(['missing-category', 'missing-category', 'missing-message', '', '3 problems (2 errors, 1 warning)', '']);
    }

    // A pattern that places no locale reads its files in the one --locale
    // gives, and a directory given as it is reads none of them.
    for (const argv of [['locales', 'locales/{namespace}.json'], ['locales/{namespace}.json', 'locales']]) {
      expect(await cli(...argv, '--locale', 'cs', '--quiet')).toMatchObject({ code: 1, out: expect.stringMatching(/^(locales\/cs\.json:1:12 .*\n){2}(locales\/en\.json:1:12 .*\n){2}\n4 problems/) as unknown, err: '' });
    }
  });

  it('gives --locale to the files whose paths hold none, under the namespaces a pattern places', async () => {
    await files({ 'locales/en/admin.json': '{"title": "Users"}', 'locales/en/shop.json': '{"title": "Cart"}' });

    expect(await cli('locales/en/{namespace}.json', '--locale', 'en')).toEqual({ code: 0, out: '', err: '' });
    expect((await cli('locales/en', '--locale', 'en')).out).toContain('duplicate-id');
  });

  it('says once that a file has no locale, whatever else it reports', async () => {
    await files({ 'messages.json': '{"a": "A"}' });

    expect(await cli('messages.json', '--quiet', '--source', 'en')).toEqual({
      code: 2,
      out: '',
      err: '1 file has no locale, so its messages are linted without one, and compared with no other locale\'s. Name it in a pattern, as in curly-lint "locales/{locale}/{namespace}.json".\nNo file given is written for the source locale `en`.\n',
    });
  });

  it('exits 0 where only warnings are found, and --quiet shows errors alone', async () => {
    await files({ 'en.json': '{"a": "C:\\\\d"}' });

    expect(await cli('en.json')).toMatchObject({ code: 0, out: expect.stringContaining('inert-escape') as unknown });
    expect(await cli('en.json', '--quiet')).toMatchObject({ code: 0, out: '' });
  });

  it('writes JSON with --format json', async () => {
    await files({ 'en.json': '{"a": "{{v:zz}}"}' });

    const { code, out } = await cli('--format', 'json', '{locale}.json');

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

    const { code, out, err } = await cli('--source', 'en', 'locales/{locale}/{namespace}.json');

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

    expect((await cli('locales/{locale}/{namespace}.json')).out.split('\n').slice(0, 2)).toEqual([
      'locales/cs/common.json:1:15  error  Expected a string, found `}`.  unreadable-catalogue',
      'locales/en/other.json:1:9  warning  `cs` has no message `other.bye`.  missing-message',
    ]);
  });

  it('reports an id defined twice under the namespace of a file that is not JSON', async () => {
    await files({ 'locales/en/common.json': '{"a.b": "x", "a": {"b": "y"}}', 'locales/cs/common.json': '{"a":' });

    expect((await cli('locales/{locale}/{namespace}.json')).out).toContain('locales/en/common.json:1:25  error  `common.a.b` is defined again in `en`, so one of the two messages is never read.  duplicate-id');
  });

  it('reads a file two arguments reach once', async () => {
    await files({ 'locales/en.json': '{"hi": "Hello"}' });

    expect(await cli('locales/en.json', 'locales')).toMatchObject({ code: 0, out: '' });
  });

  it('compares a locale whose file holds no message', async () => {
    await files({ 'en.json': '{"hi": "Hello"}', 'cs.json': '{}' });

    expect(await cli('{locale}.json')).toMatchObject({ code: 0, out: expect.stringContaining('en.json:1:8  warning  `cs` has no message `hi`.  missing-message') as unknown });
  });

  it('counts no column for a byte order mark', async () => {
    await files({ 'en.json': '\ufeff{"a": "{{v:zz}}"}' });

    expect((await cli('en.json')).out).toContain('en.json:1:12  error');
  });

  it('reads `_` in a locale given as `-`, and refuses a locale or source that is none', async () => {
    await files({ 'messages.json': '{"a": "{{n:plural; one:soubor; few:soubory; other:soubor\u016f;}}"}', 'en.json': '{"a": "A"}' });

    expect((await cli('messages.json', '--locale', 'cs_CZ')).out).toContain('missing-category');
    expect(await cli('messages.json', '--locale', 'not a tag')).toMatchObject({ code: 2, err: expect.stringContaining('not a tag') as unknown });
    // A language of five to eight letters is well-formed, and none is
    // registered.
    expect(await cli('messages.json', '--locale', 'common')).toMatchObject({ code: 2, err: expect.stringContaining('--locale "common" is no locale') as unknown });
    expect(await cli('en.json', '--source', 'fr')).toMatchObject({ code: 2, err: expect.stringContaining('`fr`') as unknown });
  });

  // Windows makes a symbolic link only with a privilege a test cannot count on.
  it.skipIf(process.platform === 'win32')('follows a linked directory once, and reports a file it cannot read', async () => {
    await files({ 'locales/en/common.json': '{"hi": "Hello {{name}}"}', 'shared/cs/common.json': '{"hi": "Ahoj {{jmeno}}"}', 'locales/de/common.json': '{"hi": "Hallo {{name}"}', 'shared/de/old.json': '{"x": "X"}' });
    await symlink(join(cwd, 'shared/cs'), join(cwd, 'locales/cs'));
    await symlink(join(cwd, 'locales'), join(cwd, 'locales/en/loop'));
    // What the link leads to is there, and cannot be reached.
    await symlink(join(cwd, 'shared/de/old.json'), join(cwd, 'locales/de/old.json'));
    unreachable.add('locales/de/old.json');
    refused.add('locales/de/old.json');
    await mkdir(join(cwd, 'public'));
    await link('locales', 'public/locales');

    const { code, out, err } = await cli('locales/{locale}/{namespace}.json');

    expect(code).toBe(2);
    expect(err).toContain('Cannot read locales/de/old.json');
    // A link that cannot be read is reported once, at the first argument's path to it.
    expect(await cli('locales/{locale}/{namespace}.json', 'public/locales/{locale}/{namespace}.json')).toMatchObject({ code: 2, err: expect.stringMatching(/^Cannot read locales\/de\/old\.json: [^\n]*\n$/) as unknown });
    // Given as it is, too: once, at the path a file that can be read is read at.
    for (const other of ['locales/{locale}/{namespace}.json', 'locales']) {
      expect(await cli('locales/de/old.json', other)).toMatchObject({ code: 2, err: expect.stringMatching(/^Cannot read locales\/de\/old\.json: [^\n]*\n(?!Cannot)/) as unknown });
    }
    expect(out).toContain('locales/cs/common.json:1:14  error  `jmeno` is read here');
    expect(out).toContain('locales/de/common.json:1:15  error  `{{` opens no placeholder');
  });

  // Windows makes a symbolic link only with a privilege a test cannot count on.
  it.skipIf(process.platform === 'win32')('passes over a link to a path that is not there where it would read a file, as a file that is not there', async () => {
    await files({
      'locales/en/common.json': '{"hi": "Hi"}',
      'locales/en/old.json': '{"x": "X"}',
      'locales/cs/common.json': '{"hi": "Ahoj"}',
      'notes.txt': 'x',
    });
    // Missing, below a file, and a loop of links.
    await symlink(join(cwd, 'gone.json'), join(cwd, 'locales/cs/old.json'));
    await symlink(join(cwd, 'notes.txt/x.json'), join(cwd, 'locales/cs/older.json'));
    await symlink(join(cwd, 'locales/cs/oldest.json'), join(cwd, 'locales/cs/oldest.json'));

    // `cs` lacks what `en` holds under `old`, as where no file stands there.
    expect(await cli('locales/{locale}/{namespace}.json')).toEqual({ code: 0, out: 'locales/en/old.json:1:7  warning  `cs` has no message `old.x`.  missing-message\n\n1 problem (0 errors, 1 warning)\n', err: '' });
    expect(await cli('locales/cs', '--locale', 'cs')).toEqual({ code: 0, out: '', err: '' });
  });

  it('reads a directory at its own path, wherever a link to it sorts', async () => {
    await files({ 'locales/en/common.json': '{"hi": "Hi"}', 'locales/cs/common.json': '{}', 'po/en/LC_MESSAGES/app.json': '{"hi": "Hi"}', 'po/cs/LC_MESSAGES/app.json': '{}' });
    await link('locales/en', 'locales/default');
    await mkdir(join(cwd, 'po/docs'));
    await link('po/en', 'po/docs/en');

    expect(await cli('locales/{locale}/{namespace}.json', '--source', 'en')).toMatchObject({ code: 0, out: expect.stringContaining('`cs` has no message `common.hi`') as unknown, err: '' });
    expect(await cli('po/{locale}/LC_MESSAGES/app.json', '--source', 'en')).toMatchObject({ code: 0, out: expect.stringContaining('`cs` has no message `hi`') as unknown, err: '' });
  });

  it('reads a directory at its own path, and through a link where the pattern reads it there alone', async () => {
    await files({
      'locales/en/common.json': '{"hi": "Hi", "bye": "Bye"}',
      'locales/en/admin/users/list.json': '{"title": "Users"}',
      'locales/vendor/cs/common.json': '{"hi": "Ahoj"}',
      'locales/vendor/cs/admin/users/list.json': '{"title": "Uzivatele"}',
      'locales/pt-BR/common.json': '{"hi": "Oi"}',
      'locales/pt-BR/admin/users/list.json': '{"title": "Usuarios"}',
      'shared/de/common.json': '{"hi": "Hallo", "bye": "Tschuss"}',
      'extra/admin/users/list.json': '{"title": "Benutzer"}',
    });
    await link('locales/vendor/cs', 'locales/cs');
    await link('locales/pt-BR', 'locales/pt');
    await link('locales/en', 'locales/default');
    await link('locales/en/admin/users', 'locales/en/admin/old');
    await link('shared/de', 'locales/de');
    await link('extra/admin', 'shared/de/admin');

    expect(await cli('locales/{locale}/{namespace}.json', '--source', 'en')).toEqual({
      code: 0,
      out: [
        'locales/en/common.json:1:21  warning  `cs` has no message `common.bye`.  missing-message',
        'locales/en/common.json:1:21  warning  `pt` has no message `common.bye`.  missing-message',
        'locales/en/common.json:1:21  warning  `pt-BR` has no message `common.bye`.  missing-message',
        '',
        '3 problems (0 errors, 3 warnings)',
        '',
      ].join('\n'),
      err: '',
    });
  });

  it('takes the first locale found in the order of the paths, by code units, wherever a link stands', async () => {
    await files({ 'shared/cs/a.json': '{"x": "X", "y": "Y"}', 'i18n/de/a.json': '{"x": "X"}', 'order/zh-Hant/a.json': '{"x": "X", "y": "Y"}', 'order/zh_Hans/a.json': '{"x": "X"}' });
    await link('shared/cs', 'i18n/cs');

    // A path given as it is reads no file a pattern reads, wherever it stands.
    for (const argv of [[], ['i18n/de'], ['.']]) {
      expect((await cli(...argv, 'i18n/{locale}/{namespace}.json')).out).toBe('i18n/cs/a.json:1:17  warning  `de` has no message `a.y`.  missing-message\n\n1 problem (0 errors, 1 warning)\n');
    }

    expect((await cli('order/{locale}/{namespace}.json')).out).toBe('order/zh-Hant/a.json:1:17  warning  `zh-Hans` has no message `a.y`.  missing-message\n\n1 problem (0 errors, 1 warning)\n');
  });

  it('follows no link to a directory that holds it, nor to the directory searched or one above it', async () => {
    await files({
      'package.json': '{"name": "{{"}',
      'locales/en/common.json': '{"hi": "Hi"}',
      'locales/cs/common.json': '{"hi": "Ahoj"}',
      'chain/m/common.json': '{"hi": "{{"}',
      'near/en/common.json': '{"hi": "Hi"}',
      'near/en-US/common.json': '{"hi": "Hi"}',
      'ring/en/common.json': '{"files": "{{n:plural; one:file; other:files;}}"}',
      'vendor/cs/common.json': '{"files": "{{n:plural; one:soubor; few:soubory; many:souboru; other:soubor\u016f;}}"}',
      'top/locales/en/common.json': '{"files": "{{n:plural; one:file; other:files;}}"}',
      'top/package.json': '{"name": "{{"}',
      'outside/cs/common.json': '{"files": "{{n:plural; one:soubor; few:soubory; many:souboru; other:soubor\u016f;}}"}',
      'held/x/en/sub/app.json': '{"files": "{{n:plural; one:file; other:files;}}"}',
    });
    await link('.', 'locales/en/up');
    await link('locales', 'locales/cs/loop');
    await link('chain/x', 'chain/m/en');
    await mkdir(join(cwd, 'chain/x'));
    await link('chain/m', 'chain/x/en');
    // `near/en` does not hold `near/en-US`, whose name it begins.
    await link('near/en', 'near/en-US/base');
    // A ring of links back to the directory searched.
    await link('vendor/cs', 'ring/cs');
    await link('ring', 'vendor/cs/app');
    // A ring back to a directory above the one searched.
    await link('outside/cs', 'top/locales/cs');
    await link('top', 'outside/cs/up');
    // A link to a directory that holds it, below the one searched.
    await link('held/x/en', 'held/x/en/sub/cs');

    expect(await cli('locales/{locale}/{namespace}.json')).toEqual({ code: 0, out: '', err: '' });
    expect(await cli('locales')).toMatchObject({ code: 0, out: '' });
    expect(await cli('chain/{namespace}/{locale}/common.json')).toMatchObject({ code: 1, out: expect.stringMatching(/^chain\/x\/en\/common\.json:1:9 {2}error .* unclosed-placeholder\n\n1 problem/) as unknown, err: '' });
    expect(await cli('near/{locale}/{namespace}.json', '--source', 'en')).toEqual({
      code: 0,
      out: 'near/en-US/base/common.json:1:8  warning  `en` has no message `base.common.hi`, so nothing this message renders is compared with it.  orphan-message\n\n1 problem (0 errors, 1 warning)\n',
      err: '',
    });
    for (const pattern of ['ring/{locale}/{namespace}.json', 'top/locales/{locale}/{namespace}.json', 'held/{namespace}/{locale}/sub/app.json']) {
      expect(await cli(pattern)).toEqual({ code: 0, out: '', err: '' });
    }
    expect(await cli('top/locales')).toMatchObject({ code: 0, out: '' });
  });

  it('reads each directory given as it is over its own base, whichever other one reads it too', async () => {
    await files({ 'P/a/one.json': '{"a": "{{"}', 'P/extra/two.json': '{"b": "{{"}', 'o/three.json': '{"c": "{{"}' });
    // Below `P/a`, `o/up` leads above the directory searched; below `o`, it does not.
    await link('o', 'P/a/o');
    await link('P', 'o/up');

    const { code, out } = await cli('P/a', 'o');

    expect(code).toBe(1);
    expect(out).toMatch(/(^|\n)o\/up\/extra\/two\.json:1:8 {2}error/);
    expect(out).toContain('\n3 problems');
  });

  it('reads a file once for each locale, at the path through the fewest links', async () => {
    await files({
      'locales/en/common.json': '{"hi": "Hi"}',
      'locales/en/app.json': '{"hi": "Hi"}',
      'locales/pt_BR/common.json': '{"hi": "Oi"}',
      'locales/pt-BR/app.json': '{"hi": "Oi"}',
    });
    // Two names spell one locale, and the path through the link sorts first.
    await link('locales/pt_BR', 'locales/pt-BR/legacy');

    expect(await cli('locales/{locale}/{namespace}.json')).toEqual({ code: 0, out: '', err: '' });
  });

  it('reads a catalogue two patterns reach once, by the first of them', async () => {
    await files({ 'locales/en/common.json': '{"hi": "Hi", "bye": "Bye"}', 'locales/cs/common.json': '{"hi": "Ahoj"}' });
    await mkdir(join(cwd, 'public'));
    await link('locales', 'public/locales');

    const found = (path: string) => ({ code: 0, out: `${path}:1:21  warning  \`cs\` has no message \`common.bye\`.  missing-message\n\n1 problem (0 errors, 1 warning)\n`, err: '' });

    expect(await cli('locales/{locale}/{namespace}.json', 'public/locales/{locale}/{namespace}.json')).toEqual(found('locales/en/common.json'));
    expect(await cli('public/locales/{locale}/{namespace}.json', 'locales/{locale}/{namespace}.json')).toEqual(found('public/locales/en/common.json'));
    expect(await cli('locales/en/{namespace}.json', 'locales/{locale}/{namespace}.json', '--locale', 'en')).toEqual(found('locales/en/common.json'));
  });

  it('reads each pattern over its base, whichever other pattern reads it too', async () => {
    await files({ 'locales/en.json': '{"hi": "Hi"}', 'locales/en/admin.json': '{"t": "{{"}' });

    expect(await cli('locales/{locale}.json', 'locales/{locale}/{namespace}.json')).toMatchObject({ code: 1, out: expect.stringMatching(/^locales\/en\/admin\.json:1:8 {2}error .* unclosed-placeholder\n\n1 problem/) as unknown, err: '' });
  });

  it.skipIf(process.platform === 'win32')('reads a linked file under the namespace of its own path', async () => {
    await files({
      'files/en/common.json': '{"hi": "Hi", "bye": "Bye"}',
      'files/cs/common.json': '{"hi": "Ahoj", "bye": "Nashle"}',
      'files/cs/app.json': '{"hi": "Ahoj"}',
    });
    await symlink(join(cwd, 'files/en/common.json'), join(cwd, 'files/en/app.json'), 'file');

    // One namespace for each file and locale: `app.json` in `en` is the file
    // read as `common`.
    const found = { out: 'files/cs/app.json:1:8  warning  `en` has no message `app.hi`, so nothing this message renders is compared with it.  orphan-message\n\n1 problem (0 errors, 1 warning)\n', err: '' };

    expect(await cli('files/{locale}/{namespace}.json')).toEqual({ code: 0, ...found });
    expect(await cli('.', 'files/{locale}/{namespace}.json')).toEqual({ code: 0, ...found });
  });

  it('reads no directory the pattern reads nothing in', async () => {
    refused.add('private');
    await files({ 'locales/en/common.json': '{"hi": "{{"}', 'locales/private/x.json': '{}' });

    expect(await cli('locales/{locale}/{namespace}.json')).toMatchObject({ code: 1, err: '' });
  });

  it('reports a directory it cannot read, reads the rest of the argument, and compares no locale with another', async () => {
    refused.add('cs/admin');
    await files({
      'locales/en/common.json': '{"hi": "Hi", "bye": "Bye", "a.b": "x", "a": {"b": "y"}}',
      'locales/cs/common.json': '{"hi": "{{", "files": "{{n:plural; one:soubor; few:soubory; other:soubor\u016f;}}"}',
      'locales/en/admin/users.json': '{"title": "Users"}',
      'locales/cs/admin/users.json': '{"title": "Uzivatele"}',
    });

    const pattern = 'locales/{locale}/{namespace}.json';
    const cannot = /^Cannot read locales\/cs\/admin: [^\n]*\n/;

    // What `cs` holds under `admin` is unknown, so what it lacks or holds
    // beside `en` is too. Each message is still linted with its locale, and
    // each locale on its own.
    expect(await cli(pattern)).toEqual({
      code: 2,
      out: [
        'locales/cs/common.json:1:9  error  `{{` opens no placeholder: nothing closes it on its line, so it renders as text.  unclosed-placeholder',
        'locales/cs/common.json:1:28  error  `cs` puts 0.5, 1.5 and 2.5 in `many`, and this selection has no `many` option, so those take the fallback chain.  missing-category',
        'locales/en/common.json:1:51  error  `common.a.b` is defined again in `en`, so one of the two messages is never read.  duplicate-id',
        '',
        '3 problems (3 errors, 0 warnings)',
        '',
      ].join('\n'),
      err: expect.stringMatching(new RegExp(`${cannot.source}${uncompared.source}`)) as unknown,
    });

    const json = await cli(pattern, '--format', 'json');

    expect({ code: json.code, codes: (JSON.parse(json.out) as Problem[]).map(({ code }) => code) }).toEqual({ code: 2, codes: ['unclosed-placeholder', 'missing-category', 'duplicate-id'] });
    expect(json.err).toMatch(cannot);

    // Given as it is, its files would be read in no locale, and compared with nothing.
    const plain = await cli('locales');

    expect(plain).toMatchObject({ code: 2, out: expect.stringContaining('locales/cs/common.json:1:9  error') as unknown, err: expect.stringMatching(cannot) as unknown });
    expect(plain.err).not.toMatch(uncompared);

    // Named once, at the first argument's path to it, and compared by none
    // where any argument would read its files in a locale.
    const both = await cli('locales', pattern);

    expect(both.err.match(/Cannot read/g)).toHaveLength(1);
    expect(both).toMatchObject({ code: 2, out: expect.not.stringContaining('orphan-message') as unknown, err: expect.stringMatching(uncompared) as unknown });

    // A base it cannot list, or cannot reach, is named, not a pattern that names no file.
    for (const denied of [refused, unreachable]) {
      denied.add('locales');
      expect(await cli(pattern)).toEqual({ code: 2, out: '', err: expect.stringMatching(new RegExp(`^Cannot read locales: [^\\n]*\\n${uncompared.source}`)) as unknown });
      denied.delete('locales');
    }
  });

  it('compares nothing a locale it cannot read could change, and still lints each message', async () => {
    refused.add('locales/cs');
    await files({
      'locales/en/common.json': '{"hi": "Hi {{name}}", "bye": "Bye"}',
      'locales/de/common.json': '{"hi": "{{"}',
      'locales/cs/common.json': '{"hi": "Ahoj"}',
    });

    const pattern = 'locales/{locale}/{namespace}.json';
    const found = {
      code: 2,
      out: 'locales/de/common.json:1:9  error  `{{` opens no placeholder: nothing closes it on its line, so it renders as text.  unclosed-placeholder\n\n1 problem (1 error, 0 warnings)\n',
      err: expect.stringMatching(new RegExp(`^Cannot read locales/cs: [^\\n]*\\n${uncompared.source}`)) as unknown,
    };

    expect(await cli(pattern)).toEqual(found);
    // Any locale could be what it cannot read, the source named included.
    for (const source of ['cs', 'pl']) expect(await cli(pattern, '--source', source)).toEqual(found);
  });

  it('compares every locale where a directory it cannot read would hold files of none', async () => {
    refused.add('extra/admin');
    await files({
      'locales/en/common.json': '{"hi": "Hi", "bye": "Bye"}',
      'locales/cs/common.json': '{"hi": "Ahoj"}',
      'locales/en/admin/users.json': '{"title": "Users", "x": "X"}',
      'locales/cs/admin/users.json': '{"title": "Uzivatele"}',
      'extra/admin/x.json': '{"x": "X"}',
    });

    const pattern = 'locales/{locale}/{namespace}.json';
    const cannot = /^Cannot read extra\/admin: [^\n]*\n/;

    for (const extra of ['extra/{namespace}.json', 'extra']) {
      // Its files would have no locale, so they are compared with nothing.
      expect(await cli(pattern, extra)).toEqual({
        code: 2,
        out: [
          'locales/en/admin/users.json:1:25  warning  `cs` has no message `admin.users.x`.  missing-message',
          'locales/en/common.json:1:21  warning  `cs` has no message `common.bye`.  missing-message',
          '',
          '2 problems (0 errors, 2 warnings)',
          '',
        ].join('\n'),
        err: expect.stringMatching(new RegExp(`${cannot.source}$`)) as unknown,
      });
      expect(await cli(pattern, extra, '--source', 'pl')).toEqual({ code: 2, out: '', err: expect.stringMatching(new RegExp(`${cannot.source}No file given is written for the source locale \`pl\`\\.\\n$`)) as unknown });
      // With --locale, they would be in that locale.
      expect(await cli('--locale', 'cs', '--source', 'pl', pattern, extra)).toEqual({ code: 2, out: '', err: expect.stringMatching(new RegExp(`${cannot.source}${uncompared.source}`)) as unknown });
    }
  });

  it('reads a base it cannot reach, or a path given as it is that is no link, as a directory it cannot read', async () => {
    await files({
      'public/en/common.json': '{"hi": "Hi", "bye": "Bye"}',
      'public/cs/common.json': '{"hi": "Ahoj"}',
      'app/locales/cs/common.json': '{"bye": "Nashle"}',
      'notes.txt': 'x',
    });

    const pattern = 'public/{locale}/{namespace}.json';
    const cannot = /^Cannot read app\/locales: [^\n]*\n/;
    const missing = 'public/en/common.json:1:21  warning  `cs` has no message `common.bye`.  missing-message\n\n1 problem (0 errors, 1 warning)\n';

    unreachable.add('app/locales');
    expect(await cli(pattern, 'app/locales/{locale}/{namespace}.json', '--source', 'pl')).toEqual({ code: 2, out: '', err: expect.stringMatching(new RegExp(`${cannot.source}${uncompared.source}`)) as unknown });
    expect(await cli(pattern, 'app/locales')).toEqual({ code: 2, out: missing, err: expect.stringMatching(new RegExp(`${cannot.source}$`)) as unknown });
    expect(await cli(pattern, 'app/locales', '--locale', 'de')).toEqual({ code: 2, out: '', err: expect.stringMatching(new RegExp(`${cannot.source}${uncompared.source}`)) as unknown });

    // A path that is not there, or stands below a file, is named as given,
    // and the rest is compared.
    for (const absent of ['gone/{locale}/{namespace}.json', 'notes.txt/locales/{locale}/{namespace}.json', 'gone', 'notes.txt/x']) {
      const named = `Cannot read ${absent}: `;

      expect(await cli(pattern, absent)).toEqual({ code: 2, out: missing, err: expect.stringMatching(new RegExp(`^${named.replace(/[.{}]/g, '\\$&')}[^\\n]*\\n$`)) as unknown });
      expect(await cli(pattern, absent, '--source', 'pl')).toMatchObject({ code: 2, err: expect.stringContaining('No file given is written for the source locale `pl`.') as unknown });
    }
  });

  // Windows makes a symbolic link only with a privilege a test cannot count on.
  it.skipIf(process.platform === 'win32')('reads a link it cannot follow as a directory it cannot read, unless it reads a file there', async () => {
    await files({
      'locales/en/common.json': '{"hi": "Hi", "bye": "Bye"}',
      'locales/de/common.json': '{"hi": "Hallo"}',
      'shared/cs/common.json': '{"hi": "Ahoj"}',
      'shared/pl/common.json': '{"hi": "Czesc"}',
      'notes.txt': 'x',
    });
    await mkdir(join(cwd, 'locales/pl'));
    await symlink(join(cwd, 'shared/cs'), join(cwd, 'locales/cs'));
    await symlink(join(cwd, 'shared/pl/common.json'), join(cwd, 'locales/pl/common.json'));

    const pattern = 'locales/{locale}/{namespace}.json';
    const found = {
      code: 2,
      out: '',
      err: expect.stringMatching(new RegExp(`^Cannot read locales/cs: [^\\n]*\\n${uncompared.source}`)) as unknown,
    };

    unreachable.add('locales/cs');
    expect(await cli(pattern)).toEqual(found);
    expect(await cli(pattern, '--source', 'cs')).toEqual(found);
    unreachable.clear();

    // One the pattern reads as a file is a file, and a link to nothing there
    // is passed over, as nothing stands below it.
    unreachable.add('locales/pl/common.json');
    await symlink(join(cwd, 'gone'), join(cwd, 'locales/fr'));
    await symlink(join(cwd, 'notes.txt/x'), join(cwd, 'locales/it'));
    await symlink(join(cwd, 'locales/sk'), join(cwd, 'locales/sk'));
    expect(await cli(pattern)).toEqual({
      code: 0,
      out: [
        'locales/en/common.json:1:21  warning  `cs` has no message `common.bye`.  missing-message',
        'locales/en/common.json:1:21  warning  `de` has no message `common.bye`.  missing-message',
        'locales/en/common.json:1:21  warning  `pl` has no message `common.bye`.  missing-message',
        '',
        '3 problems (0 errors, 3 warnings)',
        '',
      ].join('\n'),
      err: '',
    });
  });

  it('reads a file a pattern reads as the pattern does, whatever path a directory given as it is reaches it at', async () => {
    await files({ 'shared/en/common.json': '{"hi": "{{"}', 'locales/cs/common.json': '{"hi": "Ahoj"}', 'config/app.json': '{"x": "{{"}' });
    await link('shared/en', 'locales/en');
    await link('locales', 'l10n');

    const found = (path: string) => ({
      code: 1,
      out: expect.stringMatching(new RegExp(`^config/app\\.json:1:8 {2}error .*\\n${path}/en/common\\.json:1:9 {2}error .* unclosed-placeholder\\n\\n2 problems`)) as unknown,
      err: '1 file has no locale, so its messages are linted without one, and compared with no other locale\'s. Name it in a pattern, as in curly-lint "locales/{locale}/{namespace}.json".\n',
    });

    expect(await cli('.', 'locales/{locale}/{namespace}.json')).toMatchObject(found('locales'));
    expect(await cli('.', 'l10n/{locale}/{namespace}.json')).toMatchObject(found('l10n'));
  });

  it('reads no hidden name and no node_modules, but where a pattern writes it', async () => {
    await files({
      'node_modules/x/en.json': '{"a": "{{"}',
      '.cache/en.json': '{"a": "{{"}',
      'en.json': '{"a": "ok"}',
      'packages/app/.i18n/en.json': '{"a": "{{"}',
      'locales/en/common.json': '{"a": "A"}',
      'locales/en/.draft.json': '{"a": "{{"}',
      'locales/en/node_modules/x.json': '{"a": "{{"}',
      'locales/en/admin/.git/x.json': '{"a": "{{"}',
      'i18n/.en.json': '{"a": "{{"}',
    });

    expect(await cli('.')).toMatchObject({ code: 0, out: '' });
    expect(await cli('locales/{locale}/{namespace}.json')).toEqual({ code: 0, out: '', err: '' });
    expect(await cli('packages/{namespace}/.i18n/{locale}.json')).toMatchObject({ code: 1, out: expect.stringMatching(/^packages\/app\/\.i18n\/en\.json:1:8 {2}error .*\n\n1 problem/) as unknown, err: '' });
    expect(await cli('i18n/.{locale}.json')).toMatchObject({ code: 1, out: expect.stringMatching(/^i18n\/\.en\.json:1:8 {2}error .*\n\n1 problem/) as unknown, err: '' });
  });

  it('exits 2 on wrong arguments and on a path it cannot read', async () => {
    expect((await cli()).code).toBe(2);
    expect((await cli('--nope', '.')).code).toBe(2);
    expect((await cli('--format', 'xml', '.')).code).toBe(2);
    expect(await cli('missing')).toMatchObject({ code: 2, err: expect.stringContaining('Cannot read missing') as unknown });
    expect(await cli('--help')).toMatchObject({ code: 0, out: expect.stringContaining('Usage: curly-lint') as unknown });
  });
});

// What a project installs as `curly-lint`: the build, run by the interpreter
// its first line names. The suite above drives the source's `run`; this runs
// what the build made of it.
describe('the built command', () => {
  const bin = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  const runtime = 'Deno' in globalThis ? ['run', '-A', bin] : [bin];

  it('runs as the bin, and exits as the source does', async () => {
    await files({ 'en.json': '{"a": "{{v"}' });

    const { status, stdout } = spawnSync('node', [bin, 'en.json'], { cwd, encoding: 'utf8' });
    const { code, out } = await cli('en.json');

    expect(await readFile(bin, 'utf8')).toMatch(/^#!\/usr\/bin\/env node\n/);
    expect(out).toContain('unclosed-placeholder');
    expect({ status, stdout }).toEqual({ status: code, stdout: out });
  });

  // A pipe a shell makes, which stands nowhere on disk. Windows has no
  // `/dev/stdin`.
  it.skipIf(process.platform === 'win32')('reads a file given as it is that stands nowhere', () => {
    const { status, stdout } = spawnSync('sh', ['-c', 'printf \'{"a": "{{"}\' | node "$0" /dev/stdin', bin], { cwd, encoding: 'utf8' });

    expect(status).toBe(1);
    expect(stdout).toContain('dev/stdin:1:8  error');
  });

  // A report far larger than any pipe's buffer, to a reader gone before it
  // reads any. The catalogue holds warnings alone, so the run exits 0,
  // whichever stream is closed.
  it('exits as the lint decided where its reader is gone, and prints no trace', async () => {
    await files({ 'en.json': JSON.stringify(Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`m${i}`, '\\b'.repeat(100)]))) });

    const { code, err } = await cli('en.json');
    const closed = (stderr: boolean) => new Promise<{ status: number | null, stderr: string }>((resolve) => {
      const child = spawn(process.execPath, [...runtime, 'en.json'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      let text = '';

      child.stdout.destroy();

      if (stderr) child.stderr.destroy();
      else child.stderr.setEncoding('utf8').on('data', (chunk: string) => { text += chunk; });

      child.on('close', (status) => resolve({ status, stderr: text }));
    });

    expect(code).toBe(0);
    expect(err).not.toBe('');
    expect(await closed(false)).toEqual({ status: 0, stderr: err });
    expect(await closed(true)).toEqual({ status: 0, stderr: '' });
  });

  // A device that takes nothing, as a full disk does. Only Linux has one.
  it.skipIf(!existsSync('/dev/full'))('says where its output cannot be written, and exits 2', async () => {
    await files({ 'en.json': '{"a": "\\\\b"}' });

    const full = await open('/dev/full', 'w');
    const report = await cli('--locale', 'en', 'en.json');
    const lost = spawnSync(process.execPath, [...runtime, '--locale', 'en', 'en.json'], { cwd, encoding: 'utf8', stdio: ['ignore', full.fd, 'pipe'] });
    const noted = await cli('en.json');
    const unsaid = spawnSync(process.execPath, [...runtime, 'en.json'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', full.fd] });

    await full.close();

    expect(report).toMatchObject({ code: 0, out: expect.stringContaining('inert-escape') as unknown, err: '' });
    expect(lost.status).toBe(2);
    expect(lost.stderr).toMatch(/^Cannot write the report: [^\n]+\n$/);
    expect(noted.err).not.toBe('');
    expect({ status: unsaid.status, stdout: unsaid.stdout }).toEqual({ status: 2, stdout: noted.out });
  });

  // A regular file, as a shell's `>` makes one, and one open for reading
  // alone, which takes no write at all. Deno's standard output, as Rust's
  // does, reports a write to a descriptor that cannot take one as taken whole.
  it('writes its report to a regular file, and says where the file cannot be written', async () => {
    await files({ 'en.json': '{"a": "\\\\b"}' });

    const path = join(cwd, 'report.txt');
    const report = await cli('--locale', 'en', 'en.json');
    const lint = async (flags: 'w' | 'r') => {
      const file = await open(path, flags);
      const { status, stderr } = spawnSync(process.execPath, [...runtime, '--locale', 'en', 'en.json'], { cwd, encoding: 'utf8', stdio: ['ignore', file.fd, 'pipe'] });

      await file.close();

      return { status, stderr, file: await readFile(path, 'utf8') };
    };

    expect(report).toMatchObject({ code: 0, out: expect.stringContaining('inert-escape') as unknown, err: '' });
    expect(await lint('w')).toEqual({ status: 0, stderr: '', file: report.out });

    if ('Deno' in globalThis) return;

    const lost = await lint('r');

    expect(lost).toMatchObject({ status: 2, file: report.out });
    expect(lost.stderr).toMatch(/^Cannot write the report: [^\n]+\n$/);
  });
});
