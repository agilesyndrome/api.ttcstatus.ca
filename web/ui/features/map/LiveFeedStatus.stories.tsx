import type { Meta, StoryObj } from '@storybook/react-vite';
import { LiveFeedStatus } from './LiveFeedStatus';
import { demoSnapshot } from '../../stories/fixtures';
const meta = {
  component: LiveFeedStatus,
  args: {
    failed: false,
    active: true,
    updateSeconds: 30,
    retrySeconds: 0,
    now: Date.parse(demoSnapshot.fetchedAt),
  },
  tags: ['autodocs'],
} satisfies Meta<typeof LiveFeedStatus>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Loading: Story = {};
export const Live: Story = { args: { snapshot: demoSnapshot } };
export const Stale: Story = {
  args: { snapshot: demoSnapshot, now: Date.parse(demoSnapshot.fetchedAt) + 600_000 },
};
export const Empty: Story = { args: { snapshot: { ...demoSnapshot, vehicles: [] } } };
export const Paused: Story = { args: { snapshot: demoSnapshot, active: false } };
export const Failed: Story = { args: { failed: true, retrySeconds: 60 } };
export const RetainingLastPositions: Story = {
  args: { failed: true, snapshot: demoSnapshot, retrySeconds: 60 },
};
