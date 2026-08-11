#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
OUTPUT_DIR="${1:-$SCRIPT_DIR/../Safari-Xcode}"
BUNDLE_ID="${2:-ua.ivan.hochu.webextension}"

if xcrun --find safari-web-extension-packager >/dev/null 2>&1; then
  TOOL="safari-web-extension-packager"
elif xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  TOOL="safari-web-extension-converter"
else
  echo "Не найден Safari Web Extension Packager. Установи актуальный Xcode и Command Line Tools."
  exit 1
fi

xcrun "$TOOL" "$SCRIPT_DIR" \
  --project-location "$OUTPUT_DIR" \
  --app-name "В Хочу" \
  --bundle-identifier "$BUNDLE_ID" \
  --swift \
  --copy-resources

echo "Готово: $OUTPUT_DIR"
