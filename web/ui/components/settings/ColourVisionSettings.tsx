import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { SegmentedControl } from '../SegmentedControl';
import { useColourMode } from '../../hooks/useColourMode';
import type { ColourMode } from '../../../../shared/map/field-palette';

export function ColourVisionSettings() {
  useLanguage();
  const { colourMode, setColourMode } = useColourMode();
  const choices: { value: ColourMode; label: string }[] = [
    { value: 'standard', label: t('colourVision.standard') },
    { value: 'redgreen', label: t('colourVision.redgreen') },
    { value: 'full', label: t('colourVision.full') },
  ];
  return (
    <section className="colour-vision-settings" id="colour-vision">
      <h1>{t('colourVision.title')}</h1>
      <p className="microcopy">{t('colourVision.description')}</p>
      <SegmentedControl
        value={colourMode}
        options={choices}
        label={t('colourVision.title')}
        onChange={setColourMode}
      />
    </section>
  );
}
