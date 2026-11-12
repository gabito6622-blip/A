"""Música de la publicidad de Pardo Barber Club: original, sintetizada acá (sin samples ni copyright).
Jazz / boom-bap a 98 BPM en La menor. Va sincronizada con pardo.html:
  0 - 2 compases   gancho (chat): teclas suaves y el «pop» de cada mensaje
  2 - 3            logo: golpe + campanita
  3 - 15           el groove: 4 pasos, reserva y barbero (2 compases cada uno), con un clic en cada toque del dedo
 15 - 17           cierre: acorde largo
Uso: python3 music.py salida.wav
"""
import sys, wave

import numpy as np

SR = 44100
BPM = 98
BEAT = 60 / BPM
BAR = 4 * BEAT
BARS = 17
TOTAL = BARS * BAR + 2.5
N = int(TOTAL * SR)
rng = np.random.default_rng(21)
L = np.zeros(N)
R = np.zeros(N)


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def put(sig, t0, gain=1.0, pan=0.0):
    i = int(round(t0 * SR))
    if i >= N:
        return
    j = min(N, i + len(sig))
    L[i:j] += sig[: j - i] * gain * np.sqrt((1 - pan) / 2) * 1.414
    R[i:j] += sig[: j - i] * gain * np.sqrt((1 + pan) / 2) * 1.414


def sw(beats):
    """Tiempo con swing: las corcheas de atrás llegan un poco tarde."""
    b = np.floor(beats)
    f = beats - b
    return (b + (0.6 if abs(f - 0.5) < 1e-6 else f)) * BEAT


def epiano(freq, dur, vel=1.0, bright=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    env = np.exp(-t * 1.8) * (1 - np.exp(-t * 500))
    s = (np.sin(2 * np.pi * freq * t) + 0.4 * bright * np.sin(2 * np.pi * 2 * freq * t) * np.exp(-t * 5)
         + 0.15 * bright * np.sin(2 * np.pi * 7 * freq * t) * np.exp(-t * 18))
    s *= 1 + 0.05 * np.sin(2 * np.pi * 5 * t)
    rel = np.minimum(1, (n - np.arange(n)) / (0.08 * SR))
    return s * env * rel * vel * 0.15


def bass(freq, dur, vel=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    env = (1 - np.exp(-t * 400)) * np.exp(-t * 1.4) * np.minimum(1, (n - np.arange(n)) / (0.04 * SR))
    return np.tanh(2.0 * (np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * 2 * freq * t))) * env * vel * 0.33


def kick(vel=1.0):
    n = int(0.4 * SR)
    t = np.arange(n) / SR
    f = 46 + 90 * np.exp(-t * 32)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 8)
    s[:200] += rng.normal(0, 0.3, 200) * np.linspace(1, 0, 200)
    return s * vel * 0.62


def snare(vel=1.0):
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    noise = np.convolve(rng.normal(0, 1, n), [1, -0.85], "same")
    return (noise * np.exp(-t * 18) * 0.26 + np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30) * 0.22) * vel


def hat(vel=1.0, open_=False):
    n = int((0.22 if open_ else 0.05) * SR)
    t = np.arange(n) / SR
    noise = np.convolve(rng.normal(0, 1, n), [1, -1], "same")
    return noise * np.exp(-t * (14 if open_ else 80)) * 0.06 * vel


def tick(vel=1.0, hi=True):
    n = int(0.05 * SR)
    t = np.arange(n) / SR
    f = 3200 if hi else 2400
    return (np.sin(2 * np.pi * f * t) * np.exp(-t * 160) + rng.normal(0, 0.2, n) * np.exp(-t * 300)) * 0.18 * vel


def snip(vel=1.0):
    """Tijera: dos chasquidos metálicos muy cortos."""
    out = np.zeros(int(0.16 * SR))
    for k, d in enumerate((0.0, 0.07)):
        n = int(0.06 * SR)
        t = np.arange(n) / SR
        s = (np.convolve(rng.normal(0, 1, n), [1, -1, 0.5], "same") * np.exp(-t * 90) * 0.35
             + np.sin(2 * np.pi * (5200 - k * 700) * t) * np.exp(-t * 120) * 0.25)
        i = int(d * SR)
        out[i:i + n] += s
    return out * vel


