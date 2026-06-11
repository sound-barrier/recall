# Restore the active profile's Recall database from a backup made by
# Backup-Database.ps1.
#
# Lists the backups in <profile>\db\backups\ and prompts which to
# restore, or pass -BackupFile to restore a specific one. Overwrites the
# current database — close Recall first.
#
#   .\Restore-Database.ps1                       # interactive picker
#   .\Restore-Database.ps1 -BackupFile C:\x.db   # restore a specific file

[CmdletBinding()]
param(
    [string]$BackupFile
)

. "$PSScriptRoot\_Recall.ps1"

$db = Get-RecallDbPath
$backupsDir = Join-Path (Split-Path -Parent $db) 'backups'

if (-not $BackupFile) {
    if (-not (Test-Path -LiteralPath $backupsDir)) {
        Write-Host "No backups folder at:`n  $backupsDir"
        Write-Host 'Make one first with Backup-Database.ps1.'
        exit 1
    }
    $backups = @(Get-ChildItem -LiteralPath $backupsDir -Filter 'recall-*.db' | Sort-Object Name -Descending)
    if ($backups.Count -eq 0) {
        Write-Host "No backups found in:`n  $backupsDir"
        exit 1
    }
    Write-Host 'Available backups (newest first):'
    for ($i = 0; $i -lt $backups.Count; $i++) {
        Write-Host ("  [{0}] {1}  ({2})" -f $i, $backups[$i].Name, $backups[$i].LastWriteTime)
    }
    $sel = Read-Host 'Restore which number? (Enter to cancel)'
    if ($sel -eq '') {
        Write-Host 'Aborted.'
        exit 1
    }
    $BackupFile = $backups[[int]$sel].FullName
}

if (-not (Test-Path -LiteralPath $BackupFile)) {
    Write-Host "Backup not found:`n  $BackupFile"
    exit 1
}

Assert-RecallClosed

Write-Host "This OVERWRITES the current database:`n  $db"
Write-Host "from:`n  $BackupFile"
if ((Read-Host 'Proceed? [y/N]') -ne 'y') {
    Write-Host 'Aborted.'
    exit 1
}

# Drop the current trio first — a stale -wal/-shm left beside a restored
# .db would corrupt it on next open.
foreach ($f in (Get-RecallDbFiles -Db $db)) {
    if (Test-Path -LiteralPath $f) {
        Remove-Item -LiteralPath $f -Force
    }
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $db) | Out-Null

# Copy back the picked .db plus any of its -wal/-shm sidecars.
foreach ($suffix in @('', '-wal', '-shm')) {
    $src = "$BackupFile$suffix"
    if (Test-Path -LiteralPath $src) {
        Copy-Item -LiteralPath $src -Destination "$db$suffix"
    }
}
Write-Host 'Restored. Launch Recall.'
