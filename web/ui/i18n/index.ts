import {
  catalogues,
  languageMetadata,
  pluralMessageKeys,
} from '../../../shared/i18n/messages';

const en = catalogues['en-CA'];
const fr = catalogues['fr-CA'];

export const defaultLocale = 'en-CA';
/** Register new catalogues here; language choices are generated from this list. */
export const locales = [
  {
    code: 'en-CA',
    name: languageMetadata[0].name,
    direction: languageMetadata[0].direction,
    messages: en,
  },
  {
    code: 'fr-CA',
    name: languageMetadata[1].name,
    direction: languageMetadata[1].direction,
    messages: fr,
  },
] as const;
export type Locale = (typeof locales)[number]['code'];
export type LanguagePreference = Locale | 'browser';
export const languageStorageKey = 'ttc.language';

export function resolveLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const tag = language.replaceAll('_', '-').toLowerCase();
    const exact = locales.find((locale) => locale.code.toLowerCase() === tag);
    if (exact) return exact.code;
    const base = tag.split('-')[0];
    const related = locales.find((locale) => locale.code.split('-')[0] === base);
    if (related) return related.code;
  }
  return defaultLocale;
}
export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === 'browser' || locales.some((locale) => locale.code === value);
}
export function readLanguagePreference(
  storage?: Pick<Storage, 'getItem'>,
): LanguagePreference {
  try {
    const value = storage?.getItem(languageStorageKey);
    return isLanguagePreference(value) ? value : 'browser';
  } catch {
    return 'browser';
  }
}
function browserLanguages() {
  return typeof navigator === 'undefined'
    ? []
    : navigator.languages?.length
      ? navigator.languages
      : [navigator.language];
}
function browserStorage() {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
let preference = readLanguagePreference(browserStorage());
let locale = preference === 'browser' ? resolveLocale(browserLanguages()) : preference;
let persistent = true;
const listeners = new Set<() => void>();
export const getLocale = () => locale;
export const getLanguagePreference = () => preference;
export const isLanguagePersistent = () => persistent;
export function subscribeLanguage(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
let revision = 0;
export const getLanguageRevision = () => revision;
function updateLanguage() {
  locale = preference === 'browser' ? resolveLocale(browserLanguages()) : preference;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
    document.documentElement.dir = locales.find(
      (entry) => entry.code === locale,
    )!.direction;
    document.title = translate(
      document.querySelector('title')?.getAttribute('data-i18n') ?? 'app.title',
    );
    document.querySelectorAll('[data-i18n-content]').forEach((element) => {
      element.setAttribute(
        'content',
        translate(element.getAttribute('data-i18n-content')!),
      );
    });
  }
  revision++;
  listeners.forEach((listener) => listener());
}
export function setLanguagePreference(next: LanguagePreference) {
  if (!isLanguagePreference(next)) return;
  preference = next;
  try {
    const storage = browserStorage();
    if (!storage) throw new Error('Storage unavailable');
    if (next === 'browser') storage.removeItem(languageStorageKey);
    else storage.setItem(languageStorageKey, next);
    persistent = true;
  } catch {
    persistent = false;
  }
  updateLanguage();
}

export function translate(
  key: string,
  values: Record<string, string | number> = {},
  language: Locale = locale,
): string {
  const messages: Record<string, string> =
    locales.find((entry) => entry.code === language)?.messages ?? en;
  const fallback: Record<string, string> = en;
  const own = (catalogue: Record<string, string>) =>
    Object.hasOwn(catalogue, key) && typeof catalogue[key] === 'string'
      ? catalogue[key]
      : undefined;
  const message = own(messages) || own(fallback) || key;
  // A single pass prevents interpolated user content being interpreted as a template.
  return message.replace(/\{(\w+)\}/g, (token, name: string) =>
    Object.hasOwn(values, name)
      ? String(values[name])
      : token,
  );
}
export const t = translate;
if (typeof window !== 'undefined') {
  window.addEventListener('languagechange', () => {
    if (preference === 'browser') updateLanguage();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === languageStorageKey || event.key === null) {
      preference = readLanguagePreference(browserStorage());
      persistent = true;
      updateLanguage();
    }
  });
  updateLanguage();
}

/** Catalogues may provide any CLDR plural category; other is always the fallback. */
export function plural(
  key: string,
  count: number,
  values: Record<string, string | number> = {},
  language: Locale = locale,
) {
  key = pluralMessageKeys[key] ?? key;
  const category = new Intl.PluralRules(language).select(count);
  const catalogue: Record<string, string> = locales.find(
    (entry) => entry.code === language,
  )!.messages;
  const selected = catalogue[`${key}.${category}`]
    ? `${key}.${category}`
    : `${key}.other`;
  return translate(
    selected,
    { ...values, count: new Intl.NumberFormat(language).format(count) },
    language,
  );
}
