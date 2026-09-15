#!/usr/bin/env bash
# Rebuilds the vendored tokenizer and packages a release zip.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./manifest.json').version")
echo "Building Token Counter $VERSION"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

pushd "$TMP" >/dev/null
npm init -y >/dev/null 2>&1
npm install gpt-tokenizer esbuild >/dev/null 2>&1
cat > entry.js <<'JS'
import { encode, countTokens } from 'gpt-tokenizer/encoding/o200k_base'
export { encode, countTokens }
JS
# Not minified on purpose: Chrome Web Store review treats large minified
# bundles as unreadable code.
npx esbuild entry.js --bundle --format=iife --global-name=GTCTokenizer \
  --outfile=tokenizer.bundle.js
popd >/dev/null

cp "$TMP/tokenizer.bundle.js" src/tokenizer.bundle.js
cp "$TMP/node_modules/gpt-tokenizer/LICENSE" vendor-gpt-tokenizer-LICENSE.txt

node -e "
const fs=require('fs');
const T=(new Function(fs.readFileSync('src/tokenizer.bundle.js','utf8')+'\nreturn GTCTokenizer;'))();
const n=T.encode('sup bro').length;
if(n!==2) throw new Error('tokenizer sanity check failed: '+n);
console.log('tokenizer ok');
"

mkdir -p dist
rm -f "dist/token-counter-$VERSION.zip"
zip -qr "dist/token-counter-$VERSION.zip" \
  manifest.json src popup icons README.md PRIVACY.md LICENSE \
  THIRD_PARTY_NOTICES.md vendor-gpt-tokenizer-LICENSE.txt \
  -x "*.DS_Store"
echo "dist/token-counter-$VERSION.zip"
