/**
 * The feed of a directional use (I13). At the source, a→b takes transmit and b→a takes receive.
 * At the target, the feeds flip. Callers read the end from Use.end; listUses also accepts the own at attribute.
 * The stroke, link label, card row and chart share this mapping.
 */
export function linkFeeds(at: string | undefined, up: string, down: string): { a2b: string; b2a: string } {
  return at === 'target' ? { a2b: down, b2a: up } : { a2b: up, b2a: down };
}
