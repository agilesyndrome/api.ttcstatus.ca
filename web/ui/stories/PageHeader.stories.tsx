import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { PageHeader } from '../components/PageHeader';
import { demoData, demoSnapshot } from './fixtures';
import { projectSnapshot } from '../../../shared/map/live-status';
const cars = projectSnapshot(demoData, demoSnapshot, Date.parse(demoSnapshot.fetchedAt));
const meta = {
  component: PageHeader,
  args: { data: demoData, cars, onSelect: fn(), onSelectVehicle: fn(), onReset: fn() },
  tags: ['autodocs'],
} satisfies Meta<typeof PageHeader>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Search: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('searchbox'), 'Spadina');
    await userEvent.click(canvas.getByRole('button', { name: /Queen at Spadina/ }));
    await expect(args.onSelect).toHaveBeenCalledWith(demoData.features[0]);
  },
};

export const StreetcarNumber: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('searchbox'), '4400');
    await userEvent.click(canvas.getByRole('button', { name: /Streetcar 4400/ }));
    await expect(args.onSelectVehicle).toHaveBeenCalledWith(cars[0]);
  },
};
export const StreetcarNumberKeyboard: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('searchbox'), '#4400{Enter}');
    await expect(args.onSelectVehicle).toHaveBeenCalledWith(cars[0]);
  },
};
export const PartialStreetcarNumber: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('searchbox'), 'car 440');
    await expect(canvas.getByRole('button', { name: /Streetcar 4400/ })).toBeVisible();
  },
};
export const UnreportedStreetcar: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('searchbox'), '4663');
    await expect(canvas.getByText(/No matching stops or vehicles/)).toBeVisible();
  },
};
export const StaleStreetcar: Story = {
  args: { cars: cars.map((car) => ({ ...car, stale: true })) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('searchbox'), '4400');
    await expect(
      canvas.getByRole('button', { name: /Streetcar 4400.*Stale position/ }),
    ).toBeVisible();
  },
};
