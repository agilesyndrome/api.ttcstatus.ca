import type { ComponentProps } from 'react';
import type { ClerkProvider } from '@clerk/react';
import en from '../../../shared/i18n/locales/en-CA/clerk.json';
import fr from '../../../shared/i18n/locales/fr-CA/clerk.json';
import type { Locale } from './index';

export const accountLocales = {
  'en-CA': en,
  'fr-CA': fr,
} satisfies Record<Locale, ComponentProps<typeof ClerkProvider>['localization']>;
