#!/bin/bash
# verify-src.sh — checks every source file against src-manifest.txt.
#
# Usage from your repo root (with Git Bash on Windows):
#   chmod +x verify-src.sh
#   ./verify-src.sh
#
# Reports any file whose byte count differs from expected, or that's missing
# entirely. Both indicate the file got corrupted during extraction or edit.

MANIFEST="${1:-src-manifest.txt}"

if [ ! -f "$MANIFEST" ]; then
  echo "ERROR: $MANIFEST not found. Put src-manifest.txt in this folder first."
  exit 2
fi

bad=0
total=0
missing=0
differ=0

while read -r expected path; do
  case "$expected" in ""|"#"*) continue ;; esac
  total=$((total + 1))

  if [ ! -f "$path" ]; then
    printf "MISSING  (expected %6s bytes)  %s\n" "$expected" "$path"
    missing=$((missing + 1))
    bad=$((bad + 1))
    continue
  fi

  actual=$(wc -c < "$path" | tr -d ' \n\r')
  if [ "$actual" != "$expected" ]; then
    printf "DIFFER   %6s -> %6s            %s\n" "$expected" "$actual" "$path"
    differ=$((differ + 1))
    bad=$((bad + 1))
  fi
done < "$MANIFEST"

echo ""
echo "Checked $total files."
if [ "$bad" -eq 0 ]; then
  echo "All match the manifest. Push your repo."
else
  echo "$bad file(s) corrupted or missing ($differ wrong size, $missing missing)."
  echo "Re-extract src-clean.zip in Git Bash:  unzip -o src-clean.zip"
  exit 1
fi
