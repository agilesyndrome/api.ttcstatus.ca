import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { SlaRouteRow } from './SlaRouteRow';
import { slaLiveFixture, slaRoute, slaStops } from './sla-fixtures';

const meta = {
  component: SlaRouteRow,
  args: {
    route: slaRoute,
    grain: 'day',
    expanded: false,
    onToggle: fn(),
    needle: '',
    live: slaLiveFixture,
    liveByStop: new Map([
      ['501|queen-spadina-east', slaLiveFixture],
      ['501|queen-yonge-east', slaLiveFixture],
    ]),
  },
  decorators: [
    (Story) => (
      <ol className="sla-routes">
        <Story />
      </ol>
    ),
  ],
  tags: ['autodocs'],
} satisfies Meta<typeof SlaRouteRow>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {};
export const Expanded: Story = {
  args: { expanded: true, stops: slaStops },
};
export const Weekly: Story = { args: { grain: 'week' } };
