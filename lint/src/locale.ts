const LANGUAGES = new Intl.DisplayNames('en', { type: 'language', fallback: 'none' });

// A segment the host has plural rules for as it is written, or one whose
// language is a two-letter code the host can name: `mi` has no rules, and `iw`
// is rewritten to `he`, but both are languages. A longer alias the host
// rewrites is not taken: `src` would be read as Sardinian.
const isLocale = (segment: string) => {
  const tag = segment.replace(/_/g, '-');

  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(tag)) return undefined;

  try {
    const [found] = Intl.PluralRules.supportedLocalesOf([tag]);

    if (found?.toLowerCase() === tag.toLowerCase()) return tag;

    const [language] = tag.split('-');

    return language.length === 2 && LANGUAGES.of(language) !== undefined ? tag : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The locale a catalogue file is written for, read off its path, and the
 * namespace its ids sit under. The locale is the directory the file is in
 * where that names one, else the file's own name, else the nearest directory
 * farther up that names one. So `locales/cs/common.json` holds `cs` messages
 * under `common`, `locales/en/sms.json` holds `en` messages under `sms` though
 * `sms` names a locale too, `tests/it/locales/en.json` holds `en` messages
 * under no namespace though `it` names one too, and
 * `locales/cs/admin/users.json` holds `cs` messages under `admin.users`.
 */
export const localeOf = (path: string): { locale?: string, namespace: string[] } => {
  const segments = path.split(/[\\/]+/).filter(Boolean);
  const last = segments.length - 1;

  if (last < 0) return { namespace: [] };

  segments[last] = segments[last].replace(/\.[^.]*$/, '');

  // The file's directory, then its name, then the directories farther up: one
  // of those is more often a project's own, such as `it` for integration
  // tests, than the locale.
  const order = [last - 1, last, ...[...segments.keys()].slice(0, -2).reverse()].filter((index) => index >= 0);

  for (const index of order) {
    const locale = isLocale(segments[index]);

    if (locale) return { locale, namespace: segments.slice(index + 1) };
  }

  return { namespace: [] };
};
