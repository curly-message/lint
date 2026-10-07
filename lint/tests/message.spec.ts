import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lintMessage, RULES } from '@curly-message/lint';
import type { MessageOptions } from '@curly-message/lint';
import { DEEP, overflowing } from './overflow';

// The code, the text it points at, and nothing else, so a case reads as the
// message it is about.
const lint = (message: string, options?: MessageOptions) => lintMessage(message, options)
  .map(({ code, start, end }) => [code, message.slice(start, end)]);

describe('a message, read alone', () => {
  it('finds nothing in a message that renders as written', () => {
    expect(lint('Hello, {{name; default:Guest;}}! You have {{count:number;}} {{count; 1:message; default:messages;}}.')).toEqual([]);
    expect(lint('')).toEqual([]);
    expect(lint('No placeholder at all.')).toEqual([]);
  });

  it('unclosed-placeholder: a `{{` that opens nothing', () => {
    expect(lint('Hello {{name')).toEqual([['unclosed-placeholder', '{{']]);
    expect(lint('Hello {{name\n}}')).toEqual([['unclosed-placeholder', '{{']]);
    // An escaped brace opens nothing either, and is no defect.
    expect(lint('Braces \\{\\{ like this \\}\\}')).toEqual([]);
    // Inside an option value too.
    expect(lint('{{v; a:{{w; default:x;}}')).toEqual([['unclosed-placeholder', '{{']]);
    expect(lintMessage('a {{b')[0].message).toContain('nothing closes it on its line');
    expect(lintMessage('{{a{{b}}')[0].message).toContain('what it encloses is not a placeholder');
    expect(lintMessage('{{a{{b}} {{c').map(({ message }) => message.split(':')[1].split(',')[0])).toEqual([
      ' what it encloses is not a placeholder',
      ' nothing closes it on its line',
    ]);
  });

  it('unknown-modifier: a name nobody answers to, and a host registering one', () => {
    expect(lint('{{v:zz}}')).toEqual([['unknown-modifier', 'zz']]);
    expect(lint('{{:zz}}')).toEqual([['unknown-modifier', 'zz']]);
    expect(lint('{{v:zz}}', { modifiers: ['zz'] })).toEqual([]);
    expect(lint('{{v:number}} {{v:plural; other:x;}}')).toEqual([]);
  });

  it('unknown-modifier: the modifiers Intl defines, for a host that satisfies Core alone', () => {
    expect(lint('{{n:number}} {{n:plural; one:a; other:b;}} {{v:eq; a:A;}}', { intl: false, locale: 'cs' })).toEqual([
      ['unknown-modifier', 'number'],
      ['unknown-modifier', 'plural'],
    ]);
    expect(lintMessage('{{n:number}}', { intl: false })[0].message).toContain('Intl');
    expect(lint('{{n:number}}', { intl: false, modifiers: ['number'] })).toEqual([]);
  });

  it('missing-options: a selection asked to select from nothing', () => {
    expect(lint('{{v:eq}}')).toEqual([['missing-options', 'eq']]);
    expect(lint('{{n:plural; default:D;}}')).toEqual([['missing-options', 'plural']]);
    // A formatting modifier selects nothing, a placeholder naming no key asks
    // nothing, and a host's own `eq` is its own business.
    expect(lint('{{n:number}}')).toEqual([]);
    expect(lint('{{:eq}}')).toEqual([]);
    expect(lint('{{v:eq}}', { modifiers: ['eq'] })).toEqual([]);
  });

  it('nesting-limit: the first placeholder past eight levels', () => {
    const nested = (depth: number): string => (depth === 1 ? '{{v}}' : `{{v; a:${nested(depth - 1)};}}`);

    expect(lint(nested(8))).toEqual([]);
    expect(lint(nested(10)).map(([code]) => code)).toEqual(['nesting-limit']);
    expect(lint(nested(9))).toEqual([['nesting-limit', '{{v}}']]);
  });

  it('nesting-limit: nothing else past the limit, which resolution never reaches', () => {
    const wrapped = (inner: string) => `${'{{w; a:'.repeat(8)}${inner}${';}}'.repeat(8)}`;

    expect(lint(wrapped('{{v:zz}}'))).toEqual([['nesting-limit', '{{v:zz}}']]);
    expect(lint(wrapped('{{v; Default:x; a:{{n:plural; one:y;}};}}')).map(([code]) => code)).toEqual(['nesting-limit']);
    // The fallback chain reads its inline default, so the text is still read.
    expect(lint(wrapped('{{v; default:\\x;}}')).map(([code]) => code)).toEqual(['nesting-limit', 'inert-escape']);
  });

  it('nesting-limit: a message nested deeper than a call stack goes, which never throws', DEEP, () => {
    const deep = overflowing();

    expect(lintMessage(deep)).toMatchObject([{ code: 'nesting-limit', start: 0, end: deep.length }]);
  });

  it('default-case: `default` spelled in another case is an option', () => {
    expect(lint('{{v; a:A; DEFAULT:D;}}')).toEqual([['default-case', 'DEFAULT']]);
    expect(lintMessage('{{v; Default:D;}}')[0].message).toContain('this placeholder has none');
    // Beside the inline default, it is how `eq` selects for the value `default`.
    expect(lint('{{mode; Default:Standard settings; custom:Custom settings; default:Unknown}}')).toEqual([]);
  });

  it('duplicate-option: an option an earlier one selects in place of', () => {
    expect(lint('{{v; a:1; A:2;}}')).toEqual([['duplicate-option', 'A']]);
    expect(lint('{{v:ne; x:1; X:2;}}')).toEqual([['duplicate-option', 'X']]);
    expect(lint('{{v:lt; 2:a; 2.0:b;}}')).toEqual([['duplicate-option', '2.0']]);
    expect(lint('{{n:plural; one:a; 2:b; 2.0:c; one:d; other:e;}}')).toEqual([['duplicate-option', '2.0'], ['duplicate-option', 'one']]);
    expect(lint('{{v; default:a; default:b;}}')).toEqual([['duplicate-option', 'default']]);
    // `lte` reaches `2.0` by text where the value is `2.0`.
    expect(lint('{{v:lte; 2:a; 2.0:b;}}')).toEqual([]);
    // A host's modifier compares its own way.
    expect(lint('{{v:eq; a:1; A:2;}}', { modifiers: ['eq'] })).toEqual([]);
  });

  it('unreachable-option: an option its modifier never selects', () => {
    expect(lint('{{v:lt; 5:a; abc:b;}}')).toEqual([['unreachable-option', 'abc']]);
    expect(lint('{{v:lt; -Infinity:never; 5:small; default:D}}')).toEqual([['unreachable-option', '-Infinity']]);
    expect(lint('{{v:gt; Infinity:never; 5:big; default:D}}')).toEqual([['unreachable-option', 'Infinity']]);
    expect(lint('{{v:lt; Infinity:finite; default:D}}')).toEqual([]);
    // `ne` selects the first of two keys that differ, whatever the value.
    expect(lint('{{v:ne; a:not a; b:not b; c:not c; default:D}}')).toEqual([['unreachable-option', 'c']]);
    expect(lint('{{v:ne; a:not a; b:not b; default:D}}')).toEqual([]);
    expect(lint('{{n:number; 1:one;}}')).toEqual([['unreachable-option', '1']]);
    expect(lint('{{n:ordinal; 1.5:x; other:y;}}')).toEqual([['unreachable-option', '1.5']]);
    // `lte` selects `abc` by text.
    expect(lint('{{v:lte; abc:b;}}')).toEqual([]);
  });

  it('unknown-category: a plural key that is neither a category nor a number', () => {
    expect(lint('{{n:plural; One:a; other:b; 1,000:c; twelve:d; 1e3:e;}}')).toEqual([
      ['unknown-category', 'One'],
      ['unknown-category', '1,000'],
      ['unknown-category', 'twelve'],
    ]);
    expect(lintMessage('{{n:plural; One:a; other:b;}}')[0].message).toContain('The category is `one`');
    expect(lintMessage('{{n:plural; twelve:a; other:b;}}')[0].message).not.toContain('The category is');
  });

  it('inert-escape: a backslash that cancels nothing', () => {
    expect(lint('C:\\Users\\d')).toEqual([['inert-escape', '\\U'], ['inert-escape', '\\d']]);
    expect(lint('\\{ \\} \\: \\; \\\\ \\  ok')).toEqual([]);
    expect(lint('{{v; a\\x:b;}}')).toEqual([['inert-escape', '\\x']]);
  });

  it('bare-count: a count shown as written beside `plural`', () => {
    expect(lint('{{n}} {{n:plural; one:file; other:files;}}')).toEqual([['bare-count', '{{n}}']]);
    expect(lint('{{n:number}} {{n:plural; one:file; other:files;}}')).toEqual([]);
    expect(lint('{{m}} {{n:plural; one:file; other:files;}}')).toEqual([]);
    expect(lint('{{n}} {{n:plural; one:file; other:files;}}', { modifiers: ['plural'] })).toEqual([]);
  });
});

