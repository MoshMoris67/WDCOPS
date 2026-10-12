import { toast as sonner } from 'sonner';
import { t } from '@/i18n';

// Drop-in replacement for sonner's `toast` that translates the message (and an optional
// description) before showing it. Messages that have no translation, including text that
// comes straight from the server, show as written.
type Opts = Parameters<typeof sonner>[1];

const message = (m: unknown) => (typeof m === 'string' ? t(m) : m);
const options = (o: Opts): Opts =>
  o && typeof (o as { description?: unknown }).description === 'string'
    ? { ...o, description: t((o as { description: string }).description) }
    : o;

type Msg = Parameters<typeof sonner>[0];
const wrap =
  (fn: (m: Msg, o?: Opts) => string | number) =>
  (m: Msg, o?: Opts) =>
    fn(message(m) as Msg, options(o));

export const toast = Object.assign(wrap(sonner), {
  success: wrap(sonner.success),
  error: wrap(sonner.error),
  info: wrap(sonner.info),
  warning: wrap(sonner.warning),
  message: wrap(sonner.message),
  loading: wrap(sonner.loading),
  dismiss: sonner.dismiss,
  custom: sonner.custom,
  // toast.promise(request, { loading, success, error }): each can be text or a function
  // returning text; translate whichever it is.
  promise: ((promise: Parameters<typeof sonner.promise>[0], data?: Parameters<typeof sonner.promise>[1]) => {
    const tr = (v: unknown) =>
      typeof v === 'function' ? (...a: unknown[]) => message((v as (...x: unknown[]) => unknown)(...a)) : message(v);
    return sonner.promise(
      promise,
      data
        ? ({ ...data, loading: tr(data.loading), success: tr(data.success), error: tr(data.error) } as typeof data)
        : data
    );
  }) as typeof sonner.promise,
});
