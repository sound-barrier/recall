#!/usr/bin/env bash
# Drop one match's rows so the next Parse re-OCRs its screenshots fresh.
# Inner loop for parser iteration: tweak the parser, run this against a
# match_key you're debugging, click Parse — the same PNG files get
# re-OCR'd with the new code. The PNG files themselves are untouched.
#
#   db-reparse.sh <match-key|filename-substring>      # confirm prompt
#   db-reparse.sh -y <match-key|filename-substring>   # scripted
#
# Equivalent to `db-delete.sh` for the single-match case — kept as a
# separate command because intent matters (delete = throw away;
# reparse = iterate on the parser against the same captures).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/db-delete.sh" "$@"
