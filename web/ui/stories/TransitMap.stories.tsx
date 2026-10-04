import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { TransitMap } from '../components/TransitMap';
import { projectSnapshot } from '../../map/live-status';
import { demoData, demoSnapshot } from './fixtures';
const meta = { component: TransitMap, args: { data: demoData, onSelectFeature: fn(), onSelectVehicle: fn() }, decorators: [Story => <div style={{ height: '70vh', display: 'grid' }}><Story /></div>], tags: ['autodocs'] } satisfies Meta<typeof TransitMap>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const HighlightedRoute: Story = { args: { selectedRoute: '501' } };
export const LiveStreetcar: Story = { args: { cars: projectSnapshot(demoData, demoSnapshot, Date.parse(demoSnapshot.fetchedAt)) } };
export const SelectedStop: Story = { args: { selectedFeature: demoData.features[0], showLabels: true } };

export const OvernightRoutes: Story = { args: { selectedRoute: '301', includeOvernight: true } };
export const PersonalMap: Story = { args: { savedStopIds: ['queen'], locationPoint: [180, 190], selectedFeature: demoData.features[0] } };
export const ComparisonEndpoints: Story = { args: { comparisonStops: { from: demoData.features[2], to: demoData.features[0] } } };
export const PickingEndpoint: Story = { args: { pickingLabel: 'Choose a destination boarding stop' } };
