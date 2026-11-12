"""Música de «La historia de Ariana» (GaboHub): original, sintetizada acá (sin samples ni copyright).
Pop electrónico a 96 BPM en Fa# menor, sincronizado con ariana.html (cada escena = 2 compases = 5 s):
  0 - 2 compases   el caos: piano apagado y notificaciones de chat que se amontonan
  2 - 16           despega: bombo, palmas, arpegio y pad con «bombeo»
 16 - 18           manifiesto: corte, pad grande y un golpe en «Tu marca. Tus precios. Tus clientes.»
 18 - 20           cierre: vuelve el ritmo un compás y acorde final con campanita
Uso: python3 music.py salida.wav
"""
import sys, wave

import numpy as np

SR = 44100
BPM = 96
BEAT = 60 / BPM
BAR = 4 * BEAT
BARS = 20
TOTAL = BARS * BAR + 2.5
N = int(TOTAL * SR)
rng = np.random.default_rng(33)
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




def saw_pad(freq, dur, vel=1.0, bright=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for det in (-0.006, 0.0, 0.006):
        for h in range(1, 14):
            out += np.sin(2 * np.pi * freq * (1 + det) * h * t + h * 0.7) / h * np.exp(-h * (0.35 / bright))
    env = np.minimum(1, t / 0.25) * np.minimum(1, (n - np.arange(n)) / (0.4 * SR))
    return out * env * vel * 0.035


def pluck(freq, dur=0.3, vel=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = sum(np.sin(2 * np.pi * freq * h * t) * np.exp(-t * (8 + 6 * h)) / h for h in range(1, 7))
    return s * vel * 0.12


def clap(vel=1.0):
    n = int(0.22 * SR)
    t = np.arange(n) / SR
    noise = np.convolve(rng.normal(0, 1, n), [1, -0.7], "same")
    env = np.exp(-t * 22) + 0.6 * np.exp(-((t - 0.012) % 0.011) * 300) * (t < 0.035)
    return noise * env * 0.22 * vel


def pop(vel=1.0, f0=900):
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    f = f0 + 700 * np.exp(-t * 60)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 40) * 0.3 * vel


def impact(vel=1.0):
    n = int(1.6 * SR)
    t = np.arange(n) / SR
    f = 40 + 60 * np.exp(-t * 18)
    return (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 3) * 0.7 + rng.normal(0, 1, n) * np.exp(-t * 7) * 0.12) * vel


CHORDS = [  # (bajo, acorde) F#m9 · Dmaj9 · A(add9) · E6
    (42, [57, 61, 64, 68]),
    (38, [54, 57, 61, 64]),
    (45, [57, 59, 61, 64]),
    (40, [56, 59, 61, 64]),
]
duck_env = np.ones(N)                                        # «bombeo» del pad con cada bombo


def duck_at(t0):
    i = int(t0 * SR)
    n = int(BEAT * SR)
    if i >= N:
        return
    j = min(N, i + n)
    curve = 1 - 0.65 * np.exp(-np.arange(j - i) / SR * 9)
    duck_env[i:j] = np.minimum(duck_env[i:j], curve)


padL = np.zeros(N)
padR = np.zeros(N)


def put_pad(sig, t0, gain=1.0):
    i = int(t0 * SR)
    j = min(N, i + len(sig))
    padL[i:j] += sig[: j - i] * gain
    padR[i:j] += sig[: j - i] * gain * 0.95


for b in range(BARS):
    t0 = b * BAR
    root, notes = CHORDS[b % 4]
    intro, manif, last = b < 2, 16 <= b < 18, b >= 19
    if intro:
        for j, m in enumerate(notes):
            put(epiano(mtof(m), BAR * 0.95, 0.55, bright=0.3), t0 + j * 0.01, pan=-0.3 + j * 0.2)
        continue
    for m in notes:
        put_pad(saw_pad(mtof(m), BAR * (2.2 if last else 1.02), 1.25 if manif else 1.0, bright=1.6 if manif else 1.0), t0)
    put(bass(mtof(root), BAR * (1.6 if last else 0.95), 0.9 if not manif else 0.6), t0)
    if manif or last:
        continue
    # bombo en negras (pop), palmas en 2 y 4, hats en corcheas, arpegio en semicorcheas
    for q in range(4):
        put(kick(0.95), t0 + q * BEAT); duck_at(t0 + q * BEAT)
    put(clap(), t0 + BEAT, pan=0.05); put(clap(), t0 + 3 * BEAT, pan=0.05)
    for e in range(8):
        put(hat(1.0 if e % 2 else 0.5), t0 + e * BEAT / 2, pan=0.3)
    arp = notes + [notes[1] + 12, notes[2] + 12, notes[3] + 12, notes[2] + 12]
    for k in range(16):
        put(pluck(mtof(arp[k % len(arp)] + 12), 0.28, 0.8 if k % 4 == 0 else 0.5), t0 + k * BEAT / 4, pan=0.4 if k % 2 else -0.4)
    put(bass(mtof(root + 12), BEAT * 0.4, 0.6), t0 + 2.5 * BEAT)

# el caos del principio: notificaciones que se amontonan
for k, tt in enumerate((0.5, 1.1, 1.5, 2.0, 2.3, 2.6, 2.85, 3.1, 3.3, 3.5, 3.65, 3.8, 3.95, 4.1)):
    put(pop(0.6 + 0.03 * k, 700 + (k * 137) % 600), tt, pan=((k * 0.37) % 1.4) - 0.7)
put(swell(BAR * 0.9), 2 * BAR - BAR * 0.9)
put(impact(1.0), 2 * BAR)
# manifiesto: un golpe en cada frase (mismos tiempos que la voz)
put(swell(BAR * 0.8), 16 * BAR - BAR * 0.8)
for tt in (40.48, 41.44, 42.56):
    put(impact(0.75), tt); put(kick(1.1), tt)
put(swell(BAR * 0.8), 18 * BAR - BAR * 0.8)
put(impact(0.9), 18 * BAR)
for i, m in enumerate((78, 81, 85)):                          # campanita final
    put(bell(mtof(m), 3.0, 1.0 - i * 0.15), 19 * BAR + 0.1 + i * 0.12, pan=-0.3 + i * 0.3)


def reverb(x, secs=1.8, mix=0.2):
    n = int(secs * SR)
    t = np.arange(n) / SR
    ir = rng.normal(0, 1, n) * np.exp(-t * 4)
    ir /= np.sqrt(np.sum(ir ** 2))
    size = 1 << int(np.ceil(np.log2(len(x) + n)))
    return x + np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[: len(x)] * mix


padL, padR = reverb(padL * duck_env, 2.4, 0.4), reverb(padR * duck_env, 2.4, 0.4)
L, R = reverb(L) + padL, reverb(R) + padR
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
