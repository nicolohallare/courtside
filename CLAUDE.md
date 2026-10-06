# Courtside

Open play and court booking for pickleball clubs in the Philippines, where every peso goes to the club and is checked. Built from what worked at Match Day Pickle (MDP), rebuilt for many clubs.

**The edge over Reclub:** players never pay a stranger in a chat. They pay the club's own GCash (receipt checked by AI in about a minute) or through TechPay instant pay. Every payment ends up as a booking or a refund the club owes. Nothing goes missing.

## What's in the first version

- **Clubs** with their own admins, hosts, members, courts, prices, GCash number and house rules, kept apart by `club_id` and row-level security.
- **Open play sessions**: fee, spots, courts, level, guests, paid waitlist that moves people in automatically and refunds them if no spot opens.
- **Court rental by the hour**: opening hours, slot grid, peak rates, minimum and maximum lengths. Double-booking is impossible (Postgres exclusion constraint), and sessions block their courts.
- **Payments**: GCash transfer with the AI receipt check (amount, recipient number, reference, stale receipts, references reused at *any* club), or TechPay hosted checkout. Cash at the desk is recorded by staff.
- **Refunds**: created automatically for early cancellations, cancelled sessions, unreached waitlists, and late or double payments. Staff record the GCash reference when they send them.
- **Club dashboard**: money received, payments to review, refunds owed, roster with check-in, members and booking windows, activity log of every override.
- **One player account** across all clubs, with "Where my money went".

Out for now: coaching, tournaments, DUPR court board (from MDP, phase 2), discovery and ratings, native apps (it's an installable web app).

## Layout

```
supabase/
  migrations/   core tables · business rules · access (RLS + grants) · storage + schedule · payouts
  functions/    verify-receipt (AI receipt check) · techpay (checkout + webhook)
  tests/        rules_test.sql: 74 checks run on plain Postgres
web/            Next.js app (player pages + /admin/<club> + /platform)
scripts/check.sh  guards: no function defined twice, every rpc() the app calls exists
```

## Rules that live in the database

Learned at MDP; each one cost members money or access once.

| Lesson | How it's enforced |
|---|---|
| Rules on the server, not the screen | Booking windows, guest limits, flagged players and house-rules acceptance are checked in `book_session` / `book_court`. Clients have no write access to tables. |
| Every deposit needs an exit | `refunds` rows are created on every path where a player is owed; the 5-minute job returns waitlist deposits when a session starts. |
| Every payment marks the booking it pays | `apply_payment` runs in the same transaction as approval. Money that can't become a booking becomes a refund. |
| Never trust a webhook | `techpay` calls TechPay back before `settle_gateway_payment`, which settles once even across retries and holds amount mismatches. |
| Overrides leave a trail | Approvals, cash, cancellations, role changes all write to `audit_log` with a required note. |
| Paid but not registered | `run_maintenance` raises an alert for any approved payment with no live booking and no refund. |
| Money held for clubs is always accounted for | At `platform` clubs every TechPay payment and refund writes to `club_ledger`; `run_payouts` bundles what has passed the 2-day hold into one payout per verified account; a failed payout returns its lines to the next run. |

## Setup

1. **Supabase project** (Singapore). Apply `supabase/migrations/*` in order.
2. **Edge function secrets**: `ANTHROPIC_API_KEY` (receipt check), `TECHPAY_HOST` (`api-stg.techpay.com.ph` for staging), `TECHPAY_USER`, `TECHPAY_PASS`, `TECHPAY_SIGNATURE_KEY`, `APP_URL`. Optional `RECEIPT_MODEL`, `TECHPAY_SUBMERCHANT_FIELD`. Never put these in code or chat.
3. Deploy `verify-receipt` (JWT on) and `techpay` (JWT off; it checks the user itself).
4. **Web**: set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, deploy `web/` (Vercel).
5. Make yourself platform admin: `update profiles set is_platform_admin = true where id = '<your user id>';` then add clubs at `/platform`.

Instant pay rolls out in stages through `app_config.gateway_live`: `false` → `admins` (club staff only) → `true`.

## Payouts (platform collects)

Clubs default to `settlement_mode = 'platform'`: players pay into Match Day Pickle's TechPay account and the club is paid out weekly from `/platform` (Run payouts → send → Mark sent with the reference). Refunds on those payments are sent by the platform and taken from the next payout. Registered venues can be switched to `direct` once they are TechPay sub-merchants. Before going live: legal and tax review of holding club funds (BSP) and of receipts for the club's share (BIR); ideally TechPay performs the split and the payouts itself.

## Open with TechPay

- How a club is onboarded as a sub-merchant, and the field name that routes a checkout to it (`TECHPAY_SUBMERCHANT_FIELD`). Until then, payments settle to one merchant and are split by reference prefix `CS<CLUB CODE>…`.
- Whether the platform fee can be split at settlement or must be invoiced (the app records `platform_fee_pct` for reporting only).

## Tests

```
bash scripts/check.sh
cat supabase/tests/local_shim.sql supabase/migrations/2026100600000{1,2,3,5}_*.sql | psql -d courtside_t
psql -d courtside_t -f supabase/tests/rules_test.sql
```
CI runs both and builds the app on every push.

## Working on this repo
- Business rules go in SQL functions, never only in the app. Add a test to supabase/tests/rules_test.sql for every rule change.
- Never redefine a function in a new migration file by copy-paste without removing the old one; scripts/check.sh fails on that.
- Every change ships to staging first. Booking, payment and refund paths are tested before release.
