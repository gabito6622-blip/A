"""Genera subtítulos .srt desde los tiempos por palabra de ElevenLabs (audio/palabras-*.json).
En los subtítulos se escribe «Gabriel Store» aunque el locutor lea «Gabriél Stor» (truco de pronunciación).
Uso: python3 subtitulos.py full|short
"""
import json, re, sys

V = sys.argv[1]
OFFSET = 0.5 if V == "full" else 0.3          # la voz arranca con este desfase en el video
words = [w for w in json.load(open(f"audio/palabras-{V}.json")) if not re.fullmatch(r"\[[^\]]+\]", w[0])]
fix = lambda s: s.replace("Gabriél", "Gabriel").replace("Stor", "Store").replace("...", "…")

cues, cur = [], []
for i, (w, a, b) in enumerate(words):
    cur.append((fix(w), a, b))
    text = " ".join(x[0] for x in cur)
    nxt = words[i + 1] if i + 1 < len(words) else None
    gap = (nxt[1] - b) if nxt else 9
    if re.search(r"[.?!:…]$", w) or len(text) >= 30 or gap > 0.45 or (w.endswith(",") and len(text) > 18):
        cues.append(cur); cur = []
if cur: cues.append(cur)
# sin palabras huérfanas: una palabra sola se une a la línea anterior si entra
merged = []
for c in cues:
    if merged and len(c) == 1 and len(' '.join(x[0] for x in merged[-1] + c)) <= 48 and not re.search(r'[.?!:…]$', merged[-1][-1][0]):
        merged[-1] = merged[-1] + c
    else:
        merged.append(c)
cues = merged

ts = lambda t: f"{int(t // 3600):02d}:{int(t % 3600 // 60):02d}:{int(t % 60):02d},{int(round((t % 1) * 1000)) % 1000:03d}"
out = []
for n, c in enumerate(cues, 1):
    a = c[0][1] + OFFSET
    b = c[-1][2] + OFFSET + 0.25
    if n < len(cues): b = min(b, cues[n][0][1] + OFFSET - 0.02)
    out.append(f"{n}\n{ts(a)} --> {ts(b)}\n{' '.join(x[0] for x in c)}\n")
open(f"gabriel-store-{'40s' if V == 'full' else '15s'}.srt", "w").write("\n".join(out))
print("\n".join(out))
