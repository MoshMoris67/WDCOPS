'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { UserPlus, ShieldCheck, Ban, CheckCircle, Pencil, Trash2, Save } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import Fab from '@/components/ui/Fab';
import ListToolbar from '@/components/ui/ListToolbar';
import ResponsiveList from '@/components/ui/ResponsiveList';
import { toast } from '@/lib/toast';
import { getCached, setCached } from '@/lib/offline-cache';
import { useOfflineGuard } from '@/lib/use-offline-guard';
import { DEPLOYMENT } from '@/config/deployment';
import { t } from '@/i18n';

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'agent';
  status: 'active' | 'inactive';
  assignedDebtorCount: number;
}

interface CreateUserForm {
  name: string;
  email: string;
  password: string;
  role: 'admin' | 'agent';
}

interface EditUserForm {
  name: string;
  email: string;
  password: string;
  role: 'admin' | 'agent';
}

const roleLabel: Record<string, string> = { admin: 'Admin', agent: 'Agent' };

export default function AdminUsersContent() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const createForm = useForm<CreateUserForm>({ defaultValues: { name: '', email: '', password: '', role: 'agent' } });
  const editForm = useForm<EditUserForm>({ defaultValues: { name: '', email: '', password: '', role: 'agent' } });
  const { blocked: offlineBlocked } = useOfflineGuard();

  // Bespoke, not useCachedQuery — a 403 (wrong role) must never be confused with
  // "couldn't reach the server". Cache-first: render the last-known user list instantly
  // if this admin has loaded this screen before, then let a live response override it.
  // None of the cached fields include password data — the API route already excludes it.
  const loadUsers = useCallback(async () => {
    const cached = await getCached<{ users: UserRow[] }>('/api/users');
    if (cached) {
      setAuthorized(true);
      setUsers(cached.users ?? []);
    }
    try {
      const res = await fetch('/api/users');
      if (res.status === 403) {
        setAuthorized(false);
        return;
      }
      setAuthorized(true);
      const data = await res.json();
      setUsers(data.users ?? []);
      await setCached('/api/users', data);
    } catch {
      // Offline — whatever was set from cache above (if anything) stands as-is.
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => { if (authorized === false) router.replace('/agent-dashboard'); }, [authorized, router]);

  const filtered = users.filter((u) => u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase()));

  async function onCreate(data: CreateUserForm) {
    setIsSaving(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || t('Could not create user'));
        return;
      }
      toast.success(t('{0} added as {1}', data.name, t(roleLabel[data.role])));
      setCreateOpen(false);
      createForm.reset();
      await loadUsers();
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setIsSaving(false);
    }
  }

  function openEdit(user: UserRow) {
    setEditingUser(user);
    editForm.reset({ name: user.name, email: user.email, password: '', role: user.role });
  }

  async function onSubmitEdit(data: EditUserForm) {
    if (!editingUser) return;
    setIsSaving(true);
    try {
      const body: Record<string, string> = { name: data.name, email: data.email, role: data.role };
      if (data.password) body.password = data.password;
      const res = await fetch(`/api/users/${editingUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok) {
        toast.error(payload.error || t('Could not update user'));
        return;
      }
      toast.success(t('{0} updated', data.name));
      setEditingUser(null);
      await loadUsers();
    } catch {
      toast.error('Could not reach the server — try again');
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleStatus(user: UserRow) {
    const nextStatus = user.status === 'active' ? 'inactive' : 'active';
    const res = await fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    const payload = await res.json();
    if (!res.ok) {
      toast.error(payload.error || t('Could not update user'));
      return;
    }
    toast.success(`${user.name} ${nextStatus === 'active' ? 'reactivated' : 'deactivated'}`);
    await loadUsers();
  }

  async function deleteUser(user: UserRow) {
    if (
      !window.confirm(
        t(
          'Delete {0}? They must be inactive and have no assigned debtors. Historical call records will be retained.',
          user.name
        )
      )
    ) return;
    const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' });
    const payload = await res.json();
    if (!res.ok) {
      toast.error(payload.error || t('Could not delete user'));
      return;
    }
    toast.success(t('{0} deleted', user.name));
    await loadUsers();
  }

  if (authorized === null) {
    return <div className="p-6 xl:p-8 2xl:p-10 max-w-screen-2xl mx-auto"><p className="text-sm text-muted-foreground">{t('Loading…')}</p></div>;
  }
  if (authorized === false) return null;

  return (
    <div className="p-6 xl:p-8 2xl:p-10 max-w-screen-2xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-page-title text-foreground">{t('Users')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('Manage admin and agent accounts for the {0} branch', DEPLOYMENT.branchName)}</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          disabled={offlineBlocked}
          title={offlineBlocked ? t('Offline — reconnect to add a user') : undefined}
          className="hidden lg:flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <UserPlus size={15} />
          {t('Add User')}
        </button>
      </div>

      <div className="bg-card rounded-xl shadow-card border border-border">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-section-header text-foreground">{t('{0} accounts', users.length)}</h2>
          <ListToolbar search={search} onSearchChange={setSearch} searchPlaceholder={t('Search name or email…')} />
        </div>
        <div className="p-4 md:p-0">
          <ResponsiveList
            items={filtered}
            keyFor={(u) => u.id}
            emptyState={<p className="text-sm text-muted-foreground text-center py-8">{t('No users match your search.')}</p>}
            renderTableHead={() => (
              <tr className="border-b border-border bg-secondary/30">
                {['Name', 'Email', 'Role', 'Assigned', 'Status', ''].map((col) => (
                  <th key={t(col)} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{t(col)}</th>
                ))}
              </tr>
            )}
            renderTableRow={(u) => (
              <tr className="border-b border-border/60 hover:bg-secondary/40 transition-colors group">
                <td className="px-4 py-3 whitespace-nowrap font-medium text-foreground text-sm">{u.name}</td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-muted-foreground font-mono-data">{u.email}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <Badge variant={u.role === 'admin' ? 'info' : 'default'}>
                    {t(roleLabel[u.role])}
                  </Badge>
                </td>
                <td className="px-4 py-3 whitespace-nowrap font-tabular text-sm text-foreground">{u.assignedDebtorCount}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <Badge variant={u.status === 'active' ? 'positive' : 'muted'} dot>{u.status === 'active' ? t('Active') : t('Inactive')}</Badge>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => openEdit(u)}
                      disabled={offlineBlocked}
                      className="p-1.5 rounded-md hover:bg-primary/10 hover:text-primary transition-colors text-muted-foreground disabled:opacity-40"
                      title={offlineBlocked ? t('Offline — reconnect to edit') : t('Edit')}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => toggleStatus(u)}
                      disabled={offlineBlocked}
                      className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground disabled:opacity-40"
                      title={offlineBlocked ? t('Offline — reconnect') : (u.status === 'active' ? t('Deactivate') : t('Reactivate'))}
                    >
                      {u.status === 'active' ? <Ban size={14} /> : <CheckCircle size={14} />}
                    </button>
                    <button
                      onClick={() => deleteUser(u)}
                      disabled={offlineBlocked}
                      className="p-1.5 rounded-md hover:bg-[var(--negative-bg)] hover:text-negative transition-colors text-muted-foreground disabled:opacity-40"
                      title={offlineBlocked ? t('Offline — reconnect to delete') : t('Delete')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            )}
            renderCard={(u) => (
              <div className="bg-card border border-border rounded-xl p-4 shadow-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground text-sm truncate">{u.name}</p>
                    <p className="text-xs text-muted-foreground font-mono-data truncate">{u.email}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => openEdit(u)} disabled={offlineBlocked} className="p-1.5 rounded-md hover:bg-primary/10 hover:text-primary transition-colors text-muted-foreground disabled:opacity-40" title={offlineBlocked ? t('Offline — reconnect to edit') : t('Edit')}>
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => toggleStatus(u)} disabled={offlineBlocked} className="p-1.5 rounded-md hover:bg-secondary transition-colors text-muted-foreground disabled:opacity-40" title={offlineBlocked ? t('Offline — reconnect') : (u.status === 'active' ? t('Deactivate') : t('Reactivate'))}>
                      {u.status === 'active' ? <Ban size={14} /> : <CheckCircle size={14} />}
                    </button>
                    <button onClick={() => deleteUser(u)} disabled={offlineBlocked} className="p-1.5 rounded-md hover:bg-[var(--negative-bg)] hover:text-negative transition-colors text-muted-foreground disabled:opacity-40" title={offlineBlocked ? t('Offline — reconnect to delete') : t('Delete')}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-3">
                  <Badge variant={u.role === 'admin' ? 'info' : 'default'}>{t(roleLabel[u.role])}</Badge>
                  <Badge variant={u.status === 'active' ? 'positive' : 'muted'} dot>{u.status === 'active' ? t('Active') : t('Inactive')}</Badge>
                  <span className="text-xs text-muted-foreground ml-auto">{t('{0} assigned', u.assignedDebtorCount)}</span>
                </div>
              </div>
            )}
          />
        </div>
      </div>

      <Fab onClick={() => setCreateOpen(true)} label={t('Add User')} icon={UserPlus} disabled={offlineBlocked} />

      {/* Add user */}
      <Modal
        open={createOpen}
        onClose={() => { setCreateOpen(false); createForm.reset(); }}
        title={t('Add User')}
        subtitle={t('Create a login for an admin or agent')}
        footer={
          <>
            <button
              onClick={() => { setCreateOpen(false); createForm.reset(); }}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
            >
              {t('Cancel')}
            </button>
            <button
              form="create-user-form"
              type="submit"
              disabled={isSaving || offlineBlocked}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition-all disabled:opacity-60"
            >
              <ShieldCheck size={15} />
              {isSaving ? t('Creating…') : t('Create User')}
            </button>
          </>
        }
      >
        <form id="create-user-form" onSubmit={createForm.handleSubmit(onCreate)} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">{t('Full Name')}{' '}<span className="text-negative">*</span></label>
            <input
              className={`w-full px-3 py-2.5 text-sm bg-input border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 ${createForm.formState.errors.name ? 'border-negative' : 'border-border'}`}
              {...createForm.register('name', { required: t('Enter a name') })}
            />
            {createForm.formState.errors.name && <p className="text-xs text-negative">{t(createForm.formState.errors.name.message)}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">{t('Work Email')}{' '}<span className="text-negative">*</span></label>
            <input
              type="email"
              className={`w-full px-3 py-2.5 text-sm bg-input border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 ${createForm.formState.errors.email ? 'border-negative' : 'border-border'}`}
              {...createForm.register('email', { required: t('Enter an email') })}
            />
            {createForm.formState.errors.email && <p className="text-xs text-negative">{t(createForm.formState.errors.email.message)}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">{t('Temporary Password')}{' '}<span className="text-negative">*</span></label>
            <input
              type="password"
              className={`w-full px-3 py-2.5 text-sm bg-input border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 ${createForm.formState.errors.password ? 'border-negative' : 'border-border'}`}
              {...createForm.register('password', { required: t('Enter a password'), minLength: { value: 8, message: t('At least 8 characters') } })}
            />
            {createForm.formState.errors.password && <p className="text-xs text-negative">{t(createForm.formState.errors.password.message)}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">{t('Role')}</label>
            <select className="w-full px-3 py-2.5 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50" {...createForm.register('role')}>
              <option value="agent">{t('Agent')}</option>
              <option value="admin">{t('Admin')}</option>
            </select>
          </div>
        </form>
      </Modal>

      {/* Edit user */}
      <Modal
        open={!!editingUser}
        onClose={() => setEditingUser(null)}
        title={t('Edit User')}
        subtitle={editingUser ? editingUser.email : undefined}
        footer={
          <>
            <button
              onClick={() => setEditingUser(null)}
              className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
            >
              {t('Cancel')}
            </button>
            <button
              form="edit-user-form"
              type="submit"
              disabled={isSaving || offlineBlocked}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition-all disabled:opacity-60"
            >
              <Save size={15} />
              {isSaving ? t('Saving…') : t('Save Changes')}
            </button>
          </>
        }
      >
        <form id="edit-user-form" onSubmit={editForm.handleSubmit(onSubmitEdit)} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">{t('Full Name')}{' '}<span className="text-negative">*</span></label>
            <input
              className={`w-full px-3 py-2.5 text-sm bg-input border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 ${editForm.formState.errors.name ? 'border-negative' : 'border-border'}`}
              {...editForm.register('name', { required: t('Enter a name') })}
            />
            {editForm.formState.errors.name && <p className="text-xs text-negative">{t(editForm.formState.errors.name.message)}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">{t('Work Email')}{' '}<span className="text-negative">*</span></label>
            <input
              type="email"
              className={`w-full px-3 py-2.5 text-sm bg-input border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 ${editForm.formState.errors.email ? 'border-negative' : 'border-border'}`}
              {...editForm.register('email', { required: t('Enter an email') })}
            />
            {editForm.formState.errors.email && <p className="text-xs text-negative">{t(editForm.formState.errors.email.message)}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">{t('Reset Password')}</label>
            <input
              type="password"
              placeholder={t('Leave blank to keep the current password')}
              className={`w-full px-3 py-2.5 text-sm bg-input border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 ${editForm.formState.errors.password ? 'border-negative' : 'border-border'}`}
              {...editForm.register('password', { validate: (v) => !v || v.length >= 8 || t('At least 8 characters') })}
            />
            {editForm.formState.errors.password && <p className="text-xs text-negative">{t(editForm.formState.errors.password.message)}</p>}
          </div>
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">{t('Role')}</label>
            <select className="w-full px-3 py-2.5 text-sm bg-input border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50" {...editForm.register('role')}>
              <option value="agent">{t('Agent')}</option>
              <option value="admin">{t('Admin')}</option>
            </select>
          </div>
        </form>
      </Modal>
    </div>
  );
}
