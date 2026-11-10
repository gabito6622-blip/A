"""Música original de «Un día con Gabriel Store» (sintetizada desde cero: sin samples ni copyright).
Cambia con el día: mañana suave (Re mayor, sin batería), mediodía con ritmo, noche synthwave con melodía,
y un final fuerte con otro gancho. Motor de síntesis compartido con promo/barbino/music.py.
Uso: python3 music.py salida.wav
"""
import sys
import wave

import numpy as np

SR = 44100
BPM = 112
BEAT = 60 / BPM
BAR = BEAT * 4
END = 44.0
TOTAL = END + 1.5
N = int(TOTAL * SR)
rng = np.random.default_rng(23)

L = np.zeros(N)
R = np.zeros(N)
kick_env = np.zeros(N)


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




def chime(t0, gain=1.0, base=880):
    n = int(3.5 * SR); t = np.arange(n) / SR; s = np.zeros(n)
    for m, a, d in ((1, 1, 2.2), (1.5, .55, 1.8), (2, .35, 1.4), (3, .2, 1.0), (4.01, .1, .7), (.5, .4, 2.6)):
        s += a * np.sin(2 * np.pi * base * m * t) * np.exp(-t * 2.2 / d)
    s *= np.minimum(1, t / .004)
    addst(s * .11, t0, gain, pan=-.2); addst(np.roll(s, int(.012 * SR)) * .09, t0, gain, pan=.3)


lead_L = np.zeros(N); lead_R = np.zeros(N)


def lead(t0, phrase, gain=1.0, octave=0):
    """Melodía: lista de (pulsos de duración, nota midi o None)."""
    t = t0
    for beats, m in phrase:
        d = beats * BEAT
        if m is not None:
            n = int((d + .25) * SR); tt = np.arange(n) / SR
            f = mtof(m + octave)
            env = np.minimum(1, tt / .02) * np.exp(-tt * (1.2 / max(d, .2))) * np.where(tt < d, 1, np.exp(-(tt - d) * 18))
            vib = 1 + .006 * np.sin(2 * np.pi * 5.5 * tt) * np.minimum(1, tt / .25)
            ph = 2 * np.pi * np.cumsum(f * vib) / SR
            s = sum(np.sin(ph * h) / h * (1 / (1 + (f * h / 2600) ** 2)) for h in range(1, 14))
            s2 = sum(np.sin(ph * 1.004 * h) / h * (1 / (1 + (f * h / 2600) ** 2)) for h in range(1, 14))
            add(lead_L, s * env * .055 * gain, t); add(lead_R, s2 * env * .055 * gain, t)
        t += d


def section(t0, t1, chords, arp, kind, gain=1.0, cutoff=(2200, 2600), melody=None, mel_oct=0):
    global CHORDS, ARP
    CHORDS, ARP = chords, arp
    t, ci = t0, 0
    while t < t1 - .05:
        length = min(BAR, t1 - t)
        pad_bar(t, ci, cutoff[0], cutoff[1], gain=.6 * gain, length=length)
        if kind != "soft": bass_bar(t, ci, "drop" if kind in ("groove", "drop") else "long", gain=.75 * gain)
        else: bass_bar(t, ci, "long", gain=.45 * gain)
        arp_bar(t, ci, gain=(.35 if kind == "soft" else .5) * gain, oct_=12 if ci % 2 == 0 else 24)
        for q in range(4):
            tq = t + q * BEAT
            if tq >= t1: break
            if kind in ("groove", "drop"):
                kick(tq, .7 * gain); hat(tq + BEAT / 2, .6 * gain, open_=True, pan=.25)
                if q in (1, 3): clap(tq, .45 * gain)
            elif kind == "night":
                if q == 0: kick(tq, .8 * gain)
                if q == 2: clap(tq, .55 * gain); kick(tq + BEAT * .75, .5 * gain)
                hat(tq + BEAT / 2, .4 * gain, pan=.3)
            elif kind == "soft" and t >= 4.0:
                hat(tq + BEAT / 2, .25 * gain, pan=.35)
        if kind == "drop":
            for q in range(16):
                if t + q * BEAT / 4 < t1: hat(t + q * BEAT / 4, .3 if q % 2 else .18, pan=-.3)
        t += BAR; ci += 1
    if melody: lead(t0, melody, gain, mel_oct)


