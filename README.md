# Mehmaan PMS

Property management for Pakistani hotels and guesthouses: bookings, reception, housekeeping, payments, staff, cashier shifts and pricing. Amounts are stored as integer paisa; human dates and times use Asia/Karachi.

This checkout runs on Next.js with Neon PostgreSQL and managed Neon Auth. The [original Sites portal](https://mehmaan-pms-pakistan.abidzafar000.chatgpt.site/) is separate. Its hotel records and ChatGPT identities have **not** been imported into the new database.

## Using the portal

Open **Login / account** (`/login`), create an email/password account and verify your email. Existing accounts can log in, request verification codes, reset passwords and log out. Email delivery depends on the configured Neon Auth email service; verify delivery before giving staff access.

Create an empty property for a real hotel, or explicitly choose a sample property to explore. Add room types, rooms and optional rate plans, then create a reservation. Open a cashier shift before collecting cash. To add staff, the property owner adds their verified email under **Staff & assignments**. Creating an account alone does not grant access to an existing property.

## Included workflows

- Responsive calendar with half-day arrival/checkout endpoints, compact rows, booking references, number of nights and nightly-rate labels; no AM/PM labels.
- Booking-source dropdown, guest details, check-in/check-out, room moves, explicitly priced stay extensions, cancellation and no-show handling.
- Room and room-type removal/archive with dependency checks; checkout marks rooms dirty and housekeeping staff can mark them clean.
- Separate arrivals, departures and in-house front-desk lists at the top of the dashboard.
- Bills, extra charges, partial receipts and refunds; separate guest, company and OTA responsibilities.
- Corporate checkout balances and receipts, missed-payment follow-ups and an optional browser alert. The alert is not a background notification service.
- Invoices and pro-forma invoices with saved snapshots, property logo/letterhead and printing.
- Named staff, custom permissions, deactivation, planned shifts and server-side authorization.
- One active property cashier drawer, opening float, cash movements, counted closing, variance and preserved close reports.
- Rate plans, dated/weekend prices, booking price snapshots and controlled amendments.
- Activity history and validated restore of previously saved backups. General data-export options are removed.
- Saved WuBook product/property/room/rate mapping configuration. Live WuBook synchronization is not implemented.

## Local development

Requires **Node.js >=22.13** and **pnpm 11.25.0**. Use a dedicated development Neon database and Auth configuration, separate from production. Set the variables listed in `.env.example` in an ignored `.env.local` file:

- `DATABASE_URL`: development PostgreSQL connection string.
- `NEON_AUTH_BASE_URL`: the matching development Neon Auth URL.
- `NEON_AUTH_COOKIE_SECRET`: a random server-only secret of at least 32 characters, distinct from production.

For a linked Vercel project, `vercel env pull .env.local --environment=development` retrieves its development settings. Register the actual local origin (normally `http://localhost:3000`) in Neon Auth's trusted domains. Never put credentials in `NEXT_PUBLIC_` variables or commit environment files.

Start in the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm db:migrate --apply
pnpm test
pnpm typecheck
pnpm build
pnpm dev
```

`pnpm dev` runs Next.js development; `pnpm start` serves an already-built application. Follow the URL printed by the server. There is no mock sign-in or local D1 service. See [QA.md](QA.md) for opt-in database and authenticated API checks.

## Vercel deployment

Use the Next.js preset and the repository root. Configure the three required variables above for each deployment environment. Production and testing must use separate database/Auth targets and cookie secrets. Register the exact deployed origin in its corresponding Neon Auth trusted domains.

The Vercel build command applies migrations before compiling:

```text
node scripts/migrate-db.mjs --apply && pnpm build
```

Migrations live in `migrations/postgres/`. The runner serializes concurrent migration attempts, applies pending SQL transactionally and records SHA-256 checksums. Append new migrations; never edit an applied file. The historical SQLite files in `drizzle/` are not PostgreSQL migrations and must not be applied to Neon. Schema changes must remain compatible with the running release because migration runs before deployment promotion.

A successful build does not prove email delivery, login or hotel workflows. Complete the checks in [QA.md](QA.md) before using a deployment for real hotel records.

## Architecture and hosting

Next.js App Router serves the interface. `/api/auth/*` proxies managed Neon Auth, while `/api/pms` derives the user from a server-validated session and requires verified email. Browser-supplied Sites identity headers are not trusted. Every property request checks current staff membership and filters records by permission.

PostgreSQL stores versioned property aggregates as text to preserve immutable snapshot serialization. Mutations lock the property, recheck authorization/version and update the aggregate and membership index within one transaction. Stale writes return HTTP 409. Browser storage is not the authoritative hotel database.

This repository contains no production hotel records or deployment credentials. Moving existing Sites records requires a separate private import and explicit mapping of old staff identities to verified Neon accounts. Do not clear stored user IDs or grant an existing property to the first person who signs up. Vercel deployments do not update the original Sites portal.

The current small-property design bounds each aggregate at 850,000 characters, with up to 20 owner properties and 50 staff per property. Larger workloads, extensive history or several independent cashier drawers may require a normalized data model. A scheduled external disaster-recovery service is not included.

## WuBook work still needed

Confirm WooDoo versus ZaK, API eligibility, identifiers, mappings and inventory/pricing ownership. Then implement and verify booking ingestion, deduplication, availability/rate publication, retries and reconciliation using a vendor test property. Saved mapping configuration is not evidence of a working connection.

## Source provenance

Imported on 18 October 2026 from the Sites PMS release at commit `ec29e91e519f5f35b8b61fb1f60b59ce3864dbb1`. Earlier Sites repository history and live records were not imported. The Vercel migration replaces Vinext/Cloudflare D1/Sites authentication with Next.js/PostgreSQL/Neon Auth while retaining the PMS workflows and original test history.
