import { NextResponse } from 'next/server';
import { getSession } from './session';
import type { SessionPayload } from './auth';

/** Loads the session and 403s unless the caller's role is in `roles`. Returns null on failure — caller should return it directly. */
export async function requireRole(roles: SessionPayload['role'][]): Promise<SessionPayload | NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!roles.includes(session.role)) return NextResponse.json({ error: 'Not authorized for this action' }, { status: 403 });
  return session;
}

export function isSessionPayload(x: SessionPayload | NextResponse): x is SessionPayload {
  return !(x instanceof NextResponse);
}
