import type { Meta, StoryObj } from '@storybook/react-vite';
import { StationArrivals } from './StationArrivals';
import { demoData, demoSnapshot } from '../../stories/fixtures';

const now = Date.parse(demoSnapshot.fetchedAt);
const feature = { ...demoData.features[0], name: 'Spadina Station', routeIds: ['1'] };
const data = {
  ...demoData,
  routes: [{ ...demoData.routes[0], id: '1', number: '1', name: 'Yonge–University' }],
};
const snapshot = {
  ...demoSnapshot,
  subwayStatus: 'available' as const,
  subwayPredictions: [30, 180, 420].map((seconds, i) => ({
    id: `train-${i}`,
    label: String(15 + i),
    routeId: '1',
    tripId: `trip-${i}`,
    observedAt: demoSnapshot.fetchedAt,
    stops: [
      {
        stopId: 'queen-e',
        sequence: 1,
        arrivalAt: new Date(now + seconds * 1000).toISOString(),
      },
    ],
  })),
};
const meta = {
  component: StationArrivals,
  args: { data, feature, snapshot, now, enabled: true },
  tags: ['autodocs'],
} satisfies Meta<typeof StationArrivals>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Upcoming: Story = {};
export const Paused: Story = { args: { enabled: false } };
export const Loading: Story = { args: { snapshot: undefined } };
export const Unavailable: Story = {
  args: { snapshot: { ...snapshot, subwayStatus: 'unavailable' } },
};
export const Stale: Story = { args: { now: now + 121000 } };
export const RefreshFailed: Story = { args: { failed: true } };
