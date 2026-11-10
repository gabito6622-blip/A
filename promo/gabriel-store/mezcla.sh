#!/usr/bin/env bash
# Mezcla voz + música: la música baja cuando habla el locutor (sidechain) y todo se normaliza a -14 LUFS (TikTok).
# Uso: bash mezcla.sh full|short
set -euo pipefail
V=$1
if [ "$V" = full ]; then DELAY=500; END=38.5; else DELAY=300; END=15.5; fi
ffmpeg -y -hide_banner -loglevel error -i audio/musica-$V.wav -i audio/voz-$V.mp3 -filter_complex "
[1:a]aresample=44100,aformat=channel_layouts=stereo,adelay=${DELAY}|${DELAY},highpass=f=70,equalizer=f=3200:t=q:w=1.2:g=2,acompressor=threshold=0.12:ratio=3:attack=5:release=120:makeup=2,apad,asplit=2[v][vsc];
[0:a]volume=0.55[m];
[m][vsc]sidechaincompress=threshold=0.04:ratio=7:attack=25:release=350:makeup=1[md];
[md][v]amix=inputs=2:duration=first:normalize=0,atrim=0:${END},afade=t=out:st=$(python3 -c "print($END-1.2)"):d=1.2,loudnorm=I=-14:TP=-1.2:LRA=9[out]" -map "[out]" -ar 48000 -c:a pcm_s16le audio/mezcla-$V.wav
echo "mezcla-$V: $(ffprobe -v error -show_entries format=duration -of csv=p=0 audio/mezcla-$V.wav) s"
