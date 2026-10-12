#!/usr/bin/env node
// Translation tooling for the demo's language switcher.
//
//   node scripts/i18n/i18n.mjs report            coverage per language + what is missing
//   node scripts/i18n/i18n.mjs list              all English texts, numbered
//   node scripts/i18n/i18n.mjs check             validate dictionaries (placeholders, stale keys); exits 1 on problems
//   node scripts/i18n/i18n.mjs export <lang|all> write translations/<lang>.csv for the review team
//   node scripts/i18n/i18n.mjs import <lang> <file.csv>   merge a reviewed CSV back into src/i18n/dict/<lang>.json
//
// Every English text shown on screen is found by reading the source (t('...') calls, label lists,
// toast and error messages, demo settings). Dictionaries map English text -> translation.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const ts = createRequire(ROOT + '/')('typescript');
const SK = ts.SyntaxKind;
const LANGS = { pt: 'Portuguese (Mozambique)', sw: 'Swahili', sn: 'Shona' };
const DICT_DIR = path.join(ROOT, 'src/i18n/dict');
const OUT_DIR = path.join(ROOT, 'translations');
const LETTERS = /[A-Za-zÀ-ɏ]{2,}/;
const UI_PROPS = new Set(['label', 'desc', 'description', 'title', 'subtext', 'message', 'hint', 'tooltip', 'required']);
const brand = (s) => /^(WellcashOps|WELLCASH|Wellcash)$/i.test(s);
// developer-facing messages that no screen shows to an agent (they come from malformed requests)
const DEVELOPER_ONLY = (s) =>
  /^[a-z][A-Za-z]*(Id|Ids)\b/.test(s) ||
  s === 'DATABASE_URL' ||
  /^[a-z].*( (is|are) required| must be | is not a valid)/.test(s);
// wording that only exists in the Uganda deployment's JSX (the demo never shows it)
const UGANDA_ONLY = (s) => /self-hosted PostgreSQL|SQLite|KCB, HFB|currently KCB Mopesa|Every shilling tracked|Local dev uses/.test(s);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|js)$/.test(e.name)) out.push(p);
  }
  return out;
}

