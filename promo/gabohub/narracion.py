"""Voz del video de GaboHub (locutor Marco, Eleven v4): una frase por escena, cada una en su tiempo.
La clave no va acá: el proxy del entorno la agrega a api.elevenlabs.io.
Uso: python3 narracion.py            → audio/voz-XX.mp3, audio/voz.wav (todo junto) y audio/voz.json (tiempos)
     python3 narracion.py F3 F4      → rehace solo esas frases (las demás quedan como están)
En el texto hablado «Gabo Jab» hace que diga «Gabo Jab»; en pantalla y subtítulos se escribe «GaboHub».
"""
import base64, json, os, subprocess, sys, urllib.request

import numpy as np

VOICE = "fjL3LsPhPx7Isgj2S7NE"  # Marco (ElevenLabs Voice Library)
BAR = 4 * 60 / 125
# (id, segundo en que arranca, texto). Los tiempos siguen las escenas de promo.html (compases de 1,92 s).
SEGMENTS = [
    ("H1", 0.25, "[curious] ¿Vendés streaming y anotás todo en un cuaderno?"),
    ("H2", 3.75, "[confident] Esto se terminó."),
    ("L", 3 * BAR + 0.15, "[excited] Con Gabo Jab, vendés streaming con tu propia marca."),
    ("F1", 5 * BAR + 0.2, "[confident] Comprás a precio de revendedor, con tu saldo."),
    ("F2", 7 * BAR + 0.2, "[confident] La cuenta te llega al instante, sin esperar."),
    ("F3", 9 * BAR + 0.2, "[warm] Ves tus clientes y quién vence esta semana."),
    ("F4", 11 * BAR + 0.2, "[confident] Renovás en un toque, y le avisás por WhatsApp."),
    ("F5", 13 * BAR + 0.2, "[excited] Tenés tu propia tienda, con tu logo y tus colores."),
    ("F6", 15 * BAR + 0.2, "[confident] Armás tus combos... y la ganancia es tuya."),
    ("F7", 17 * BAR + 0.2, "[warm] Y si traés a otro revendedor, ganás saldo."),
    ("X", 19 * BAR + 0.2, "[excited] ¡Y todavía hay mucho más!"),
    ("C", 21 * BAR + 0.45, "[excited] Gabo Jab. Escribinos y empezá hoy."),
]
SLOT = {"H1": 3.4, "H2": 1.95, "L": 3.65}  # lo demás: 3,6 s (2 compases menos un respiro)
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
total = 22 * BAR + 3 * BAR
track = np.zeros(int(total * SR) + SR)
out = []
for sid, start, _ in SEGMENTS:
    x = decode(f"audio/voz-{sid}.mp3")
    words = [w for w in json.load(open(f"audio/voz-{sid}.json")) if not (w[0].startswith("[") and w[0].endswith("]"))]
    speech_end = words[-1][2]
    slot = SLOT.get(sid, 3.6)
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
