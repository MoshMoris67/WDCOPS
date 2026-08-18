import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession, type SessionPayload } from './auth';

/** Reads and verifies the session cookie inside a Route Handler or Server Component. */
export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}
