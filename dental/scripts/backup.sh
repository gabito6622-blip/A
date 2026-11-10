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
# Archivos clínicos (radiografías, fotos, documentos escaneados): si DENTAL_FILES_DIR existe, se
# empaqueta DESPUÉS de la base (así toda fila respaldada tiene su archivo), con el mismo cifrado.
# El nombre del paquete va a stderr: la última línea de stdout sigue siendo el respaldo de la base.
FILES_DIR="${DENTAL_FILES_DIR:-}"
if [[ -n "$FILES_DIR" && -d "$FILES_DIR" ]]; then
  FARCH="$DEST/dental-files-$STAMP.tar.gz"
  tar -C "$FILES_DIR" -czf "$FARCH" .
  if [[ -n "${BACKUP_PASSPHRASE:-}" ]]; then
    openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$FARCH" -out "$FARCH.enc" -pass env:BACKUP_PASSPHRASE
    rm -f "$FARCH"
    FARCH="$FARCH.enc"
  fi
  sha256sum "$FARCH" > "$FARCH.sha256"
  echo "Archivos clínicos: $FARCH" >&2
fi
echo "$FILE"
