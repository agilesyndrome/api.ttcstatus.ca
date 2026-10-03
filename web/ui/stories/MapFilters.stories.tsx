import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { MapFilters } from '../components/MapFilters';
const meta = { component: MapFilters, args: { value: { live: true, labels: false, overnight: false }, onChange: fn() }, tags: ['autodocs'] } satisfies Meta<typeof MapFilters>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { play: async ({ canvasElement, args }) => { await userEvent.click(within(canvasElement).getByRole('checkbox', { name: 'More stop labels' })); await expect(args.onChange).toHaveBeenCalledWith({ live: true, labels: true, overnight: false }); } };
export const Interactive: Story = { render: function Render(args) { const [value, setValue] = useState(args.value); return <MapFilters value={value} onChange={setValue} />; } };
