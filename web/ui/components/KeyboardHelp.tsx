import { english } from '../../../shared/i18n/messages';
import { t } from '../i18n';
import { useLanguage } from '../i18n/react';
import { useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  enabled: boolean;
  onEnabled(value: boolean): void;
  onClose(): void;
}
const shortcuts = [
  ['/', english('keyboard.focusStopAndStreetcarSearch')],
  ['E', english('keyboard.openExplore')],
  ['F', english('keyboard.openFleet')],
  ['C', english('keyboard.openCompare')],
  ['D', english('keyboard.openStopDirectory')],
  ['J', english('keyboard.openStreetcarJournal')],
  ['P', english('keyboard.previewAPrintableMap')],
  ['S', english('keyboard.saveOrRemoveTheSelectedStop')],
  ['N', english('keyboard.switchDayNightTheme')],
  ['R', english('keyboard.resetSelectionAndFitTheMap')],
  ['?', english('keyboard.openThisHelp')],
] as const;
export function KeyboardHelp({ open, enabled, onEnabled, onClose }: Props) {
  useLanguage();
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
        <h2 id="shortcut-title">{t('keyboard.title')}</h2>
        <button aria-label={t('keyboard.closeShortcutHelp')} onClick={onClose}>
          ×
        </button>
      </div>
      <p className="helper">{t('keyboard.shortcutsWorkWhileYouReOutsideATextFieldOr')}</p>
      <dl className="shortcut-list">
        {shortcuts.map(([key, action]) => (
          <div key={key}>
            <dt>
              <kbd>{key}</kbd>
            </dt>
            <dd>{t(action)}</dd>
          </div>
        ))}
      </dl>
      <p className="helper">{t('keyboard.focusTheMapToUseArrowKeysForPanningFor')}</p>
      <label className="accessible-filter">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onEnabled(event.target.checked)}
        />{' '}
        {t('keyboard.enableKeyboardShortcuts')}
      </label>
    </dialog>
  );
}
