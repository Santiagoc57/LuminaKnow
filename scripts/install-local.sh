#!/bin/zsh
set -euo pipefail

PROJECT_PATH="$(cd "$(dirname "$0")/.." && pwd)"
NODE_PATH="$(command -v node)"
LAUNCH_AGENTS_PATH="$HOME/Library/LaunchAgents"
PLIST_PATH="$LAUNCH_AGENTS_PATH/com.lumina.library.plist"

if ! command -v ffmpeg >/dev/null 2>&1; then
  brew install ffmpeg
fi

cd "$PROJECT_PATH"
mkdir -p "$PROJECT_PATH/bin"
curl -L --fail --silent --show-error \
  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos" \
  -o "$PROJECT_PATH/bin/yt-dlp"
chmod +x "$PROJECT_PATH/bin/yt-dlp"
npm install
npm run build
mkdir -p "$PROJECT_PATH/data" "$PROJECT_PATH/backups" "$LAUNCH_AGENTS_PATH"

sed \
  -e "s|__NODE_PATH__|$NODE_PATH|g" \
  -e "s|__PROJECT_PATH__|$PROJECT_PATH|g" \
  "$PROJECT_PATH/scripts/com.lumina.library.plist.template" > "$PLIST_PATH"

launchctl bootout "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl enable "gui/$(id -u)/com.lumina.library"

echo "Lúmina quedó instalada. Abre http://$(scutil --get LocalHostName).local:3000"
