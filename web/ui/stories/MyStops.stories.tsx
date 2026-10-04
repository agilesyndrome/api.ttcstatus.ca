import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { MyStops } from '../components/MyStops';
import { demoData } from './fixtures';

const meta = { component: MyStops, args: { data: demoData, ids: [], persistent: true, onSelect: fn(), onRemove: fn() }, tags: ['autodocs'] } satisfies Meta<typeof MyStops>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const Saved: Story = { args: { ids: ['queen', 'king'] } };
export const ChangedNetwork: Story = { args: { ids: ['queen', 'retired-stop'] } };
export const StorageBlocked: Story = { args: { ids: ['queen'], persistent: false } };