def bell(freq, dur, vel=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = sum(a * np.sin(2 * np.pi * freq * r * t) * np.exp(-t * d) for r, a, d in ((1, 1, 1.2), (2.76, .5, 2.5), (5.4, .25, 4), (8.9, .12, 6)))
    return s * vel * 0.12


def swell(dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    noise = rng.normal(0, 1, n)
    k = np.exp(-np.linspace(4, 0.5, n))
    lp = np.zeros(n); y = 0.0
    for i in range(n):
        y += k[i] * (noise[i] - y); lp[i] = y
    return lp * (t / dur) ** 2 * 0.25




def pop(vel=1.0, f0=900):
    """«Pop» de mensaje de chat."""
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    f = f0 + 700 * np.exp(-t * 60)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 40) * 0.35 * vel


def click(vel=1.0):
    """Toque en la pantalla."""
    n = int(0.03 * SR)
    t = np.arange(n) / SR
    return (np.sin(2 * np.pi * 2600 * t) * 0.5 + rng.normal(0, 0.4, n)) * np.exp(-t * 260) * 0.3 * vel


def whoosh(t_cut, dur=0.5, vel=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    noise = np.convolve(rng.normal(0, 1, n), [1, -0.6], "same")
    env = np.sin(np.pi * t / dur) ** 2
    put(noise * env * 0.08 * vel, t_cut - dur * 0.6)


CHORDS = [  # (bajo, acorde) Am9 · Dm9 · G13 · Cmaj9
    (45, [55, 59, 60, 64]),
    (38, [53, 57, 60, 64]),
    (43, [53, 57, 59, 64]),
    (36, [52, 55, 59, 62]),
]
TAPS = [(3 + 2 * i) * BAR + 1.35 for i in range(4)]       # mismos tiempos que el dedo de pardo.html

for b in range(BARS):
    t0 = b * BAR
    root, notes = CHORDS[b % 4]
    soft, end = b < 2, b >= 15
    for j, m in enumerate(notes):
        put(epiano(mtof(m), BAR * (1.6 if end else 0.95), 0.7 if soft else 1.0, bright=0.5 if soft else 1.0), t0 + j * 0.012, pan=-0.3 + j * 0.2)
        if not soft and not end:
            put(epiano(mtof(m), BEAT * 0.9, 0.45), t0 + sw(2.5) + j * 0.01, pan=-0.3 + j * 0.2)
    if soft:
        put(bass(mtof(root), BAR * 0.9, 0.5), t0)
        put(hat(0.7), t0 + BEAT); put(hat(0.7), t0 + 3 * BEAT)
        continue
    if b == 16:
        continue
    put(bass(mtof(root), BEAT * 1.4), t0)
    put(bass(mtof(root + 7), BEAT * 0.5, 0.8), t0 + sw(1.5))
    put(bass(mtof(root + 12), BEAT * 0.5, 0.7), t0 + sw(2.5))
    put(bass(mtof(root), BEAT * 0.9, 0.85), t0 + sw(3.5))
    if b < 15:
        for k in (0, sw(1.5), sw(2.75)):
            put(kick(1.0 if k == 0 else 0.7), t0 + k)
        put(snare(), t0 + BEAT); put(snare(), t0 + 3 * BEAT)
        for e in range(8):
            put(hat(1.0 if e % 2 else 0.6), t0 + sw(e / 2), pan=0.35)
        if b % 2 == 0:
            for beat, m in ((0.5, notes[-1] + 12), (1.5, notes[-2] + 12), (2.5, notes[-1] + 14), (3.5, notes[-3] + 12)):
                put(epiano(mtof(m), BEAT * 0.7, 0.4), t0 + sw(beat), pan=0.4)
    if b >= 3 and b % 2 == 1 and b < 15:
        whoosh(t0)

for t in (0.55, 1.6, 2.5):                                   # mensajes del chat
    put(pop(), t, pan=0.2)
put(pop(0.8, 600), 3.6, pan=-0.2)                            # «visto»
put(swell(BAR * 0.8), 2 * BAR - BAR * 0.8)
put(kick(1.15), 2 * BAR)
for i, m in enumerate((81, 84, 88)):
    put(bell(mtof(m), 2.5, 0.9 - i * 0.15), 2 * BAR + 0.1 + i * 0.1, pan=-0.3 + i * 0.3)
put(swell(BAR * 0.8), 3 * BAR - BAR * 0.8)
for tp in TAPS:
    put(click(), tp, pan=0.1)
put(swell(BAR * 0.8), 15 * BAR - BAR * 0.8)
put(kick(1.1), 15 * BAR)
for i, m in enumerate((76, 81, 84)):
    put(bell(mtof(m), 3.0, 1.0 - i * 0.15), 15 * BAR + 0.15 + i * 0.12, pan=-0.3 + i * 0.3)
put(bass(mtof(45), BAR * 2), 15 * BAR)


def reverb(x, secs=1.8, mix=0.2):
    n = int(secs * SR)
    t = np.arange(n) / SR
    ir = rng.normal(0, 1, n) * np.exp(-t * 4)
    ir /= np.sqrt(np.sum(ir ** 2))
    size = 1 << int(np.ceil(np.log2(len(x) + n)))
    return x + np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[: len(x)] * mix


L, R = reverb(L), reverb(R)
fade = np.ones(N)
f0 = int((BARS * BAR + 0.6) * SR)
fade[f0:] = np.linspace(1, 0, N - f0) ** 2
st = np.stack([L * fade, R * fade], 1)
st = np.tanh(st * 1.15)
st /= np.max(np.abs(st)) / 0.89
with wave.open(sys.argv[1] if len(sys.argv) > 1 else "music.wav", "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((st * 32767).astype("<i2").tobytes())
print("ok", round(TOTAL, 2), "s")
