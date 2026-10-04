import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { StopBrowser } from './StopBrowser';
import { demoData } from '../../stories/fixtures';
const meta = {
  component: StopBrowser,
  args: { data: demoData, savedIds: [], onSelect: fn() },
  tags: ['autodocs'],
} satisfies Meta<typeof StopBrowser>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Directory: Story = {};
export const SavedStops: Story = {
  args: { savedIds: demoData.features.map((stop) => stop.id) },
};
export const WithLocation: Story = {
  args: { location: { latitude: 43.65, longitude: -79.4 } },
};
export const NoBoardingRecords: Story = {
  args: {
    data: {
      ...demoData,
      features: demoData.features.map((stop) => ({ ...stop, boardingPoints: 0 })),
    },
  },
};
