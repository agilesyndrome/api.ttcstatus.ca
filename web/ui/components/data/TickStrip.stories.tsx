import type { Meta, StoryObj } from '@storybook/react-vite';
import { TickStrip } from './TickStrip';

const ticks = [
  { key: 'one', tone: 'positive', label: 'Monday · ready' },
  { key: 'two', tone: 'warning', label: 'Tuesday · needs attention' },
  { key: 'three', tone: 'negative', label: 'Wednesday · unavailable', partial: true },
];

const meta = {
  component: TickStrip,
  args: {
    ticks,
    ariaLabel: 'Example daily status',
    emptyLabel: 'No status data yet.',
    startLabel: 'Mon',
    endLabel: 'now',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof TickStrip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Standard: Story = {};
export const Wide: Story = { args: { size: 'wide', startLabel: 'Week of Jun 1' } };
export const WithLiveTail: Story = {
  args: {
    live: [
      { key: 'live-1', tone: 'positive', label: 'Live · 12:30' },
      { key: 'live-2', tone: 'neutral', label: 'Live · feed unavailable' },
    ],
  },
};
export const Empty: Story = { args: { ticks: [], live: null } };