export function extractKeys() {
  const keys = new Map(); // text -> Set(where)
  const add = (text, where) => {
    if (!text || !LETTERS.test(text) || brand(text) || DEVELOPER_ONLY(text) || UGANDA_ONLY(text) || /^#[0-9a-f]{3,8}$/i.test(text)) return;
    if (!keys.has(text)) keys.set(text, new Set());
    keys.get(text).add(where);
  };
  const files = [
    ...walk(path.join(ROOT, 'src')),
    path.join(ROOT, 'prisma/seed-demo.js'),
  ];
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind);
    const isApi = rel.startsWith('src/app/api/') || rel.startsWith('src/lib/');
    const isUi = rel.startsWith('src/app/') || rel.startsWith('src/components/') || rel === 'src/lib/nav-groups.ts' || rel.startsWith('src/config/') || rel === 'prisma/seed-demo.js';
    const isExcel = rel === 'src/lib/excel.ts';
    const text = (n) => (n.kind === SK.StringLiteral || n.kind === SK.NoSubstitutionTemplateLiteral ? n.text : null);
    (function visit(n) {
      if (n.kind === SK.CallExpression) {
        const callee = n.expression.getText(sf);
        const a = n.arguments[0];
        if (a && (callee === 't' || callee === 'translate')) {
          if (text(a)) add(text(a), rel);
          else if (a.kind === SK.TemplateExpression) { /* converted by the codemod to {0} keys already */ }
        }
        if (a && /^toast\.(error|success|info|warning|message|loading)$/.test(callee) && text(a)) add(text(a), rel);
        if (a && /^(window\.)?(confirm|alert)$/.test(callee) && text(a)) add(text(a), rel);
      }
      if (n.kind === SK.NewExpression && n.expression.getText(sf) === 'Error' && n.arguments?.[0] && text(n.arguments[0]) && !isExcel) add(text(n.arguments[0]), rel);
      if (n.kind === SK.PropertyAssignment && n.initializer) {
        const name = n.name.getText(sf).replace(/['"]/g, '');
        const v = text(n.initializer);
        if (v) {
          if (isUi && UI_PROPS.has(name)) add(v, rel);
          if (isApi && !isExcel && (name === 'error' || name === 'message')) add(v, rel);
        }
        // demo settings shown on screen: every string in the DEMO block + login tagline array
        if (rel === 'src/config/deployment.ts' && n.initializer.kind === SK.ArrayLiteralExpression && name === 'loginTagline') {
          n.initializer.elements.forEach((el) => text(el) && add(text(el), rel + ' (demo tagline)'));
        }
      }
      ts.forEachChild(n, visit);
    })(sf);
  }
  // demo-only settings that are rendered through t(DEPLOYMENT.x)
  const dep = fs.readFileSync(path.join(ROOT, 'src/config/deployment.ts'), 'utf8');
  const demoBlock = dep.slice(dep.indexOf('const DEMO: Deployment'));
  const wanted = ['loginBlurb', 'loginFooter', 'loginDataNote', 'branchNote', 'hostingNote', 'commissionClientHint', 'clientNamePlaceholder', 'batchPlaceholder', 'debtorSearchPlaceholder', 'clockLabel'];
  for (const w of wanted) {
    const m = demoBlock.match(new RegExp(`${w}:\\s*\\n?\\s*'((?:[^'\\\\]|\\\\.)*)'`));
    if (m) add(m[1].replace(/\\'/g, "'"), `src/config/deployment.ts (${w})`);
  }
  const cur = fs.readFileSync(path.join(ROOT, 'src/config/currencies.ts'), 'utf8');
  for (const m of cur.matchAll(/name:\s*'([^']+)'/g)) add(m[1], 'src/config/currencies.ts');
  const note = cur.match(/RATES_NOTE\s*=\s*'([^']+)'/);
  if (note) add(note[1], 'src/config/currencies.ts');
  // texts rendered through t(variable) (table headers, option labels, …) that the scan above cannot see
  for (const text of JSON.parse(fs.readFileSync(path.join(ROOT, 'src/i18n/indirect-keys.json'), 'utf8'))) {
    if (!keys.has(text)) keys.set(text, new Set());
    keys.get(text).add('src/i18n/indirect-keys.json');
  }
  return keys;
}

const placeholders = (s) => [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort().join(',');
const readDict = (code) => JSON.parse(fs.readFileSync(path.join(DICT_DIR, `${code}.json`), 'utf8'));
const writeDict = (code, dict) => {
  const sorted = Object.fromEntries(Object.entries(dict).sort(([a], [b]) => a.localeCompare(b, 'en')));
  fs.writeFileSync(path.join(DICT_DIR, `${code}.json`), JSON.stringify(sorted, null, 2) + '\n');
};

// --- minimal RFC 4180 CSV
function parseCsv(text) {
  const rows = []; let row = [], field = '', i = 0, inQ = false;
  text = text.replace(/^﻿/, '');
  while (i < text.length) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
    i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const csvCell = (s) => `"${String(s).replace(/"/g, '""')}"`;

const [cmd, arg1, arg2] = process.argv.slice(2);
const keys = extractKeys();

if (cmd === 'report') {
  console.log(`${keys.size} texts to translate\n`);
  for (const code of Object.keys(LANGS)) {
    const d = readDict(code);
    const missing = [...keys.keys()].filter((k) => !d[k]);
    console.log(`${code}  ${LANGS[code].padEnd(26)} ${keys.size - missing.length}/${keys.size} translated (${Math.round(((keys.size - missing.length) / keys.size) * 100)}%)`);
    if (process.argv.includes('--missing')) missing.forEach((k) => console.log('    - ' + k));
  }
} else if (cmd === 'list') {
  [...keys.keys()].sort((a, b) => a.localeCompare(b, 'en')).forEach((k, i) => console.log(`${i + 1}\t${k}`));
} else if (cmd === 'check') {
  let problems = 0;
  for (const code of Object.keys(LANGS)) {
    const d = readDict(code);
    for (const [k, v] of Object.entries(d)) {
      if (!keys.has(k)) { console.log(`${code}: stale key (no longer in the code): ${k.slice(0, 70)}`); problems++; }
      if (typeof v !== 'string' || !v.trim()) { console.log(`${code}: empty translation: ${k.slice(0, 70)}`); problems++; continue; }
      if (placeholders(k) !== placeholders(v)) { console.log(`${code}: placeholders differ  EN: ${k.slice(0, 60)}  |  ${code.toUpperCase()}: ${v.slice(0, 60)}`); problems++; }
      if (/[<>]/.test(v) && !/[<>]/.test(k)) { console.log(`${code}: unexpected markup: ${v.slice(0, 60)}`); problems++; }
    }
  }
  console.log(problems ? `${problems} problem(s)` : 'dictionaries OK');
  process.exit(problems ? 1 : 0);
} else if (cmd === 'export') {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const targets = arg1 === 'all' ? Object.keys(LANGS) : [arg1];
  for (const code of targets) {
    if (!LANGS[code]) { console.error('unknown language ' + code); process.exit(1); }
    const d = readDict(code);
    const rows = [['English', `Translation (${LANGS[code]})`, 'Where it appears']];
    for (const [k, where] of [...keys].sort(([a], [b]) => a.localeCompare(b, 'en'))) rows.push([k, d[k] || '', [...where].slice(0, 2).join('; ')]);
    fs.writeFileSync(path.join(OUT_DIR, `${code}.csv`), '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n');
    console.log(`wrote translations/${code}.csv (${rows.length - 1} rows, ${rows.filter((r, i) => i && r[1]).length} translated)`);
  }
} else if (cmd === 'import') {
  if (!LANGS[arg1] || !arg2) { console.error('usage: import <pt|sw|sn> <file.csv>'); process.exit(1); }
  const rows = parseCsv(fs.readFileSync(arg2, 'utf8')).slice(1);
  const d = readDict(arg1); let n = 0, skipped = 0;
  for (const [en, tr] of rows) {
    if (!en || !tr || !tr.trim()) continue;
    if (!keys.has(en)) { skipped++; continue; }
    if (placeholders(en) !== placeholders(tr)) { console.log(`skipped (placeholders {0}, {1}… must stay): ${en.slice(0, 60)}`); skipped++; continue; }
    if (d[en] !== tr.trim()) { d[en] = tr.trim(); n++; }
  }
  writeDict(arg1, d);
  console.log(`${arg1}: ${n} translation(s) updated, ${skipped} skipped`);
} else {
  console.log('usage: i18n.mjs report [--missing] | list | check | export <pt|sw|sn|all> | import <pt|sw|sn> <file.csv>');
}
