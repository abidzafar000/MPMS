# PMS verification

This file separates checks of the Vercel migration from the earlier Sites release. Passing a build or mocked request test does not verify hosted login or email delivery.

## Vercel migration checks — 24 October 2026

- Combined automated suite: **80 passed, 0 failed, 2 skipped**. The skipped cases require an opt-in real PostgreSQL connection and a local authenticated session. Provider responses are stubbed in the auth contract suite.
- Dedicated development PostgreSQL suite: **7 passed, 0 failed**. This exercised the real database, migration idempotency, exact text serialization, concurrent booking/payment conflicts, rollback after membership-index failure, stale-index isolation, revocation after lock acquisition and the concurrent owner-property limit.
- TypeScript and the Next.js production build: passed on 24 October. The build includes the dynamic login, account, auth API and PMS API routes.
- Development browser acceptance: login, sample property creation, saved/reloaded property, WhatsApp booking creation, generated reference and nightly calendar label verified. Mobile calendar at 390px used three-day auto-fit with no document horizontal overflow.
- Real provider login/logout: anonymous requests rejected, verified login/session accepted, and replaying a revoked session rejected. An aged-session cookie refresh error in Server Components was reproduced and repaired by loading account identity through the same-origin auth route; hotel authorization remains server-side.
- Deployed browser acceptance: pending at this checkpoint; update after execution.
- Live WuBook synchronization: not implemented or tested.

## Automated coverage

| Area | Covered behavior |
| --- | --- |
| Availability | Physical-room conflicts, room-type capacity, adjacent checkout/arrival, invalid date ranges and extensions into occupied dates |
| Booking display | Half-day endpoints, visible-range clipping, date boundaries, stable alphanumeric references, collision handling and nightly-rate display |
| Operations | Room/type archive dependencies, housekeeping readiness, maintenance blocks, room moves and explicit extension pricing |
| Permissions | Restricted mutations, foreign-property identifiers, disabled staff and filtered private details |
| Payments | Partial receipts, separate guest/company/OTA balances, refunds, paid cancellation and payment follow-ups |
| Shifts | Cross-midnight sessions, cash reconciliation, variance, insufficient-cash refund rejection and immutable closes |
| Pricing | Confirmed quote preservation, inactive historical plans, approved price changes and attribution |
| Invoices | Invoice/pro-forma display, payer separation and saved financial snapshots |
| API contract | Initial property request omits null version; authenticated POST validation, origin checks and malformed/unauthorized request protections |
| Managed identity | Verified email, session expiry and user-ID consistency; forged Sites headers cannot select an actor; provider failures do not grant access |
| PostgreSQL | Atomic aggregate/index changes, stale-write conflicts, property isolation, post-lock authorization and idempotent migrations |
| Restore | Valid backup restore and rejection of malformed, duplicate, dangling or cross-property records |

Request-handler tests run the real application session helper with an explicit SDK stub. They do not prove provider cookie verification or email delivery. In-memory domain tests do not verify real bank/OTA settlement.

## Run checks

```powershell
pnpm test
pnpm typecheck
pnpm build
```

Ordinary `pnpm test` skips real PostgreSQL and local-session acceptance unless explicitly configured. For the database suite, supply a dedicated **development** connection through your secure local environment:

```powershell
$env:PMS_POSTGRES_TEST = 'development'
# Set PMS_POSTGRES_TEST_URL to the dedicated development database privately.
pnpm test:postgres
```

This suite applies schema migrations and writes synthetic fixtures. It cleans up its own records. Never point it at production.

For the optional API smoke, initialize development storage with `pnpm db:migrate --apply`, start Next.js and sign in using a verified test account:

```powershell
$env:PMS_QA_BASE_URL = 'http://localhost:3000'
# Set PMS_QA_COOKIE privately from that authenticated local test session.
pnpm test:api
```

Use the actual server origin and keep the cookie out of files, commits and logs. The test accepts only loopback HTTP, creates a synthetic QA property and has no mock-login fallback. Do not use a live hotel account or production database.

## Remaining acceptance checks

Complete a test account journey on the intended deployment: account creation, email verification, login, password reset, logout and denial after logout. Check the configured email service delivers verification/reset messages. Confirm anonymous and forged-header requests cannot read or change property records, and that another verified account cannot access a property without membership.

Then use an authorized test property to verify persisted booking/check-in, room moves, priced extensions, checkout-to-dirty and staff cleaning, corporate receipts/missed balances, invoice printing/logo, shift closing, restricted staff access and persistence after reload. Recheck mobile and desktop layouts. Backup recovery, email-delivery limits and outage procedures need operational acceptance.

Existing Sites data has not been imported. A future private import must validate record integrity and explicitly map staff identities before users can access those records.

## Historical Sites checks

The source imported on 18 October 2026 came from `ec29e91e519f5f35b8b61fb1f60b59ce3864dbb1`. That release recorded **72 passed, 0 failed, 1 skipped**, a successful TypeScript check and Vinext build, and hosted login/logout plus desktop/mobile calendar checks. Its local D1 smoke was skipped after Windows workerd error `0xc0000005`. These historical results do not verify the new Vercel deployment.

General export actions remain removed. Stay extensions use explicit additional pricing, and previously saved backups remain subject to validated restore.
