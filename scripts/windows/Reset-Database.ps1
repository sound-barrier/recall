# Reset (wipe) the active profile's Recall database.
#
# Recall has no schema migrations pre-1.0 — it recreates an empty
# database on next launch. "Cleaning up the database" therefore just
# means deleting the recall.db trio; the app rebuilds it. Use this when
# the local data is corrupt or you want a fresh start.
#
#   .\Reset-Database.ps1          # confirm, then delete
#   .\Reset-Database.ps1 -Backup  # back up to db\backups\ first
#   .\Reset-Database.ps1 -Force   # skip the confirmation prompt

[CmdletBinding()]
param(
    [switch]$Backup,
    [switch]$Force
)

. "$PSScriptRoot\_Recall.ps1"

$db = Get-RecallDbPath
if (-not (Test-Path -LiteralPath $db)) {
    Write-Host "No database at:`n  $db"
    Write-Host 'Nothing to reset — launch Recall once to create it.'
    exit 0
}

Assert-RecallClosed

Write-Host "This deletes the database for profile '$(Get-RecallActiveProfile)':"
Write-Host "  $db"
Write-Host 'Recall will rebuild an empty database on next launch.'
if (-not $Force) {
    if ((Read-Host 'Delete it? [y/N]') -ne 'y') {
        Write-Host 'Aborted.'
        exit 1
    }
}

if ($Backup) {
    & "$PSScriptRoot\Backup-Database.ps1"
}

foreach ($f in (Get-RecallDbFiles -Db $db)) {
    if (Test-Path -LiteralPath $f) {
        Remove-Item -LiteralPath $f -Force
    }
}
Write-Host 'Done. Launch Recall to start fresh.'
