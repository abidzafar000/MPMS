# Database history

`postgres/` is the active PostgreSQL migration history. The original `drizzle/`
directory is retained unchanged as archived SQLite history and must never be
applied to PostgreSQL.

Generate a PostgreSQL migration with `drizzle-kit generate`. Apply the committed
SQL using `node scripts/migrate-db.mjs --apply`. The script uses `DATABASE_URL`
from the current environment, or loads checkout-local `.env.local` when absent.
It serializes runs, verifies SHA-256 checksums (with canonical LF line endings), and atomically
applies pending migrations. It performs no resets or data deletion.

Production and preview/development must use separate database resources. Run
real integration tests only against development, explicitly:

```
PMS_POSTGRES_TEST=development PMS_POSTGRES_TEST_URL=<development URL> node --test tests/qa-postgres.test.mjs
```

Set these variables through the shell or a local environment file; never commit
credentials. The test refuses production/deployment environments and deletes
only fixtures owned by its newly generated test principals. Test runs do not
import, migrate, print, or delete any existing hotel data.

Provisioning and schema migration do not transfer existing SQLite data. A
separate private, validated importer is required to preserve identity mappings,
financial history and exact aggregate serialization from an existing database.
