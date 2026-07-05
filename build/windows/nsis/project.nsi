Unicode true

####
## Please note: Template replacements don't work in this file. They are provided with default defines like
## mentioned underneath.
## If the keyword is not defined, "wails_tools.nsh" will populate them.
## If they are defined here, "wails_tools.nsh" will not touch them. This allows you to use this project.nsi manually
## from outside of Wails for debugging and development of the installer.
## 
## For development first make a wails nsis build to populate the "wails_tools.nsh":
## > wails build --target windows/amd64 --nsis
## Then you can call makensis on this file with specifying the path to your binary:
## For a AMD64 only installer:
## > makensis -DARG_WAILS_AMD64_BINARY=..\..\bin\app.exe
## For a ARM64 only installer:
## > makensis -DARG_WAILS_ARM64_BINARY=..\..\bin\app.exe
## For a installer with both architectures:
## > makensis -DARG_WAILS_AMD64_BINARY=..\..\bin\app-amd64.exe -DARG_WAILS_ARM64_BINARY=..\..\bin\app-arm64.exe
####
## The following information is taken from the wails_tools.nsh file, but they can be overwritten here.
####
## !define INFO_PROJECTNAME    "my-project" # Default "recall"
## !define INFO_COMPANYNAME    "My Company" # Default "My Company"
## !define INFO_PRODUCTNAME    "My Product Name" # Default "My Product"
## !define INFO_PRODUCTVERSION "1.0.0"     # Default "0.1.0"
## !define INFO_COPYRIGHT      "(c) Now, My Company" # Default "© 2026, My Company"
###
## !define PRODUCT_EXECUTABLE  "Application.exe"      # Default "${INFO_PROJECTNAME}.exe"
## !define UNINST_KEY_NAME     "UninstKeyInRegistry"  # Default "${INFO_COMPANYNAME}${INFO_PRODUCTNAME}"
####
## !define REQUEST_EXECUTION_LEVEL "admin"            # Default "admin"  see also https://nsis.sourceforge.io/Docs/Chapter4.html
## !define WAILS_INSTALL_SCOPE     "user"             # Default "machine" - set to "user" for per-user install ($LOCALAPPDATA) without UAC prompt
####
## Real app identity — defined here so wails_tools.nsh's !ifndef defaults (the
## "My Company"/"My Product" placeholders) don't apply. Without these the
## installer lands in $PROGRAMFILES64\My Company\My Product and registers a
## "My Product" entry. Keep in sync with build/config.yml.
####
!define INFO_COMPANYNAME "sound-barrier"
!define INFO_PRODUCTNAME "Recall"
!define INFO_COPYRIGHT   "© 2026 sound-barrier"
####
## Include the wails tools
####
!include "wails_tools.nsh"

####
## Migration: remove a prior machine-wide (Program Files) install.
##
## Recall moved from machine scope to per-user ($LOCALAPPDATA\Programs\Recall)
## so the in-app self-updater can swap the running exe in place — Program Files
## isn't writable without elevation. A per-user (unelevated) installer can't
## delete Program Files or HKLM keys, so it runs the OLD uninstaller: that
## uninstaller's own admin manifest raises exactly ONE UAC prompt via
## ShellExecute (ExecShellWait; a plain ExecWait/CreateProcess would fail with
## ERROR_ELEVATION_REQUIRED). The old uninstaller removes the app files, the
## HKLM Add/Remove-Programs entry, and the all-users shortcuts. `_?=` runs it
## in place synchronously; a running uninstall.exe can't self-delete, so an
## inert uninstall.exe + its folder may linger in Program Files (no registry
## entry — harmless). On UAC decline we warn and continue: aborting the
## per-user install would strand the user worse than a temporary dual install.
####
!define OLD_UNINST_ROOT "Software\Microsoft\Windows\CurrentVersion\Uninstall"

