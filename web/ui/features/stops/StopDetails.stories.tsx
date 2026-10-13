import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { StopDetails } from './StopDetails';
import { projectSnapshot } from '../../../../shared/map/live-status';
import { journalEntry } from '../../../../shared/accounts/journal';
import { demoData, demoSnapshot } from '../../stories/fixtures';
const streetcar = projectSnapshot(
  demoData,
  demoSnapshot,
  Date.parse(demoSnapshot.fetchedAt),
)[0];
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
    car: streetcar,
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
  args: { feature: demoData.features[0] },
};
export const FollowingStreetcar: Story = {
  args: {
    car: streetcar,
    following: true,
    onFollow: fn(),
    onJournal: fn(),
    journalReady: true,
  },
};
export const RiddenStreetcar: Story = {
  args: {
    car: streetcar,
    following: true,
    onFollow: fn(),
    onJournal: fn(),
    journalEntry: {
      ...journalEntry(streetcar, demoData.routes, new Date(demoSnapshot.fetchedAt)),
      status: 'ridden',
    },
  },
};
