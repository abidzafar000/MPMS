# PMS verification

Source snapshot: `ec29e91e519f5f35b8b61fb1f60b59ce3864dbb1`, imported on 18 October 2026. The records below describe checks of the application before the GitHub transfer; they do not imply a new hosting deployment from GitHub.

## Recorded release checks

- Full automated suite: **72 passed, 0 failed, 1 skipped** across eight test files.
- TypeScript check and production build: passed.
- Latest login/calendar checks: signed-in account view, logout and sign-in flow verified on the hosted portal; desktop and narrow mobile layouts checked. Calendar AM/PM labels are removed while half-day booking geometry remains.
- Local API authorization/persistence/concurrency smoke: skipped because Windows workerd exited with native error `0xc0000005`. No claim is made that this skipped check passed.
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
| API contract | Initial property request omits null version; authenticated POST validation and malformed/unauthorized request protections |
| Restore | Valid backup restore and rejection of malformed, duplicate, dangling or cross-property records |

Request-handler tests explicitly stub authentication and persistence. In-memory domain tests do not verify hosted identity, D1 persistence or real bank/OTA settlement.

## Run checks

```powershell
pnpm test
pnpm typecheck
pnpm build
```

For the optional API smoke test, first initialize local D1 and start a working local preview as described in README. The test creates a synthetic local QA property and accepts only a loopback URL:

```powershell
$env:PMS_QA_BASE_URL = 'http://127.0.0.1:5173'
pnpm test:api
```

Use the actual port printed by your server. Do not point this test at the live hotel portal. A missing local runtime leaves this smoke test skipped.

## Remaining acceptance checks

For a production hotel rollout, complete an authorized test-property journey covering persisted booking/check-in, cross-type room move, priced extension, checkout-to-dirty and staff cleaning, corporate receipt and missed balance, printed invoice/logo, cash shift closing, second-user permission enforcement and reload persistence. Verify platform access separately from app membership. Backup recovery and outage procedures need operational acceptance.

Earlier October checks described export actions and extensions that retained the same total. Those historical descriptions are superseded: general export actions are removed and stay extensions now accept explicit additional pricing. Previously saved backups remain subject to validated restore.

The repository transfer preserves the application source and tests; it does not migrate live records, add staff access or establish a deployment pipeline.
