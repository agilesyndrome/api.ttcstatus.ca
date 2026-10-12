import type { Meta, StoryObj } from '@storybook/react-vite';
import { ThemeSettings } from './ThemeSettings';

const meta = {
  component: ThemeSettings,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ margin: '3em' }}>
        {/* Storybook(ThemeSettings)  */}
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ThemeSettings>;
export default meta;
export const Default: StoryObj<typeof meta> = {};
