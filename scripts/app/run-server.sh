#!/bin/zsh
# Arranca LUMINA en modo app (compilada, sin Terminal). Lo usan LUMINA.app y el inicio automático.
# Si el código cambió desde la última compilación, recompila antes (tarda unos segundos).
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
export LUMINA_DIST_DIR=.next-app
export NODE_ENV=production
PORT="${LUMINA_PORT:-3000}"
STATE="$HOME/Library/Application Support/LUMINA"
LOGS="$HOME/Library/Logs/LUMINA"
mkdir -p "$STATE" "$LOGS"
cd "$ROOT" || exit 1

# Ya hay un LUMINA respondiendo (por ejemplo, el de desarrollo): no se abre otro.
if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/m/index.html"; then exit 0; fi

current="$(git rev-parse HEAD 2>/dev/null)-$( (git diff HEAD; git ls-files --others --exclude-standard) 2>/dev/null | shasum | cut -c1-12)"
stamp="$ROOT/.next-app/LUMINA_BUILD"
if [ ! -f "$stamp" ] || [ "$(cat "$stamp")" != "$current" ]; then
  echo "[$(date)] Compilando LUMINA…" >> "$LOGS/server.log"
  if npx next build >> "$LOGS/build.log" 2>&1; then echo "$current" > "$stamp"
  else echo "[$(date)] La compilación falló; mira build.log" >> "$LOGS/server.log"; [ -d "$ROOT/.next-app/server" ] || exit 1; fi
fi

echo $$ > "$STATE/server.pid"
echo "[$(date)] LUMINA en el puerto $PORT" >> "$LOGS/server.log"
exec node "$ROOT/node_modules/next/dist/bin/next" start -H 0.0.0.0 -p "$PORT" >> "$LOGS/server.log" 2>&1
