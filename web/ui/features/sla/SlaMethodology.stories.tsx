import type { Meta, StoryObj } from '@storybook/react-vite';
import { SlaMethodology } from './SlaMethodology';
import { slaReportFixture } from './sla-fixtures';

const meta = {
  component: SlaMethodology,
  args: { targets: slaReportFixture.targets },
  tags: ['autodocs'],
} satisfies Meta<typeof SlaMethodology>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Thresholds: Story = {};
