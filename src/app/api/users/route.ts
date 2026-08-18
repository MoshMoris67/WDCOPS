import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { hashPassword } from '@/lib/auth';

export async function GET() {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const users = await prisma.user.findMany({
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { assignedDebtors: true } } },
  });

  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      assignedDebtorCount: u._count.assignedDebtors,
      createdAt: u.createdAt,
    })),
  });
}

export async function POST(req: Request) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const role = typeof body?.role === 'string' ? body.role : '';

  if (!name || !email || !password || !['admin', 'agent'].includes(role)) {
    return NextResponse.json({ error: 'name, email, password, and a valid role are required' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return NextResponse.json({ error: 'A user with that email already exists' }, { status: 409 });

  const user = await prisma.user.create({
    data: { name, email, passwordHash: await hashPassword(password), role },
  });

  return NextResponse.json(
    { user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status } },
    { status: 201 }
  );
}