MORNING = [(38, [62, 66, 69, 73]), (35, [59, 62, 66, 69]), (31, [55, 59, 62, 66]), (33, [57, 61, 64, 66])]
MIDDAY = [(31, [55, 59, 62, 67]), (33, [57, 61, 64, 69]), (30, [54, 57, 61, 66]), (35, [54, 59, 62, 66])]
NIGHT = [(35, [54, 59, 62, 66]), (31, [55, 59, 62, 67]), (38, [57, 62, 66, 69]), (33, [57, 61, 64, 69])]
DROP = [(28, [55, 59, 64, 67]), (31, [55, 59, 62, 67]), (38, [57, 62, 66, 69]), (33, [57, 61, 64, 69])]
ARP_SOFT = [0, 2, 1, 3, 2, 1, 3, 2, 0, 3, 2, 1, 3, 2, 1, 0]
ARP_UP = [0, 1, 2, 3, 0, 1, 2, 3, 1, 2, 3, 2, 1, 2, 3, 1]
ARP_NIGHT = [0, 2, 3, 2, 0, 2, 3, 1, 0, 2, 3, 2, 1, 3, 2, 1]
NIGHT_MEL = [(2, 78), (1, 74), (1, 76), (2, 74), (2, 71), (1, 69), (1, 74), (2, 78), (3, 76), (1, 73), (2, 78), (1, 81), (1, 78)]
DROP_MEL = [(.5, 76), (.5, 79), (1, 83), (1, 81), (1, 79), (1.5, 83), (.5, 81), (1, 79), (1, 74), (1, 78), (1, 81), (2, 86), (1, 85), (1, 83), (2, 81),
            (.5, 76), (.5, 79), (1, 83), (1, 81), (1, 79), (1.5, 83), (.5, 81), (1, 79), (1, 74), (1, 78), (1, 81), (1, 86), (1, 88), (4, 86)]

M, MD, NI, TD, DR, OUT = 0.0, 8.2, 16.6, 22.6, 25.1, 36.3   # cortes = escenas del video
chime(0.15, .7, base=660); chime(1.5, .5, base=990)
section(M, MD, MORNING, ARP_SOFT, "soft", gain=.9, cutoff=(700, 2400))
whoosh(MD, .8, -.4); impact(MD, .35)
section(MD, NI, MIDDAY, ARP_UP, "groove", gain=.85)
whoosh(NI, .9, .4); impact(NI, .5)
section(NI, TD, NIGHT, ARP_NIGHT, "night", gain=.9, cutoff=(1800, 3200), melody=NIGHT_MEL)
CHORDS = NIGHT
pad_bar(TD, 0, 2600, 900, gain=.7, length=DR - TD)
riser(DR, DR - TD, .9)
impact(DR, .9); chime(DR, .6, base=1175)
section(DR, OUT, DROP, ARP_UP, "drop", gain=.9, melody=DROP_MEL, mel_oct=-12)
for c in (31.4, 33.6): whoosh(c, .6, .3)
riser(OUT, 1.6, .6)
impact(OUT, 1.0); chime(OUT + .05, .9, base=880)
CHORDS = [(38, [57, 62, 66, 69, 74])] * 4
pad_bar(OUT, 0, 3200, 700, gain=1.0, length=END - OUT + 1)
bass_bar(OUT, 0, "long", .7)
ARP = ARP_SOFT; arp_bar(OUT, 0, gain=.4, oct_=24); arp_bar(OUT + BAR, 0, gain=.25, oct_=24)
chime(39.2, 1.0, base=1174.7)

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

leadL = reverb(lead_L, 1.6, .35)
leadR = reverb(lead_R, 1.6, .35)
mixL = L + padL + arpL + bassd + leadL
mixR = R + padR + arpR + bassd + leadR

# fade final
fade = np.ones(N)
f0, f1 = int((END - 2.5) * SR), N
fade[f0:f1] = np.linspace(1, 0, f1 - f0) ** 1.5
mixL *= fade
mixR *= fade

# master: soft clip + normalización
st = np.stack([mixL, mixR], 1)
st = np.tanh(st * 1.2)
st /= np.max(np.abs(st)) / 0.89
pcm = (st * 32767).astype("<i2")
with wave.open(sys.argv[1] if len(sys.argv) > 1 else "musica.wav", "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("ok", TOTAL, "s")
