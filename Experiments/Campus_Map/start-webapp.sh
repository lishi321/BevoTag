#!/usr/bin/env sh
# Start BevoTag Signal Studio and open it in the browser (macOS/Linux).
# Press Ctrl+C to stop the web app.
cd "$(dirname "$0")/collector" || exit 1
PORT="${PORT:-8765}"
URL="http://localhost:$PORT/"

PY="$(command -v python3 || command -v python)" || {
  echo "Python 3 is required. Install it from https://www.python.org/downloads/ and run this again."
  exit 1
}

echo "Starting BevoTag Signal Studio at $URL"
echo "Use Chrome or Edge to connect the ESP32. Press Ctrl+C to stop."
if [ -z "$BEVOTAG_NO_BROWSER" ]; then
  (sleep 2
   if command -v open >/dev/null 2>&1; then open "$URL"
   elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
   fi) >/dev/null 2>&1 &
fi
exec "$PY" -m http.server "$PORT" --bind 127.0.0.1