describe('a message, read with its locale', () => {
  it('unused-category: a category the locale never answers', () => {
    expect(lint('{{n:plural; zero:Z; one:a; other:b;}}', { locale: 'en' })).toEqual([['unused-category', 'zero']]);
    expect(lintMessage('{{n:plural; zero:Z; one:a; other:b;}}', { locale: 'en' })[0].message).toContain('Write `0:`');
    expect(lint('{{n:plural; zero:Z; one:a; two:b; few:c; many:d; other:e;}}', { locale: 'ar' })).toEqual([]);
    expect(lint('{{n:ordinal; one:st; two:nd; few:rd; other:th;}}', { locale: 'en' })).toEqual([]);
  });

  it('missing-category: a category the locale answers with no option for it', () => {
    expect(lint('{{n:plural; one:soubor; few:soubory; other:soubor\u016f;}}', { locale: 'cs' })).toEqual([['missing-category', 'plural']]);
    expect(lintMessage('{{n:plural; one:soubor; few:soubory; other:soubor\u016f;}}', { locale: 'cs' })[0].message).toBe('`cs` puts 0.5, 1.5 and 2.5 in `many`, and this selection has no `many` option, so those take the fallback chain.');
    expect(lint('{{n:ordinal; one:st; other:th;}}', { locale: 'en' }).map(([code]) => code)).toEqual(['missing-category', 'missing-category']);
    // Number keys for some of the category's counts leave the others: Polish
    // puts 22 in `few` as well.
    expect(lint('{{n:plural; 2:a; 3:b; 4:c; one:x; many:y; other:z;}}', { locale: 'pl' })).toEqual([['missing-category', 'plural']]);
  });

  it('keyed-category: a category with no option, every count of which has a number key', () => {
    // A number key selects for its value alone, and the category holds more:
    // the value's negation, and numbers shown as it.
    expect(lintMessage('{{n:plural; 1:one file; other:files;}}', { locale: 'en' }).map(({ code, severity, message }) => [code, severity, message])).toEqual([[
      'keyed-category',
      'warning',
      'Every count `en` puts in `one` has a number key, but -1, 1.001 and -1.001 fall there too, and this selection has no `one` option, so those take the fallback chain.',
    ]]);
    expect(lint('{{n:plural; 0:none; 1:one file; other:files;}}', { locale: 'en' })).toEqual([['keyed-category', 'plural']]);
    // Czech puts 2, 3 and 4 alone in `few`.
    expect(lint('{{n:plural; 2:a; 3:b; 4:c; one:x; many:y; other:z;}}', { locale: 'cs' })).toEqual([['keyed-category', 'plural']]);
    expect(lint('{{n:plural; 1:one file; one:file; other:files;}}', { locale: 'en' })).toEqual([]);
  });

  it('reads no locale rules without a locale, or for one the host has no rules for', () => {
    expect(lint('{{n:plural; one:a; other:b;}}')).toEqual([]);
    expect(lint('{{n:plural; one:a; other:b;}}', { locale: 'xx' })).toEqual([]);
    expect(lint('{{n:plural; one:a; other:b;}}', { locale: 'not a locale' })).toEqual([]);
  });

  it('reads a locale written with `_` as one written with `-`', () => {
    expect(lint('{{n:plural; one:a; other:b;}}', { locale: 'cs_CZ' }).map(([code]) => code)).toEqual(['missing-category', 'missing-category']);
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
