"""Subtítulos de «Un día con Gabriel Store»: genera un-dia.srt y captions.js (los usa la animación).
Uso: python3 subtitulos.py"""
import json, re

OFFSET = 1.5
words = [w for w in json.load(open("audio/palabras.json")) if not re.fullmatch(r"\[[^\]]+\]", w[0])]
fix = lambda s: s.replace("Gabriél", "Gabriel").replace("Stor", "Store").replace("...", "…")
cues, cur = [], []
for i, (w, a, b) in enumerate(words):
    cur.append((fix(w), a, b))
    text = " ".join(x[0] for x in cur)
    nxt = words[i + 1] if i + 1 < len(words) else None
    gap = (nxt[1] - b) if nxt else 9
    if re.search(r"[.?!:…]$", w) or len(text) >= 26 or gap > .45 or (w.endswith(",") and len(text) > 14):
        cues.append(cur); cur = []
if cur: cues.append(cur)
merged = []
for c in cues:
    if merged and len(c) == 1 and len(" ".join(x[0] for x in merged[-1] + c)) <= 34 and not re.search(r"[.?!:…]$", merged[-1][-1][0]):
        merged[-1] += c
    else:
        merged.append(c)
out, js = [], []
ts = lambda t: f"{int(t // 3600):02d}:{int(t % 3600 // 60):02d}:{int(t % 60):02d},{int(round((t % 1) * 1000)) % 1000:03d}"
for n, c in enumerate(merged, 1):
    a = c[0][1] + OFFSET; b = c[-1][2] + OFFSET + .3
    if n < len(merged): b = min(b, merged[n][0][1] + OFFSET - .02)
    text = " ".join(x[0] for x in c)
    out.append(f"{n}\n{ts(a)} --> {ts(b)}\n{text}\n")
    js.append({"a": round(a, 3), "b": round(b, 3), "text": text, "words": [[x[0], round(x[1] + OFFSET, 3)] for x in c]})
open("un-dia-gabriel-store.srt", "w").write("\n".join(out))
open("captions.js", "w").write("window.CAPS = " + json.dumps(js, ensure_ascii=False) + ";\n")
for x in js: print(f"{x['a']:6.2f}-{x['b']:6.2f}  {x['text']}")
