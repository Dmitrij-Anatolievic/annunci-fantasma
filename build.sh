#!/bin/sh
# Crea i pacchetti per Chrome/Brave/Edge/Opera/Vivaldi e per Firefox nella cartella dist/
set -e
cd "$(dirname "$0")"
V=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
rm -rf dist && mkdir -p dist/chromium dist/firefox
FILES="content.js background.js icons README.md PRIVACY.md CHANGELOG.md LICENSE"
cp -r $FILES manifest.json dist/chromium/
cp -r $FILES dist/firefox/ && cp manifest.firefox.json dist/firefox/manifest.json
(cd dist/chromium && zip -qr ../annunci-fantasma-$V-chrome-brave-edge.zip .)
(cd dist/firefox && zip -qr ../annunci-fantasma-$V-firefox.zip .)
echo "Pacchetti in dist/: $(ls dist/*.zip | tr '\n' ' ')"
