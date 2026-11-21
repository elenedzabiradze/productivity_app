#!/bin/sh
# Packages server.js + index.html into ONE standalone program that the desktop
# app (Tauri) starts by itself. Run with:  npm run build:server
#
# Uses Node's "single executable application" (SEA) feature. Homebrew's Node
# has this switched off, so we use the official Node from nodejs.org, which
# is installed at /usr/local/bin/node.

set -e  # stop at the first failing command

NODE=/usr/local/bin/node
OUT_DIR=src-tauri/binaries
# Tauri expects the Mac chip type at the end of the file name.
TARGET="$OUT_DIR/server-aarch64-apple-darwin"

mkdir -p "$OUT_DIR"

echo "1/4 Bundling server.js and index.html into a blob..."
"$NODE" --experimental-sea-config sea-config.json

echo "2/4 Copying the Node program (Apple-chip part only)..."
# The official Node is a "universal" program containing both an Intel and an
# Apple-chip version. postject needs exactly one, so `lipo -thin` copies out
# just the arm64 (Apple chip) part — also halving the size.
lipo -thin arm64 "$NODE" -output "$TARGET"
chmod u+w "$TARGET"
codesign --remove-signature "$TARGET"

echo "3/4 Injecting the blob into the copy..."
npx postject "$TARGET" NODE_SEA_BLOB "$OUT_DIR/server.blob" \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  --macho-segment-name NODE_SEA

echo "4/4 Signing it so macOS will run it..."
codesign --sign - --force "$TARGET"

rm "$OUT_DIR/server.blob"
echo "Done: $TARGET"
