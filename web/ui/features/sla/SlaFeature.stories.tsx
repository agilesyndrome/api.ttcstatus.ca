import type { Meta, StoryObj } from '@storybook/react-vite';
import { SlaFeature } from './SlaFeature';

const meta = {
  component: SlaFeature,
  tags: ['autodocs'],
} satisfies Meta<typeof SlaFeature>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The feature waits for the signed-in report hook; the deterministic report
 * surface is documented by SlaReport and its child stories. */
export const WaitingForReport: Story = {};
