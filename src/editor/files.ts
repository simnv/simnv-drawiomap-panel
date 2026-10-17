/**
 * Image files for the export of the bundled editor. The editor frame has an opaque origin and Grafana sends no CORS
 * headers, so draw.io cannot read the bytes of an image in dist/drawio (for example img/lib/...). It needs them to
 * embed the images in the exported SVG (embedImages). The shim in the frame (src/editor/drawio-shim.js) asks the host
 * through the channel port. The host reads only image files inside dist/drawio and answers with a data: URL.
 * These files are public plugin files: the frame gets nothing that it cannot already show as an image.
 */

/** Largest file that the host reads for the editor. */
export const MAX_EDITOR_FILE = 10 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  gif: 'image/gif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

export interface FileRequest {
  id: number;
  url: string;
}

/** Parses the payload {"dmapFetch":<id>,"url":<url>} of the shim. */
export function parseFileRequest(data: unknown): FileRequest | undefined {
  if (typeof data !== 'string' || !data.startsWith('{"dmapFetch":')) {
    return undefined;
  }
  try {
    const obj = JSON.parse(data);
    return Number.isInteger(obj.dmapFetch) && typeof obj.url === 'string'
      ? { id: obj.dmapFetch, url: obj.url }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The absolute URL and the MIME type of an image file inside the draw.io directory, or undefined.
 * The URL parser removes dot segments (also %2e%2e), so the prefix check keeps the request inside `base`.
 */
export function editorFileUrl(url: string, base: string): { href: string; type: string } | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (u.search !== '' || u.hash !== '' || !u.href.startsWith(base)) {
    return undefined;
  }
  const ext = /\.([a-z]+)$/i.exec(u.pathname)?.[1].toLowerCase();
  const type = ext ? IMAGE_TYPES[ext] : undefined;
  return type ? { href: u.href, type } : undefined;
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/**
 * Reads the requested file and returns the reply {"dmapFile":<id>,"dataUri":<data: URL>} for the port. The data: URL
 * is empty when the request is not allowed or the read fails: draw.io then keeps the image URL.
 * The request has no credentials and does not follow redirects.
 */
export async function readEditorFile(
  req: FileRequest,
  base: string,
  fetchFn: typeof fetch = fetch,
  maxBytes = MAX_EDITOR_FILE
): Promise<string> {
  let dataUri = '';
  const file = editorFileUrl(req.url, base);
  if (file) {
    try {
      const res = await fetchFn(file.href, { credentials: 'omit', redirect: 'error' });
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length <= maxBytes) {
          dataUri = `data:${file.type};base64,${base64(bytes)}`;
        }
      }
    } catch {
      dataUri = '';
    }
  }
  return JSON.stringify({ dmapFile: req.id, dataUri });
}
