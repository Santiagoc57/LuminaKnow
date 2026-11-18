#!/bin/zsh
# Lo que hace LUMINA.app al abrirla: arranca el servidor si no está corriendo y abre la ventana.
ROOT="__ROOT__"
PORT="${LUMINA_PORT:-3000}"
URL="http://localhost:$PORT/"
STATE="$HOME/Library/Application Support/LUMINA"
LOGS="$HOME/Library/Logs/LUMINA"
LABEL="com.lumina.server"
mkdir -p "$STATE" "$LOGS"
up() { curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/m/index.html"; }

# Si corre nuestro servidor de app con una compilación vieja (hubo cambios), se reinicia para recompilar.
pid="$(cat "$STATE/server.pid" 2>/dev/null)"
current="$(cd "$ROOT" && git rev-parse HEAD 2>/dev/null)-$(cd "$ROOT" && (git diff HEAD; git ls-files --others --exclude-standard) 2>/dev/null | shasum | cut -c1-12)"
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
  osascript -e 'display notification "Abriendo tu biblioteca…" with title "LUMINA"' >/dev/null 2>&1
  for i in {1..240}; do up && break; sleep 0.5; done
fi

# Ventana propia (sin pestañas ni barra de direcciones) si hay Chrome; si no, el navegador predeterminado.
if [ -d "/Applications/Google Chrome.app" ]; then
  open -na "Google Chrome" --args --app="$URL" --user-data-dir="$STATE/window"
else
  open "$URL"
fi
