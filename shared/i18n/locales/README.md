# User-facing language catalogues

Every user-facing string belongs under a language-code folder here:

```text
shared/i18n/locales/
├── en-CA/
│   ├── messages.json   # Canadian English source catalogue
│   ├── metadata.json   # language name and text direction
│   └── clerk.json      # account-provider copy
└── fr-CA/
    ├── messages.json
    ├── metadata.json
    └── clerk.json
```

Application code uses stable message keys such as `header.title`; it does not use
English sentences as translation identifiers. Add another locale by copying the
`en-CA` folder, translating `messages.json` and the account-provider catalogue, then
registering the locale in `web/ui/i18n/index.ts`. Missing keys intentionally fall back
to `en-CA`, so a partial translation can be shipped safely while it is completed.

Values in this directory are plain text. Keep `{value}` placeholders unchanged. HTML,
CSS, route IDs, API values, feed data, and user-entered text remain in code or data and
are not treated as translatable copy.

The build resolves `{{i18n:key}}` placeholders in HTML, and runtime React/canvas
surfaces call the same catalogue through `t()` or `plural()`. Run `npm test` and
`npm run build` after changing a catalogue.
