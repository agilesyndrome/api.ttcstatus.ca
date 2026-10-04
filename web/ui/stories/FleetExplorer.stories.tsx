import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { FleetExplorer } from '../components/FleetExplorer';
import { projectSnapshot } from '../../map/live-status';
import { demoData, demoSnapshot } from './fixtures';

const cars = projectSnapshot(demoData, demoSnapshot, Date.parse(demoSnapshot.fetchedAt));
const meta = { component: FleetExplorer, args: { data: demoData, cars, snapshot: demoSnapshot, active: true, failed: false, onSelect: fn(), onEnableLive: fn() }, tags: ['autodocs'] } satisfies Meta<typeof FleetExplorer>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Live: Story = {};
export const Paused: Story = { args: { active: false } };
export const NoSnapshot: Story = { args: { cars: [], snapshot: undefined, active: false } };
export const Unavailable: Story = { args: { cars: [], snapshot: undefined, failed: true } };
export const Stale: Story = { args: { cars: cars.map(car => ({ ...car, stale: true })) } };
export const WithLocation: Story = { args: { location: { latitude: 43.65, longitude: -79.4 } } };
const largeSnapshot = { ...demoSnapshot, vehicles: Array.from({ length: 26 }, (_, index) => ({ ...demoSnapshot.vehicles[0], id: String(4400 + index), label: String(4400 + index) })) };
export const ManyCars: Story = { args: { snapshot: largeSnapshot, cars: projectSnapshot(demoData, largeSnapshot, Date.parse(largeSnapshot.fetchedAt)) } };
