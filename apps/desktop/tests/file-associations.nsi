; Compile-only test of the production uninstall hook. Never run this installer.
!include LogicLib.nsh
!define BUNDLEID "com.readaware.app.capability-e2e"
!include "../src-tauri/windows/file-associations.nsh"
Name "ReadAware association hook compile test"
OutFile "${OUTPUT}"
RequestExecutionLevel user
Section
  WriteUninstaller "$TEMP\readaware-association-hook-uninstall.exe"
SectionEnd
Section "Uninstall"
  !insertmacro NSIS_HOOK_PREUNINSTALL
SectionEnd