!macro tryRemoveMachineKey KEYNAME
    SetRegView 64
    ReadRegStr $R0 HKLM "${OLD_UNINST_ROOT}\${KEYNAME}" "UninstallString"
    ${If} $R0 != ""
        ; DisplayIcon is the UNQUOTED "$INSTDIR\<exe>" — clean for GetParent
        ; (UninstallString is quoted). GetParent works here the same way the
        ; already-used ${GetSize} does (both from the FileFunc.nsh include).
        ReadRegStr $R1 HKLM "${OLD_UNINST_ROOT}\${KEYNAME}" "DisplayIcon"
        ${GetParent} "$R1" $R2
        ${If} ${FileExists} "$R2\uninstall.exe"
            DetailPrint "Removing previous machine-wide install: $R2"
            ExecShellWait "" "$R2\uninstall.exe" '/S _?=$R2'
            Delete "$R2\uninstall.exe"   ; best-effort; unelevated remove of a
            RMDir "$R2"                   ; Program Files path may fail — fine
        ${EndIf}
    ${EndIf}
!macroend

!macro tryRemoveMachineDir OLDDIR
    ${If} ${FileExists} "${OLDDIR}\uninstall.exe"
        DetailPrint "Removing previous machine-wide install: ${OLDDIR}"
        ExecShellWait "" "${OLDDIR}\uninstall.exe" '/S _?=${OLDDIR}'
        Delete "${OLDDIR}\uninstall.exe"
        RMDir "${OLDDIR}"
    ${EndIf}
!macroend

!macro removeMachineScopeInstall
    ; Registry-driven for the current identity and the pre-identity-fix
    ; scaffold identity (b37230d0 set "sound-barrier"/"Recall"; before it the
    ; wails scaffold used "My Company"/"My Product").
    !insertmacro tryRemoveMachineKey "sound-barrierRecall"
    !insertmacro tryRemoveMachineKey "My CompanyMy Product"
    ; Dir-probe fallbacks for installs whose registry key is already gone.
    !insertmacro tryRemoveMachineDir "$PROGRAMFILES64\sound-barrier\Recall"
    !insertmacro tryRemoveMachineDir "$PROGRAMFILES64\My Company\My Product"
    !insertmacro tryRemoveMachineDir "$PROGRAMFILES64\Recall"
    RMDir "$PROGRAMFILES64\sound-barrier"   ; empty company dir, best-effort
    RMDir "$PROGRAMFILES64\My Company"

    ; If a machine key survived (user declined the UAC prompt), warn but don't
    ; abort. /SD IDOK keeps silent installs unblocked.
    SetRegView 64
    ReadRegStr $R0 HKLM "${OLD_UNINST_ROOT}\sound-barrierRecall" "UninstallString"
    ReadRegStr $R1 HKLM "${OLD_UNINST_ROOT}\My CompanyMy Product" "UninstallString"
    ${If} $R0 != ""
    ${OrIf} $R1 != ""
        MessageBox MB_OK|MB_ICONEXCLAMATION "A previous machine-wide copy of Recall could not be removed automatically. Please uninstall the old Recall from Settings > Apps (Add/Remove Programs) when convenient." /SD IDOK
    ${EndIf}
!macroend

####
## Close any running Recall before touching files.
##
## Recall's window-close hook hides the app to the tray and keeps the process
## alive as the background screenshots watcher (pkg/cmd/systray.go,
## ExitOnClose defaults false) — so the user can believe they "closed" Recall
## while recall.exe is still running. An in-place per-user upgrade (or the
## uninstaller's RMDir) then can't overwrite the locked exe and NSIS aborts with
## "Error opening file for writing: ...\recall.exe". A graceful WM_CLOSE is no
## use here: the app's own close hook cancels it (that's the hide-to-tray
## behavior), so we force-terminate the process tree (/T also takes the child
## WebView2 host processes) and pause to let the file handles release before the
## File writes. Matches on image name, so it clears a running copy in either
## scope; the installer's own image is recall-<arch>-installer.exe, which never
## matches recall.exe.
####
!macro closeRunningRecall
    DetailPrint "Closing any running Recall instance…"
    ExecWait '"$SYSDIR\taskkill.exe" /F /T /IM "${PRODUCT_EXECUTABLE}"'
    Sleep 1000
!macroend

# The version information for this two must consist of 4 parts
VIProductVersion "${INFO_PRODUCTVERSION}.0"
VIFileVersion    "${INFO_PRODUCTVERSION}.0"

