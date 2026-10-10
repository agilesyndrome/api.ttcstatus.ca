import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { MainNav } from '../components/MainNav';
import type { SidebarPanel } from '../commute';

const meta = {
  component: MainNav,
  args: { panel: 'explore', onPanel: fn() },
  tags: ['autodocs'],
} satisfies Meta<typeof MainNav>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The map workspace's strip: panels as tabs, with the SLA and Settings page
 * links beside them. */
function InteractiveTabs() {
  const [panel, setPanel] = useState<SidebarPanel>('explore');
  return (
    <aside className="sidebar" style={{ width: 350, height: 220 }}>
      <MainNav panel={panel} onPanel={setPanel} />
      {(['explore', 'journal', 'badges'] as const).map((value) => (
        <div
          key={value}
          id={`panel-${value}`}
          role="tabpanel"
          aria-label={`${value} tools`}
          hidden={panel !== value}
        >
          Tools for {value}
        </div>
      ))}
    </aside>
  );
}
export const WorkspaceTabs: Story = { render: () => <InteractiveTabs /> };

/** The standalone pages' strip: the same five items as links, the page's own
 * surface marked current. */
export const PageLinks: Story = {
  args: { current: 'sla' },
};
