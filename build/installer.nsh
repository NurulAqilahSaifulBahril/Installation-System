; electron-builder only wires shortcut creation to the interactive
; finish-page checkbox, which a silent install never shows. That is exactly
; how the auto-updater installs a new version (quitAndInstall(true, true) in
; electron/main.cjs runs the installer with /S), so a routine update was
; silently uninstalling the old shortcuts and never putting new ones back.
;
; customInstall runs unconditionally as part of the main install section —
; interactive or silent, fresh install or update — so creating the shortcuts
; here instead makes them survive every install path.
!macro customInstall
  CreateShortCut "$DESKTOP\Installation System.lnk" "$INSTDIR\Installation System.exe"
  CreateShortCut "$SMPROGRAMS\Installation System.lnk" "$INSTDIR\Installation System.exe"
!macroend
