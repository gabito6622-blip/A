-- =====================================================================
-- 0027 — Operación diaria: registro de respaldos, simulacros de
-- restauración y alertas a la plataforma (Equipo V).
--
--  * backup_runs: una fila por ejecución de `backup:run` (kind = backup)
--    o de `backup:verify` (kind = verify): inicio, fin, tamaño, SHA-256,
--    resultado y un error RESUMIDO (sin DETAIL/CONTEXT de PostgreSQL,
--    que pueden traer valores de filas). `details` guarda solo nombres de
--    tablas, conteos y el resultado de cada verificación: nunca datos de
--    pacientes.
--  * ops_alerts: episodios de alerta (respaldo vencido o fallido,
--    simulacro vencido o fallido, pico de 5xx, /api/ready fallando) con la
--    hora del último envío, para no repetir la misma alerta más de una vez
--    cada ALERT_REPEAT_HOURS.
--
-- Son tablas GLOBALES de la plataforma (sin clinic_id): describen el
-- servicio, no a una clínica. Solo las usan el rol dueño (CLI de respaldo,
-- monitor y rutas /api/platform/*, que usan el pool de administración).
-- Por eso dental_app NO recibe ningún privilegio sobre ellas (ver
-- tests/db-hardening.test.ts y tests/ops.test.ts).
-- =====================================================================

CREATE TABLE backup_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           text NOT NULL CHECK (kind IN ('backup','verify')),
  status         text NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','failed')),
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  -- Nombre del juego de respaldo: dental-AAAAMMDDTHHMMSSZ (el del verificado en kind = verify).
  backup_name    text CHECK (backup_name ~ '^dental-[0-9]{8}T[0-9]{6}Z$'),
  storage        text CHECK (storage IN ('local','s3')),
  encrypted      boolean,
  size_bytes     bigint CHECK (size_bytes >= 0),
  sha256         text CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  files_included boolean,
  tables_count   int CHECK (tables_count >= 0),
  rows_total     bigint CHECK (rows_total >= 0),
  pruned_count   int CHECK (pruned_count >= 0),
  details        jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_summary  text CHECK (char_length(error_summary) <= 500),
  host           text CHECK (char_length(host) <= 120),
  CONSTRAINT backup_runs_finished_ck CHECK ((status = 'running') = (finished_at IS NULL)),
  CONSTRAINT backup_runs_error_ck CHECK (status <> 'failed' OR error_summary IS NOT NULL)
);
CREATE INDEX backup_runs_kind_started_idx ON backup_runs (kind, started_at DESC);

CREATE TABLE ops_alerts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_key         text NOT NULL CHECK (alert_key ~ '^[a-z0-9_]{2,40}$'),
  severity          text NOT NULL CHECK (severity IN ('warning','critical')),
  title             text NOT NULL CHECK (char_length(title) <= 200),
  message           text NOT NULL CHECK (char_length(message) <= 1000),
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  last_sent_at      timestamptz,
  sent_count        int NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  suppressed_count  int NOT NULL DEFAULT 0 CHECK (suppressed_count >= 0),
  channels          text[] NOT NULL DEFAULT '{}',
  resolved_at       timestamptz
);
-- Un solo episodio abierto por tipo de alerta.
CREATE UNIQUE INDEX ops_alerts_open_uq ON ops_alerts (alert_key) WHERE resolved_at IS NULL;
CREATE INDEX ops_alerts_key_sent_idx ON ops_alerts (alert_key, last_sent_at DESC);

-- Mínimo privilegio: la app (dental_app) no lee ni escribe estas tablas.
REVOKE ALL ON backup_runs, ops_alerts FROM PUBLIC;
REVOKE ALL ON backup_runs, ops_alerts FROM dental_app;
