import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lintMessage, RULES } from '@curly-message/lint';
import type { MessageOptions } from '@curly-message/lint';

// The code, the text it points at, and nothing else, so a case reads as the
// message it is about.
const lint = (message: string, options?: MessageOptions) => lintMessage(message, options)
  .map(({ code, start, end }) => [code, message.slice(start, end)]);

// What a message, read alone or with its locale, is found with is pinned by the
// fixture set at the repository's root, `fixtures/message/`. What stays here
// is what data does not pin: a message no fixture holds, and the plural rules
// the host's `Intl` answers.
describe('a message', () => {
  it('nesting-limit: a message nested deeper than any call stack goes, at the placeholder past the limit', () => {
    const deep = `${'{{v; a:'.repeat(100_000)}x${'}}'.repeat(100_000)}`;

    expect(lintMessage(deep)).toMatchObject([{ code: 'nesting-limit', start: 8 * 7, end: deep.length - 8 * 2 }]);
  });

  it('reads the plural rules of the host\'s Intl', () => {
    expect(lintMessage('{{n:plural; one:soubor; few:soubory; other:soubor\u016f;}}', { locale: 'cs' }).map(({ code, message }) => [code, message])).toEqual([
      ['missing-category', '`cs` puts 0.5, 1.5 and 2.5 in `many`, and this selection has no `many` option, so those take the fallback chain.'],
    ]);
    expect(lint('{{n:plural; zero:Z; one:a; other:b;}}', { locale: 'en' })).toEqual([['unused-category', 'zero']]);
    expect(lint('{{n:ordinal; one:st; other:th;}}', { locale: 'en_US' }).map(([code]) => code)).toEqual(['missing-category', 'missing-category']);
    expect(lint('{{n:plural; one:a; other:b;}}', { locale: 'xx' })).toEqual([]);
    expect(lint('{{n:plural; one:a; other:b;}}', { locale: 'not a locale' })).toEqual([]);
  });

  it('finds nothing in a message that is not well-formed Unicode text', () => {
    for (const message of ['\ud800 {{', '{{ \udc00', '{{v:zz}}\ud83d']) expect(lintMessage(message)).toEqual([]);
    expect(lint('\ud83d\ude00 {{')).toEqual([['unclosed-placeholder', '{{']]);
  });
});

describe('the rule table', () => {
  it('lists every code a message can be found with once', () => {
    const codes = RULES.map(({ code }) => code);

    expect(new Set(codes).size).toBe(codes.length);
  });

  it('is what the README describes, rule by rule and severity by severity', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

    for (const { code, severity } of RULES) {
      expect(readme).toMatch(new RegExp(`#### \`${code}\`\n\n${severity === 'error' ? 'Error' : 'Warning'}\\.`));
    }
  });

  it('gives each finding the severity its rule has', () => {
    for (const { code, severity } of lintMessage('{{v:zz}} {{w:eq}} C:\\d {{n}} {{n:plural; One:a; other:b;}}')) {
      expect(RULES.find((rule) => rule.code === code)?.severity).toBe(severity);
    }
  });
});
