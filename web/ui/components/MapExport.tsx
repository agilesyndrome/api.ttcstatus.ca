import { useEffect, useRef, useState } from 'react';
import { downloadFile } from '../download';
interface Props { image?: string; includeCars: boolean; onCars(value: boolean): void; onClose(): void }
export function MapExport({ image, includeCars, onCars, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState<string>();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    if (!image) { setUrl(undefined); return; }
    const next = URL.createObjectURL(new Blob([image], { type: 'image/svg+xml' }));
    setUrl(next); return () => URL.revokeObjectURL(next);
  }, [image]);
  useEffect(() => {
    const node = dialog.current!;
    if (image && !node.open) node.showModal();
    if (!image && node.open) node.close();
  }, [Boolean(image)]);
  return <><dialog ref={dialog} className="keyboard-help map-export" aria-labelledby="map-export-title" onClose={onClose} onCancel={onClose} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
  }}><div className="details-heading export-options"><h2 id="map-export-title">Take this map with you.</h2><button aria-label="Close map export" onClick={onClose}>×</button></div>
    <p className="helper export-options">A frozen copy of your current view with a route key and sources. Pan, zoom or fit the map before opening this preview. Your location marker and saved-stop stars are left out.</p>
    <label className="accessible-filter export-options"><input type="checkbox" checked={includeCars} onChange={event => onCars(event.target.checked)} /> Include visible streetcar positions</label>
    {url && <img className="map-print-sheet" src={url} alt="Printable Toronto streetcar map with route key, snapshot date and sources" onLoad={() => setReady(true)} onError={() => setReady(false)} />}
    <div className="comparison-actions export-options"><button className="action-button" disabled={!ready} onClick={() => window.print()}>Print / save PDF</button><button className="action-button" disabled={!image || !ready} onClick={() => image && downloadFile(image, 'toronto-streetcar-map.svg', 'image/svg+xml')}>Download map (.svg)</button></div>
    <p className="microcopy export-options">SVG works offline in a browser and scales for printing. Streetcars are position reports at capture time, including any dimmed stale reports.</p>
  </dialog><section className="map-print-output" aria-hidden="true">{url && <img className="map-print-sheet" src={url} alt="" />}</section></>;
}
