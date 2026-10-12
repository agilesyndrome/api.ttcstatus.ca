import type { Meta, StoryObj } from '@storybook/react-vite';
import { SnakeTemplate } from './SnakeTemplate';

const meta = {
  title: 'Templates/SnakeTemplate',
  component: SnakeTemplate,
  tags: ['autodocs'],
  args: { initialSnakeVersion: 2 },
} satisfies Meta<typeof SnakeTemplate>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CurrentGame: Story = {};
