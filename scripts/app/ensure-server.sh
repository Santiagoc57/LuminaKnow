#!/bin/zsh
# Lo que hace LUMINA.app al abrirse: arranca el servidor si no está corriendo (o si quedó viejo) y espera a que responda.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${LUMINA_PORT:-3000}"
URL="http://localhost:$PORT/"
STATE="$HOME/Library/Application Support/LUMINA"
LOGS="$HOME/Library/Logs/LUMINA"
LABEL="com.lumina.server"
mkdir -p "$STATE" "$LOGS"
code_version() {
  if [ -d "$ROOT/.git" ]; then echo "$(cd "$ROOT" && git rev-parse HEAD 2>/dev/null)-$(cd "$ROOT" && (git diff HEAD; git ls-files --others --exclude-standard) 2>/dev/null | shasum | cut -c1-12)"
  else cat "$ROOT/.lumina-code-version" 2>/dev/null; fi
}

up() { curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/m/index.html"; }

# En un Mac instalado desde iCloud (sin git): si hay programa nuevo en iCloud, se copia (y se instalan componentes si cambiaron).
CLOUD="${LUMINA_SYNC_DIR:-$HOME/Library/Mobile Documents/com~apple~CloudDocs/LUMINA}"
if [ ! -d "$ROOT/.git" ] && [ -f "$CLOUD/app/.lumina-code-version" ] && [ "$(cat "$CLOUD/app/.lumina-code-version")" != "$(cat "$ROOT/.lumina-code-version" 2>/dev/null)" ]; then
  export PATH="$HOME/.local/node/bin:$PATH"
  rsync -a --delete --exclude /data --exclude /node_modules --exclude '/.next*' --exclude /.lumina-installed-lock "$CLOUD/app/" "$ROOT/" >> "$LOGS/server.log" 2>&1
  if ! cmp -s "$ROOT/package-lock.json" "$ROOT/.lumina-installed-lock"; then (cd "$ROOT" && npm ci --no-audit --no-fund --loglevel=error >> "$LOGS/server.log" 2>&1 && cp package-lock.json .lumina-installed-lock); fi
fi

# Si corre nuestro servidor de app con una compilación vieja (hubo cambios), se reinicia para recompilar.
pid="$(cat "$STATE/server.pid" 2>/dev/null)"
current="$(code_version)"
if up && [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && [ "$(cat "$ROOT/.next-app/LUMINA_BUILD" 2>/dev/null)" != "$current" ]; then
  kill "$pid"; for i in {1..20}; do up || break; sleep 0.5; done
fi

if ! up; then
  if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
    launchctl kickstart -k "gui/$(id -u)/$LABEL"
  else
    nohup "$ROOT/scripts/app/run-server.sh" >> "$LOGS/server.log" 2>&1 &
    disown
  fi
  for i in {1..240}; do up && break; sleep 0.5; done
fi
