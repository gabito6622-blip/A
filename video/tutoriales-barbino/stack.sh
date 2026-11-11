#!/bin/bash
# Copia aislada de Barbiño para grabar tutoriales.
#   stack.sh up <nombre> <puerto>   crea la base gabo_<nombre> (datos ficticios) y arranca el servidor
#   stack.sh reset <nombre>         vuelve la base gabo_<nombre> a los datos ficticios iniciales
D=/tmp/claude-0/-workspace-A/54aab0e5-b810-5a8a-a381-3dd90d647a94/scratchpad/tut
cmd=$1; name=$2; port=$3; db=gabo_$name
cd /tmp
pg_isready -h localhost -q || su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgdata -o '-p 5432 -k /tmp' -l /tmp/pg.log start" >/dev/null
for i in $(seq 1 20); do pg_isready -h localhost -q && break; sleep 0.5; done
if [ "$cmd" = up ]; then
  psql -h localhost -U gabo_owner -d postgres -Atc "select 1 from pg_database where datname='$db'" | grep -q 1 || { createdb -h localhost -U gabo_owner -O gabo_owner $db; pg_restore -h localhost -U gabo_owner -d $db --no-owner --role=gabo_owner $D/base.dump 2>&1 | grep -i error | head -3; pg_restore -h localhost -U gabo_owner -d $db --clean --if-exists --single-transaction $D/base.dump 2>&1 | grep -i error | head -3; }
  if ! curl -s -o /dev/null localhost:$port/; then
    cd /workspace/gabo-barber && (DATABASE_URL="postgresql://gabo_app:gabo_app_dev@localhost:5432/$db" PLATFORM_DATABASE_URL="postgresql://gabo_platform:gabo_platform_dev@localhost:5432/$db" MIGRATION_DATABASE_URL="postgresql://gabo_owner:gabo_owner_dev@localhost:5432/$db" BETTER_AUTH_URL="http://localhost:$port" nohup npx next start -p $port > $D/server-$name.log 2>&1 &)
    for i in $(seq 1 60); do curl -s -o /dev/null localhost:$port/ && break; sleep 0.5; done
  fi
  curl -s -o /dev/null -w "$name: http://localhost:$port -> %{http_code}\n" localhost:$port/imperio
elif [ "$cmd" = reset ]; then
  pg_restore -h localhost -U gabo_owner -d $db --clean --if-exists --single-transaction $D/base.dump 2>&1 | grep -i error | head -3
  echo "$db restaurada"
fi
