/**
 * The draw.io XML as a DOM that also works in the Grafana frontend sandbox.
 *
 * The sandbox reads `style` of each element that goes to the plugin, and an element with no namespace has no `style`:
 * then the sandbox throws "Cannot convert undefined or null to object". An SVG element has a `style`. So the parse puts
 * the elements in the SVG namespace, and the serializer removes that namespace again. The names, their case and the
 * attributes do not change.
 */
const NS = 'http://www.w3.org/2000/svg';
const DECLARATION = ` xmlns="${NS}"`;
/** The name of the root element, after an XML declaration, comments, processing instructions and a doctype. */
const ROOT_NAME = /^(?:\s|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>)*<[A-Za-z_][\w.:-]*/;
/** The root start tag declares its own default namespace. */
const OWN_NAMESPACE = /^[^>]*?\sxmlns\s*=/;

/** The documents that got the SVG namespace from `parseXml`. */
const wrapped = new WeakSet<Document>();

/** Parse an XML text. Give `undefined` when it does not parse. */
export function parseXml(text: string): Document | undefined {
  const root = ROOT_NAME.exec(text);
  const own = root && OWN_NAMESPACE.test(text.slice(root[0].length));
  const source = root && !own ? root[0] + DECLARATION + text.slice(root[0].length) : text;
  const doc = new DOMParser().parseFromString(source, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    return undefined;
  }
  if (root && !own) {
    wrapped.add(doc);
  }
  return doc;
}

/** A new element in the namespace of the root, so that the serializer writes no `xmlns` for it. */
export function createXmlElement(doc: Document, name: string): Element {
  return doc.createElementNS(doc.documentElement.namespaceURI, name);
}

/** The XML text of a document from `parseXml`, with no namespace that the parse added. */
export function serializeXml(doc: Document): string {
  const text = new XMLSerializer().serializeToString(doc);
  // The first match is in the root start tag: a value in an attribute escapes its quotes.
  return wrapped.has(doc) ? text.replace(DECLARATION, '') : text;
}
