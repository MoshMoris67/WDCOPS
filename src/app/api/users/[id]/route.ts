import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireRole, isSessionPayload } from '@/lib/rbac';
import { hashPassword } from '@/lib/auth';
import { clearLoginFailures } from '@/lib/login-rate-limit';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  const body = await req.json().catch(() => null);

  const data: { name?: string; email?: string; passwordHash?: string; role?: string; status?: string } = {};

  if (typeof body?.name === 'string') {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: 'Name cannot be blank' }, { status: 400 });
    data.name = name;
  }
  if (typeof body?.email === 'string') {
    const email = body.email.trim().toLowerCase();
    if (!email) return NextResponse.json({ error: 'Email cannot be blank' }, { status: 400 });
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && existing.id !== id) return NextResponse.json({ error: 'A user with that email already exists' }, { status: 409 });
    data.email = email;
  }
  if (typeof body?.password === 'string' && body.password.length > 0) {
    if (body.password.length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    data.passwordHash = await hashPassword(body.password);
  }
  if (typeof body?.role === 'string' && ['admin', 'agent'].includes(body.role)) data.role = body.role;
  if (typeof body?.status === 'string' && ['active', 'inactive'].includes(body.status)) data.status = body.status;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }
  if (id === session.sub && data.status === 'inactive') {
    return NextResponse.json({ error: "You can't deactivate your own account" }, { status: 400 });
  }
  if (id === session.sub && data.role === 'agent') {
    return NextResponse.json({ error: "You can't demote your own account — have another admin do it" }, { status: 400 });
  }

  const user = await prisma.user.update({ where: { id }, data }).catch(() => null);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  // A password reset is how an admin unlocks someone who tripped the failed-login limit.
  if (data.passwordHash) clearLoginFailures(user.email);

  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status },
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole(['admin']);
  if (!isSessionPayload(session)) return session;

  const { id } = await params;
  if (id === session.sub) {
    return NextResponse.json({ error: "You can't delete your own account" }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({ where: { id }, select: { status: true } });
        if (!user) return { error: 'not-found' as const };
        if (user.status !== 'inactive') {
          return { error: 'active' as const };
        }

        const assignedDebtorCount = await tx.debtor.count({
          where: { assignedAgentId: id },
        });
        if (assignedDebtorCount > 0) {
          return { error: 'assigned' as const, assignedDebtorCount };
        }

        await tx.user.delete({ where: { id } });
        return { ok: true as const };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    if ('error' in result) {
      if (result.error === 'not-found') {
        return NextResponse.json(
          { error: 'User not found' },
          { status: 404 }
        );
      }
      if (result.error === 'active') {
        return NextResponse.json(
          { error: 'Deactivate this user before deleting them.' },
          { status: 400 }
        );
      }
      return NextResponse.json(
        {
          error: `This user still has ${result.assignedDebtorCount} debtor(s) assigned — reassign those first (Team Overview).`,
        },
        { status: 400 }
      );
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') {
      return NextResponse.json(
        { error: 'The user or their assignments changed while deleting. Refresh and try again.' },
        { status: 409 }
      );
    }
    console.error('Failed to delete user', { userId: id, error });
    return NextResponse.json({ error: 'Could not delete user because related records still reference this account.' }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
