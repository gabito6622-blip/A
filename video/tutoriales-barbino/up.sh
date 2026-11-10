#!/bin/bash
# Levanta Postgres local + Barbiño (puerto 3000) si no están corriendo.
pg_isready -h localhost -q || su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgdata -o '-p 5432 -k /tmp' -l /tmp/pg.log start" >/dev/null
for i in $(seq 1 20); do pg_isready -h localhost -q && break; sleep 0.5; done
if ! curl -s -o /dev/null localhost:3000/; then
  cd /workspace/gabo-barber && (nohup npx next start -p 3000 > /tmp/claude-0/-workspace-A/54aab0e5-b810-5a8a-a381-3dd90d647a94/scratchpad/barber.log 2>&1 &)
  for i in $(seq 1 40); do curl -s -o /dev/null localhost:3000/ && break; sleep 0.5; done
fi
curl -s -o /dev/null -w "barbino %{http_code}\n" localhost:3000/imperio
