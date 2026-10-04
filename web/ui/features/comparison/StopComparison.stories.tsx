import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { StopComparison } from './StopComparison';
import { demoData } from '../../stories/fixtures';

const meta = {
  component: StopComparison,
  args: {
    data: demoData,
    includeOvernight: false,
    onChange: fn(),
    onPick: fn(),
    onOvernight: fn(),
    onRoute: fn(),
  },
  tags: ['autodocs'],
} satisfies Meta<typeof StopComparison>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const DirectConnection: Story = { args: { fromId: 'terminal', toId: 'queen' } };
export const Overnight: Story = {
  args: { fromId: 'terminal', toId: 'queen', includeOvernight: true },
};
export const NoDirectConnection: Story = { args: { fromId: 'queen', toId: 'king' } };
export const SameStop: Story = { args: { fromId: 'queen', toId: 'queen' } };
export const Picking: Story = { args: { picking: 'to', fromId: 'queen' } };
export const MissingSequences: Story = {
  args: { data: { ...demoData, patterns: undefined }, fromId: 'terminal', toId: 'queen' },
};
