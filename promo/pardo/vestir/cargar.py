"""Carga las imágenes de ejemplo (vestir/png) en la copia LOCAL de Barbiño para Pardo Barber Club.
Las pasa a WEBP, las deja donde Barbiño guarda sus archivos (.data/media) y anota las claves en la base local.
Uso: python3 cargar.py /workspace/gabo-barber   (con la base local de desarrollo corriendo)
"""
import os, subprocess, sys, uuid

from PIL import Image

GB = sys.argv[1] if len(sys.argv) > 1 else "/workspace/gabo-barber"
PNG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "png")
DB = ["psql", "-h", "localhost", "-U", "gabo_owner", "-d", "gabo", "-Atq", "-v", "ON_ERROR_STOP=1"]
ENV = {**os.environ, "PGPASSWORD": "gabo_owner_dev"}


def sql(q):
    return subprocess.run(DB + ["-c", q], capture_output=True, text=True, env=ENV, check=True).stdout.strip()


shop = sql("select id from barbershop where slug='pardo'")


def save(name, folder):
    im = Image.open(os.path.join(PNG, name + ".png")).convert("RGBA")
    key = f"{shop}/{folder}/{uuid.uuid4()}.webp"
    path = os.path.join(GB, ".data/media", key)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, "WEBP", quality=90)
    return key, im.size


logo, _ = save("logo", "branding")
cover, _ = save("portada", "branding")
sql(f"update barbershop_branding set logo_key='{logo}', cover_key='{cover}' where barbershop_id='{shop}'")

for n in ("Camilo", "Diego", "Mateo", "Luis"):
    key, _ = save("barbero-" + n.lower(), "barbers")
    sql(f"update barber set photo_key='{key}' where barbershop_id='{shop}' and display_name='{n}'")

SERV = {"Corte clásico": "corte-clasico", "Degradado (fade)": "degradado", "Corte + barba": "corte-barba",
        "Perfilado de barba": "perfilado", "Diseño / líneas": "diseno", "Cejas": "cejas"}
for name, f in SERV.items():
    key, (w, h) = save("servicio-" + f, "services")
    sid = sql(f"select id from service where barbershop_id='{shop}' and name='{name}'")
    sql(f"delete from service_image where service_id='{sid}'")
    sql(f"insert into service_image (barbershop_id, service_id, file_key, alt_text, width, height, is_cover) values ('{shop}','{sid}','{key}','{name}',{w},{h},true)")
print("listo: logo, portada, 4 barberos y 6 servicios con imagen")
