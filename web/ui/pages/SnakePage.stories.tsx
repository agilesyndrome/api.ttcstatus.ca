import type { Meta, StoryObj } from '@storybook/react-vite';
import { SnakePage } from './SnakePage';

const meta = {
  title: 'Pages/SnakePage',
  component: SnakePage,
  tags: ['autodocs'],
} satisfies Meta<typeof SnakePage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CurrentGame: Story = {};
