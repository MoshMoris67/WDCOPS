// Client debtor files arrive in whatever phone format that client uses —
// "0772123456", "772123456", "256772123456", "+256 772 123 456", etc. — and
// we deliberately store/display that raw value untouched (it's also what
// reconciliation matching compares against, see reconciliation.ts). The SIM
// gateway's dialer only accepts the local "0"-prefixed format though, so this
// is a dial-time-only conversion: call it right where a tel: link is built,
// never on data going into or read out of the database.
export function toDialFormat(raw: string): string {
  const digits = raw.replace(/\D/g, '');

  if (digits.startsWith('256') && digits.length === 12) {
    return '0' + digits.slice(3);
  }
  if (digits.startsWith('0') && digits.length === 10) {
    return digits;
  }
  if (digits.length === 9) {
    return '0' + digits;
  }
  return digits;
}
