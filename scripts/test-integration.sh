#!/bin/sh
# Run DB-backed tests against isolated storage and the local SQLite migrations.
set -e
cd "$(dirname "$0")/.."

test_dir=$(mktemp -d "${TMPDIR:-/tmp}/vidyasarthi-integration.XXXXXX")
trap 'rm -rf "$test_dir"' EXIT
export DATABASE_URL="file:$test_dir/test.db"
export LOCAL_STORAGE_DIR="$test_dir/storage"

for migration in prisma/migrations/*/migration.sql; do
  sqlite3 -bail "$test_dir/test.db" < "$migration"
done
bunx vitest run --config vitest.integration.config.ts
