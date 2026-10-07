import { readFileSync } from 'node:fs';
import json from '@eslint/json';
import { RULES } from '@curly-message/lint';
import { Linter } from 'eslint';
import type { SourceCode } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, expectTypeOf, it } from 'vitest';
import plugin from '@curly-message/eslint-plugin';
import type { Settings } from '@curly-message/eslint-plugin';

const linter = new Linter({ configType: 'flat' });

const config = (settings?: Settings): Linter.Config[] => [
  { files: ['**/*.js'], ...plugin.configs.recommended },
  { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser }, ...plugin.configs.recommended },
  { files: ['**/*.json'], language: 'json/json', plugins: { json, '@curly-message': plugin }, rules: plugin.configs.recommended.rules },
  ...(settings ? [{ settings: { 'curly-message': settings } }] : []),
];

const lint = (code: string | SourceCode, filename: string, settings?: Settings) => linter.verify(code, config(settings), { filename })
  .map(({ ruleId, line, column, endLine, endColumn, severity, message }) => ({ ruleId, at: `${line}:${column}-${endLine}:${endColumn}`, severity, message }));

describe('the plugin', () => {
  it('has a rule for every finding a single message can be found with', () => {
    expect(Object.keys(plugin.rules ?? {})).toEqual(RULES.filter(({ scope }) => scope !== 'catalogue').map(({ code }) => code));
  });

  it('is what the README lists, rule by rule', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

    for (const { code, severity, scope } of RULES) {
      if (scope !== 'catalogue') expect(readme).toContain(`| \`@curly-message/${code}\` | ${severity === 'error' ? 'error' : 'warn'} |`);
    }
  });

  it('types its config by name', () => {
    expectTypeOf<keyof typeof plugin.configs>().toEqualTypeOf<'recommended'>();
  });

  it('recommends errors as errors and warnings as warnings', () => {
    for (const { code, severity, scope } of RULES) {
      if (scope === 'catalogue') continue;

      expect(plugin.configs.recommended.rules?.[`@curly-message/${code}`]).toBe(severity === 'error' ? 'error' : 'warn');
    }
  });
});

describe('in JavaScript', () => {
  it('lints the first argument of `resolve`, as a function or a method', () => {
    expect(lint("resolve('Hi {{name');\nparser.resolve(`{{v:zz}}`);", 'src/app.js')).toEqual([
      { ruleId: '@curly-message/unclosed-placeholder', at: '1:13-1:15', severity: 2, message: '`{{` opens no placeholder: nothing closes it on its line, so it renders as text.' },
      { ruleId: '@curly-message/unknown-modifier', at: '2:21-2:23', severity: 2, message: '`zz` is no modifier the format defines or the host registers, so the placeholder takes its fallback chain.' },
    ]);
  });

  it('lints no other call, no other argument and no string with an expression', () => {
    expect(lint("t('{{');\nresolve(id, '{{');\nresolve(`{{${x}`);\nresolve[name]('{{');", 'src/app.js')).toEqual([]);
  });

  it('reads the callees a project names', () => {
    expect(lint("translate('{{');\nresolve('{{');", 'src/app.js', { callees: ['translate'] }).map(({ at }) => at)).toEqual(['1:12-1:14']);
  });

  it('reads a method called through a property named by a string', () => {
    expect(lint("i18n['resolve']('{{v:zz}}');", 'src/app.js').map(({ at }) => at)).toEqual(['1:22-1:24']);
  });

  it('lints TypeScript given a parser for it', () => {
    expect(lint("const greet = (name: string): string => resolve('Hi {{name', name);", 'src/app.ts').map(({ ruleId, at }) => `${ruleId} ${at}`)).toEqual([
      '@curly-message/unclosed-placeholder 1:53-1:55',
    ]);
  });

  it('lints every property of a catalogue module, with the locale the settings name', () => {
    const found = lint("export default {\n  files: '{{n:plural; one:a; other:b;}}',\n  nested: { esc: 'C:\\\\d {{v; a:A; A:B;}}' },\n};", 'src/translations/cs/common.js', { catalogue: true, locale: 'cs' });

    expect(found.map(({ ruleId, at }) => `${ruleId} ${at}`)).toEqual([
      '@curly-message/missing-category 2:15-2:21',
      '@curly-message/missing-category 2:15-2:21',
      // A string spelled with an escape sequence is pointed at whole.
      '@curly-message/duplicate-option 3:18-3:42',
      '@curly-message/inert-escape 3:18-3:42',
    ]);
  });

  it('lints a string under a computed key or in an array of a catalogue module', () => {
    const found = lint("export default { ['a']: '{{v:zz}}', list: ['{{w:zz}}'] };", 'src/translations/en/common.js', { catalogue: true });

    expect(found.map(({ at }) => at)).toEqual(['1:30-1:32', '1:49-1:51']);
  });

  it('reads no locale off a path', () => {
    // `be` names Belarusian, which has `few` and `many`, and `ms` Malay,
    // which has neither `one` nor `few`.
    expect(lint("export default { files: '{{n:plural; one:a; other:b;}}' };", 'src/translations/be/common.js', { catalogue: true })).toEqual([]);
    expect(lint('{ "files": "{{n:plural; one:a; few:b; other:c;}}" }', 'locales/ms/common.json')).toEqual([]);
  });

  it('reads the modifiers Intl defines as unknown where the host satisfies Core alone', () => {
    expect(lint("resolve('{{n:number}} {{v:eq; a:A;}}');", 'src/app.js', { intl: false }).map(({ ruleId }) => ruleId)).toEqual(['@curly-message/unknown-modifier']);
  });

  it('reads a locale written with `_` as one written with `-`', () => {
    expect(lint("resolve('{{n:plural; one:a; other:b;}}');", 'src/app.js', { locale: 'cs_CZ' }).map(({ ruleId }) => ruleId)).toEqual([
      '@curly-message/missing-category',
      '@curly-message/missing-category',
    ]);
  });

  it('reads a locale and the host modifiers a project names', () => {
    expect(lint("resolve('{{n:plural; one:a; other:b;}} {{v:upper}}');", 'src/app.js').map(({ ruleId }) => ruleId)).toEqual(['@curly-message/unknown-modifier']);
    expect(lint("resolve('{{n:plural; one:a; other:b;}} {{v:upper}}');", 'src/app.js', { locale: 'cs', modifiers: ['upper'] }).map(({ ruleId }) => ruleId)).toEqual(['@curly-message/missing-category', '@curly-message/missing-category']);
  });
});

