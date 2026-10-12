import type { Meta, StoryObj } from '@storybook/react-vite';
import { SettingsPage } from './SettingsPage';

const meta = {
  title: 'Pages/SettingsPage',
  component: SettingsPage,
  tags: ['autodocs'],
} satisfies Meta<typeof SettingsPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SignedOut: Story = {};
