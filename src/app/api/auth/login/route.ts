import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyPassword, signSession, SESSION_COOKIE, sessionCookieOptions, type SessionPayload } from '@/lib/auth';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const valid = user && user.status === 'active' && (await verifyPassword(password, user.passwordHash));

  if (!user || !valid) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const session: SessionPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role as SessionPayload['role'],
  };
  const token = await signSession(session);

  const res = NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
}
