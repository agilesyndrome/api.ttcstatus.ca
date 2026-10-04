import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { NearbyStops } from './NearbyStops';
import { demoData } from '../../stories/fixtures';

const meta = {
  component: NearbyStops,
  args: { data: demoData, onLocate: fn(), onClear: fn(), onSelect: fn() },
  tags: ['autodocs'],
} satisfies Meta<typeof NearbyStops>;
export default meta;
type Story = StoryObj<typeof meta>;
export const BeforeLocation: Story = {};
export const Nearby: Story = {
  args: { location: { latitude: 43.65, longitude: -79.4, accuracy: 40 } },
};
export const OutsideToronto: Story = {
  args: { location: { latitude: 45.42, longitude: -75.69, accuracy: 100 } },
};
