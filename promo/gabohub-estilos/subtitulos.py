"""Subtítulos de «Desfile de estilos» (GaboHub): desfile-de-estilos.srt y captions.js (los usa estilos.html).
Uso: python3 subtitulos.py   (después de narracion.py)"""
import json, re

cues = []
for seg in json.load(open("audio/voz.json")):
    # «Gabo Jab» se escribe «GaboHub»
    words = []
    for w in seg["words"]:
        if words and words[-1][0] == "Gabo" and w[0].startswith("Jab"):
            words[-1] = ["GaboHub" + w[0][3:], words[-1][1], w[2]]
        else:
            words.append([w[0].replace("...", "…"), w[1], w[2]])
    # cortes en la puntuación; si un pedazo queda largo, se parte al medio
    parts, cur = [], []
    for w in words:
        cur.append(w)
        if re.search(r"[.?!:…,]$", w[0]):
            parts.append(cur); cur = []
    if cur: parts.append(cur)
    for p in parts:
        full = " ".join(x[0] for x in p)
        if len(full) > 34 and len(p) > 3:   # se parte donde las dos mitades quedan más parejas
            m = min(range(1, len(p)), key=lambda k: abs(len(" ".join(x[0] for x in p[:k])) - len(full) / 2))
            cues += [p[:m], p[m:]]
        else:
            cues.append(p)
ts = lambda t: f"{int(t // 3600):02d}:{int(t % 3600 // 60):02d}:{int(t % 60):02d},{int(round((t % 1) * 1000)) % 1000:03d}"
srt, js = [], []
for n, c in enumerate(cues, 1):
    a = c[0][1]; b = c[-1][2] + .25
    if n < len(cues): b = min(b, cues[n][0][1] - .02)
    text = " ".join(x[0] for x in c)
    srt.append(f"{n}\n{ts(a)} --> {ts(b)}\n{text}\n")
    js.append({"a": round(a, 3), "b": round(b, 3), "text": text, "words": [[x[0], x[1]] for x in c]})
open("desfile-de-estilos.srt", "w").write("\n".join(srt))
open("captions.js", "w").write("window.CAPS = " + json.dumps(js, ensure_ascii=False) + ";\n")
for x in js: print(f"{x['a']:6.2f}-{x['b']:6.2f}  {x['text']}")
