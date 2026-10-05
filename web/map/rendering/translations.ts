import { t } from '../../ui/i18n';

/** Static viewer copy is explicitly marked so TTC place names remain untouched. */
export function translateViewerPage() {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n!);
  });
  for (const attribute of ['aria-label', 'title', 'placeholder', 'alt', 'content'])
    document.querySelectorAll(`[data-i18n-${attribute}]`).forEach((element) => {
      element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)!));
    });
}
