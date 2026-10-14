import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ColourMode } from '../../../../shared/map/field-palette';
import { drynessColor } from './wave-field';

const scenes = {
  roncesvallesQueenKing: {
    title: 'Roncesvalles · Queen · King',
    values: [0.2, 0.45, null, 2.4, 0.25, 0.7, 1.8],
    routeNumber: '501',
    routeColour: '#c74638',
    note: 'seam gap beside the route identity',
  },
  collegeDufferin: {
    title: 'College · Dufferin',
    values: [0.2, null, 0.6, 1.2, null, 1.9],
    bridgedValues: [0.2, 0.4, 0.6, 1.2, 1.55, 1.9],
    note: 'blind-stop bridge comparison',
  },
  dundasGladstone: {
    title: 'Dundas · Gladstone',
    values: [0, 0.4, 0.8, 1.2, 1.7, 2.1, 2.5, 3.2],
    note: 'fresh → due → void → beyond',
  },
} as const;

function ServiceColourFixture({
  title,
  values,
  bridgedValues,
  routeNumber,
  routeColour,
  note,
  colourMode = 'standard',
}: {
  title: string;
  values: readonly (number | null)[];
  bridgedValues?: readonly (number | null)[];
  routeNumber?: string;
  routeColour?: string;
  note: string;
  colourMode?: ColourMode;
}) {
  return (
    <figure style={{ width: 720, margin: 24 }}>
      <figcaption style={{ marginBottom: 8 }}>
        <strong>{title}</strong> · {note}
      </figcaption>
      {[
        { label: bridgedValues ? 'before bridge' : 'direction A', values },
        {
          label: bridgedValues ? 'after bridge' : 'direction B',
          values: bridgedValues ?? values,
        },
      ].map(({ label, values: rowValues }, rowIndex) => (
        <svg key={label} viewBox="0 0 720 42" width="720" height="42">
          <text x="0" y="23" fontSize="10" fill="#59616a">
            {label}
          </text>
          {rowValues.map((dryness, index) => (
            <line
              key={index}
              x1={index * 78 + 86}
              x2={index * 78 + 150}
              y1={18}
              y2={18}
              stroke={
                dryness === null
                  ? '#707982'
                  : drynessColor(dryness, undefined, 'light', colourMode)
              }
              strokeWidth={5}
              strokeDasharray={dryness === null ? '3 3' : undefined}
            />
          ))}
          {routeNumber && rowIndex === 0 && (
            <g transform="translate(625 8)">
              <rect width="42" height="20" rx="8" fill={routeColour} />
              <text x="21" y="14" textAnchor="middle" fontSize="11" fill="#fff">
                {routeNumber}
              </text>
            </g>
          )}
        </svg>
      ))}
    </figure>
  );
}

const meta = {
  component: ServiceColourFixture,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
} satisfies Meta<typeof ServiceColourFixture>;
export default meta;
type Story = StoryObj<typeof meta>;

export const RoncesvallesQueenKing: Story = { args: scenes.roncesvallesQueenKing };
export const CollegeDufferin: Story = { args: scenes.collegeDufferin };
export const DundasGladstone: Story = { args: scenes.dundasGladstone };

export const AllColourModes: Story = {
  args: scenes.dundasGladstone,
  render: () => (
    <div style={{ display: 'grid', gap: 8 }}>
      {(['standard', 'redgreen', 'full'] as const).map((colourMode) => (
        <ServiceColourFixture
          key={colourMode}
          {...scenes.dundasGladstone}
          title={`${scenes.dundasGladstone.title} · ${colourMode}`}
          colourMode={colourMode}
        />
      ))}
    </div>
  ),
};
