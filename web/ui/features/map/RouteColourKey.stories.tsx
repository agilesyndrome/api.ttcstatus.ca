import type { Meta, StoryObj } from '@storybook/react-vite';
import { RouteColourKey } from './RouteColourKey';
import { demoData } from '../../stories/fixtures';

const meta = {
  component: RouteColourKey,
  args: { routes: demoData.routes.slice(0, 6) },
  tags: ['autodocs'],
} satisfies Meta<typeof RouteColourKey>;
export default meta;
type Story = StoryObj<typeof meta>;
export const VisibleRoutes: Story = {};
