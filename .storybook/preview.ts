import type { Preview } from '@storybook/react-vite';
import '../web/ui/styles/main.css';
import {
  getLocale,
  setLanguagePreference,
  type Locale,
} from '../web/ui/i18n';

export const globalTypes = {
  locale: {
    description: 'Language',
    defaultValue: 'en-CA' as Locale,
    toolbar: {
      icon: 'globe',
      items: [
        { value: 'en-CA' as Locale, title: 'English' },
        { value: 'fr-CA' as Locale, title: 'Français' },
      ],
    },
  },
};

const preview: Preview = {
  parameters: { layout: 'fullscreen', controls: { expanded: true } },
  decorators: [
    (Story, context) => {
      const locale = context.globals.locale as Locale;
      if (locale !== getLocale()) setLanguagePreference(locale);
      return Story();
    },
  ],
};
export default preview;
