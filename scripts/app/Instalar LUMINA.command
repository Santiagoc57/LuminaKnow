#!/bin/zsh
# Instala LUMINA en este Mac desde iCloud Drive: el programa, Node y la app. Tus datos bajan solos de iCloud al abrirla.
set -e
CLOUD="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/LUMINA"
echo "Instalando LUMINA en $DEST (tarda unos minutos la primera vez)…"
if [ ! -f "$CLOUD/app/package.json" ]; then echo "Todavía no está el programa en iCloud. Espera a que termine de bajar y vuelve a abrir esto."; read -k1; exit 1; fi
mkdir -p "$DEST"
rsync -a --delete --exclude /data --exclude /node_modules --exclude '/.next*' "$CLOUD/app/" "$DEST/"

# Node (el mismo que usa tu otro Mac), solo para tu usuario.
if [ ! -x "$HOME/.local/node/bin/node" ]; then
  V="$(cat "$CLOUD/app/.node-version")"; ARCH="$(uname -m | sed 's/x86_64/x64/')"
  echo "Bajando Node $V…"
  TMP="$(mktemp -d)"
  curl -fsSL "https://nodejs.org/dist/$V/node-$V-darwin-$ARCH.tar.gz" | tar -xz -C "$TMP"
  mkdir -p "$HOME/.local"; rm -rf "$HOME/.local/node"; mv "$TMP/node-$V-darwin-$ARCH" "$HOME/.local/node"
fi
export PATH="$HOME/.local/node/bin:$PATH"
cd "$DEST"
echo "Instalando componentes…"
npm ci --no-audit --no-fund --loglevel=error
cp "$CLOUD/app/package-lock.json" "$DEST/.lumina-installed-lock" 2>/dev/null || true

# Sincronización con iCloud activada desde el principio: al abrirla baja tu biblioteca.
mkdir -p data
[ -f data/sync-state.json ] || echo '{"enabled":true,"version":0,"fingerprint":"","syncedAt":""}' > data/sync-state.json

# La app.
rm -rf "${LUMINA_APPS_DIR:-/Applications}/LUMINA.app"
ditto "$CLOUD/LUMINA.app" "${LUMINA_APPS_DIR:-/Applications}/LUMINA.app"
/usr/libexec/PlistBuddy -c "Set :LuminaRoot $DEST" "${LUMINA_APPS_DIR:-/Applications}/LUMINA.app/Contents/Info.plist"
xattr -dr com.apple.quarantine "${LUMINA_APPS_DIR:-/Applications}/LUMINA.app" 2>/dev/null || true
codesign --force --deep --sign - "${LUMINA_APPS_DIR:-/Applications}/LUMINA.app" >/dev/null 2>&1 || true
echo "Listo. Abriendo LUMINA…"
[ -n "$LUMINA_NO_OPEN" ] || open "${LUMINA_APPS_DIR:-/Applications}/LUMINA.app"
