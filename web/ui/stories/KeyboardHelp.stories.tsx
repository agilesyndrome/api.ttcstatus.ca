import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { KeyboardHelp } from '../components/KeyboardHelp';

const meta = { component: KeyboardHelp, args: { open: true, enabled: true, onEnabled: fn(), onClose: fn() }, tags: ['autodocs'] } satisfies Meta<typeof KeyboardHelp>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Enabled: Story = {};
export const Disabled: Story = { args: { enabled: false } };
