import type { Meta, StoryObj } from '@storybook/react-vite';
import { Nav } from './Nav';

const meta = {
  title: 'Components/nav/Nav',
  component: Nav,
  tags: ['autodocs'],
} satisfies Meta<typeof Nav>;
export default meta;

export const Default: StoryObj<typeof meta> = {
  args: {
    variant: 'page',
    children: (
      <main style={{ minHeight: '70vh', padding: 32 }}>
        <h1>Page content</h1>
      </main>
    ),
  },
};
