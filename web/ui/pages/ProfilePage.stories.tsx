import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProfilePage } from './ProfilePage';

const meta = {
  title: 'Pages/ProfilePage',
  component: ProfilePage,
  tags: ['autodocs'],
} satisfies Meta<typeof ProfilePage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SignedOut: Story = {};
