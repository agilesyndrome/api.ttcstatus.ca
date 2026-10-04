import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { RoutePulse } from './RoutePulse';
import { projectSnapshot } from '../../../../shared/map/live-status';
import { demoData, demoSnapshot } from '../../stories/fixtures';

const cars = projectSnapshot(demoData, demoSnapshot, Date.parse(demoSnapshot.fetchedAt));
const meta = {
  component: RoutePulse,
  args: {
    routes: demoData.routes,
    cars,
    loaded: true,
    active: true,
    failed: false,
    onSelect: fn(),
  },
  tags: ['autodocs'],
} satisfies Meta<typeof RoutePulse>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Live: Story = {};
export const SelectedRoute: Story = { args: { selectedRoute: '501' } };
export const Loading: Story = { args: { loaded: false, cars: [] } };
export const Stale: Story = {
  args: { cars: cars.map((car) => ({ ...car, stale: true })) },
};
export const Paused: Story = { args: { active: false } };
export const RefreshFailed: Story = { args: { failed: true } };
