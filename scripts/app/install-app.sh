#!/bin/zsh
# Crea /Applications/LUMINA.app: un doble clic arranca LUMINA (si no está corriendo) y abre su ventana.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="/Applications/LUMINA.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
sed "s|__ROOT__|$ROOT|" "$ROOT/scripts/app/launcher.sh" > "$APP/Contents/MacOS/LUMINA"
chmod +x "$APP/Contents/MacOS/LUMINA"

# Icono a partir del de LUMINA.
ICONSET="$(mktemp -d)/LUMINA.iconset"; mkdir -p "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z $size $size "$ROOT/public/m/icon-512.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2)); [ $double -le 1024 ] && sips -z $double $double "$ROOT/public/m/icon-512.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/LUMINA.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>LUMINA</string>
  <key>CFBundleDisplayName</key><string>LUMINA</string>
  <key>CFBundleIdentifier</key><string>local.lumina.app</string>
  <key>CFBundleExecutable</key><string>LUMINA</string>
  <key>CFBundleIconFile</key><string>LUMINA</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST
touch "$APP"
echo "Instalada en $APP"
