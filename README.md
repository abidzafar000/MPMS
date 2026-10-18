# Mehmaan PMS

Property management for Pakistani hotels and guesthouses: bookings, reception, housekeeping, payments, staff, cashier shifts and pricing. Amounts are stored as integer paisa; human dates and times use Asia/Karachi.

This repository contains the current application source and automated tests. The existing [live portal](https://mehmaan-pms-pakistan.abidzafar000.chatgpt.site/) remains hosted through Sites. Uploading this source to GitHub does not move the live database or configure automatic deployment.

## Using the portal

Open the portal and use **Login / account** (`/login`) to sign in with ChatGPT. Create an empty property for a real hotel, or explicitly choose a sample property to explore. Add room types, rooms and optional rate plans, then create a reservation. Open a cashier shift before collecting cash.

Hosted access currently remains owner-private. App staff membership and platform visitor access are separate: adding a staff record does not invite that person or grant access to the hosted Site.

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

Requires **Node.js >=22.13** and **pnpm 11.25.0**. Start in the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_lame_orphan.sql
pnpm dev
```

Apply the initial SQL only once to a fresh local database. Later schema changes require appended migrations. Follow the loopback URL printed by the development server.

A clean clone defaults to the portable execution profile. Development provides an explicit local mock identity; production builds do not include mock sign-in. `pnpm start` runs the built application in local Wrangler, not a production deployment. The hosted identity flow requires the Sites environment.

Local workerd startup failed with native error `0xc0000005` on the original Windows host. The automated in-memory suites and production build passed, but local D1/runtime verification was not completed there. See [QA.md](QA.md) for coverage and limitations.

## Architecture and hosting

React/Vinext serves the interface. `/api/pms` authenticates and authorizes mutations. Cloudflare D1 stores versioned property aggregates with atomic compare-and-swap mutations and a transactional membership index. A stale update returns HTTP 409 instead of overwriting newer work. Browser storage is not the authoritative hotel database.

The tracked `.openai/hosting.json` retains the existing Site identifier and D1 binding. That identifier is deployment metadata, not a credential. This repository contains neither production database records nor deployment credentials. Sites supplies hosted authentication, storage bindings and its publication/migration workflow. Static GitHub Pages alone cannot run this backend. Moving to another host requires authentication and database deployment work.

No GitHub Actions or automatic deployment pipeline is configured. Pushing to this repository does not update the live portal. Keep runtime configuration and credentials in ignored files or server-side secrets; do not commit database exports.

The current small-property design bounds each aggregate at 850,000 characters, with up to 20 owner properties and 50 staff per property. Larger workloads, extensive history or several independent cashier drawers may require a normalized data model. A scheduled external disaster-recovery service is not included.

## WuBook work still needed

Confirm WooDoo versus ZaK, API eligibility, identifiers, mappings and inventory/pricing ownership. Then implement and verify booking ingestion, deduplication, availability/rate publication, retries and reconciliation using a vendor test property. Saved mapping configuration is not evidence of a working connection.

## Source provenance

Imported on 18 October 2026 from the existing PMS release at source commit `ec29e91e519f5f35b8b61fb1f60b59ce3864dbb1`. GitHub starts with a clean source snapshot; earlier Sites repository history is not imported. Application files, dependencies, migrations, tests and existing vendored license notices are preserved. README, QA notes and ignore rules are updated for this checkout.
