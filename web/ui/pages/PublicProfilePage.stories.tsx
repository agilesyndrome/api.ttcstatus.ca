import type { Meta, StoryObj } from '@storybook/react-vite';
import { PublicProfilePage } from './ProfilePage';

const meta = {
  title: 'Pages/PublicProfilePage',
  component: PublicProfilePage,
  args: { username: 'streetcar-rider' },
  tags: ['autodocs'],
} satisfies Meta<typeof PublicProfilePage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Profile: Story = {};
