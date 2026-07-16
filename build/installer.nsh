; Custom NSIS installer include for IndexArc.
;
; DATA-SAFETY GUARANTEE:
;   User vault data lives in <installDir>\data, <installDir>\config and
;   <installDir>\logs. The installer MUST NEVER delete these on update or
;   uninstall so users never lose their secrets when reinstalling/updating.
;
; Default install location = current user's profile folder, e.g.
; C:\Users\<user>\.IndexArc  (writable, no admin rights needed, and the
; vault data written next to the exe is always writable).

!macro preInit
  ; Reuse the previously installed location (if any) so an update/reinstall
  ; lands in the SAME folder and finds the existing data/ vault. Only fall
  ; back to the profile default the very first time.
  ReadRegStr $R0 HKCU "Software\IndexArc" "InstallLocation"
  ${If} $R0 == ""
    StrCpy $R0 "$PROFILE"
    StrCpy $R0 "$R0\.IndexArc"
  ${EndIf}
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$R0"
!macroend

; --- UPDATE SAFETY -------------------------------------------------------
; When upgrading, electron-builder copies files into the existing install
; dir. We must ensure our user-data folders are preserved if the user
; somehow changes the directory, and are explicitly excluded from the
; uninstaller's file removal list.
!macro customInstall
  ; Persist the chosen install dir so a later update/reinstall lands in the
  ; SAME folder (and thus finds the existing data/ folder).
  WriteRegStr HKCU "Software\IndexArc" "InstallLocation" "$INSTDIR"
!macroend

!macro customUnInstall
  ; Do NOT remove the user's vault. Leave data/, config/ and logs/ behind.
  ; (electron-builder's generated uninstaller removes program files only.)
!macroend

; Prevent the generated uninstaller from deleting user data by excluding
; those subfolders from the file removal set.
!macro RM_EXCLUDE dir
  ${If} ${FileExists} "$INSTDIR\${dir}\*.*"
    ; Keep the directory; nothing to delete.
  ${EndIf}
!macroend
