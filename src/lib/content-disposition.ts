// HTTP header values must be Latin-1, so a filename built from user data (e.g. the em dash in
// reconciliation-created batch labels, curly quotes, emoji) makes the Response constructor
// throw. Send an ASCII fallback plus the RFC 5987 filename* form that browsers prefer.
export function attachmentDisposition(filename: string): string {
  const clean = filename.replace(/[\r\n]/g, '');
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
