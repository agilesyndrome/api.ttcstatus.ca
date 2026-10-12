import type { Meta, StoryObj } from '@storybook/react-vite';
import { SlaPage } from './SlaPage';

const meta = {
  title: 'Pages/SlaPage',
  component: SlaPage,
  tags: ['autodocs'],
} satisfies Meta<typeof SlaPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SignedOut: Story = {};
