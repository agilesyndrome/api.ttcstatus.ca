import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { RoutesStopsSearch } from './RoutesStopsSearch';

const meta = {
  component: RoutesStopsSearch,
  args: {
    value: '',
    label: 'Search routes and stops',
    placeholder: 'Search routes and stops…',
    onChange: fn(),
  },
  tags: ['autodocs'],
} satisfies Meta<typeof RoutesStopsSearch>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const Searching: Story = { args: { value: 'Queen' } };
