import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { SearchAhead } from './SearchAhead';

const meta = {
  component: SearchAhead,
  args: {
    id: 'example-search',
    value: '',
    label: 'Search the collection',
    placeholder: 'Search…',
    onChange: fn(),
  },
  tags: ['autodocs'],
} satisfies Meta<typeof SearchAhead>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const WithQuery: Story = { args: { value: 'Queen' } };
