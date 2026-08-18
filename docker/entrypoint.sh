#!/bin/sh
# Usage: entrypoint.sh web|worker
# `web` runs pending DB migrations first (idempotent), then starts the Next.js standalone server.
# `worker` waits for the DB to be migrated by web (compose depends_on healthcheck) and starts BullMQ.
set -eu

ROLE="${1:-web}"

case "$ROLE" in
  web)
    echo "[entrypoint] running database migrations"
    node dist/src/server/db/migrate.js
    echo "[entrypoint] starting web"
    exec node server.js
    ;;
  worker)
    echo "[entrypoint] starting worker"
    exec node dist/worker/index.js
    ;;
  *)
    echo "unknown role: $ROLE" >&2
    exit 1
    ;;
esac
