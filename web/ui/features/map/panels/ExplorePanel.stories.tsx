import type { Meta, StoryObj } from '@storybook/react-vite';
import { ExplorePanel } from './ExplorePanel';
import { exploreWorkspace } from './panel-fixtures';

const meta = {
  component: ExplorePanel,
  args: { workspace: exploreWorkspace },
  tags: ['autodocs'],
} satisfies Meta<typeof ExplorePanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Workspace: Story = {};