describe('in JSON', () => {
  it('lints every string a member or an element holds, past escape sequences', () => {
    const text = '{\n  "q": "say \\"{{x}\\"",\n  "nested": { "list": ["{{y:eq}}"] }\n}';

    expect(lint(text, 'locales/en/common.json').map(({ ruleId, at }) => `${ruleId} ${at}`)).toEqual([
      '@curly-message/unclosed-placeholder 2:15-2:17',
      '@curly-message/missing-options 3:29-3:31',
    ]);
  });

  it('reads the locale the block of the config that matches a catalogue names', () => {
    const blocks = ['en', 'cs'].map((locale): Linter.Config => ({
      files: [`locales/${locale}/**/*.json`],
      language: 'json/json',
      plugins: { json, '@curly-message': plugin },
      rules: plugin.configs.recommended.rules,
      settings: { 'curly-message': { locale } },
    }));
    const text = '{ "files": "{{n:plural; one:soubor; few:soubory; other:soubor\u016f;}}" }';

    expect(linter.verify(text, blocks, { filename: 'locales/cs/common.json' }).map(({ ruleId }) => ruleId)).toEqual(['@curly-message/missing-category']);
    expect(linter.verify(text, blocks, { filename: 'locales/en/common.json' }).map(({ ruleId }) => ruleId)).toEqual(['@curly-message/unused-category']);
  });

  it('lints no member name', () => {
    expect(lint('{ "{{": "ok" }', 'en.json')).toEqual([]);
  });

  it('lints a document that is a string', () => {
    expect(lint('"Hi {{name"', 'locales/en/greeting.json').map(({ at }) => at)).toEqual(['1:5-1:7']);
  });

  it('lints a file anew under other settings', () => {
    const text = '{ "files": "{{n:plural; one:soubor; few:soubory; other:soubor\u016f;}}" }';

    expect(lint(text, 'common.json', { locale: 'cs' }).map(({ ruleId }) => ruleId)).toEqual(['@curly-message/missing-category']);
    expect(lint(linter.getSourceCode(), 'common.json', { locale: 'en' }).map(({ ruleId }) => ruleId)).toEqual(['@curly-message/unused-category']);
  });
});
