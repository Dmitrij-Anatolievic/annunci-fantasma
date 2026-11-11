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
python3 - "$V" <<'PY'
import json, re, sys
v = sys.argv[1]
log = open('CHANGELOG.md', encoding='utf-8').read()
sec = log.split('\n## ')[1] if '\n## ' in log else log
notes = [re.sub(r'\*\*', '', l[2:]).split('. ')[0][:140] for l in sec.split('\n') if l.startswith('- ')][:4]
base = 'https://github.com/Dmitrij-Anatolievic/annunci-fantasma/raw/main/download/'
json.dump({'version': v, 'chrome': base + 'annunci-fantasma-%s-chrome-brave-edge.zip' % v,
           'firefox': base + 'annunci-fantasma-%s-firefox.zip' % v, 'notes': notes},
          open('version.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
PY
echo "Pacchetti in dist/: $(ls dist/*.zip | tr '\n' ' ')"
