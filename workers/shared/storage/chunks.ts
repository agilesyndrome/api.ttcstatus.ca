/** Keep JSON chunks below D1's row limit without splitting UTF-16 pairs. */
export function chunkString(value: string, maximumCharacters = 300_000): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < value.length;) {
    let end = Math.min(value.length, start + maximumCharacters);
    const last = value.charCodeAt(end - 1);
    if (end < value.length && last >= 0xd800 && last <= 0xdbff) end--;
    chunks.push(value.slice(start, end));
    start = end;
  }
  return chunks;
}
