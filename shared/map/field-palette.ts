import type { FieldState } from '../../web/ui/features/service/wave-field';

export type FieldTheme = 'light' | 'dark';
export type ColourMode = 'standard' | 'redgreen' | 'full';

export interface FieldPalette {
  fresh: string;
  due: string;
  void: string;
  unmonitored: string;
  collecting: string;
  deepVoid: string;
}

type Oklch = { lightness: number; chroma: number; hue: number };

const STANDARD_LIGHT: FieldPalette = {
  fresh: '#23744f',
  due: '#9c6508',
  void: '#9b2834',
  unmonitored: '#707982',
  collecting: '#68727a',
  deepVoid: '#8e2430',
};

const STANDARD_DARK: FieldPalette = {
  fresh: '#71d39f',
  due: '#e8bd62',
  void: '#f07b86',
  unmonitored: '#9eabb5',
  collecting: '#71808c',
  deepVoid: '#ff9ba3',
};

const REDGREEN_LIGHT: FieldPalette = {
  fresh: '#2878a8',
  due: '#8f6208',
  void: '#9b3030',
  unmonitored: '#707982',
  collecting: '#68727a',
  deepVoid: '#762b3c',
};

const REDGREEN_DARK: FieldPalette = {
  fresh: '#73bce3',
  due: '#e8bd62',
  void: '#f08b8b',
  unmonitored: '#9eabb5',
  collecting: '#71808c',
  deepVoid: '#ffb0b0',
};

const FULL_LIGHT: FieldPalette = {
  fresh: '#0072b2',
  due: '#8f6208',
  void: '#c04f00',
  unmonitored: '#707982',
  collecting: '#68727a',
  deepVoid: '#9b2226',
};

const FULL_DARK: FieldPalette = {
  fresh: '#56b4e9',
  due: '#f0e442',
  void: '#e69f5a',
  unmonitored: '#9eabb5',
  collecting: '#71808c',
  deepVoid: '#ff8f8f',
};

const PALETTES: Record<ColourMode, Record<FieldTheme, FieldPalette>> = {
  standard: { light: STANDARD_LIGHT, dark: STANDARD_DARK },
  redgreen: { light: REDGREEN_LIGHT, dark: REDGREEN_DARK },
  full: { light: FULL_LIGHT, dark: FULL_DARK },
};

function srgbToLinear(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value: number): number {
  const channel = Math.max(0, Math.min(1, value));
  return (
    255 *
    (channel <= 0.0031308 ? 12.92 * channel : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055)
  );
}

function hexToOklch(hex: string): Oklch {
  const red = srgbToLinear(Number.parseInt(hex.slice(1, 3), 16));
  const green = srgbToLinear(Number.parseInt(hex.slice(3, 5), 16));
  const blue = srgbToLinear(Number.parseInt(hex.slice(5, 7), 16));
  const l = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue;
  const m = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue;
  const s = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue;
  const lRoot = Math.cbrt(l);
  const mRoot = Math.cbrt(m);
  const sRoot = Math.cbrt(s);
  const lightness = 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot;
  const a = 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot;
  const b = 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot;
  return { lightness, chroma: Math.hypot(a, b), hue: Math.atan2(b, a) };
}

function oklchToHex({ lightness, chroma, hue }: Oklch): string {
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const lRoot = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lRoot ** 3;
  const m = mRoot ** 3;
  const s = sRoot ** 3;
  const red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return `#${[red, green, blue]
    .map((channel) => Math.round(linearToSrgb(channel)).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Mixes field colours in OKLCH so midpoint hues do not pass through sRGB mud. */
export function mixFieldColours(from: string, to: string, amount: number): string {
  if (amount <= 0) return from;
  if (amount >= 1) return to;
  const a = hexToOklch(from);
  const b = hexToOklch(to);
  let hueDelta = b.hue - a.hue;
  if (hueDelta > Math.PI) hueDelta -= Math.PI * 2;
  if (hueDelta < -Math.PI) hueDelta += Math.PI * 2;
  return oklchToHex({
    lightness: a.lightness + (b.lightness - a.lightness) * amount,
    chroma: a.chroma + (b.chroma - a.chroma) * amount,
    hue: a.hue + hueDelta * amount,
  });
}

export function fieldPalette(
  theme: FieldTheme = 'light',
  colourMode: ColourMode = 'standard',
): FieldPalette {
  return PALETTES[colourMode][theme];
}

export function fieldColour(
  state: FieldState,
  theme: FieldTheme = 'light',
  colourMode: ColourMode = 'standard',
): string {
  return fieldPalette(theme, colourMode)[state];
}

export function drynessColour(
  dryness: number | null,
  state: FieldState | undefined = undefined,
  theme: FieldTheme = 'light',
  colourMode: ColourMode = 'standard',
): string {
  const palette = fieldPalette(theme, colourMode);
  if (state === 'collecting') return palette.collecting;
  if (dryness === null || state === 'unmonitored') return palette.unmonitored;
  if (dryness <= 0) return palette.fresh;
  if (dryness <= 1) return mixFieldColours(palette.fresh, palette.due, dryness);
  if (dryness <= 2) return mixFieldColours(palette.due, palette.void, dryness - 1);
  return mixFieldColours(
    palette.void,
    palette.deepVoid,
    Math.min(1, (dryness - 2) / 1.5),
  );
}

export function paletteLightness(hex: string): number {
  return hexToOklch(hex).lightness;
}

function relativeLuminance(hex: string): number {
  const channels = [0, 1, 2].map((index) =>
    srgbToLinear(Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16)),
  );
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

export function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}
