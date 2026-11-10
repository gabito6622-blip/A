"""Música original para el promo de Barbiño (sintetizada desde cero, sin samples ni copyright).

125 BPM, La menor (Am - F - C - G). Las secciones coinciden con las escenas del video:
  0.00 - 3.84   gancho      (pulso + pad filtrado)
  3.84 - 7.68   logo        (impacto, arpegio, redoble que sube)
  7.68 - 34.56  drop        (beat completo; whoosh en cada cambio de función)
 34.56 - 40.32  cierre      (impacto, pad abierto, final)
Uso: python3 music.py salida.wav
"""
import sys
import wave

import numpy as np

SR = 44100
BPM = 125
BEAT = 60 / BPM          # 0.48 s
BAR = BEAT * 4           # 1.92 s
TOTAL = 40.32 + 1.2      # un poco de cola para la reverb
N = int(TOTAL * SR)
rng = np.random.default_rng(7)

L = np.zeros(N)
R = np.zeros(N)
kick_env = np.zeros(N)   # para el sidechain


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def add(buf, sig, t0, gain=1.0):
    i = int(round(t0 * SR))
    if i >= len(buf):
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[: j - i] * gain


def addst(sig, t0, gain=1.0, pan=0.0):
    add(L, sig, t0, gain * np.sqrt((1 - pan) / 2) * 1.414)
    add(R, sig, t0, gain * np.sqrt((1 + pan) / 2) * 1.414)


