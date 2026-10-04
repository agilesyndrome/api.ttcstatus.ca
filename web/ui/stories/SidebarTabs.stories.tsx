import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { SidebarTabs } from '../components/SidebarTabs';
import type { SidebarPanel } from '../commute';

const meta = { component: SidebarTabs, args: { value: 'explore', onChange: fn() }, tags: ['autodocs'] } satisfies Meta<typeof SidebarTabs>;
export default meta;
type Story = StoryObj<typeof meta>;
function InteractiveTabs() {
  const [panel, setPanel] = useState<SidebarPanel>('explore');
  return <aside className="sidebar" style={{ width: 350, height: 220 }}><SidebarTabs value={panel} onChange={setPanel} />{(['explore', 'fleet', 'compare', 'stops', 'journal'] as const).map(value => <div key={value} id={`panel-${value}`} role="tabpanel" aria-label={`${value} tools`} hidden={panel !== value}>Tools for {value}</div>)}</aside>;
}
export const Interactive: Story = { render: () => <InteractiveTabs /> };
