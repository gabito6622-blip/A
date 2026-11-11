#!/usr/bin/env bash
# Restaura una copia en una base VACÍA (nunca sobre producción en uso).
# Uso: TARGET_DATABASE_URL=postgres://.../dental_restore scripts/restore.sh archivo.dump[.enc]
set -euo pipefail
: "${TARGET_DATABASE_URL:?Define TARGET_DATABASE_URL (base vacía de destino)}"
FILE="${1:?Indica el archivo de respaldo}"
# Huella: se compara solo el valor (el .sha256 puede nombrar el archivo con otra ruta, p. ej. los de
# `npm run backup:run`, que guardan solo el nombre, o los descargados de S3 a otra carpeta).
if [[ -f "$FILE.sha256" ]]; then
  EXPECTED="$(cut -d' ' -f1 "$FILE.sha256")"
  ACTUAL="$(sha256sum "$FILE" | cut -d' ' -f1)"
  if [[ "$EXPECTED" != "$ACTUAL" ]]; then echo "La huella SHA-256 no coincide: el respaldo está dañado o fue modificado" >&2; exit 1; fi
fi
SRC="$FILE"
if [[ "$FILE" == *.enc ]]; then
  : "${BACKUP_PASSPHRASE:?El archivo está cifrado: define BACKUP_PASSPHRASE}"
  SRC="$(mktemp)"
  trap 'rm -f "$SRC"' EXIT
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$FILE" -out "$SRC" -pass env:BACKUP_PASSPHRASE
fi
# El rol de la aplicación debe existir en el servidor de destino (las políticas RLS lo referencian).
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dental_app') THEN CREATE ROLE dental_app NOLOGIN NOBYPASSRLS; END IF; END \$\$;"
pg_restore --no-owner --exit-on-error --dbname="$TARGET_DATABASE_URL" "$SRC"
echo "Restauración completada en $TARGET_DATABASE_URL"
