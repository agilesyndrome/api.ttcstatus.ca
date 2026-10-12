import type { Meta, StoryObj } from '@storybook/react-vite';
import { LanguageSettings } from './LanguageSettings';

const meta = {
  component: LanguageSettings,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ margin: '3em' }}>
        {/* Storybook(LanguageSettings)  */}
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LanguageSettings>;
export default meta;
export const Default: StoryObj<typeof meta> = {};
