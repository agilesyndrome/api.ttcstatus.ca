import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { StreetcarJournal } from './StreetcarJournal';
import { journalEntry, type JournalEntry } from '../../../../shared/accounts/journal';
import { projectSnapshot } from '../../../../shared/map/live-status';
import { demoData, demoSnapshot } from '../../stories/fixtures';
const cars = projectSnapshot(demoData, demoSnapshot, Date.parse(demoSnapshot.fetchedAt));
const entries = cars.map((car) =>
  journalEntry(car, demoData.routes, new Date(demoSnapshot.fetchedAt)),
);
function InteractiveJournal(props: React.ComponentProps<typeof StreetcarJournal>) {
  const [saved, setSaved] = useState<JournalEntry[]>(props.entries);
  return <StreetcarJournal {...props} entries={saved} onChange={setSaved} />;
}
const meta = {
  component: StreetcarJournal,
  args: {
    entries,
    cars,
    routes: demoData.routes,
    active: true,
    onChange: fn(),
    onSelect: fn(),
  },
  render: (args) => <InteractiveJournal {...args} />,
  tags: ['autodocs'],
} satisfies Meta<typeof StreetcarJournal>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Collection: Story = {};
export const Empty: Story = { args: { entries: [] } };
export const WithNotes: Story = {
  args: {
    entries: entries.map((entry) => ({
      ...entry,
      note: 'A little ride along Queen.\nNext stop: coffee ☕',
    })),
  },
};
export const Paused: Story = { args: { active: false } };
export const Milestones: Story = {
  args: {
    entries: Array.from({ length: 25 }, (_, index) => ({
      ...entries[0],
      vehicleId: String(4400 + index),
      label: String(4400 + index),
      routeId: String(index % 3),
      overnight: index === 0,
    })),
  },
};
