# Back up and restore data

The repository does not schedule production backups. Configure backup frequency, retention, encryption, and restore access with your database and storage providers.

## SQLite

The default local database is `prisma/dev.db`. Stop the app before copying the file, or use SQLite's online backup API while writes continue.

```bash
mkdir -p /backups
cp prisma/dev.db "/backups/vidyasarthi-$(date +%F).db"
```

To restore a copy, stop the app and replace `prisma/dev.db`. Then check the schema:

```bash
bunx prisma migrate status
```

## PostgreSQL

Create a custom-format dump with `pg_dump`:

```bash
pg_dump "$DATABASE_URL" -Fc -f "/backups/vidyasarthi-$(date +%F).dump"
```

Restore into a scratch or replacement database before pointing the app at it:

```bash
pg_restore --dbname "$DATABASE_URL" /backups/vidyasarthi-YYYY-MM-DD.dump
```

Point-in-time recovery needs WAL archiving configured on the PostgreSQL service. The repository does not configure that service setting.

## Uploaded files

The local storage driver writes under `./storage`. Include that directory in local backups. The current S3-compatible adapter cannot read or delete remote objects, so do not rely on it for production file data.

## Redis jobs

The database stores job records. Redis carries queued work when Redis mode is enabled. Keep the database backup and Redis worker configuration; after restoring, check queued and failed job records before restarting the worker.

## Restore drill

Restore a recent backup into an isolated environment. Start the app against the restored database and storage copy. Verify sign-in, notes, files, and pending jobs. Record the date, backup source, restore duration, and outcome in your operations log.
