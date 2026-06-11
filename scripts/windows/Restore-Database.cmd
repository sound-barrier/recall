@echo off
rem Double-click launcher for Restore-Database.ps1 (bypasses the PowerShell
rem execution policy so it runs without per-machine setup). Args pass through.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Restore-Database.ps1" %*
pause
