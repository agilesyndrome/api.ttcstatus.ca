import type { Meta, StoryObj } from '@storybook/react-vite';
import { AccountContext } from '../../accounts/auth';
import { SlaPanel } from './SlaPanel';
import { slaWorkspace, storyAccount } from './panel-fixtures';

const meta = {
  component: SlaPanel,
  args: { workspace: slaWorkspace },
  decorators: [
    (Story) => (
      <AccountContext.Provider value={storyAccount}>
        <Story />
      </AccountContext.Provider>
    ),
  ],
  tags: ['autodocs'],
} satisfies Meta<typeof SlaPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The report itself fetches /api/v1/sla/report, which no Storybook server
 * serves — the signed-out gate is the story that reads deterministically. */
export const SignedOut: Story = {};
