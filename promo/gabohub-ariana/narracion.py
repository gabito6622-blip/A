"""Voz de «La historia de Ariana» (GaboHub, locutor Marco, Eleven v4): una frase por escena, cada una en su tiempo.
La clave no va acá: el proxy del entorno la agrega a api.elevenlabs.io.
Uso: python3 narracion.py            → audio/voz-XX.mp3, audio/voz.wav (todo junto) y audio/voz.json (tiempos)
     python3 narracion.py F3 F4      → rehace solo esas frases (las demás quedan como están)
En el texto hablado «Gabo Jab» hace que diga «Gabo Jab»; en pantalla y subtítulos se escribe «GaboHub».
"""
import base64, json, os, subprocess, sys, urllib.request

import numpy as np

VOICE = "fjL3LsPhPx7Isgj2S7NE"  # Marco (ElevenLabs Voice Library)
SB = 5.0   # cada escena dura 2 compases a 96 BPM (= 5 s)
# (id, segundo en que arranca, texto). Los tiempos siguen las escenas de ariana.html.
SEGMENTS = [
    ("S0", 0.35, "[warm] Ariana empezó con un cuaderno... y cuarenta chats sin responder."),
    ("S1", 1 * SB + 0.25, "[excited] Hoy tiene su propia tienda. Con su nombre y sus colores."),
    ("S2", 2 * SB + 0.25, "[confident] Compra a precio de revendedor, con su saldo."),
    ("S3", 3 * SB + 0.25, "[confident] Y la cuenta le llega al instante. Sin esperar a nadie."),
    ("S4", 4 * SB + 0.25, "[warm] Ve quién vence esta semana... y renueva con un toque."),
    ("S5", 5 * SB + 0.25, "[confident] Le avisa por WhatsApp, con el mensaje ya escrito."),
    ("S6", 6 * SB + 0.25, "[excited] Arma sus combos, pone sus precios... y la ganancia es suya."),
    ("S7", 7 * SB + 0.25, "[warm] Y si trae a otro revendedor, también gana."),
    ("S8", 8 * SB + 0.4, "[confident] Tu marca. Tus precios. Tus clientes."),
    ("S9", 9 * SB + 0.35, "[excited] Gabo Jab. Escribinos... y empezá tu historia hoy."),
]
SLOT = {}  # cada frase tiene 4,6 s
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
total = 10 * SB + 2
track = np.zeros(int(total * SR) + SR)
out = []
for sid, start, _ in SEGMENTS:
    x = decode(f"audio/voz-{sid}.mp3")
    words = [w for w in json.load(open(f"audio/voz-{sid}.json")) if not (w[0].startswith("[") and w[0].endswith("]"))]
    speech_end = words[-1][2]
    slot = SLOT.get(sid, 4.6)
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
