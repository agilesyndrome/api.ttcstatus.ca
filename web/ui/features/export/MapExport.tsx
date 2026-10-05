import { t } from '../../i18n';
import { useLanguage } from '../../i18n/react';
import { useEffect, useRef, useState } from 'react';
import { downloadFile } from './download';
interface Props {
  image?: string;
  includeCars: boolean;
  onCars(value: boolean): void;
  onClose(): void;
}
export function MapExport({ image, includeCars, onCars, onClose }: Props) {
  useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState<string>();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    if (!image) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(new Blob([image], { type: 'image/svg+xml' }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [image]);
  useEffect(() => {
    const node = dialog.current!;
    if (image && !node.open) node.showModal();
    if (!image && node.open) node.close();
  }, [Boolean(image)]);
  return (
    <>
      <dialog
        ref={dialog}
        className="keyboard-help map-export"
        aria-labelledby="map-export-title"
        onClose={onClose}
        onCancel={onClose}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            onClose();
        }}
      >
        <div className="details-heading export-options">
          <h2 id="map-export-title">{t('mapExport.takeThisMapWithYou')}</h2>
          <button aria-label={t('mapExport.closeMapExport')} onClick={onClose}>
            ×
          </button>
        </div>
        <p className="helper export-options">
          {t('mapExport.aFrozenCopyOfYourCurrentViewWithARoute')}
        </p>
        <label className="accessible-filter export-options">
          <input
            type="checkbox"
            checked={includeCars}
            onChange={(event) => onCars(event.target.checked)}
          />{' '}
          {t('mapExport.includeVisibleStreetcarPositions')}
        </label>
        {url && (
          <img
            className="map-print-sheet"
            src={url}
            alt={t('mapExport.printableTorontoStreetcarMapWithRouteKeySnapshotDateAnd')}
            onLoad={() => setReady(true)}
            onError={() => setReady(false)}
          />
        )}
        <div className="comparison-actions export-options">
          <button
            className="action-button"
            disabled={!ready}
            onClick={() => window.print()}
          >
            {t('mapExport.printSavePdf')}
          </button>
          <button
            className="action-button"
            disabled={!image || !ready}
            onClick={() =>
              image && downloadFile(image, 'toronto-streetcar-map.svg', 'image/svg+xml')
            }
          >
            {t('mapExport.downloadMapSvg')}
          </button>
        </div>
        <p className="microcopy export-options">
          {t('mapExport.svgWorksOfflineInABrowserAndScalesForPrinting')}
        </p>
      </dialog>
      <section className="map-print-output" aria-hidden="true">
        {url && <img className="map-print-sheet" src={url} alt="" />}
      </section>
    </>
  );
}
