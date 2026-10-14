import assert from 'node:assert/strict';
import test from 'node:test';
import { compileModules } from '../helpers/compile.mjs';

const palette = await compileModules(`export * from './shared/map/field-palette';`);

test('field palettes expose every state for both themes and all colour modes', () => {
  for (const mode of ['standard', 'redgreen', 'full']) {
    for (const theme of ['light', 'dark']) {
      const values = palette.fieldPalette(theme, mode);
      assert.deepEqual(Object.keys(values).sort(), [
        'collecting',
        'deepVoid',
        'due',
        'fresh',
        'unmonitored',
        'void',
      ]);
    }
  }
});

test('OKLCH ramp keeps a monotone lightness ordering', () => {
  for (const mode of ['standard', 'redgreen', 'full']) {
    const colours = [0, 0.5, 1, 1.5, 2, 2.5].map((dryness) =>
      palette.drynessColour(dryness, undefined, 'light', mode),
    );
    const lightness = colours.map((colour) => palette.paletteLightness(colour));
    for (let index = 1; index < lightness.length; index += 1)
      assert.ok(lightness[index] <= lightness[index - 1] + 0.03, `${mode} lightness`);
  }
});
