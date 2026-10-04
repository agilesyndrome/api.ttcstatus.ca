import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { MapExport } from './MapExport';
const image =
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><rect width="800" height="500" fill="#fffdf7"/><text x="40" y="50" font-family="system-ui" font-size="24">Toronto streetcar field map</text><path d="M80 240H720M180 100V360" stroke="#b4393f" stroke-width="5"/><circle cx="180" cy="240" r="8" fill="white" stroke="#43535e"/><text x="200" y="224" font-family="system-ui">Queen at Spadina</text><text x="40" y="450" font-family="system-ui" font-size="12">Schematic · Demo snapshot · Location marker omitted</text></svg>';
const meta = {
  component: MapExport,
  args: { image, includeCars: true, onCars: fn(), onClose: fn() },
  tags: ['autodocs'],
} satisfies Meta<typeof MapExport>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Preview: Story = {};
export const WithoutCars: Story = { args: { includeCars: false } };
