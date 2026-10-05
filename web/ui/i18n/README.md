# Interface languages

The app and standalone map viewer use Canadian English (`en-CA`) and Canadian French
(`fr-CA`). The browser profile at `/profile` has a language selector even when signed
out or accounts are unavailable. The globe link on the map opens those settings.

Language selection uses the saved browser preference first, then `navigator.languages`
in preference order (or `navigator.language`). Each browser preference tries an exact
locale and then a supported regional variant of the same language. Unsupported
languages and missing translations fall back to Canadian English. Selecting “Use
browser language” removes the override. Changes propagate to other tabs; denied
storage still permits an in-memory choice for the current page.

## Adding a language

1. Copy `shared/i18n/locales/en-CA/` to a BCP 47 locale folder, such as
   `shared/i18n/locales/es-CA/`.
2. Translate the values, keeping the keys and `{placeholders}` unchanged. These are
   plain strings, never HTML. Keep complete sentences together so translators can
   reorder words. Placeholders are inserted once and React/DOM text nodes escape
   their contents.
3. Add the locale’s `messages.json`, `metadata.json`, and `clerk.json` files, then
   register its code in `locales` in `web/ui/i18n/index.ts`. This also adds the profile choice and
   browser language matching. List the preferred regional fallback first when
   supporting multiple variants of one language.
4. Add the corresponding official Clerk catalogue to `accountLocales` in `clerk.ts`.
   Clerk currently supplies base English and French rather than Canadian-specific
   catalogues; missing SDK translations use Clerk’s English fallback.
5. Check the translated layout, keyboard access, map tools and profile at desktop and
   mobile sizes. For an RTL language, review the layout in addition to `html[dir]`.
6. Run `npm run check`, `npm run build`, and, with `npm run dev:viewer` running,
   `npm run test:i18n` and `npm run test:ui`.

`shared/i18n/locales/en-CA/messages.json` is the source catalogue. Keys are stable
names such as `header.title`, making copy edits independent of component code. A
missing/empty entry in another locale uses the English value.
Plural families use semantic keys (for example `vehicleReports.one` and
`vehicleReports.other`); `plural()` uses `Intl.PluralRules` and localized counts.
Include `other` and the CLDR categories needed by the new language. Date/time display
uses the chosen locale and Toronto’s time zone. Keep protocol values, CSV columns,
route IDs, official TTC place names and user-entered content untranslated.

In React, call `useLanguage()` at the top of components that display translated copy,
then use `t(key, values)` or `plural(key, count, values)`. This updates copy without
remounting the map or losing input state. Keep stored static error messages as English
keys and translate them when displayed. Non-React helpers can use `t()` directly.
The standalone viewer marks static copy with `data-i18n` and translates dynamic copy
in its render functions.

The unit checks cover locale negotiation, invalid/blocked storage, interpolation,
plural rules, and French catalogue/placeholder completeness. The browser checks cover
reloads, overrides, resetting to the browser setting, cross-tab synchronization,
retaining map/search state and storage failures. Catalogue text should receive native
speaker review as languages are added or expanded.
