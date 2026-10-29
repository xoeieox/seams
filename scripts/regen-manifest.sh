#!/usr/bin/env bash
# regen-manifest.sh - rewrite MANIFEST.sha256 from the git index, deterministically.
# Rule (matches every prior manifest): every TRACKED file except MANIFEST.sha256 itself, byte-sorted
# paths (LC_ALL=C), "<sha256>  <path>" lines. Untracked files are never listed: `git add` first.
# Verify with: sha256sum -c MANIFEST.sha256
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
export LC_ALL=C
git ls-files -z | grep -zv '^MANIFEST\.sha256$' | sort -z | xargs -0 sha256sum > MANIFEST.sha256
echo "MANIFEST.sha256: $(wc -l < MANIFEST.sha256) entries"