def additive(freq, dur, cutoff, detune=0.0, phase=None, maxh=60):
    """Diente de sierra limitado en banda con filtro paso-bajos variable (cutoff: escalar o array)."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = freq * (1 + detune)
    out = np.zeros(n)
    ph = rng.uniform(0, 2 * np.pi) if phase is None else phase
    cut = np.broadcast_to(np.asarray(cutoff, dtype=float), (n,)) if np.ndim(cutoff) else cutoff
    for h in range(1, maxh + 1):
        fh = f * h
        if fh > 16000:
            break
        g = 1.0 / h / np.sqrt(1 + (fh / cut) ** 4)
        if np.ndim(g) == 0 and g < 1e-4:
            break
        out += g * np.sin(2 * np.pi * fh * t + ph * h)
    return out


def env_adsr(n, a, d, s, r):
    e = np.ones(n) * s
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    na = max(na, 1)
    e[:na] = np.linspace(0, 1, na)
    if nd:
        e[na:na + nd] = np.linspace(1, s, len(e[na:na + nd]))
    if nr:
        e[-nr:] *= np.linspace(1, 0, nr)
    return e


# ---------------------------------------------------------------- percusión
def kick(t0, gain=1.0):
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    f = 45 + 110 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) * np.exp(-t * 6.5)
    s[:300] += rng.normal(0, 0.35, 300) * np.linspace(1, 0, 300)
    s = np.tanh(s * 1.6)
    addst(s, t0, 0.95 * gain)
    e = np.exp(-np.arange(int(0.4 * SR)) / SR * 9)
    add(kick_env, e, t0, 1.0)


def clap(t0, gain=1.0):
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    noise = rng.normal(0, 1, n)
    noise = np.diff(noise, prepend=0)  # más brillante
    e = np.exp(-t * 18)
    for k in (0.0, 0.011, 0.022):
        e = e + np.where(t >= k, np.exp(-(t - k) * 140), 0) * 0.6
    s = noise * e * 0.28
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30) * 0.3
    addst(s + body, t0, gain, pan=0.0)


def hat(t0, gain=1.0, open_=False, pan=0.2):
    n = int((0.25 if open_ else 0.06) * SR)
    t = np.arange(n) / SR
    s = rng.normal(0, 1, n)
    s = np.diff(np.diff(s, prepend=0), prepend=0)
    s *= np.exp(-t * (14 if open_ else 70))
    addst(s * 0.06, t0, gain, pan)


def snare(t0, gain=1.0):
    n = int(0.18 * SR)
    t = np.arange(n) / SR
    s = rng.normal(0, 1, n) * np.exp(-t * 25) * 0.25 + np.sin(2 * np.pi * 220 * t) * np.exp(-t * 35) * 0.25
    addst(s, t0, gain)


def impact(t0, gain=1.0):
    n = int(3.0 * SR)
    t = np.arange(n) / SR
    f = 30 + 90 * np.exp(-t * 6)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.6)
    noise = rng.normal(0, 1, n) * np.exp(-t * 4) * 0.25
    s = np.tanh((boom + noise) * 1.4)
    addst(s, t0, 0.9 * gain)
    add(kick_env, np.exp(-np.arange(int(1.0 * SR)) / SR * 3), t0, 1.0)


def riser(t_end, dur, gain=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = t / dur
    noise = rng.normal(0, 1, n)
    # "filtro" que se abre: mezcla de ruido suavizado y ruido brillante
    k = 64
    smooth = np.convolve(noise, np.ones(k) / k, mode="same") * 4
    bright = np.diff(noise, prepend=0)
    s = (smooth * (1 - x) + bright * x) * x ** 2.2 * 0.18
    tone = np.sin(2 * np.pi * np.cumsum(200 + 1400 * x ** 2) / SR) * x ** 3 * 0.08
    addst(s + tone, t_end - dur, gain)


def whoosh(t_cut, gain=1.0, pan=0.0):
    dur = 0.32
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = t / dur
    noise = rng.normal(0, 1, n)
    k = 24
    sm = np.convolve(noise, np.ones(k) / k, mode="same") * 3
    e = np.sin(np.pi * x) ** 2 * x
    addst(sm * e * 0.12, t_cut - dur * 0.75, gain, pan)


# ---------------------------------------------------------------- armonía
CHORDS = [  # (bajo, notas del pad)
    (33, [57, 60, 64, 69]),   # Am
    (29, [57, 60, 65, 69]),   # F
    (36, [55, 60, 64, 67]),   # C
    (31, [55, 59, 62, 67]),   # G
]
pad_L = np.zeros(N)
pad_R = np.zeros(N)
bass = np.zeros(N)
arp_L = np.zeros(N)
arp_R = np.zeros(N)


def pad_bar(t0, ci, cutoff_from, cutoff_to, gain=1.0, length=BAR):
    _, notes = CHORDS[ci % 4]
    n = int(length * SR)
    cut = np.geomspace(cutoff_from, cutoff_to, n)
    e = env_adsr(n, 0.08, 0.2, 0.85, 0.12)
    for m in notes:
        for d, side in ((-0.006, -1), (0.0, 0), (0.0065, 1)):
            s = additive(mtof(m), length, cut, detune=d, maxh=40) * e * 0.05 * gain
            if side <= 0:
                add(pad_L, s, t0, 1.0 if side else 0.7)
            if side >= 0:
                add(pad_R, s, t0, 1.0 if side else 0.7)


def bass_bar(t0, ci, pattern="drop", gain=1.0):
    root, _ = CHORDS[ci % 4]
    f = mtof(root + 12)
    if pattern == "drop":   # corcheas en contratiempo + nota larga
        hits = [(0.0, 0.42), (0.5, 0.2), (0.75, 0.2), (1.5, 0.2), (1.75, 0.2), (2.0, 0.42), (2.5, 0.2), (2.75, 0.2), (3.5, 0.2), (3.75, 0.2)]
    else:
        hits = [(0.0, 1.8)]
    for b, d in hits:
        n = int(d * SR)
        cut = 180 + 900 * np.exp(-np.arange(n) / SR * 14)
        s = additive(f, d, cut, maxh=30)
        s += 0.6 * np.sin(2 * np.pi * f / 2 * np.arange(n) / SR)  # sub
        s *= env_adsr(n, 0.004, 0.05, 0.9, 0.03)
        add(bass, s * 0.42 * gain, t0 + b * BEAT)


ARP = [0, 2, 1, 3, 2, 1, 3, 2, 0, 2, 1, 3, 2, 3, 1, 2]


def arp_bar(t0, ci, gain=1.0, oct_=12):
    _, notes = CHORDS[ci % 4]
    step = BEAT / 4
    for i, k in enumerate(ARP):
        m = notes[k] + oct_
        d = 0.22
        n = int(d * SR)
        tt = np.arange(n) / SR
        cut = 400 + 5200 * np.exp(-tt * 22)
        s = additive(mtof(m), d, cut, maxh=30) * np.exp(-tt * 11) * 0.11 * gain
        pan = 0.45 if i % 2 else -0.45
        add(arp_L, s * np.sqrt((1 - pan) / 2) * 1.414, t0 + i * step)
        add(arp_R, s * np.sqrt((1 + pan) / 2) * 1.414, t0 + i * step)


# ---------------------------------------------------------------- arreglo
# Gancho (2 compases): pulso de bombo, pad cerrado
for b in range(2):
    t0 = b * BAR
    pad_bar(t0, b, 300, 900, gain=0.9)
    bass_bar(t0, b, "long", gain=0.7)
    for q in range(4):
        kick(t0 + q * BEAT, gain=0.55 if q else 0.8)
    for q in range(8):
        hat(t0 + q * BEAT / 2 + BEAT / 2 * (q % 2 == 0), gain=0.5)
clap(1 * BAR + 3 * BEAT, 0.6)
riser(2 * BAR, 1.2, 0.7)

# Logo (2 compases): impacto + arpegio + redoble que acelera
impact(2 * BAR)
for b in range(2, 4):
    t0 = b * BAR
    pad_bar(t0, b, 800 if b == 2 else 1200, 1600 if b == 2 else 4000, gain=1.0)
    arp_bar(t0, b, gain=0.8 + 0.3 * (b - 2))
    bass_bar(t0, b, "long", gain=0.8)
# redoble: negras, corcheas, semicorcheas, fusas
t = 3 * BAR
for div, beats in ((2, 1), (4, 1), (8, 1), (16, 1)):
    for i in range(div * beats):
        frac = (t - 3 * BAR) / BAR
        snare(t, 0.25 + 0.6 * frac)
        t += BEAT / div
riser(4 * BAR, 1.9, 1.0)

# Drop (14 compases): 12 funciones + 2 de montaje rápido
DROP0 = 4 * BAR
for b in range(14):
    t0 = DROP0 + b * BAR
    ci = b
    montage = b >= 12
    pad_bar(t0, ci, 2500, 3000, gain=0.75)
    bass_bar(t0, ci, "drop")
    arp_bar(t0, ci, gain=0.9 if not montage else 1.1, oct_=12 if b % 4 < 2 else 24)
    for q in range(4):
        kick(t0 + q * BEAT)
        hat(t0 + q * BEAT + BEAT / 2, 1.0, open_=True, pan=0.25)
    for q in range(16 if montage else 8):
        div = 4 if montage else 2
        hat(t0 + q * BEAT / div, 0.55 if q % 2 else 0.35, pan=-0.3)
    clap(t0 + BEAT, 0.9)
    clap(t0 + 3 * BEAT, 0.9)
    if b < 12:
        whoosh(t0 + BAR, 0.8, pan=(-0.5 if b % 2 else 0.5))
impact(DROP0, 0.8)
riser(DROP0 + 14 * BAR, 1.9, 0.9)

# Cierre (3 compases): impacto, pad abierto, acorde final
OUT0 = DROP0 + 14 * BAR
impact(OUT0, 1.0)
for b in range(3):
    t0 = OUT0 + b * BAR
    pad_bar(t0, b if b < 2 else 0, 4000, 3000 if b < 2 else 600, gain=1.0, length=BAR if b < 2 else BAR + 1.0)
    if b < 2:
        arp_bar(t0, b, gain=0.7 - 0.2 * b, oct_=24)
        bass_bar(t0, b, "long", gain=0.8)
        kick(t0, 0.9)
        kick(t0 + 2 * BEAT, 0.7)
        clap(t0 + 3 * BEAT, 0.5)
kick(OUT0 + 2 * BAR, 1.0)
bass_bar(OUT0 + 2 * BAR, 0, "long", gain=0.9)

# ---------------------------------------------------------------- mezcla
duck = 1 - 0.75 * np.clip(kick_env, 0, 1)


def reverb(x, secs=1.8, mix=0.25):
    n = int(secs * SR)
    t = np.arange(n) / SR
    ir = rng.normal(0, 1, n) * np.exp(-t * 3.2 / secs * 2)
    ir /= np.sqrt(np.sum(ir ** 2))
    m = len(x) + n
    size = 1 << int(np.ceil(np.log2(m)))
    y = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[: len(x)]
    return x + y * mix


padL = reverb(pad_L * duck, 2.4, 0.5)
padR = reverb(pad_R * duck, 2.4, 0.5)
arpL = reverb(arp_L * (0.5 + 0.5 * duck), 1.4, 0.35)
arpR = reverb(arp_R * (0.5 + 0.5 * duck), 1.4, 0.35)
bassd = bass * duck

mixL = L + padL + arpL + bassd
mixR = R + padR + arpR + bassd

# fade final
fade = np.ones(N)
f0, f1 = int(40.32 * SR) - int(1.6 * SR), N
fade[f0:f1] = np.linspace(1, 0, f1 - f0) ** 1.5
mixL *= fade
mixR *= fade

# master: soft clip + normalización
st = np.stack([mixL, mixR], 1)
st = np.tanh(st * 1.2)
st /= np.max(np.abs(st)) / 0.89
pcm = (st * 32767).astype("<i2")
with wave.open(sys.argv[1] if len(sys.argv) > 1 else "music.wav", "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("ok", TOTAL, "s")
