// Failed-login throttling for POST /api/auth/login, per account.
//
// In-memory on purpose: production is a single `next start` process in one container (see
// the server runbook), so one Map sees every login attempt, and no migration is needed. A
// restart clears it, which is harmless — it only ever forgets recent failures. If the app
// is ever scaled to more than one process, this needs to move into Postgres.
//
// Keyed by the submitted email, whether or not that account exists — so a lockout can't be
// used to tell real accounts from made-up ones. Only failures count; a success clears it.
//
// Deliberately NOT also limited per IP: every request reaches the app through the same
// proxy (Tailscale Funnel) and Next.js fills in X-Forwarded-For itself when it's missing,
// so "the IP" can easily be one shared address for the whole company — a per-IP limit
// would let a handful of typos (or one attacker, on purpose) lock every agent out at once.
// With a staff-sized number of accounts, 5 guesses per account per window is the real cap.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
// Bounds memory if someone sprays thousands of made-up emails.
const MAX_TRACKED_ACCOUNTS = 10_000;

// email -> timestamps of failures still inside the window, oldest first. Kept on globalThis
// (same reason as db.ts's Prisma client) so the login route and the users route — which
// clears an entry on password reset — always share one Map, even across dev hot reloads.
const globalForLimits = globalThis as unknown as { loginFailures?: Map<string, number[]> };
const failures = (globalForLimits.loginFailures ??= new Map<string, number[]>());

function recent(email: string, now: number): number[] {
  const list = failures.get(email);
  if (!list) return [];
  const kept = list.filter((t) => now - t < WINDOW_MS);
  if (kept.length) failures.set(email, kept);
  else failures.delete(email);
  return kept;
}

/** Seconds until this account may try again, or 0 if allowed right now. */
export function loginRetryAfterSeconds(email: string, now = Date.now()): number {
  const list = recent(email, now);
  if (list.length < MAX_FAILURES) return 0;
  const blockedUntil = list[list.length - MAX_FAILURES] + WINDOW_MS;
  return Math.max(0, Math.ceil((blockedUntil - now) / 1000));
}

/** Records a failure and returns how many this account now has inside the window. */
export function recordLoginFailure(email: string, now = Date.now()): number {
  if (failures.size >= MAX_TRACKED_ACCOUNTS) {
    for (const key of failures.keys()) recent(key, now);
    // Still too many live entries: drop the oldest-inserted ones (Map keeps insertion order).
    for (const key of failures.keys()) {
      if (failures.size < MAX_TRACKED_ACCOUNTS) break;
      failures.delete(key);
    }
  }
  const list = recent(email, now);
  list.push(now);
  failures.set(email, list);
  return list.length;
}

export const LOGIN_MAX_FAILURES = MAX_FAILURES;

/** One line per failed/blocked sign-in in the app's stdout, so `docker logs wellcashops-app
 *  | grep "\[login\]"` shows who is being tried and from where. The password is never logged.
 *  Values go through JSON.stringify so a crafted email can't forge extra log lines.
 *  `via` tells the two entrances apart: Funnel (the public https address, where ip is the
 *  visitor's address as Funnel reports it) vs. a direct hit on the server's own port, where
 *  X-Forwarded-For is whatever the client chose to send and can't be trusted. */
export function logLoginEvent(event: 'failed' | 'LOCKED' | 'blocked', email: string, req: Request, detail: string) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  const via = host.endsWith('.ts.net') ? 'funnel' : `direct(${host})`;
  console.warn(
    `[login] ${new Date().toISOString()} ${event} email=${JSON.stringify(email)} ip=${JSON.stringify(ip)} via=${JSON.stringify(via)} ${detail}`
  );
}

/** Clears an account's failures — on successful login, and when an admin resets that
 *  user's password (the way to unlock someone early without waiting out the window). */
export function clearLoginFailures(email: string) {
  failures.delete(email);
}
