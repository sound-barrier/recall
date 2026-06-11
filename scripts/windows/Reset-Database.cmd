@echo off
rem Double-click launcher for Reset-Database.ps1 (bypasses the PowerShell
rem execution policy so it runs without per-machine setup). Args pass through.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Reset-Database.ps1" %*
pause
