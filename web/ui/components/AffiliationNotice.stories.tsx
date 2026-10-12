import type { Meta, StoryObj } from '@storybook/react-vite';
import { AffiliationNotice } from './AffiliationNotice';

const meta = {
  component: AffiliationNotice,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ margin: '8em' }}>
        {/* Storybook(AffiliationNotice)  */}
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AffiliationNotice>;
export default meta;
export const Default: StoryObj<typeof meta> = {};
