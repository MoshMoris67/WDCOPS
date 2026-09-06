import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession, type SessionPayload } from './auth';
import { prisma } from './db';

/** Reads and verifies the session cookie inside a Route Handler or Server Component. */
export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await verifySession(token);
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { email: true, name: true, role: true, status: true },
  });
  if (!user || user.status !== 'active') return null;

  return {
    sub: session.sub,
    email: user.email,
    name: user.name,
    role: user.role as SessionPayload['role'],
  };
}
