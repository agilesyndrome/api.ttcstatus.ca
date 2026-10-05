import en from './locales/en-CA/messages.json';
import fr from './locales/fr-CA/messages.json';
import enMetadata from './locales/en-CA/metadata.json';
import frMetadata from './locales/fr-CA/metadata.json';

export type MessageKey = keyof typeof en;
export const catalogues = { 'en-CA': en, 'fr-CA': fr };
export const languageMetadata = [enMetadata, frMetadata];
export function english(key: MessageKey): string {
  return en[key];
}
/** Compatibility for API badge names and existing English error messages. */
export const englishMessageKeys = new Map(
  Object.entries(en).map(([key, value]) => [value, key]),
);

export const pluralMessageKeys: Record<string, string> = {
  vehicleReports: 'counts.vehicleReports',
  placesFound: 'counts.placesFound',
  unmappedBoarding: 'counts.unmappedBoarding',
};
