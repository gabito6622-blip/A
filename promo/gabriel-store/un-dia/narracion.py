"""Narración de «Un día con Gabriel Store» (voz Marco, Eleven v4) con tiempos por carácter.
La clave no va acá: el proxy del entorno la agrega a api.elevenlabs.io. Uso: python3 narracion.py
En el texto hablado «Gabriél Stor» fuerza Ga-bri-ÉL; en pantalla se escribe «Gabriel Store».
"""
import base64, json, urllib.request

VOICE = "fjL3LsPhPx7Isgj2S7NE"  # Marco (ElevenLabs Voice Library, locutor publicitario mexicano)
TEXT = (
    "[warm] Siete de la mañana en Santa Cruz. Ponés tu playlist... y el día arranca con Spotify, sin anuncios. "
    "[curious] Mediodía: ese trabajo que hay que entregar. "
    "ChatGPT te ayuda a pensar, Canva lo deja bonito... y CapCut le da vida. "
    "[excited] Y cuando llega la noche... Netflix, Disney Plus, Max, Prime Video. Elegís vos. "
    "[warm] Todo tu día, en un solo lugar. "
    "[excited] Netflix desde cuarenta bolivianos. Spotify a treinta y tres. Y Canva, desde solo cinco. "
    "Pagás con QR... y listo. "
    "[warm] ¿Querés el tuyo? Respondé este estado. "
    "[excited] ¡Gabriél Stor! Tu mundo digital, más cerca de vos."
)
body = json.dumps({"text": TEXT, "model_id": "eleven_v4", "language_code": "es",
                   "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}}).encode()
req = urllib.request.Request(f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE}/with-timestamps?output_format=mp3_44100_128",
                             data=body, headers={"Content-Type": "application/json", "xi-api-key": "proxy-injected"})
with urllib.request.urlopen(req, timeout=300) as r:
    cost = r.headers.get("character-cost"); d = json.load(r)
open("audio/voz.mp3", "wb").write(base64.b64decode(d["audio_base64"]))
a = d.get("normalized_alignment") or d["alignment"]
words, cur, s, e = [], "", None, None
for c, t0, t1 in zip(a["characters"], a["character_start_times_seconds"], a["character_end_times_seconds"]):
    if c.isspace():
        if cur: words.append((cur, s, e)); cur = ""
        continue
    if not cur: s = t0
    cur += c; e = t1
if cur: words.append((cur, s, e))
json.dump(words, open("audio/palabras.json", "w"), ensure_ascii=False)
print("créditos:", cost)
print(" ".join(f"{w}@{s:.2f}" for w, s, _ in words))
