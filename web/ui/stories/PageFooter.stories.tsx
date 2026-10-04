import type { Meta, StoryObj } from '@storybook/react-vite';
import { PageFooter } from '../components/PageFooter';
const meta = { component: PageFooter, tags: ['autodocs'] } satisfies Meta<
  typeof PageFooter
>;
export default meta;
export const Default: StoryObj<typeof meta> = {};
