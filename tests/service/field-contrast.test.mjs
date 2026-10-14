import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

const { fieldPalette, contrastRatio } = await compileModules(
  `export * from './shared/map/field-palette';`,
);

test('field states meet the three-to-one contrast floor against map surfaces', () => {
  const surfaces = {
    light: ['#f7f5ed', '#d8e8e9', '#fffdf7'],
    dark: ['#111f29', '#142f40', '#192b36'],
  };
  for (const theme of ['light', 'dark']) {
    for (const mode of ['standard', 'redgreen', 'full']) {
      const palette = fieldPalette(theme, mode);
      for (const state of ['fresh', 'due', 'void', 'unmonitored', 'collecting'])
        for (const surface of surfaces[theme])
          assert.ok(
            contrastRatio(palette[state], surface) >= 3,
            `${theme}/${mode}/${state} against ${surface}`,
          );
    }
  }
});
