import type { Meta, StoryObj } from '@storybook/react-vite';
import { SlaStopRow } from './SlaStopRow';
import { slaLiveFixture, slaStops } from './sla-fixtures';

const meta = {
  component: SlaStopRow,
  args: { stop: slaStops[0], grain: 'day', live: slaLiveFixture },
  decorators: [
    (Story) => (
      <ol className="sla-stops">
        <Story />
      </ol>
    ),
  ],
  tags: ['autodocs'],
} satisfies Meta<typeof SlaStopRow>;
export default meta;
type Story = StoryObj<typeof meta>;

export const DirectionalStop: Story = {};
export const Weekly: Story = { args: { grain: 'week' } };
export const NoData: Story = {
  args: {
    stop: {
      ...slaStops[0],
      overall: {
        ...slaStops[0].overall,
        compliance: null,
        band: 'no-data',
        latestBand: null,
      },
      days: [],
      weeks: [],
    },
    live: null,
  },
};
