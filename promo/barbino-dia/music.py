"""Música de «Un día en Barbería Imperio» (Barbiño): original, sintetizada acá (sin samples ni copyright).
Groove soul / hip-hop a 104 BPM: piano eléctrico, bajo redondo, batería con swing, tic-tac de reloj en la
intro y un «tijeretazo» en cada cambio de escena (cada 2 compases).
  0 - 2 compases   intro (reloj + acorde filtrado)
  2 - 16           el día: 7 momentos de 2 compases
 16 - 20           cierre (página + logo, acorde final y campanita)
Uso: python3 music.py salida.wav
"""
import sys, wave

import numpy as np

SR = 44100
BPM = 104
BEAT = 60 / BPM
BAR = 4 * BEAT
BARS = 20
TOTAL = BARS * BAR + 2.5
N = int(TOTAL * SR)
rng = np.random.default_rng(12)
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


CHORDS = [  # (bajo, acorde) Fmaj9 · Em7 · Dm9 · Cmaj9
    (41, [57, 60, 64, 67]),
    (40, [55, 59, 62, 64]),
    (38, [53, 57, 60, 64]),
    (36, [52, 55, 59, 62]),
]

for b in range(BARS):
    t0 = b * BAR
    root, notes = CHORDS[b % 4]
    intro, outro_end = b < 2, b >= 18
    # piano
    for j, m in enumerate(notes):
        put(epiano(mtof(m), BAR * 0.95, 0.75 if intro else 1.0, bright=0.4 if intro else 1.0), t0 + j * 0.01, pan=-0.3 + j * 0.2)
        if not intro and not outro_end:
            put(epiano(mtof(m), BEAT * 0.9, 0.5), t0 + sw(2.5) + j * 0.01, pan=-0.3 + j * 0.2)
    if intro:
        for q in range(8):   # tic-tac
            put(tick(0.9 if q % 2 == 0 else 0.7, hi=q % 2 == 0), t0 + q * BEAT / 2)
        continue
    # bajo
    if b < 19:
        put(bass(mtof(root), BEAT * 1.4), t0)
        put(bass(mtof(root + 7), BEAT * 0.5, 0.8), t0 + sw(1.5))
        put(bass(mtof(root + 12), BEAT * 0.5, 0.7), t0 + sw(2.5))
        put(bass(mtof(root), BEAT * 0.9, 0.85), t0 + sw(3.5))
    # batería
    if b < 18:
        for k in (0, sw(1.5), sw(2.5)):
            put(kick(1.0 if k == 0 else 0.75), t0 + k)
        put(snare(), t0 + BEAT, pan=0.05)
        put(snare(), t0 + 3 * BEAT, pan=0.05)
        for e in range(8):
            put(hat(1.0 if e % 2 else 0.6), t0 + sw(e / 2), pan=0.35)
        put(hat(0.8, open_=True), t0 + sw(3.5), pan=0.35)
    # gancho melódico cada 2 compases (piano agudo)
    if b % 2 == 1 and b < 18:
        for beat, m in ((0, notes[-1] + 12), (0.5, notes[-2] + 12), (1.5, notes[-1] + 12), (3, notes[-3] + 12)):
            put(epiano(mtof(m), BEAT * 0.8, 0.45), t0 + sw(beat), pan=0.4)
    # tijeretazo en cada cambio de escena
    if b % 2 == 0 and 2 <= b <= 18:
        put(snip(), t0 - 0.03, pan=-0.2)

put(swell(BAR * 0.9), 2 * BAR - BAR * 0.9)                 # entra el día
put(kick(1.1), 2 * BAR)
put(swell(BAR * 0.9), 18 * BAR - BAR * 0.9)                # entra el logo
put(kick(1.1), 18 * BAR)
for i, m in enumerate((76, 79, 84)):                       # campanita final
    put(bell(mtof(m), 3.0, 1.0 - i * 0.15), 18 * BAR + 0.15 + i * 0.12, pan=-0.3 + i * 0.3)
put(epiano(mtof(53), BAR * 2.2, 1.0), 19 * BAR)             # acorde final largo (Fmaj9)
for j, m in enumerate((57, 60, 64, 67)):
    put(epiano(mtof(m), BAR * 2.2, 0.9), 19 * BAR + j * 0.02, pan=-0.3 + j * 0.2)
put(bass(mtof(41), BAR * 2), 19 * BAR)


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
