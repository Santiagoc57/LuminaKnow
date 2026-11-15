#!/bin/zsh

set -u

export PATH="$HOME/.local/node/bin:$PATH"

PROJECT_PATH="${0:A:h}"
APP_PORT="${LUMINA_PORT:-3000}"
APP_URL="http://localhost:${APP_PORT}"

cd "$PROJECT_PATH" || exit 1

show_error() {
  printf "\nNo se pudo abrir Lúmina.\n%s\n\n" "$1"
  printf "Presiona cualquier tecla para cerrar esta ventana."
  read -r -k 1
  printf "\n"
  exit 1
}

if curl --silent --fail --max-time 2 "$APP_URL" >/dev/null 2>&1; then
  if [[ "${LUMINA_SKIP_BROWSER:-0}" != "1" ]]; then
    open "$APP_URL"
  fi
  printf "Lúmina ya estaba encendida. Se abrió en tu navegador.\n"
  exit 0
fi

if lsof -nP -iTCP:"$APP_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  show_error "El puerto ${APP_PORT} está siendo usado por otra aplicación."
fi

command -v node >/dev/null 2>&1 || show_error "No encontramos Node.js. Instala Node.js 20 o una versión más reciente."
command -v npm >/dev/null 2>&1 || show_error "No encontramos npm junto a Node.js."

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null)"
if [[ -z "$NODE_MAJOR" || "$NODE_MAJOR" -lt 20 ]]; then
  show_error "Lúmina necesita Node.js 20 o una versión más reciente."
fi

if [[ ! -d "$PROJECT_PATH/node_modules" ]]; then
  printf "Preparando Lúmina por primera vez…\n"
  npm install || show_error "No fue posible instalar los componentes necesarios."
fi

printf "\nIniciando Lúmina…\n"
printf "Esta ventana mantiene la aplicación encendida. Puedes minimizarla.\n"
printf "Para detener Lúmina, cierra esta ventana o presiona Control + C.\n\n"

(
  for attempt in {1..90}; do
    if curl --silent --fail --max-time 2 "$APP_URL" >/dev/null 2>&1; then
      if [[ "${LUMINA_SKIP_BROWSER:-0}" != "1" ]]; then
        open "$APP_URL"
      fi
      exit 0
    fi
    sleep 1
  done
) &
OPEN_WATCHER_PID=$!

cleanup() {
  kill "$OPEN_WATCHER_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

npm run dev -- --hostname 0.0.0.0 --port "$APP_PORT"
EXIT_CODE=$?

if [[ "$EXIT_CODE" -ne 0 ]]; then
  show_error "El servidor de Lúmina se cerró inesperadamente."
fi
