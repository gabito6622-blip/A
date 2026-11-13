"""Voz del «Desfile de estilos» (GaboHub, locutor Marco, Eleven v4): una frase por escena, cada una en su tiempo.
La clave no va acá: el proxy del entorno la agrega a api.elevenlabs.io.
Uso: python3 narracion.py            → audio/voz-XX.mp3, audio/voz.wav (todo junto) y audio/voz.json (tiempos)
     python3 narracion.py F3 F4      → rehace solo esas frases (las demás quedan como están)
En el texto hablado «Gabo Jab» hace que diga «Gabo Jab»; en pantalla y subtítulos se escribe «GaboHub».
"""
import base64, json, os, subprocess, sys, urllib.request

import numpy as np

VOICE = "fjL3LsPhPx7Isgj2S7NE"  # Marco (ElevenLabs Voice Library)
SB = 4.0   # cada escena del panel dura 2 compases a 120 BPM (= 4 s)
# (id, segundo en que arranca, texto). Los tiempos siguen las escenas de estilos.html.
SEGMENTS = [
    ("S0", 0.15, "[curious] ¿Tenés una tienda de streaming?"),
    ("S1", 2.3, "[excited] Elegí cómo se ve. Neón... oro... gamer... pastel... ¡diecisiete estilos listos!"),
    ("S2", 10.2, "[confident] Subís tu logo, tu portada... y tus colores."),
    ("S3", 14.2, "[confident] Elegís el fondo, las tarjetas y las letras."),
    ("S4", 18.2, "[excited] Y tu tienda queda publicada, con tu propio link."),
    ("S5", 22.2, "[warm] En tu panel tenés a todos tus clientes."),
    ("S6", 26.2, "[confident] Ves quién vence, y le avisás por WhatsApp con un toque."),
    ("S7", 30.2, "[confident] Armás tus combos y tus descuentos."),
    ("S8", 34.2, "[warm] Creás cupones, y tus clientes ven sus códigos solos."),
    ("S9", 38.3, "[confident] Tu tienda. Tu estilo. Tus clientes."),
    ("S10", 42.3, "[excited] Gabo Jab. Armá tu tienda hoy."),
]
SLOT = {"S0": 2.1, "S1": 7.5, "S8": 3.8}  # las demás tienen 3,7 s
SR = 44100
os.makedirs("audio", exist_ok=True)


def tts(seg_id, text):
    body = json.dumps({"text": text, "model_id": "eleven_v4", "language_code": "es",
                       "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}}).encode()
    req = urllib.request.Request(f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE}/with-timestamps?output_format=mp3_44100_128",
                                 data=body, headers={"Content-Type": "application/json", "xi-api-key": "proxy-injected"})
    with urllib.request.urlopen(req, timeout=300) as r:
        cost = r.headers.get("character-cost")
        d = json.load(r)
    open(f"audio/voz-{seg_id}.mp3", "wb").write(base64.b64decode(d["audio_base64"]))
    a = d.get("normalized_alignment") or d["alignment"]
    words, cur, s, e = [], "", None, None
    for c, t0, t1 in zip(a["characters"], a["character_start_times_seconds"], a["character_end_times_seconds"]):
        if c.isspace():
            if cur: words.append((cur, s, e)); cur = ""
            continue
        if not cur: s = t0
        cur += c; e = t1
    if cur: words.append((cur, s, e))
    json.dump(words, open(f"audio/voz-{seg_id}.json", "w"), ensure_ascii=False)
    return cost


def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


only = set(sys.argv[1:])
for sid, _, text in SEGMENTS:
    if only and sid not in only:
        continue
    if not only and os.path.exists(f"audio/voz-{sid}.mp3"):
        continue
    print(sid, "créditos:", tts(sid, text))

# Todo junto en una pista, cada frase en su segundo; tiempos absolutos para los subtítulos.
total = 50.0
track = np.zeros(int(total * SR) + SR)
out = []
for sid, start, _ in SEGMENTS:
    x = decode(f"audio/voz-{sid}.mp3")
    words = [w for w in json.load(open(f"audio/voz-{sid}.json")) if not (w[0].startswith("[") and w[0].endswith("]"))]
    speech_end = words[-1][2]
    slot = SLOT.get(sid, 3.7)
    flag = "  ⚠ NO ENTRA" if speech_end > slot else ""
    print(f"{sid:3} {start:6.2f}s  dura {speech_end:4.2f}s / {slot:.2f}s{flag}")
    i = int(start * SR)
    track[i:i + len(x)] += x[: len(track) - i]
    out.append({"id": sid, "start": round(start, 3), "words": [[w, round(start + a, 3), round(start + b, 3)] for w, a, b in words]})
json.dump(out, open("audio/voz.json", "w"), ensure_ascii=False, indent=1)
pcm = (np.clip(track, -1, 1) * 32767).astype("<i2")
import wave
with wave.open("audio/voz.wav", "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print("listo: audio/voz.wav")
