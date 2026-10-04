import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { StopDetails } from './StopDetails';
import { projectSnapshot } from '../../../../shared/map/live-status';
import { demoData, demoSnapshot } from '../../stories/fixtures';
const meta = {
  component: StopDetails,
  args: { data: demoData, onClose: fn() },
  tags: ['autodocs'],
} satisfies Meta<typeof StopDetails>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Overview: Story = {};
export const Stop: Story = { args: { feature: demoData.features[0] } };
export const Streetcar: Story = {
  args: {
    car: projectSnapshot(demoData, demoSnapshot, Date.parse(demoSnapshot.fetchedAt))[0],
  },
};
export const SavedWithNearbyCars: Story = {
  args: {
    feature: demoData.features[0],
    saved: true,
    onToggleSave: fn(),
    onSelectVehicle: fn(),
    liveEnabled: true,
    feedLoaded: true,
    cars: projectSnapshot(demoData, demoSnapshot, Date.parse(demoSnapshot.fetchedAt)),
  },
};
export const LivePaused: Story = {
  args: {
    feature: demoData.features[0],
    onToggleSave: fn(),
    onSelectVehicle: fn(),
    liveEnabled: false,
  },
};
export const ComparisonActions: Story = {
  args: { feature: demoData.features[0], onCompare: fn() },
};
export const FollowingStreetcar: Story = {
  args: {
    car: projectSnapshot(demoData, demoSnapshot, Date.parse(demoSnapshot.fetchedAt))[0],
    following: true,
    onFollow: fn(),
  },
};
