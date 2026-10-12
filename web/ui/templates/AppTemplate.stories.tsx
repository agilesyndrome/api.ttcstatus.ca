import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppTemplate } from './AppTemplate';

const meta = {
  title: 'Templates/AppTemplate',
  component: AppTemplate,
  tags: ['autodocs'],
  args: { current: 'settings', children: null },
} satisfies Meta<typeof AppTemplate>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PageContent: Story = {
  render: (args) => (
    <AppTemplate {...args}>
      <main className="profile-page">
        <p className="eyebrow">Settings</p>
        <h1>Shared application page shell</h1>
        <p className="helper">
          Pages provide content; the template provides the app stack.
        </p>
      </main>
    </AppTemplate>
  ),
};
