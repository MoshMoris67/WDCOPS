/**
 * Picks a badge color for a client name deterministically (same name always
 * gets the same color) without hardcoding specific names — the old
 * `name === 'KCB' ? 'info' : 'warning'` pattern silently fell back to gray
 * for every client added after the first two, and broke entirely the moment
 * a client got renamed. Sticks to non-semantic variants only — 'positive'/
 * 'negative' already mean success/failure elsewhere in the UI, so reusing
 * them here for arbitrary client identity would be misleading.
 */
const CLIENT_BADGE_VARIANTS = ['info', 'warning', 'default', 'muted'] as const;

export function clientBadgeVariant(name: string): (typeof CLIENT_BADGE_VARIANTS)[number] {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return CLIENT_BADGE_VARIANTS[hash % CLIENT_BADGE_VARIANTS.length];
}
