import { useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  enabled: boolean;
  onEnabled(value: boolean): void;
  onClose(): void;
}
const shortcuts = [
  ['/', 'Focus stop and streetcar search'],
  ['E', 'Open Explore'],
  ['F', 'Open Fleet'],
  ['C', 'Open Compare'],
  ['D', 'Open stop directory'],
  ['J', 'Open streetcar journal'],
  ['P', 'Preview a printable map'],
  ['S', 'Save or remove the selected stop'],
  ['N', 'Switch day/night theme'],
  ['R', 'Reset selection and fit the map'],
  ['?', 'Open this help'],
] as const;
export function KeyboardHelp({ open, enabled, onEnabled, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current!;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="keyboard-help"
      aria-labelledby="shortcut-title"
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
      <div className="details-heading">
        <h2 id="shortcut-title">Keyboard shortcuts</h2>
        <button aria-label="Close shortcut help" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="helper">Shortcuts work while you’re outside a text field or menu.</p>
      <dl className="shortcut-list">
        {shortcuts.map(([key, action]) => (
          <div key={key}>
            <dt>
              <kbd>{key}</kbd>
            </dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
      <p className="helper">
        Focus the map to use arrow keys for panning, + / − for zoom, and Home to fit.
        Escape closes this help.
      </p>
      <label className="accessible-filter">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onEnabled(event.target.checked)}
        />{' '}
        Enable keyboard shortcuts
      </label>
    </dialog>
  );
}
