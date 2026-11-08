#!/usr/bin/env bash
set -euo pipefail

WHISPER_DIR="/home/selub/Documents/progs/whisper.cpp"
MODEL="models/ggml-medium.bin"
HOST="127.0.0.1"
THREADS=12
LANG="ru"

PIDS=()

cleanup() {
    echo ""
    echo "Stopping whisper instances..."
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[1/2] Starting whisper-server (microphone) on port 8081..."
"$WHISPER_DIR/build/bin/whisper-server" \
    -m "$WHISPER_DIR/$MODEL" \
    --port 8081 \
    --host "$HOST" \
    -l "$LANG" \
    -t "$THREADS" &
PIDS+=($!)

echo "[2/2] Starting whisper-server (system audio) on port 8082..."
"$WHISPER_DIR/build/bin/whisper-server" \
    -m "$WHISPER_DIR/$MODEL" \
    --port 8082 \
    --host "$HOST" \
    -l "$LANG" \
    -t "$THREADS" &
PIDS+=($!)

echo "Both whisper instances running (Ctrl+C to stop)."
wait
