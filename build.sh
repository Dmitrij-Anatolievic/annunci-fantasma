#!/bin/sh
# Crea i pacchetti per Chrome/Brave/Edge/Opera/Vivaldi e per Firefox nella cartella dist/
set -e
cd "$(dirname "$0")"
V=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
rm -rf dist && mkdir -p dist/chromium dist/firefox
FILES="content.js background.js icons README.md PRIVACY.md CHANGELOG.md LICENSE"
cp -r $FILES manifest.json dist/chromium/
cp -r $FILES dist/firefox/ && cp manifest.firefox.json dist/firefox/manifest.json
# Negli zip i file stanno in una cartella col nome giusto per l'aggiornamento automatico
mkdir -p dist/z && cp -r dist/chromium dist/z/annunci-fantasma && cp -r dist/firefox dist/z/annunci-fantasma-firefox
(cd dist/z && zip -qr ../annunci-fantasma-$V-chrome-brave-edge.zip annunci-fantasma && zip -qr ../annunci-fantasma-$V-firefox.zip annunci-fantasma-firefox)
rm -rf dist/z
# Copie sciolte per l'aggiornamento automatico (solo i file che servono all'estensione)
rm -rf download/chrome download/firefox && mkdir -p download/chrome download/firefox
for d in chrome:chromium firefox:firefox; do
  dst=download/${d%%:*}; src=dist/${d##*:}
  cp -r $src/manifest.json $src/background.js $src/content.js $src/icons $dst/
done
python3 - "$V" <<'PY'
import json, re, sys
v = sys.argv[1]
log = open('CHANGELOG.md', encoding='utf-8').read()
sec = log.split('\n## ')[1] if '\n## ' in log else log
notes = [re.sub(r'\*\*', '', l[2:]).split('. ')[0][:140] for l in sec.split('\n') if l.startswith('- ')][:4]
base = 'https://github.com/Dmitrij-Anatolievic/annunci-fantasma/raw/main/download/'
raw = 'https://raw.githubusercontent.com/Dmitrij-Anatolievic/annunci-fantasma/main/download/'
import hashlib, os
def files(d):
    out = []
    for root, _, names in os.walk(d):
        for n in sorted(names):
            fp = os.path.join(root, n); rel = os.path.relpath(fp, d).replace(os.sep, '/')
            out.append({'path': rel, 'sha256': hashlib.sha256(open(fp, 'rb').read()).hexdigest()})
    return sorted(out, key=lambda f: f['path'])
json.dump({'version': v, 'chrome': base + 'annunci-fantasma-%s-chrome-brave-edge.zip' % v,
           'firefox': base + 'annunci-fantasma-%s-firefox.zip' % v, 'notes': notes,
           'base_chrome': raw + 'chrome/', 'files_chrome': files('download/chrome'),
           'base_firefox': raw + 'firefox/', 'files_firefox': files('download/firefox')},
          open('version.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
PY
echo "Pacchetti in dist/: $(ls dist/*.zip | tr '\n' ' ')"
