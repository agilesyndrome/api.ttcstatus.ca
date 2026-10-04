import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { RouteLegend } from './RouteLegend';
import { demoData } from '../../stories/fixtures';
const meta = {
  component: RouteLegend,
  args: { routes: demoData.routes, onSelect: fn() },
  tags: ['autodocs'],
} satisfies Meta<typeof RouteLegend>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: /507/ })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: /501 Queen/ }));
    await expect(args.onSelect).toHaveBeenCalledWith('501');
  },
};
export const Selected: Story = {
  args: { selectedRoute: '501' },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Show all' }),
    );
    await expect(args.onSelect).toHaveBeenCalledWith(undefined);
  },
};
export const Interactive: Story = {
  render: function Render(args) {
    const [selected, setSelected] = useState<string>();
    return <RouteLegend {...args} selectedRoute={selected} onSelect={setSelected} />;
  },
};
