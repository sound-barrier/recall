# Back up the active profile's Recall database.
#
# Writes a timestamped copy of the recall.db trio (db + -wal + -shm) so
# it can be restored later with Restore-Database.ps1. Pure file copy —
# close Recall first so the snapshot is consistent.
#
#   .\Backup-Database.ps1              # -> <profile>\db\backups\recall-<stamp>.db
#   .\Backup-Database.ps1 -To D:\safe # custom destination folder

[CmdletBinding()]
param(
    [string]$To
)

. "$PSScriptRoot\_Recall.ps1"

$db = Get-RecallDbPath
if (-not (Test-Path -LiteralPath $db)) {
    Write-Host "No database at:`n  $db"
    Write-Host 'Nothing to back up — launch Recall once to create it.'
    exit 1
}

Assert-RecallClosed

$destDir = if ($To) { $To } else { Join-Path (Split-Path -Parent $db) 'backups' }
New-Item -ItemType Directory -Force -Path $destDir | Out-Null

$name = "recall-$(Get-Date -Format 'yyyyMMdd-HHmmss').db"
foreach ($f in (Get-RecallDbFiles -Db $db)) {
    if (Test-Path -LiteralPath $f) {
        # '' for the .db, '-wal' / '-shm' for the sidecars.
        $suffix = $f.Substring($db.Length)
        Copy-Item -LiteralPath $f -Destination (Join-Path $destDir "$name$suffix")
    }
}
Write-Host "Backed up to:`n  $(Join-Path $destDir $name)"
