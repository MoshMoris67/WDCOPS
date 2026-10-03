import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { verifyPassword, signSession, SESSION_COOKIE, sessionCookieOptions, type SessionPayload } from '@/lib/auth';
import { clearLoginFailures, loginRetryAfterSeconds, logLoginEvent, LOGIN_MAX_FAILURES, recordLoginFailure } from '@/lib/login-rate-limit';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
  }

  // Checked before touching the password at all — a locked-out attempt is rejected even if
  // the password happens to be right, otherwise the lock wouldn't stop guessing.
  const retryAfter = loginRetryAfterSeconds(email);
  if (retryAfter > 0) {
    const minutes = Math.ceil(retryAfter / 60);
    logLoginEvent('blocked', email, req, `(locked, ${minutes} min left)`);
    return NextResponse.json(
      { error: `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or ask an admin to reset your password.` },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const valid = user && user.status === 'active' && (await verifyPassword(password, user.passwordHash));

  if (!user || !valid) {
    const count = recordLoginFailure(email);
    const reason = !user ? 'no such account' : user.status !== 'active' ? 'account inactive' : 'wrong password';
    logLoginEvent('failed', email, req, `(${count}/${LOGIN_MAX_FAILURES}, ${reason})`);
    if (count >= LOGIN_MAX_FAILURES) logLoginEvent('LOCKED', email, req, 'for 15 min');
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }
  clearLoginFailures(email);

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
