import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { MapFilters } from './MapFilters';
const meta = {
  component: MapFilters,
  args: {
    value: { live: true, labels: false, overnight: false, streetcar: true, subway: true },
    onChange: fn(),
  },
  tags: ['autodocs'],
} satisfies Meta<typeof MapFilters>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole('checkbox', { name: 'Show live vehicles' }),
    ).toBeChecked();
    await userEvent.click(
      canvas.getByRole('checkbox', { name: 'Include overnight routes' }),
    );
    await expect(args.onChange).toHaveBeenCalledWith({
      live: true,
      labels: false,
      overnight: true,
      streetcar: true,
      subway: true,
    });
  },
};
export const Interactive: Story = {
  render: function Render(args) {
    const [value, setValue] = useState(args.value);
    return <MapFilters value={value} onChange={setValue} />;
  },
};
