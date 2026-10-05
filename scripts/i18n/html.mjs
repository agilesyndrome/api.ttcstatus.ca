import { readFile } from 'node:fs/promises';

export async function renderLocalizedHtml(template) {
  const messages = JSON.parse(
    await readFile(
      new URL('../../shared/i18n/locales/en-CA/messages.json', import.meta.url),
      'utf8',
    ),
  );
  return template.replace(/\{\{i18n:([\w.-]+)\}\}/g, (_, key) => {
    if (!Object.hasOwn(messages, key))
      throw new Error(`Unknown HTML translation key: ${key}`);
    return messages[key]
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  });
}
