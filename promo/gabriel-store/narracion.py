"""Genera la narración de Gabriel Store con ElevenLabs (voz José, Eleven v4) y guarda los tiempos por carácter.
La clave NO va acá: el proxy del entorno la agrega a las llamadas a api.elevenlabs.io.
Uso: python3 narracion.py full|short
"""
import base64, json, sys, urllib.request

VOICE = "y2ijeTfmnXjzheHO6zeN"  # José - Pleasant announcer's voice (ElevenLabs Voice Library)
# En el texto hablado «Gabriél Stor» fuerza Ga-bri-ÉL y «stor»; en pantalla y subtítulos se escribe «Gabriel Store».
TEXTS = {
    "full": (
        "[curious] ¿Querés disfrutar tus series favoritas... y tener las mejores herramientas digitales? "
        "[excited] ¡Bienvenido a Gabriél Stor! "
        "Disfrutá Netflix desde cuarenta bolivianos. "
        "[curious] ¿Querés aprovechar la inteligencia artificial? [excited] ¡Gemini Pro por solo dieciocho bolivianos! "
        "También encontrás Disney Plus, Prime Video, Max, ChatGPT, Canva, CapCut... y muchas plataformas más. "
        "Entretenimiento, inteligencia artificial y productividad: todo en un solo lugar. "
        "Consultá nuestros precios, elegí lo que necesitás... y escribinos por WhatsApp. "
        "[excited] ¡Gabriél Stor! [warm] Tu mundo digital, más cerca de vos."
    ),
    "short": (
        "[excited] ¡Bienvenido a Gabriél Stor! Netflix desde cuarenta bolivianos y Gemini Pro por solo dieciocho. "
        "Disney Plus, Prime Video, Max, ChatGPT y mucho más. Escribinos por WhatsApp. "
        "[excited] ¡Gabriél Stor! [warm] Tu mundo digital."
    ),
}
which = sys.argv[1]
body = json.dumps({"text": TEXTS[which], "model_id": "eleven_v4", "language_code": "es",
                   "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}}).encode()
req = urllib.request.Request(f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE}/with-timestamps?output_format=mp3_44100_128",
                             data=body, headers={"Content-Type": "application/json", "xi-api-key": "proxy-injected"})
with urllib.request.urlopen(req, timeout=300) as r:
    cost = r.headers.get("character-cost")
    d = json.load(r)
open(f"audio/voz-{which}.mp3", "wb").write(base64.b64decode(d["audio_base64"]))
json.dump({"text": TEXTS[which], "alignment": d.get("normalized_alignment") or d.get("alignment"), "raw_alignment": d.get("alignment")},
          open(f"audio/voz-{which}.json", "w"), ensure_ascii=False)
print(which, "créditos:", cost)
