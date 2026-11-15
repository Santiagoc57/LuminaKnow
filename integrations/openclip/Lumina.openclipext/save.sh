#!/bin/zsh
# Envía el texto seleccionado a Lúmina. La dirección y el código de conexión viven en ~/.lumina/openclip.env.
set -u
CONFIG="$HOME/.lumina/openclip.env"
[[ -r "$CONFIG" ]] || { echo "Falta $CONFIG. Ejecuta: npm run openclip:setup" >&2; exit 1; }
set -a; source "$CONFIG"; set +a
NODE="$HOME/.local/node/bin/node"
[[ -x "$NODE" ]] || NODE="$(command -v node)"

BUNDLE="${OPENCLIP_BUNDLE_ID:-}"
SOURCE_URL=""
SOURCE_TITLE=""
case "$BUNDLE" in
  com.apple.Safari)
    SOURCE_URL="$(osascript -e 'tell application "Safari" to get URL of front document' 2>/dev/null)"
    SOURCE_TITLE="$(osascript -e 'tell application "Safari" to get name of front document' 2>/dev/null)";;
  com.google.Chrome|com.brave.Browser|com.microsoft.edgemac|company.thebrowser.Browser|com.vivaldi.Vivaldi)
    SOURCE_URL="$(osascript -e "tell application id \"$BUNDLE\" to get URL of active tab of front window" 2>/dev/null)"
    SOURCE_TITLE="$(osascript -e "tell application id \"$BUNDLE\" to get title of active tab of front window" 2>/dev/null)";;
esac
APP_NAME=""
[[ -n "$BUNDLE" ]] && APP_NAME="$(osascript -e "name of application id \"$BUNDLE\"" 2>/dev/null)"

LUMINA_TEXT="${OPENCLIP_TEXT:-$(cat)}" LUMINA_SOURCE_URL="$SOURCE_URL" LUMINA_SOURCE_TITLE="$SOURCE_TITLE" LUMINA_APP="$APP_NAME" \
"$NODE" -e '
const body = { text: process.env.LUMINA_TEXT || "", sourceUrl: process.env.LUMINA_SOURCE_URL || "", sourceTitle: process.env.LUMINA_SOURCE_TITLE || "", app: process.env.LUMINA_APP || "" };
fetch(`${process.env.LUMINA_URL}/api/extension/clip`, { method: "POST", headers: { Authorization: `Bearer ${process.env.LUMINA_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })
  .then(async (response) => { if (!response.ok) { const payload = await response.json().catch(() => ({})); console.error(payload.error || `Lúmina respondió ${response.status}`); process.exit(1); } })
  .catch(() => { console.error("No se pudo conectar con Lúmina. ¿Está abierta?"); process.exit(1); });
'
