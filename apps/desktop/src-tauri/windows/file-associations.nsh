; Runtime owns per-user handlers. The installer must not select file defaults.
; BUNDLEID is supplied by Tauri, including isolated development/test identities.
!macro READ_AWARE_REMOVE_OPEN_WITH EXT
  System::Call 'advapi32::RegOpenKeyExW(p 0x80000001, w "Software\Classes\.${EXT}\OpenWithProgids", i 0, i 2, *p .r1) i .r2'
  ${If} $2 == 0
    System::Call 'advapi32::RegDeleteValueW(p r1, w "${BUNDLEID}.Book") i .r2'
    System::Call 'advapi32::RegCloseKey(p r1)'
  ${EndIf}
  ${If} $2 != 0
  ${AndIf} $2 != 2
    MessageBox MB_OK|MB_ICONSTOP "Could not remove ReadAware file associations (Windows error $2). No application files have been removed."
    Abort
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Push $R0
  Push $1
  Push $2
  System::Call 'advapi32::RegOpenKeyExW(p 0x80000001, w "Software\Classes\${BUNDLEID}.Book", i 0, i 1, *p .r1) i .r2'
  ${If} $2 == 0
    System::Call 'advapi32::RegCloseKey(p r1)'
  ${ElseIf} $2 != 2
    MessageBox MB_OK|MB_ICONSTOP "Could not inspect ReadAware's file handler (Windows error $2). No application files have been removed."
    Abort
  ${EndIf}
  ReadRegStr $R0 HKCU "Software\Classes\${BUNDLEID}.Book" "ReadAwareOwner"
  ${If} $R0 == "${BUNDLEID}"
    !insertmacro READ_AWARE_REMOVE_OPEN_WITH "epub"
    !insertmacro READ_AWARE_REMOVE_OPEN_WITH "mobi"
    !insertmacro READ_AWARE_REMOVE_OPEN_WITH "prc"
    !insertmacro READ_AWARE_REMOVE_OPEN_WITH "azw3"
    !insertmacro READ_AWARE_REMOVE_OPEN_WITH "azw"
    !insertmacro READ_AWARE_REMOVE_OPEN_WITH "kf8"
    !insertmacro READ_AWARE_REMOVE_OPEN_WITH "fb2"
    !insertmacro READ_AWARE_REMOVE_OPEN_WITH "fbz"
    !insertmacro READ_AWARE_REMOVE_OPEN_WITH "cbz"
    !insertmacro READ_AWARE_REMOVE_OPEN_WITH "cbr"
    !insertmacro READ_AWARE_REMOVE_OPEN_WITH "txt"
    !insertmacro READ_AWARE_REMOVE_OPEN_WITH "html"
    !insertmacro READ_AWARE_REMOVE_OPEN_WITH "htm"
    !insertmacro READ_AWARE_REMOVE_OPEN_WITH "pdf"
    ClearErrors
    DeleteRegKey HKCU "Software\Classes\${BUNDLEID}.Book"
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "Could not remove ReadAware's file handler. No application files have been removed."
      Abort
    ${EndIf}
    System::Call "shell32::SHChangeNotify(i,i,p,p) (0x08000000, 0, 0, 0)"
  ${EndIf}
  Pop $2
  Pop $1
  Pop $R0
!macroend
