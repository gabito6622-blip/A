"""Arma un tutorial: voz (ElevenLabs, en caché), timeline y HTML animado.
Uso: python3 build.py 01            -> out/01/video.html + out/01/timeline.json
     python3 build.py 01 --render   -> además renderiza y mezcla out/01/Barbino_Tutorial_01.mp4
"""
import hashlib, json, os, re, subprocess, sys
D = os.path.dirname(os.path.abspath(__file__)) + "/"
SCR = os.path.dirname(D.rstrip("/")) + "/"
VOICE = "k8cFOyAg7B9qwBlDDNTC"  # Miguel
TITLES = json.load(open(D + "titulos.json"))


def tts(text):
    os.makedirs(D + "vo", exist_ok=True)
    h = hashlib.sha1(text.encode()).hexdigest()[:16]
    mp3, wav = f"{D}vo/{h}.mp3", f"{D}vo/{h}.wav"
    if not os.path.exists(wav):
        body = json.dumps({"text": text, "model_id": "eleven_multilingual_v2", "voice_settings": {"stability": 0.5, "similarity_boost": 0.8, "style": 0.25, "use_speaker_boost": True, "speed": 1.08}})
        for attempt in range(6):
            r = subprocess.run(["curl", "-sS", "-f", "-o", mp3, "-X", "POST", f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE}?output_format=mp3_44100_128", "-H", "xi-api-key: x", "-H", "content-type: application/json", "-d", body])
            if r.returncode == 0: break
            import time; time.sleep(5 * (attempt + 1))
        else:
            raise RuntimeError("ElevenLabs no respondió")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", mp3, "-af", "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,apad=pad_dur=0.1", "-ar", "44100", wav], check=True)
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav], capture_output=True, text=True).stdout)
    return wav, dur


def chunks(text):
    """Parte la narración en frases cortas para los subtítulos."""
    parts = re.split(r"(?<=[.!?:])\s+", text.strip())
    out = []
    for p in parts:
        while len(p) > 110:
            cut = p.rfind(",", 0, 110)
            if cut < 40: cut = p.rfind(" ", 0, 100)
            out.append(p[:cut + 1].strip()); p = p[cut + 1:].strip()
        if p: out.append(p)
    return out


def build(tid):
    o = f"{D}out/{tid}/"
    j = json.load(open(o + "steps.json"))
    n = j["number"]
    intro_text = f"Tutorial número {n}: {j['title']}."
    segs, t = [], 0.6
    wav, dur = tts(intro_text)
    segs.append({"kind": "intro", "start": 0, "vo": t, "dur": dur, "wav": wav, "text": intro_text})
    t += dur + 1.4
    for i, s in enumerate(j["steps"]):
        wav, dur = tts(s["text"])
        cs = chunks(s["text"])
        total = sum(len(c) for c in cs)
        acc, subs = 0, []
        for c in cs:
            subs.append({"t": round(dur * acc / total, 2), "text": c}); acc += len(c)
        segs.append({"kind": "step", "i": i, "start": round(t - 0.35, 2), "vo": round(t, 2), "dur": round(dur, 2), "wav": wav, "subs": subs, **s})
        t += dur + 0.55
    segs.append({"kind": "outro", "start": round(t - 0.35, 2), "vo": None, "dur": 4.5})
    end = round(t + 4.5, 2)
    for k in range(len(segs) - 1):
        segs[k]["end"] = segs[k + 1]["start"] + 0.35
    segs[-1]["end"] = end
    nxt = TITLES.get(str(n + 1))
    data = {"id": tid, "n": n, "title": j["title"], "learn": j["learn"], "next": nxt, "segs": segs, "end": end, "img": ""}
    json.dump(data, open(o + "timeline.json", "w"), ensure_ascii=False, indent=1)
    html = open(D + "template.html").read().replace("__DATA__", json.dumps(data, ensure_ascii=False))
    open(o + "video.html", "w").write(html)
    print(f"{tid}: {len(j['steps'])} pasos, {end:.1f} s ({end/60:.1f} min)")
    return data


def render(tid, data):
    o = f"{D}out/{tid}/"
    subprocess.run(["node", D + "render.cjs", o + "video.html", "full", o + "silent.mp4"], check=True)
    segs = [s for s in data["segs"] if s.get("vo") is not None]
    inp, flt = [], []
    for i, s in enumerate(segs):
        inp += ["-i", s["wav"]]
        ms = int(s["vo"] * 1000)
        flt.append(f"[{i+1}:a]aresample=44100,aformat=channel_layouts=stereo,adelay={ms}|{ms}[v{i}]")
    n, END = len(segs), data["end"]
    flt.append("".join(f"[v{i}]" for i in range(n)) + f"amix=inputs={n}:normalize=0,volume=1.6,apad=whole_dur={END}[vo]")
    flt.append("[vo]asplit[vo1][vo2]")
    flt.append(f"[{n+1}:a]aloop=loop=-1:size=2e9,atrim=0:{END},asetpts=PTS-STARTPTS,volume=0.2,afade=t=in:d=0.5,afade=t=out:st={END-3}:d=3[m]")
    flt.append("[m][vo2]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=500[md]")
    flt.append("[md][vo1]amix=inputs=2:normalize=0:duration=longest,alimiter=limit=0.95,loudnorm=I=-15:TP=-1.5:LRA=11[a]")
    out = o + f"Barbino_Tutorial_{tid}.mp4"
    cmd = ["ffmpeg", "-y", "-i", o + "silent.mp4"] + inp + ["-i", SCR + "bmusic.wav", "-filter_complex", ";".join(flt), "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-movflags", "+faststart", "-t", str(END), out]
    r = subprocess.run(cmd, capture_output=True, text=True)
    print(out if r.returncode == 0 else r.stderr[-500:])


if __name__ == "__main__":
    tid = sys.argv[1]
    data = build(tid)
    if "--render" in sys.argv:
        render(tid, data)
