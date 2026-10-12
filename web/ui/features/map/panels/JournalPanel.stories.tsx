import type { Meta, StoryObj } from '@storybook/react-vite';
import { AccountContext } from '../../accounts/auth';
import { JournalPanel } from './JournalPanel';
import { journalWorkspace, storyAccount } from './panel-fixtures';

const meta = {
  component: JournalPanel,
  args: { workspace: journalWorkspace },
  decorators: [
    (Story) => (
      <AccountContext.Provider value={storyAccount}>
        <Story />
      </AccountContext.Provider>
    ),
  ],
  tags: ['autodocs'],
} satisfies Meta<typeof JournalPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Collection: Story = {};
export const Empty: Story = {
  args: {
    workspace: {
      ...journalWorkspace,
      journal: [],
      accountJournal: { ...journalWorkspace.accountJournal, entries: [] },
    },
  },
};
