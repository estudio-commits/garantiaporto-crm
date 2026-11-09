#!/usr/bin/env bash
set -euo pipefail
# Disposable database only. Does not read production connection variables.
container="porto-test-${RANDOM}-$$"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$container" -e POSTGRES_PASSWORD=isolated-test-only postgres:17 >/dev/null
for attempt in {1..30}; do
 if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
 sleep 1
done
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < tests/bootstrap.sql
for migration in supabase/migrations/*.sql; do
 if [[ "$migration" == *006_separate_workflows.sql ]]; then docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < tests/upgrade-before.sql; fi
 docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < "$migration"
 if [[ "$migration" == *006_separate_workflows.sql ]]; then docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < tests/upgrade-after.sql; fi
done
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < tests/database.sql
docker exec -i "$container" psql -U postgres -v ON_ERROR_STOP=1 < tests/whatsapp.sql
