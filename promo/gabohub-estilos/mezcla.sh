#!/usr/bin/env bash
# Voz (Marco) + música: la música baja cuando habla (sidechain); normalizado a -14 LUFS (TikTok/Reels).
# Uso: python3 music.py audio/musica.wav && python3 narracion.py && bash mezcla.sh
set -euo pipefail
cd "$(dirname "$0")"
END=49.0
ffmpeg -y -hide_banner -loglevel error -i audio/musica.wav -i audio/voz.wav -filter_complex "
[1:a]aresample=44100,aformat=channel_layouts=stereo,highpass=f=70,equalizer=f=3200:t=q:w=1.2:g=2,acompressor=threshold=0.12:ratio=3:attack=5:release=120:makeup=2,apad,asplit=2[v][vsc];
[0:a]volume=0.55[m];
[m][vsc]sidechaincompress=threshold=0.04:ratio=6:attack=25:release=400:makeup=1[md];
[md][v]amix=inputs=2:duration=first:normalize=0,atrim=0:${END},afade=t=out:st=47.6:d=1.4,loudnorm=I=-14:TP=-1.2:LRA=10[out]" -map "[out]" -ar 48000 -c:a pcm_s16le audio/mezcla.wav
echo "mezcla: $(ffprobe -v error -show_entries format=duration -of csv=p=0 audio/mezcla.wav) s"
