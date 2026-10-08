/**
 * What tells a locale tag from another: its text without regard to case, as
 * BCP 47 reads a tag, with `-` for `_`. No alias is resolved, as each runtime
 * resolves them from locale data of its own age.
 */
export const localeKey = (tag: string): string => (typeof tag === 'string' ? tag.replace(/[A-Z_]/g, (char) => (char === '_' ? '-' : char.toLowerCase())) : tag);
