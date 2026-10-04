import { MAX_CSV_FIELD_CHARACTERS, MAX_CSV_COLUMNS } from './limits';
/**
 * Streaming RFC-4180-ish CSV reader suitable for GTFS text files.
 * It handles quoted commas, escaped quotes, CRLF, and quoted newlines without
 * buffering the entire GTFS entry in Worker memory.
 */
export async function* csvRows(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<Record<string, string>> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');

  let header: string[] | null = null;
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let quotePending = false;
  let firstField = true;

  const finishField = () => {
    if (field.length > MAX_CSV_FIELD_CHARACTERS)
      throw new Error('CSV field is too large');
    if (row.length >= MAX_CSV_COLUMNS) throw new Error('CSV row has too many columns');
    if (firstField) {
      field = field.replace(/^\uFEFF/, '');
      firstField = false;
    }
    row.push(field);
    field = '';
  };

  const finishRow = (): Record<string, string> | null => {
    finishField();
    const values = row;
    row = [];
    firstField = true;

    // Ignore a trailing entirely-empty row.
    if (values.length === 1 && values[0] === '') return null;

    if (!header) {
      header = values;
      return null;
    }

    const out: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) out[header[i]] = values[i] ?? '';
    return out;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      const text = decoder.decode(value, { stream: !done });

      for (let i = 0; i < text.length; i++) {
        if (field.length > MAX_CSV_FIELD_CHARACTERS)
          throw new Error('CSV field is too large');
        const ch = text[i];

        if (quotePending) {
          if (ch === '"') {
            field += '"';
            quotePending = false;
            continue;
          }
          inQuotes = false;
          quotePending = false;
          // Continue processing this same character outside the quoted field.
        }

        if (inQuotes) {
          if (ch === '"') quotePending = true;
          else field += ch;
          continue;
        }

        if (ch === '"' && field.length === 0) {
          inQuotes = true;
        } else if (ch === ',') {
          finishField();
        } else if (ch === '\n') {
          const out = finishRow();
          if (out) yield out;
        } else if (ch !== '\r') {
          field += ch;
        }
      }

      if (done) break;
    }

    if (quotePending) {
      quotePending = false;
      inQuotes = false;
    }
    if (field.length || row.length) {
      const out = finishRow();
      if (out) yield out;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
