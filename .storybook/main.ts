import type { StorybookConfig } from '@storybook/react-vite';
const config: StorybookConfig = {
  stories: ['../web/ui/**/*.stories.tsx'],
  addons: ['@storybook/addon-docs'],
  framework: {
    name: '@storybook/react-vite',
    options: { builder: { viteConfigPath: '.storybook/vite.config.ts' } },
  },
};
export default config;
