import type { Meta, StoryObj } from '@storybook/react-vite';
import { NavPanel, navLogos } from './NavPanel';

const meta = {
  title: 'Components/nav/NavPanel',
  component: NavPanel,
  tags: ['autodocs'],
} satisfies Meta<typeof NavPanel>;
export default meta;

export const Explore: StoryObj<typeof meta> = {
  args: { name: 'Explore', href: '/', logo: navLogos.explore },
};

export const Journal: StoryObj<typeof meta> = {
  args: { name: 'Journal', href: '/#view=journal', logo: navLogos.journal },
};

export const Badges: StoryObj<typeof meta> = {
  args: { name: 'Badges', href: '/#view=badges', logo: navLogos.badges },
};

export const Status: StoryObj<typeof meta> = {
  args: { name: 'Status', href: '/sla', logo: navLogos.sla },
};

export const Settings: StoryObj<typeof meta> = {
  args: { name: 'Settings', href: '/settings', logo: navLogos.settings },
};
