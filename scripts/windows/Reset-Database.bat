@echo off
setlocal EnableExtensions

rem ====================================================================
rem  Reset-Database.bat - wipe Recall's match database for a clean start.
rem
rem  Recall has no schema migrations pre-1.0: it recreates an empty
rem  database on next launch and re-parses your screenshots folder. Use
rem  this when an update made your data incompatible, the database is
rem  corrupt, or you just want a fresh start.
rem
rem  By default it BACKS UP the database first (to db\backups\) and asks
rem  to confirm. Double-click it, or run from a terminal:
rem      Reset-Database.bat            confirm, back up, then delete
rem      Reset-Database.bat /force     skip the confirmation prompt
rem      Reset-Database.bat /nobackup  delete without backing up first
rem
rem  Env overrides (same names + precedence the app uses):
rem      RECALL_DB         full path straight to the .db file
rem      RECALL_PROFILE    profile name to act on (else the active one)
rem      RECALL_DATA_DIR   install base (the parent of profiles\)
rem ====================================================================

set "FORCE="
set "NOBACKUP="
:parseargs
if "%~1"=="" goto argsdone
if /I "%~1"=="/force"    set "FORCE=1"
if /I "%~1"=="/nobackup" set "NOBACKUP=1"
if /I "%~1"=="/?"        goto usage
if /I "%~1"=="/help"     goto usage
if /I "%~1"=="-h"        goto usage
shift
goto parseargs
:argsdone

rem --- Resolve the database path (RECALL_DB > profile resolution) ---
set "DB=%RECALL_DB%"
if defined DB goto havedb

set "BASE=%RECALL_DATA_DIR%"
if not defined BASE set "BASE=%APPDATA%\Recall"

set "PROFILE=%RECALL_PROFILE%"
if defined PROFILE goto haveprofile
if not exist "%BASE%\profiles.json" goto profiledefault
rem Read profiles.json's active_profile. PowerShell does the JSON parse
rem (no pipe, so cmd does not need to escape it); falls back to "main".
for /f "usebackq delims=" %%P in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "try { (ConvertFrom-Json (Get-Content -LiteralPath '%BASE%\profiles.json' -Raw)).active_profile } catch { '' }"`) do set "PROFILE=%%P"
:profiledefault
if not defined PROFILE set "PROFILE=main"
:haveprofile
set "DB=%BASE%\profiles\%PROFILE%\db\recall.db"
:havedb

if not exist "%DB%" (
    echo No database found at:
    echo     %DB%
    echo Nothing to reset - launch Recall once to create it.
    goto done
)

rem --- Warn if Recall is running (a mid-write copy can be torn) ---
tasklist /FI "IMAGENAME eq Recall.exe" 2>NUL | find /I "Recall.exe" >NUL
if errorlevel 1 goto notrunning
echo(
echo   WARNING: Recall appears to be running.
echo   Close it first so the database is not written mid-reset.
set /p "GO=Continue anyway? [y/N] "
if /I not "%GO%"=="y" goto aborted
:notrunning

echo(
echo This will DELETE the database for profile "%PROFILE%":
echo     %DB%
echo(
echo Permanently lost - these live ONLY in the database:
echo   - match notes, tags, and tagged teammates
echo   - leaver flags and replay codes
echo   - review state and queue / play-mode overrides
echo   - hidden-match flags
echo(
echo Safe and untouched: your screenshots folder and settings. Recall
echo re-parses the screenshots and rebuilds the database on next launch.
echo(

if defined FORCE goto confirmed
set /p "ANS=Delete it? [y/N] "
if /I not "%ANS%"=="y" goto aborted
:confirmed

rem --- Back up the db trio (.db + WAL sidecars) unless /nobackup ---
if defined NOBACKUP goto delete
for %%D in ("%DB%") do set "DBDIR=%%~dpD"
set "BACKDIR=%DBDIR%backups"
for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"`) do set "STAMP=%%T"
if not exist "%BACKDIR%" mkdir "%BACKDIR%"
copy /Y "%DB%" "%BACKDIR%\recall-%STAMP%.db" >NUL
if exist "%DB%-wal" copy /Y "%DB%-wal" "%BACKDIR%\recall-%STAMP%.db-wal" >NUL
if exist "%DB%-shm" copy /Y "%DB%-shm" "%BACKDIR%\recall-%STAMP%.db-shm" >NUL
echo Backed up to: %BACKDIR%\recall-%STAMP%.db
echo To restore later, copy that recall-*.db trio back over recall.db.

:delete
del /F /Q "%DB%" >NUL 2>&1
if exist "%DB%-wal" del /F /Q "%DB%-wal" >NUL 2>&1
if exist "%DB%-shm" del /F /Q "%DB%-shm" >NUL 2>&1
echo(
echo Done. Launch Recall to start fresh.
goto done

:usage
echo Reset-Database.bat - wipe Recall's match database (backs up first).
echo(
echo   Reset-Database.bat            confirm, back up, then delete
echo   Reset-Database.bat /force     skip the confirmation prompt
echo   Reset-Database.bat /nobackup  delete without backing up first
goto done

:aborted
echo Aborted - nothing was changed.

:done
echo(
pause
endlocal
exit /b 0
