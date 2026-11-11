"""Música de fondo de los tutoriales de Barbiño: original, sintetizada acá (sin samples ni copyright).
Tranquila, para ir debajo de la voz: 90 BPM, piano eléctrico, bajo suave y una batería liviana con swing.
Es un bucle de 16 compases que empalma sin corte (build.py lo repite lo que haga falta).
Uso: python3 musica.py [salida.wav]   (por defecto bmusic.wav al lado de este archivo)
"""
import os, sys, wave

import numpy as np

SR = 44100
BPM = 90
BEAT = 60 / BPM
BAR = 4 * BEAT
BARS = 16
LOOP = BARS * BAR                      # 42,67 s
N = int(LOOP * SR)
rng = np.random.default_rng(3)
L = np.zeros(N)
R = np.zeros(N)


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def put(sig, t0, gain=1.0, pan=0.0):
    """Suma en forma circular: lo que se pasa del final entra por el principio (bucle sin corte)."""
    i = int(round(t0 * SR)) % N
    gl, gr = gain * np.sqrt((1 - pan) / 2) * 1.414, gain * np.sqrt((1 + pan) / 2) * 1.414
    idx = (np.arange(len(sig)) + i) % N
    np.add.at(L, idx, sig * gl)
    np.add.at(R, idx, sig * gr)


def swing(t_in_beats):
    """Corchea con swing: la segunda de cada negra llega un poco tarde."""
    b = np.floor(t_in_beats)
    f = t_in_beats - b
    return (b + (0.58 if abs(f - 0.5) < 1e-6 else f)) * BEAT


def epiano(freq, dur, vel=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    env = np.exp(-t * 2.2) * (1 - np.exp(-t * 400))
    trem = 1 + 0.06 * np.sin(2 * np.pi * 4.5 * t)
    s = (np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * 2 * freq * t) * np.exp(-t * 6)
         + 0.12 * np.sin(2 * np.pi * 7 * freq * t) * np.exp(-t * 20))
    rel = np.minimum(1, (n - np.arange(n)) / (0.08 * SR))
    return s * env * trem * rel * vel * 0.16


def bass(freq, dur, vel=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    env = (1 - np.exp(-t * 300)) * np.exp(-t * 1.6) * np.minimum(1, (n - np.arange(n)) / (0.05 * SR))
    s = np.tanh(1.6 * (np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(2 * np.pi * 2 * freq * t)))
    return s * env * vel * 0.32


def kick(vel=1.0):
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = 48 + 70 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9) * vel * 0.55


def snap(vel=1.0):
    n = int(0.18 * SR)
    t = np.arange(n) / SR
    noise = rng.normal(0, 1, n)
    noise = np.convolve(noise, [1, -0.9], "same")            # más brillante
    return (noise * np.exp(-t * 28) * 0.22 + np.sin(2 * np.pi * 330 * t) * np.exp(-t * 40) * 0.1) * vel


def shaker(vel=1.0):
    n = int(0.06 * SR)
    t = np.arange(n) / SR
    noise = np.convolve(rng.normal(0, 1, n), [1, -1], "same")
    return noise * np.exp(-t * 70) * (1 - np.exp(-t * 900)) * 0.05 * vel


# ii - V - I - vi con color (Dm9 · G13 · Cmaj9 · Am9)
CHORDS = [
    (38, [53, 57, 60, 64]),   # Dm9  (F A C E)
    (43, [53, 57, 59, 64]),   # G13  (F A B E)
    (36, [52, 55, 59, 62]),   # Cmaj9 (E G B D)
    (45, [52, 55, 59, 60]),   # Am9  (E G B C)
]

for b in range(BARS):
    t0 = b * BAR
    root, notes = CHORDS[b % 4]
    # piano: acorde en el 1 y un golpe suave en el "y" del 2
    for j, m in enumerate(notes):
        strum = j * 0.012
        put(epiano(mtof(m), BAR * 0.95, 0.9), t0 + strum, pan=-0.25 + j * 0.15)
        put(epiano(mtof(m), BEAT * 1.4, 0.45), t0 + swing(1.5) + strum, pan=-0.25 + j * 0.15)
    # melodía de piano muy sencilla cada 2 compases
    if b % 2 == 1:
        for k, (beat, m) in enumerate([(0, notes[-1] + 12), (1.5, notes[-2] + 12), (2.5, notes[-1] + 10)]):
            put(epiano(mtof(m), BEAT * 1.2, 0.35), t0 + swing(beat), pan=0.35)
    # bajo
    put(bass(mtof(root), BEAT * 1.6), t0)
    put(bass(mtof(root + (7 if b % 2 else 12)), BEAT * 0.9, 0.8), t0 + swing(2.5))
    put(bass(mtof(root), BEAT * 0.8, 0.7), t0 + swing(3.5))
    # batería liviana
    put(kick(), t0)
    put(kick(0.7), t0 + swing(2.5))
    put(snap(), t0 + BEAT, pan=0.1)
    put(snap(), t0 + 3 * BEAT, pan=0.1)
    for e in range(8):
        put(shaker(1.0 if e % 2 else 0.6), t0 + swing(e / 2), pan=0.4)

# reverb corta y circular (para que el bucle siga empalmando)
def reverb(x, secs=1.6, mix=0.22):
    n = int(secs * SR)
    t = np.arange(n) / SR
    ir = rng.normal(0, 1, n) * np.exp(-t * 4.5)
    ir /= np.sqrt(np.sum(ir ** 2))
    X = np.fft.rfft(x)
    H = np.fft.rfft(np.concatenate([ir, np.zeros(N - n)]))
    return x + np.fft.irfft(X * H, N) * mix


L, R = reverb(L), reverb(R)
st = np.stack([L, R], 1)
st = np.tanh(st * 1.1)
st /= np.max(np.abs(st)) / 0.89
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "bmusic.wav")
with wave.open(out, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((st * 32767).astype("<i2").tobytes())
print("ok", round(LOOP, 2), "s ->", out)
