import type { Meta, StoryObj } from '@storybook/react-vite';
import { PageFooter } from './PageFooter';
const meta = {
  component: PageFooter,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div style={{ margin: '3em' }}>
        {/* 👇 Decorators in Storybook also accept a function. Replace <Story/> with Story() to enable it  */}
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PageFooter>;
export default meta;
export const Default: StoryObj<typeof meta> = {};
