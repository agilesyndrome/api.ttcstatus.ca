import type { Meta, StoryObj } from '@storybook/react-vite';
import { ShareMap } from '../components/ShareMap';
import { DEFAULT_FILTERS } from '../commute';

const meta = { component: ShareMap, args: { filters: DEFAULT_FILTERS }, tags: ['autodocs'] } satisfies Meta<typeof ShareMap>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Network: Story = {};
export const Stop: Story = { args: { selection: { kind: 'stop', id: 'queen' } } };
export const OvernightRoute: Story = { args: { selection: { kind: 'route', id: '301' }, filters: { ...DEFAULT_FILTERS, overnight: true } } };
