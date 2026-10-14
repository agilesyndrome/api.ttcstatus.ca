import type { Meta, StoryObj } from '@storybook/react-vite';
import { fieldPalette } from '../../../../shared/map/field-palette';

function FieldContrastAudit() {
  return (
    <div className="field-contrast-audit">
      {(['light', 'dark'] as const).flatMap((theme) =>
        (['standard', 'redgreen', 'full'] as const).map((mode) => {
          const palette = fieldPalette(theme, mode);
          return (
            <section key={`${theme}-${mode}`}>
              <h2>
                {theme} · {mode}
              </h2>
              {(['fresh', 'due', 'void', 'unmonitored', 'collecting'] as const).map(
                (state) => (
                  <div key={state} style={{ background: palette[state], color: '#fff' }}>
                    {state}
                  </div>
                ),
              )}
            </section>
          );
        }),
      )}
    </div>
  );
}

const meta = {
  component: FieldContrastAudit,
  tags: ['autodocs'],
} satisfies Meta<typeof FieldContrastAudit>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AllThemesAndModes: Story = {};
