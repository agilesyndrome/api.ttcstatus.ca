import type { Meta, StoryObj } from '@storybook/react-vite';
import { LegendBar } from './LegendBar';

const meta = {
  component: LegendBar,
  args: { theme: 'light', colourMode: 'standard' },
  tags: ['autodocs'],
} satisfies Meta<typeof LegendBar>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const DarkRedGreen: Story = { args: { theme: 'dark', colourMode: 'redgreen' } };
