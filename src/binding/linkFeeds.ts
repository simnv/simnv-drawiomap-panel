/**
 * The refId that feeds each half of a link (spec 3.8.2, D14). The edge key names the interface at the source end, so
 * a→b takes `up` (tx) and b→a takes `down` (rx). The cell attribute `at=target` tells that the key names the target
 * end: then a→b takes `down` and b→a takes `up`. `at=source`, no `at` and any other value give no change. The stroke,
 * the link label and the card row all use this one mapping (3.8.3).
 */
export function linkFeeds(at: string | undefined, up: string, down: string): { a2b: string; b2a: string } {
  return at === 'target' ? { a2b: down, b2a: up } : { a2b: up, b2a: down };
}
