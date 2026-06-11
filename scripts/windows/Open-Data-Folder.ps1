# Open the active profile's Recall data folder in File Explorer.
#
# That folder holds db\ (the SQLite database), screenshots\, and the
# profile's settings — handy when you want to find or hand-edit them.

. "$PSScriptRoot\_Recall.ps1"

$dir = Get-RecallProfileDir
if (Test-Path -LiteralPath $dir) {
    Start-Process explorer.exe $dir
    exit 0
}

Write-Host "No data folder yet for profile '$(Get-RecallActiveProfile)':"
Write-Host "  $dir"
Write-Host 'Launch Recall once to create it.'

# Fall back to the install base dir if it at least exists.
$base = Get-RecallBaseDir
if (Test-Path -LiteralPath $base) {
    Start-Process explorer.exe $base
}
