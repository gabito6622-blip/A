#!/usr/bin/env bash
# Copia (solo lectura) el catálogo público de la tienda real: nombres, descripciones, precios públicos y la imagen de
# cada producto. No cambia nada en la tienda real. Uso: bash traer-catalogo.sh
set -euo pipefail
cd "$(dirname "$0")/catalogo-real"
B=https://tienda-production-8c7b.up.railway.app
curl -sSf "$B/api/catalog" -o catalogo.json
python3 -c "import json;[print(p['id']) for p in json.load(open('catalogo.json'))]" | while read -r id; do
  curl -sSf "$B/api/products/$id/image" -o "logos/$id.img"
done
python3 - <<'PY'
import os
from PIL import Image
for f in os.listdir("logos"):
    if f.endswith(".img"):
        src = os.path.join("logos", f)
        Image.open(src).convert("RGBA").save(src[:-4] + ".png")   # todas a PNG para cargarlas después
        os.remove(src)
PY
echo "catálogo: $(python3 -c "import json;print(len(json.load(open('catalogo.json'))))") productos"
