import type { Meta, StoryObj } from '@storybook/react-vite';
import { Legend } from './Legend';

const meta = {
  component: Legend,
  args: {
    ariaLabel: 'Example legend',
    items: [
      { key: 'ready', label: 'Ready', tone: 'positive' },
      { key: 'attention', label: 'Needs attention', tone: 'warning' },
      { key: 'offline', label: 'Unavailable', tone: 'negative' },
    ],
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Legend>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Statuses: Story = {};
