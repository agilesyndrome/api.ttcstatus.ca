import type { Meta, StoryObj } from '@storybook/react-vite';
import { RoutePills } from './RoutePills';
import { demoData } from '../../stories/fixtures';

const meta = {
  component: RoutePills,
  args: { features: demoData.features.slice(0, 8), routes: demoData.routes, scale: 2 },
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof RoutePills>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ServiceLabels: Story = {};
