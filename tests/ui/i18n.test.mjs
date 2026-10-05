import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { compileModules } from '../helpers/compile.mjs';

const {
  locales,
  resolveLocale,
  readLanguagePreference,
  translate,
  plural,
  isLanguagePreference,
} = await compileModules("export * from './web/ui/i18n/index.ts';");

test('browser language negotiation respects preference order, regions and fallback', () => {
  assert.equal(resolveLocale(['fr-CA', 'en-CA']), 'fr-CA');
  assert.equal(resolveLocale(['fr-FR']), 'fr-CA');
  assert.equal(resolveLocale(['FR_ca']), 'fr-CA');
  assert.equal(resolveLocale(['en-US', 'fr-CA']), 'en-CA');
  assert.equal(resolveLocale(['ja-JP', 'fr-FR', 'en']), 'fr-CA');
  assert.equal(resolveLocale(['ja-JP', 'zz']), 'en-CA');
  assert.equal(resolveLocale([]), 'en-CA');
});

test('stored preferences validate and tolerate inaccessible storage', () => {
  assert.equal(readLanguagePreference({ getItem: () => 'fr-CA' }), 'fr-CA');
  for (const value of [null, 'null', 'bogus', '{}', 'ar', 'en-US'])
    assert.equal(readLanguagePreference({ getItem: () => value }), 'browser');
  assert.equal(
    readLanguagePreference({
      getItem() {
        throw new Error('blocked');
      },
    }),
    'browser',
  );
  assert.equal(readLanguagePreference(), 'browser');
  assert.equal(isLanguagePreference('browser'), true);
  assert.equal(isLanguagePreference({ code: 'fr-CA' }), false);
});

test('translations preserve interpolation values without interpreting them', () => {
  assert.equal(translate('stopComparison.compareStops', {}, 'en-CA'), 'Compare stops');
  assert.equal(translate('stopComparison.swapStops', {}, 'en-CA'), '⇄ Swap stops');
  assert.equal(
    translate('stopComparison.includeOvernightConnections', {}, 'en-CA'),
    'Include overnight connections',
  );
  assert.equal(translate('account.profile', {}, 'fr-CA'), 'Profil');
  assert.equal(translate('Profile', {}, 'fr-CA'), 'Profile');
  assert.equal(translate('Unknown message', {}, 'fr-CA'), 'Unknown message');
  assert.equal(translate('__proto__', {}, 'fr-CA'), '__proto__');
  const french = locales.find((entry) => entry.code === 'fr-CA').messages;
  const saved = french['account.profile'];
  delete french['account.profile'];
  assert.equal(
    translate('account.profile', {}, 'fr-CA'),
    'Profile',
    'missing entries use Canadian English',
  );
  french['account.profile'] = saved;
  assert.equal(
    translate('journal.added', { car: '{value2}<script>' }, 'fr-CA'),
    'Véhicule {value2}<script> ajouté à votre journal.',
  );
  assert.equal(
    translate('map.mapRequestFailedValue', { value1: 500 }, 'fr-CA'),
    'Échec de la demande de carte (500).',
  );
  assert.equal(plural('vehicleReports', 1, { stale: '' }, 'en-CA'), '1 car reported.');
  assert.equal(plural('vehicleReports', 2, { stale: '' }, 'en-CA'), '2 cars reported.');
  assert.equal(
    plural('vehicleReports', 0, { stale: '' }, 'fr-CA'),
    '0 véhicule signalé.',
  );
  assert.equal(
    plural('vehicleReports', 2, { stale: '' }, 'fr-CA'),
    '2 véhicules signalés.',
  );
});

test('French catalogue covers English keys and preserves all placeholders', async () => {
  const read = async (code) =>
    JSON.parse(await readFile(`shared/i18n/locales/${code}/messages.json`, 'utf8'));
  const en = await read('en-CA'),
    fr = await read('fr-CA');
  assert.ok(
    Object.keys(fr).every((key) => Object.hasOwn(en, key)),
    'French catalogue cannot introduce unknown keys',
  );
  const placeholders = (value) => [...new Set(value.match(/\{\w+\}/g) ?? [])].sort();
  for (const [key, value] of Object.entries(en)) {
    if (fr[key] !== undefined) {
      assert.ok(fr[key].trim(), `empty translation: ${key}`);
      assert.deepEqual(placeholders(fr[key]), placeholders(value), key);
    }
  }
});

test('language catalogues are the single source for user-facing HTML copy', async () => {
  const files = [
    'web/ui/index.html',
    'web/map/index.html',
    'public/snake/v1/index.html',
    'public/snake/v1/site.webmanifest',
  ];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, />[A-Za-z][^<{]*</, `${file} has inline visible copy`);
  }
  assert.equal(
    await readFile('web/ui/i18n/locales/en-CA.json', 'utf8').catch(() => undefined),
    undefined,
    'legacy per-UI catalogue must not return',
  );
});
