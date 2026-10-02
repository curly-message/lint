import { describe, expect, it } from 'vitest';
import { localeOf, readCatalogue } from '../src';
import type { Read } from '../src';

const ok = (read: Read) => {
  if (!read.ok) throw new Error(read.message);

  return read;
};

describe('readCatalogue', () => {
  it('reads what JSON.parse reads', () => {
    const text = '{"a": "A", "b": {"c": [1, true, null, "C"]}, "d": -1.5e2}';

    expect(ok(readCatalogue(text)).value).toEqual(JSON.parse(text));
  });

  it('says where each string stands, past the escape sequences it spells', () => {
    const text = '{\n  "q": "say \\"{{x}\\" \\u0041"\n}';
    const { strings } = ok(readCatalogue(text));
    const [q] = strings;

    expect(q.path).toEqual(['q']);
    expect(q.value).toBe('say "{{x}" A');
    expect(text.slice(q.start, q.end)).toBe('"say \\"{{x}\\" \\u0041"');
    expect(text.slice(q.offsetOf(q.value.indexOf('{{')), q.offsetOf(q.value.indexOf('{{') + 2))).toBe('{{');
    expect(text.slice(q.offsetOf(q.value.indexOf('A')))).toMatch(/^\\u0041/);
    expect(q.offsetOf(q.value.length)).toBe(q.end - 1);
  });

  it('lets a later member replace an earlier one, and says which was replaced', () => {
    const text = '{"a": "first", "b": "kept", "a": {"x": "second"}}';
    const read = ok(readCatalogue(text));

    expect(read.value).toEqual(JSON.parse(text));
    expect(read.strings.map(({ value }) => value)).toEqual(['kept', 'second']);
    expect(read.replaced.map(({ path, start, end }) => [path, text.slice(start, end)])).toEqual([[['a'], '"a"']]);
  });

  it('drops every string a replaced member held, at any depth, however often it is replaced', () => {
    const read = ok(readCatalogue('{"a": {"b": "x", "b": "y"}, "a": "z", "c": {"d": "w", "d": "v", "d": "u"}}'));

    expect(read.strings.map(({ value }) => value)).toEqual(['z', 'u']);
    expect(read.replaced.map(({ path }) => path.join('.'))).toEqual(['a.b', 'a', 'c.d', 'c.d']);
  });

  it('reads `__proto__` as a member', () => {
    const read = ok(readCatalogue('{"__proto__": {"x": "y"}}'));

    expect(Object.keys(read.value as object)).toEqual(['__proto__']);
    expect(read.strings[0].path).toEqual(['__proto__', 'x']);
  });

  it('answers where a file stops being JSON', () => {
    for (const [text, offset] of [['{"a": }', 6], ['{"a": "b",}', 10], ['{"a": "b"} x', 11], ['{"a": "b\nc"}', 8], ['', 0]] as const) {
      const read = readCatalogue(text);

      expect(read.ok).toBe(false);
      if (!read.ok) expect(read.offset).toBe(offset);
    }
  });

  it('names a character that would break the line it is reported on by its code point', () => {
    expect(readCatalogue('{"a": "x\ny"}')).toMatchObject({ ok: false, message: 'Expected a control character to be escaped, found U+000A' });
    expect(readCatalogue('{"a": \u2028}')).toMatchObject({ ok: false, message: 'Expected a value, found U+2028' });
    expect(readCatalogue('{"a": \ud83d\ude00}')).toMatchObject({ ok: false, message: 'Expected a value, found `\ud83d\ude00`' });
  });

  it('refuses a catalogue nested deeper than it reads, and never overflows', () => {
    const read = readCatalogue(`{"a": ${'['.repeat(6000)}"x"${']'.repeat(6000)}}`);

    expect(read).toMatchObject({ ok: false, message: 'The catalogue nests deeper than 512 levels' });
    expect(ok(readCatalogue(`${'['.repeat(511)}"x"${']'.repeat(511)}`)).strings).toHaveLength(1);
  });

  it('skips a byte order mark', () => {
    expect(ok(readCatalogue('\ufeff{"a": "b"}')).strings[0].start).toBe(7);
  });
});

describe('localeOf', () => {
  it('reads the directory that holds the file where it names a locale, and the namespace after it', () => {
    expect(localeOf('src/lib/translations/cs/common.json')).toEqual({ locale: 'cs', namespace: ['common'] });
    expect(localeOf('locales/en.json')).toEqual({ locale: 'en', namespace: [] });
    expect(localeOf('i18n/en_US/a/b.json')).toEqual({ locale: 'en-US', namespace: ['a', 'b'] });
    expect(localeOf('C:\\app\\locales\\de\\shop.json')).toEqual({ locale: 'de', namespace: ['shop'] });
  });

  it('reads a file named like a locale under a locale\'s directory as a namespace', () => {
    expect(localeOf('locales/en/sms.json')).toEqual({ locale: 'en', namespace: ['sms'] });
  });

  it('reads the file\'s own name before a directory farther up', () => {
    expect(localeOf('tests/it/locales/en.json')).toEqual({ locale: 'en', namespace: [] });
    expect(localeOf('src/my/translations/de.json')).toEqual({ locale: 'de', namespace: [] });
    expect(localeOf('locales/cs/admin/users.json')).toEqual({ locale: 'cs', namespace: ['admin', 'users'] });
  });

  it('takes a two-letter language the host has no rules for, or rewrites', () => {
    expect(localeOf('locales/mi.json')).toEqual({ locale: 'mi', namespace: [] });
    expect(localeOf('locales/iw/common.json')).toEqual({ locale: 'iw', namespace: ['common'] });
    expect(localeOf('locales/tl_PH.json')).toEqual({ locale: 'tl-PH', namespace: [] });
  });

  it('takes no segment that names no language, or a longer alias the host rewrites', () => {
    expect(localeOf('src/app.json')).toEqual({ namespace: [] });
    expect(localeOf('translations/common.json')).toEqual({ namespace: [] });
    expect(localeOf('ui/db.json')).toEqual({ namespace: [] });
  });
});
