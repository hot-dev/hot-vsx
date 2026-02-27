#!/bin/bash

# Package the Hot VS Code extension as a .vsix and install it via CLI
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$ROOT_DIR/build"

cd "$ROOT_DIR"

# Ensure deps
echo "Installing npm dependencies..."
npm install --silent

# Prepare build output directory
mkdir -p "$BUILD_DIR"

# Package using vsce without global install
echo "Packaging extension (.vsix)..."
npx --yes @vscode/vsce package --no-yarn --out "$BUILD_DIR" 2>&1 | tee /dev/stderr

# Find produced .vsix
VSIX_FILE=$(ls -t "$BUILD_DIR"/*.vsix 2>/dev/null | head -n 1)

if [ -z "${VSIX_FILE:-}" ] || [ ! -f "$VSIX_FILE" ]; then
  echo "Error: Could not locate generated .vsix file in $BUILD_DIR" >&2
  exit 1
fi

echo "VSIX created: $VSIX_FILE"

# Install into VS Code
if command -v code >/dev/null 2>&1; then
  echo "Installing VSIX into VS Code..."
  code --install-extension "$VSIX_FILE" --force | cat
  echo "Installed into VS Code. You may need to reload the window."
else
  echo "Warning: 'code' CLI not found. Skipping VS Code install."
fi

# Attempt Cursor CLI if available
if command -v cursor >/dev/null 2>&1; then
  echo "Installing VSIX into Cursor..."
  cursor --install-extension "$VSIX_FILE" --force | cat || echo "Cursor CLI install failed; use Command Palette: 'Extensions: Install from VSIX...'"
else
  echo "Cursor CLI not found. To install in Cursor, use 'Extensions: Install from VSIX...' and select: $VSIX_FILE"
fi

echo "Done."
