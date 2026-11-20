#!/bin/zsh
# Publica el programa de LUMINA (no los datos) en iCloud Drive → LUMINA, para instalarlo o actualizarlo en otro Mac.
# Lo llama el servidor tras compilar, solo si la sincronización con iCloud está activada en este Mac.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLOUD="${LUMINA_SYNC_DIR:-$HOME/Library/Mobile Documents/com~apple~CloudDocs/LUMINA}"
[ -d "$(dirname "$CLOUD")" ] || exit 0
mkdir -p "$CLOUD/app"
version="$(cd "$ROOT" && git rev-parse HEAD 2>/dev/null)-$(cd "$ROOT" && (git diff HEAD; git ls-files --others --exclude-standard) 2>/dev/null | shasum | cut -c1-12)"
[ "$(cat "$CLOUD/app/.lumina-code-version" 2>/dev/null)" = "$version" ] && exit 0
# Solo el programa: los archivos que guarda git (nunca datos, copias de seguridad ni claves) y yt-dlp.
LIST="$(mktemp)"
(cd "$ROOT" && git ls-files -co --exclude-standard | grep -v -E '^(data|backups|outputs|work|Referentes)/' ; echo bin/yt-dlp) > "$LIST"
rsync -a --delete --delete-excluded --files-from="$LIST" "$ROOT/" "$CLOUD/app/"
# --files-from no borra lo que ya no existe: se limpia lo que sobra comparando listas.
(cd "$CLOUD/app" && find . -type f ! -name '.lumina-code-version' ! -name '.node-version' ! -path './bin/lumina-*' | sed 's|^\./||' | sort) | comm -23 - <(sort "$LIST") | while read -r stale; do rm -f "$CLOUD/app/$stale"; done
# Ayudantes nativos universales (Apple Silicon e Intel).
BUILD="$(mktemp -d)"
for tool in "vision/analyze.swift:lumina-vision" "audio/split.swift:lumina-audio-split"; do
  src="${tool%%:*}"; out="${tool##*:}"
  if swiftc -O -target arm64-apple-macos13 "$ROOT/scripts/$src" -o "$BUILD/$out-arm64" 2>/dev/null && swiftc -O -target x86_64-apple-macos13 "$ROOT/scripts/$src" -o "$BUILD/$out-x86_64" 2>/dev/null; then
    lipo -create "$BUILD/$out-arm64" "$BUILD/$out-x86_64" -output "$CLOUD/app/bin/$out"
  else cp "$ROOT/bin/$out" "$CLOUD/app/bin/$out" 2>/dev/null || true; fi
done
node -v > "$CLOUD/app/.node-version" 2>/dev/null || "$HOME/.local/node/bin/node" -v > "$CLOUD/app/.node-version"
# La app y el instalador, listos para el otro Mac.
[ -d /Applications/LUMINA.app ] && rsync -a --delete /Applications/LUMINA.app/ "$CLOUD/LUMINA.app/"
cp "$ROOT/scripts/app/Instalar LUMINA.command" "$CLOUD/Instalar LUMINA.command"
chmod +x "$CLOUD/Instalar LUMINA.command"
echo "$version" > "$CLOUD/app/.lumina-code-version"
echo "[$(date)] Programa publicado en iCloud ($version)"
