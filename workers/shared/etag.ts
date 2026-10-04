/** If-None-Match on GET/HEAD uses weak comparison (RFC 9110, 13.1.2).
 * Cloudflare compression can add W/ to the validator seen by the browser. */
export function ifNoneMatchMatches(header: string | null | undefined, etag: string | null | undefined): boolean {
  if (!header || !etag) return false;
  const current = /^(?:W\/)?("[\x21\x23-\x7e\x80-\xff]*")$/.exec(etag.trim());
  if (!current) return false;
  if (header.trim() === "*") return true;

  // Parse quoted tags instead of splitting on commas: opaque tags may contain
  // commas. Ignore empty list elements, but reject malformed validators.
  const tags = /[ \t]*(?:(?:W\/)?("[\x21\x23-\x7e\x80-\xff]*"))?[ \t]*(?:,|$)/gy;
  let offset = 0, matched = false;
  while (offset < header.length) {
    tags.lastIndex = offset;
    const tag = tags.exec(header);
    if (!tag || tags.lastIndex === offset) return false;
    if (tag[1] === current[1]) matched = true;
    offset = tags.lastIndex;
  }
  return matched;
}
