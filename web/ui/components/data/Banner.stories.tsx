import type { Meta, StoryObj } from '@storybook/react-vite';
import { Banner } from './Banner';

const meta = {
  component: Banner,
  args: {
    title: 'Most services are meeting their promise',
    detail: '91% within target · 1,200 observed services',
    tone: 'positive',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Banner>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Positive: Story = {};
export const Warning: Story = { args: { tone: 'warning', title: 'Some services need attention' } };
export const Negative: Story = { args: { tone: 'negative', title: 'Service data is below target' } };
export const Collecting: Story = {
  args: { tone: 'neutral', title: 'Collecting service data', detail: undefined },
};
