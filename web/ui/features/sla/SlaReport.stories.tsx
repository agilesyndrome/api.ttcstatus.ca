import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { SlaReport } from './SlaReport';
import { slaLiveFixture, slaReportFixture } from './sla-fixtures';

const live = {
  byRoute: new Map([['501', slaLiveFixture]]),
  byStop: new Map([
    ['501|queen-spadina-east', slaLiveFixture],
    ['501|queen-yonge-east', slaLiveFixture],
  ]),
  windowEnd: slaLiveFixture.at(-1)?.endAt ?? null,
  ready: true,
};

const meta = {
  component: SlaReport,
  args: {
    report: slaReportFixture,
    grain: 'day',
    query: '',
    needle: '',
    expanded: new Set<string>(),
    filteredRoutes: slaReportFixture.routes,
    live,
    onGrainChange: fn(),
    onQueryChange: fn(),
    onToggle: fn(),
  },
  tags: ['autodocs'],
} satisfies Meta<typeof SlaReport>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {};
export const Weekly: Story = { args: { grain: 'week' } };
export const Filtered: Story = {
  args: { query: 'Queen', needle: 'queen', filteredRoutes: [slaReportFixture.routes[0]] },
};
export const NoMatches: Story = { args: { filteredRoutes: [] } };
