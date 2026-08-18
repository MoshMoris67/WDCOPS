# Sample test files

Real, working sample files for click-testing the app yourself instead of via curl/scripts. All of
these reference the actual seeded demo data in `prisma/seed.js`, so they'll work against a freshly
seeded database (`npx prisma migrate reset` + reseed, or just the dev database as shipped).

Log in as admin (`admin@wellcash.ug` / `Admin@2026!`) for all of these — only admin can import files
and log reconciliations.

## 1. `1-import-new-file.xlsx` / `.csv`

A standard new-client-file import — 6 debtors across a spread of balance bands. Use it on
**Files → Import New File**, pick **HFB** as the client. Try the `.xlsx` version once and the `.csv`
version once (delete/re-import, or just use a different batch label) to confirm both formats parse.
After import, use the agent checklist + **Run Auto-Distribution** to split them across agents by
balance band.

## 2. `2-reconciliation-partial.xlsx`

A pure partial reconciliation — two rows, each an incremental payment against an existing seeded KCB
debtor (Wasswa Denis, Kato Ronald), matched by loan ref. Use it on **Reconciliations → Log New
Reconciliation**, client **KCB**, type **Partial (Paid-Only)**. Their balances should drop by exactly
the amounts in the file (500,000 and 300,000 UGX) and nothing else on the file should change.

## 3. `3-reconciliation-full.xlsx`

A pure full reconciliation — two rows against existing seeded HFB debtors (Nansubuga Patience,
Nalwanga Prossy), this time with an absolute **Cumulative Paid** figure rather than an increment. Use
type **Full Reconciliation**, client **HFB**.

## 4. `4-reconciliation-with-new-accounts.xlsx`

The interesting one — demonstrates a client sending reconciliation and new accounts in the same file
(the scenario where a 1200-account file comes back as 1500: 1200 existing + 300 new). Client **KCB**,
type **Partial**.

- Row 1 matches an existing seeded debtor (Ssebulime Peter) by loan ref — a normal payment update.
- Rows 2–5 don't match anything — they carry Name + Phone + Amount Owed instead, so the system creates
  them as new debtors and auto-distributes them across whichever agents are already working KCB,
  weighted by how caught-up each agent currently is (an agent who's behind on their existing list gets
  fewer of the new ones, not none — see `src/lib/coverage.ts` and `src/lib/rebalance.ts`... actually
  `src/lib/distribution.ts`'s `assignByCoverageWeight` for the exact algorithm).

After uploading, open the reconciliation in the log — the detail panel shows **New Accounts Added: 4**
and a green callout explaining what happened. Check **Files** for a new auto-created batch named
`KCB MOPESA — New accounts via reconciliation <date>`, and check which agents picked up the 4 new
debtors — whoever currently has the best call-through rate on KCB should get the most of them.

## Column reference

| File type | Required | Optional |
|---|---|---|
| Import | Name, Phone 1, Loan Ref, Amount Owed | Phone 2 |
| Reconciliation | Loan Ref and/or Phone, plus Amount Paid (partial) or Cumulative Paid (full) | Name + Amount Owed (turns an unmatched row into a new account instead of an error) |

Headers are matched case-insensitively and ignoring punctuation/spacing, so "Loan Ref", "loan ref", and
"LoanRef" all work the same.
