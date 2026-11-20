#!/bin/zsh
# Crea /Applications/LUMINA.app: un doble clic arranca LUMINA (si no está corriendo) y abre su ventana.
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="/Applications/LUMINA.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
# App nativa (ventana propia con icono en el Dock): se compila con el Swift que trae macOS.
# Universal (Apple Silicon e Intel), para poder instalarla también en otro Mac.
BUILD="$(mktemp -d)"
swiftc -O -target arm64-apple-macos13 -o "$BUILD/arm64" "$ROOT/scripts/app/LuminaApp.swift" -framework Cocoa -framework WebKit
swiftc -O -target x86_64-apple-macos13 -o "$BUILD/x86_64" "$ROOT/scripts/app/LuminaApp.swift" -framework Cocoa -framework WebKit
lipo -create "$BUILD/arm64" "$BUILD/x86_64" -output "$APP/Contents/MacOS/LUMINA"

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
  <key>LuminaRoot</key><string>$ROOT</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>LUMINA usa el micrófono solo cuando dictas una nota o una búsqueda.</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/><key>NSAllowsArbitraryLoads</key><true/></dict>
</dict></plist>
PLIST
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
# Copia descargable para otros Mac de la casa (se conectan a este; no llevan servidor).
mkdir -p "$ROOT/public/downloads"
rm -f "$ROOT/public/downloads/LUMINA-mac.zip"
ditto -c -k --keepParent "$APP" "$ROOT/public/downloads/LUMINA-mac.zip"
touch "$APP"
echo "Instalada en $APP"
