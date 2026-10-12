import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import type { SlaReportResponse } from '../../../../shared/service/contracts';

interface Props {
  targets: SlaReportResponse['targets'];
}

export function SlaMethodology({ targets }: Props) {
  useLanguage();
  return (
    <details className="sla-methodology">
      <summary>{t('sla.methodology')}</summary>
      <p>
        {t('sla.methodologyBody', {
          value1: Math.round(targets.metRatio * 100),
          value2: targets.toleranceRatio,
          value3: Math.round(targets.degradedRatio * 100),
        })}
      </p>
    </details>
  );
}
