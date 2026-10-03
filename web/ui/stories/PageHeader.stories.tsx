import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { PageHeader } from '../components/PageHeader';
import { demoData } from './fixtures';
const meta = { component: PageHeader, args: { data: demoData, onSelect: fn(), onReset: fn() }, tags: ['autodocs'] } satisfies Meta<typeof PageHeader>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Search: Story = { play: async ({ canvasElement, args }) => { const canvas = within(canvasElement); await userEvent.type(canvas.getByRole('searchbox'), 'Spadina'); await userEvent.click(canvas.getByRole('button', { name: /Queen at Spadina/ })); await expect(args.onSelect).toHaveBeenCalledWith(demoData.features[0]); } };
