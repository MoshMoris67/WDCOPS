'use client';

import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Eye, EyeOff, Wifi, LogIn, ShieldCheck, Mail, Lock,
  PhoneCall, RadioTower, Smartphone,
} from 'lucide-react';
import AppLogo from '@/components/ui/AppLogo';
import DispositionBadge from '@/components/ui/DispositionBadge';
import BrandWordmark from '@/components/ui/BrandWordmark';
import { toast } from 'sonner';

interface LoginFormData {
  email: string;
  password: string;
  rememberMe: boolean;
}

function useKampalaClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  if (!now) return { time: '--:--', date: '' };
  return {
    time: new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Kampala', hour: '2-digit', minute: '2-digit' }).format(now),
    date: new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Kampala', weekday: 'short', day: '2-digit', month: 'short' }).format(now),
  };
}

export default function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const kampala = useKampalaClock();

  const { register, handleSubmit, formState: { errors }, setError } = useForm<LoginFormData>({
    defaultValues: { email: '', password: '', rememberMe: false },
  });

  async function onSubmit(data: LoginFormData) {
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email, password: data.password }),
      });
      const payload = await res.json();
      if (!res.ok) {
        setError('root', { message: payload.error || 'Invalid credentials — use a demo account below to sign in' });
        return;
      }
      toast.success(`Welcome back, ${payload.user.name}!`);
      const next = searchParams.get('next') || '/agent-dashboard';
      router.push(next);
      router.refresh();
    } catch {
      setError('root', { message: 'Could not reach the server — try again' });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left brand panel */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-1/2 relative overflow-hidden flex-col justify-between p-12 bg-[#0B1220]">
        {/* Layered background: deep navy base, blue glow, dot-grid texture */}
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(120% 100% at 15% 0%, #1E3A8A 0%, #111C36 45%, #0B1220 100%)' }}
        />
        <div
          className="absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
        />
        <div className="absolute -top-24 -right-24 w-[420px] h-[420px] rounded-full bg-[#3B82F6]/20 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-72 h-72 rounded-full bg-[#F59E0B]/10 blur-3xl" />

        {/* Top: brand + live clock */}
        <div className="relative z-10 flex items-start justify-between fade-in">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/15">
              <AppLogo size={26} />
            </div>
            <div>
              <BrandWordmark />
              <span className="text-xs text-blue-300/80 block mt-1.5">Uganda Branch · Collections Platform</span>
            </div>
          </div>
          <div className="hidden xl:flex flex-col items-end shrink-0 pl-4">
            <span className="font-mono-data text-lg text-white tabular-nums">{kampala.time}</span>
            <span className="text-[11px] text-blue-300/70">{kampala.date} · Kampala</span>
          </div>
        </div>

        {/* Middle: headline + floating product preview */}
        <div className="relative z-10 space-y-8">
          <div>
            <h1 className="text-[2.15rem] leading-[1.15] font-bold text-white text-balance">
              Every call logged.<br />Every shilling tracked.<br />One system.
            </h1>
            <p className="text-blue-200/90 mt-4 text-sm leading-relaxed max-w-sm">
              Replaces the Excel-and-OneDrive workflow with one offline-first platform, purpose-built
              for the Uganda branch — and ready to extend to any Wellcash country branch next.
            </p>
          </div>

          {/* Floating live-preview card */}
          <div className="relative max-w-sm slide-up" style={{ animationDelay: '80ms' }}>
            <div className="rounded-xl bg-white shadow-[0_20px_60px_-10px_rgba(0,0,0,0.5)] p-4 rotate-[-1.5deg]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Call Queue · Live</span>
                <span className="flex items-center gap-1 text-[11px] font-medium text-positive">
                  <span className="w-1.5 h-1.5 rounded-full bg-positive animate-pulse" />
                  Synced
                </span>
              </div>
              <div className="space-y-2.5">
                {[
                  { name: 'Nakato Josephine', balance: 'UGX 2.4M', code: 'PTP', color: '#16A34A' },
                  { name: 'Mukasa Emmanuel', balance: 'UGX 1.2M', code: 'CB', color: '#1D4ED8' },
                ].map((row) => (
                  <div key={row.name} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-800 truncate">{row.name}</p>
                      <p className="text-[11px] text-slate-500 font-mono-data">{row.balance}</p>
                    </div>
                    <DispositionBadge code={row.code} color={row.color} />
                  </div>
                ))}
              </div>
            </div>
            <div className="absolute -bottom-3 -right-3 rounded-lg bg-[#F59E0B] text-white text-[11px] font-semibold px-2.5 py-1.5 shadow-lg rotate-[3deg] flex items-center gap-1.5">
              <PhoneCall size={12} />
              Tap to call — no dialer switching
            </div>
          </div>
        </div>

        {/* Bottom: feature list + footer */}
        <div className="relative z-10 space-y-6">
          <div className="grid grid-cols-1 gap-2.5">
            {[
              { icon: Wifi, label: 'Offline-first — sync resumes the instant you reconnect' },
              { icon: ShieldCheck, label: 'Every disposition timestamped and tied to a login' },
              { icon: Smartphone, label: 'One login, any device — no BYOD workarounds' },
            ].map((feat) => (
              <div key={feat.label} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center shrink-0 ring-1 ring-white/10">
                  <feat.icon size={14} className="text-blue-100" />
                </div>
                <span className="text-[13px] text-blue-100/90">{feat.label}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-5 border-t border-white/10">
            <RadioTower size={13} className="text-blue-300/60" />
            <p className="text-[11px] text-blue-300/60">Hosted internally · No client data leaves Wellcash infrastructure</p>
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex flex-col justify-center px-6 py-10 sm:px-12 lg:px-16 xl:px-20 bg-background overflow-y-auto scrollbar-thin">
        <div className="max-w-md w-full mx-auto fade-in">
          {/* Mobile logo */}
          <div className="flex items-center gap-2.5 mb-8 lg:hidden">
            <AppLogo size={32} />
            <div>
              <BrandWordmark size="sm" />
              <span className="text-xs text-muted-foreground block mt-1">Uganda Branch</span>
            </div>
          </div>

          <div className="bg-gradient-to-b from-card to-card/95 border border-border rounded-2xl shadow-modal p-6 sm:p-8">
          <div className="mb-8">
            <span className="text-xs font-semibold text-primary uppercase tracking-widest font-mono-data">Sign In</span>
            <h2 className="text-2xl font-bold text-foreground mt-1.5">Welcome back</h2>
            <p className="text-sm text-muted-foreground mt-1">Access your collections queue and call logs</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
            {/* Root error */}
            {errors.root && (
              <div className="bg-[var(--negative-bg)] border border-[#FECACA] rounded-lg px-4 py-3 fade-in">
                <p className="text-sm text-negative font-medium">{errors.root.message}</p>
              </div>
            )}

            {/* Email */}
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-medium text-foreground">
                Work Email
              </label>
              <div className="relative">
                <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="yourname@wellcash.ug"
                  className={`w-full pl-9 pr-3 py-2.5 text-sm bg-input border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 placeholder:text-muted-foreground transition-colors ${errors.email ? 'border-negative' : 'border-border'}`}
                  {...register('email', {
                    required: 'Email is required',
                    pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Enter a valid email address' },
                  })}
                />
              </div>
              {errors.email && <p className="text-xs text-negative">{errors.email.message}</p>}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="block text-sm font-medium text-foreground">
                  Password
                </label>
                <button type="button" className="text-xs text-primary hover:underline">
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className={`w-full pl-9 pr-10 py-2.5 text-sm bg-input border rounded-lg focus:outline-none focus:ring-2 focus:ring-ring/50 placeholder:text-muted-foreground transition-colors ${errors.password ? 'border-negative' : 'border-border'}`}
                  {...register('password', { required: 'Password is required' })}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-negative">{errors.password.message}</p>}
            </div>

            {/* Remember me */}
            <div className="flex items-center gap-2">
              <input
                id="rememberMe"
                type="checkbox"
                className="w-4 h-4 rounded border-border accent-primary"
                {...register('rememberMe')}
              />
              <label htmlFor="rememberMe" className="text-sm text-foreground">
                Keep me signed in on this device
              </label>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-br from-[#3B82F6] to-primary text-primary-foreground text-sm font-semibold rounded-lg shadow-[0_10px_24px_-8px_rgba(29,78,216,0.55)] hover:shadow-[0_12px_28px_-6px_rgba(29,78,216,0.6)] active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>Signing in…</span>
                </>
              ) : (
                <>
                  <LogIn size={16} />
                  <span>Sign In</span>
                </>
              )}
            </button>
          </form>

          {/* Trust row */}
          <div className="mt-4 flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[var(--info-bg)] border border-[#BFDBFE] text-xs text-info">
            <ShieldCheck size={13} className="shrink-0" />
            <span>Data stays on Wellcash infrastructure. Once signed in, the app keeps working offline — call logs sync when you reconnect.</span>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
