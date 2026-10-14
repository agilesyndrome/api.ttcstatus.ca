import type { Meta, StoryObj } from '@storybook/react-vite';
import { AccountContext } from '../accounts/auth';
import { ReplayPanel } from './ReplayPanel';
import { replayWorkspace, storyAccount } from '../map/panels/panel-fixtures';

const meta = {
  component: ReplayPanel,
  args: { workspace: replayWorkspace },
  decorators: [
    (Story) => (
      <AccountContext.Provider value={storyAccount}>
        <Story />
      </AccountContext.Provider>
    ),
  ],
  tags: ['autodocs'],
} satisfies Meta<typeof ReplayPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The remote, with a resolved window and a paused frame mid-window. The
 * engine itself mounts in the workspace — stories render the panel only,
 * so no tick fetches happen here. Replay is members-only; a signed-out
 * render shows the sign-in gate instead. */
export const Ready: Story = {};
