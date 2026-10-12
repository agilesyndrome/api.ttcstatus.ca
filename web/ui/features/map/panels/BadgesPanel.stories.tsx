import type { Meta, StoryObj } from '@storybook/react-vite';
import { AccountContext } from '../../accounts/auth';
import { BadgesPanel } from './BadgesPanel';
import { badgesWorkspace, storyAccount } from './panel-fixtures';

const meta = {
  component: BadgesPanel,
  args: { workspace: badgesWorkspace },
  decorators: [
    (Story) => (
      <AccountContext.Provider value={storyAccount}>
        <Story />
      </AccountContext.Provider>
    ),
  ],
  tags: ['autodocs'],
} satisfies Meta<typeof BadgesPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Collection: Story = {};
export const Empty: Story = {
  args: {
    workspace: {
      ...badgesWorkspace,
      journal: [],
    },
  },
};
