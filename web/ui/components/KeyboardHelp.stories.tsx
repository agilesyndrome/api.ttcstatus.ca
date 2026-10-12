import type { Meta, StoryObj } from '@storybook/react-vite';
import { KeyboardHelp } from './KeyboardHelp';

const meta = {
  component: KeyboardHelp,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ margin: '3em' }}>
        {/* Storybook(KeyboardHelp)  */}
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof KeyboardHelp>;
export default meta;
export const Default: StoryObj<typeof meta> = {
  args: {
    open: true,
    enabled: true,
    onEnabled: () => {},
    onClose: () => {},
  },
};
