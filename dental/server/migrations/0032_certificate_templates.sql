-- =====================================================================
-- 0032 — B-075: textos de certificados y derivaciones editables por clínica, con versiones.
--
--  * Cada cambio es una versión nueva (solo inserción): lo emitido antes conserva su texto
--    congelado y se sabe con qué versión se generó.
--  * Sin filas, la clínica usa el texto base del sistema. «Volver al texto original» inserta una
--    versión con is_default = true.
--  * Los campos de cada plantilla (fecha, motivo, días…) no cambian: solo el título y el texto.
-- =====================================================================

CREATE TABLE certificate_template_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES clinics(id),
  template    text NOT NULL CHECK (template IN ('attendance','rest','treatment','referral')),
  version     int  NOT NULL CHECK (version >= 1),
  title       text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 120),
  body        text NOT NULL CHECK (length(body) BETWEEN 20 AND 5000),
  is_default  boolean NOT NULL DEFAULT false,
  note        text CHECK (note IS NULL OR length(note) <= 300),
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  CONSTRAINT certificate_template_versions_uq UNIQUE (clinic_id, template, version)
);
CREATE TRIGGER certificate_template_versions_immutable BEFORE UPDATE OR DELETE ON certificate_template_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
ALTER TABLE certificate_template_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON certificate_template_versions USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());
GRANT SELECT, INSERT ON certificate_template_versions TO dental_app;
