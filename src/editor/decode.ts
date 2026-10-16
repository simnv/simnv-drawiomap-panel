/** Decodes a data URI (base64 or percent-encoded) to a UTF-8 string. Returns other text unchanged. */
export function decodeDataUri(uri: string): string {
  const m = /^data:([^,]*?)(;base64)?,(.*)$/s.exec(uri);
  if (!m) {
    return uri;
  }
  if (m[2]) {
    const bin = atob(m[3]);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  }
  return decodeURIComponent(m[3]);
}
