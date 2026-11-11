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
# Con DENTAL_FILES_DRIVER=s3 los archivos están en el bucket y NO se empaquetan aquí: su respaldo
# es el versionado / la replicación / el bloqueo de objetos que se configure en el proveedor.
FILES_DIR="${DENTAL_FILES_DIR:-}"
FILES_DRIVER="$(printf '%s' "${DENTAL_FILES_DRIVER:-local}" | tr '[:upper:]' '[:lower:]')"
if [[ "$FILES_DRIVER" == "s3" ]]; then
  echo "Aviso: los archivos clínicos están en un almacenamiento S3 (bucket ${DENTAL_S3_BUCKET:-sin nombre}); este respaldo solo incluye la base. El respaldo de los archivos lo da el proveedor: activa el versionado del bucket (y, si se puede, replicación o bloqueo de objetos)." >&2
  if [[ -n "$FILES_DIR" && -d "$FILES_DIR" && -n "$(ls -A "$FILES_DIR" 2>/dev/null)" ]]; then
    echo "Aviso: ${FILES_DIR} todavía tiene archivos antiguos guardados en disco; se empaquetan también." >&2
  else
    FILES_DIR=""
  fi
fi
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
