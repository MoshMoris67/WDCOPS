import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getActiveCallbacks } from '@/lib/callbacks';

// Agents see only their own active callbacks; admins see the whole branch — same
// scope-by-role pattern as api/ptp. "Active callback" is entirely derived from CallLog
// (see lib/callbacks.ts), so this list is always a live mirror of current state.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const mineOnly = new URL(req.url).searchParams.get('scope') === 'mine' || session.role === 'agent';
  const callbacks = await getActiveCallbacks(mineOnly ? session.sub : undefined);

  return NextResponse.json({ callbacks });
}
