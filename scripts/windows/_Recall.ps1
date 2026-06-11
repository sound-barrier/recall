# Shared helpers for the Recall Windows maintenance scripts.
#
# Mirrors the install layout the app computes (pkg/app/settings.go +
# profile.go) and the bash scripts/lib/_db.sh: base dir -> active
# profile -> profile dir -> recall.db. Dot-source it from a sibling:
#
#   . "$PSScriptRoot\_Recall.ps1"
#
# Env overrides (same names + precedence as the bash scripts):
#   RECALL_DATA_DIR  full base-dir override (the parent of profiles\)
#   RECALL_PROFILE   profile name to act on
#   RECALL_DB        full path to the .db file
#
# Leading underscore = library, not a runnable command.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-RecallBaseDir {
    # 1. RECALL_DATA_DIR override; 2. the released app's %AppData%\Recall.
    if ($env:RECALL_DATA_DIR) { return $env:RECALL_DATA_DIR }
    return (Join-Path $env:APPDATA 'Recall')
}

function Get-RecallActiveProfile {
    # 1. RECALL_PROFILE; 2. <base>\profiles.json's active_profile; 3. "main".
    if ($env:RECALL_PROFILE) { return $env:RECALL_PROFILE }
    $meta = Join-Path (Get-RecallBaseDir) 'profiles.json'
    if (Test-Path -LiteralPath $meta) {
        try {
            $name = (Get-Content -LiteralPath $meta -Raw | ConvertFrom-Json).active_profile
            if ($name) { return $name }
        } catch {
            # Malformed profiles.json — fall through to the default.
        }
    }
    return 'main'
}

function Get-RecallProfileDir {
    return (Join-Path (Join-Path (Get-RecallBaseDir) 'profiles') (Get-RecallActiveProfile))
}

function Get-RecallDbPath {
    if ($env:RECALL_DB) { return $env:RECALL_DB }
    return (Join-Path (Get-RecallProfileDir) 'db\recall.db')
}

function Get-RecallDbFiles {
    # SQLite runs in WAL mode, so the on-disk database is a trio: the
    # .db plus its -wal (uncommitted pages) and -shm (shared-memory
    # index) sidecars. File-level reset/backup/restore must treat all
    # three as one unit or the restored DB can be inconsistent.
    param([string]$Db = (Get-RecallDbPath))
    return @($Db, "$Db-wal", "$Db-shm")
}

function Assert-RecallClosed {
    # A file copy/delete while the app holds the DB open can capture a
    # torn state (data still in the -wal). Warn and let the user bail.
    if (Get-Process -Name 'Recall*' -ErrorAction SilentlyContinue) {
        Write-Warning 'Recall appears to be running. Close it first so the database is in a consistent state.'
        if ((Read-Host 'Continue anyway? [y/N]') -ne 'y') {
            Write-Host 'Aborted.'
            exit 1
        }
    }
}