VIAddVersionKey "CompanyName"     "${INFO_COMPANYNAME}"
VIAddVersionKey "FileDescription" "${INFO_PRODUCTNAME} Installer"
VIAddVersionKey "ProductVersion"  "${INFO_PRODUCTVERSION}"
VIAddVersionKey "FileVersion"     "${INFO_PRODUCTVERSION}"
VIAddVersionKey "LegalCopyright"  "${INFO_COPYRIGHT}"
VIAddVersionKey "ProductName"     "${INFO_PRODUCTNAME}"

# Enable HiDPI support. https://nsis.sourceforge.io/Reference/ManifestDPIAware
ManifestDPIAware true

!include "MUI.nsh"

!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"
# !define MUI_WELCOMEFINISHPAGE_BITMAP "resources\leftimage.bmp" #Include this to add a bitmap on the left side of the Welcome Page. Must be a size of 164x314
!define MUI_FINISHPAGE_NOAUTOCLOSE # Wait on the INSTFILES page so the user can take a look into the details of the installation steps
!define MUI_ABORTWARNING # This will warn the user if they exit from the installer.

!insertmacro MUI_PAGE_WELCOME # Welcome to the installer page.
# !insertmacro MUI_PAGE_LICENSE "resources\eula.txt" # Adds a EULA page to the installer
!insertmacro MUI_PAGE_DIRECTORY # In which folder install page.
!insertmacro MUI_PAGE_INSTFILES # Installing page.
!insertmacro MUI_PAGE_FINISH # Finished installation page.

!insertmacro MUI_UNPAGE_INSTFILES # Uninstalling page

!insertmacro MUI_LANGUAGE "English" # Set the Language of the installer

## The following two statements can be used to sign the installer and the uninstaller. The path to the binaries are provided in %1
#!uninstfinalize 'signtool --file "%1"'
#!finalize 'signtool --file "%1"'

Name "${INFO_PRODUCTNAME}"
OutFile "..\..\..\bin\${INFO_PROJECTNAME}-${ARCH}-installer.exe" # Name of the installer's file.
!if "${WAILS_INSTALL_SCOPE}" == "user"
    InstallDir "$LOCALAPPDATA\Programs\${INFO_PRODUCTNAME}"
!else
    InstallDir "$PROGRAMFILES64\${INFO_COMPANYNAME}\${INFO_PRODUCTNAME}"
!endif
ShowInstDetails show # This will always show the installation details.

Function .onInit
   !insertmacro wails.checkArchitecture
FunctionEnd

Section
    !insertmacro wails.setShellContext

    ; A running Recall (tray watcher) locks recall.exe and fails the upgrade
    ; with "Error opening file for writing" — close it before any file writes.
    !insertmacro closeRunningRecall

    ; Per-user installs first clear any prior machine-wide (Program Files)
    ; copy so there's exactly one install and it can self-update in place.
    !if "${WAILS_INSTALL_SCOPE}" == "user"
        !insertmacro removeMachineScopeInstall
    !endif

    !insertmacro wails.webview2runtime

    SetOutPath $INSTDIR

    !insertmacro wails.files

    ; The DB-reset helper documented in docs/install-windows.md. Bundled next
    ; to the app; uninstall's RMDir /r $INSTDIR removes it.
    File "/oname=Reset-Database.bat" "..\..\..\scripts\windows\Reset-Database.bat"

    CreateShortcut "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"
    CreateShortCut "$DESKTOP\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"

    !insertmacro wails.associateFiles
    !insertmacro wails.associateCustomProtocols
    
    !insertmacro wails.writeUninstaller
SectionEnd

Section "uninstall"
    !insertmacro wails.setShellContext

    ; A running tray instance locks recall.exe; without this the RMDir below
    ; silently leaves the exe (and the live process) behind.
    !insertmacro closeRunningRecall

    RMDir /r "$AppData\${PRODUCT_EXECUTABLE}" # Remove the WebView2 DataPath

    RMDir /r $INSTDIR

    Delete "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk"
    Delete "$DESKTOP\${INFO_PRODUCTNAME}.lnk"

    !insertmacro wails.unassociateFiles
    !insertmacro wails.unassociateCustomProtocols

    !insertmacro wails.deleteUninstaller
SectionEnd
