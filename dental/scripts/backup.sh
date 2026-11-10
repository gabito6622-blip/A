#!/usr/bin/env bash
# Copia de seguridad de PostgreSQL (formato custom de pg_dump, comprimido).
# Uso: DATABASE_URL=postgres://... scripts/backup.sh [carpeta_destino]
# Si BACKUP_PASSPHRASE está definida, el archivo se cifra con AES-256 (openssl, PBKDF2).
set -euo pipefail
: "${DATABASE_URL:?Define DATABASE_URL}"
DEST="${1:-./backups}"
mkdir -p "$DEST"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$DEST/dental-$STAMP.dump"
pg_dump --format=custom --no-owner --file="$FILE" "$DATABASE_URL"
if [[ -n "${BACKUP_PASSPHRASE:-}" ]]; then
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$FILE" -out "$FILE.enc" -pass env:BACKUP_PASSPHRASE
  rm -f "$FILE"
  FILE="$FILE.enc"
fi
sha256sum "$FILE" > "$FILE.sha256"
echo "$FILE"
