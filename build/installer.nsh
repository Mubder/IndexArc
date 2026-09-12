; Custom NSIS installer include for IndexArc.
;
; DATA-SAFETY GUARANTEE:
;   User vault data lives in <installDir>\data, <installDir>\config,
;   <installDir>\logs and <installDir>\backups. electron-builder's stock
;   uninstaller ends with `RMDir /r $INSTDIR` — it deletes the ENTIRE install
;   folder, user data included. Worse: the new Setup runs that uninstaller
;   silently (with --updated) before every reinstall/update, which is exactly
;   how users lost their vault on reinstall.
;
;   Defining `customRemoveFiles` REPLACES the stock removal below (see
;   uninstaller.nsh in app-builder-lib: `!ifmacrodef customRemoveFiles … !else
;   … RMDir /r $INSTDIR`), so the macro below is what actually enforces the
;   guarantee: program files are removed, the data folders survive.
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

!macro customInstall
  ; Persist the chosen install dir so a later update/reinstall lands in the
  ; SAME folder (and thus finds the existing data/ folder).
  WriteRegStr HKCU "Software\IndexArc" "InstallLocation" "$INSTDIR"
!macroend

!macro customUnInstall
  ; User-data folders are preserved by customRemoveFiles below (this macro
  ; exists for other side effects; there are none).
!macroend

; Replacement for the stock `RMDir /r $INSTDIR`: walk the install folder and
; delete everything EXCEPT the user-data folders. Runs on explicit uninstall
; AND on the silent uninstall that precedes every reinstall/update.
; NOTE: only files/folders shipped by the installer plus the running
; uninstaller live here otherwise, so the enumeration is complete.
!macro customRemoveFiles
  Push $R0
  Push $R1
  Push $R2

  ; A running exe can be renamed but not deleted — move the uninstaller out
  ; of $INSTDIR (into the installer's temp dir) so the folder can be removed
  ; when nothing else remains.
  CreateDirectory "$PLUGINSDIR\old-install"
  ClearErrors
  Rename "$INSTDIR\${UNINSTALL_FILENAME}" "$PLUGINSDIR\old-install\${UNINSTALL_FILENAME}"
  ClearErrors

  FindFirst $R1 $R2 "$INSTDIR\*.*"
  ia_keep_files_loop:
    StrCmp $R2 "" ia_keep_files_done
    StrCmp $R2 "." ia_keep_files_next
    StrCmp $R2 ".." ia_keep_files_next
    ; ── user data folders: NEVER delete ──
    StrCmp $R2 "data" ia_keep_files_next
    StrCmp $R2 "config" ia_keep_files_next
    StrCmp $R2 "logs" ia_keep_files_next
    StrCmp $R2 "backups" ia_keep_files_next
    StrCmp $R2 "tmp" ia_keep_files_next
    IfFileExists "$INSTDIR\$R2\*.*" ia_keep_files_isdir ia_keep_files_isfile
    ia_keep_files_isdir:
      RMDir /r "$INSTDIR\$R2"
      Goto ia_keep_files_next
    ia_keep_files_isfile:
      Delete "$INSTDIR\$R2"
    ia_keep_files_next:
      FindNext $R1 $R2
      Goto ia_keep_files_loop
  ia_keep_files_done:
    FindClose $R1

  Pop $R2
  Pop $R1
  Pop $R0

  ; Remove $INSTDIR only if it is now empty (i.e. no vault data kept it
  ; alive) — a plain RMDir never recurses into data/.
  SetOutPath $TEMP
  RMDir "$INSTDIR"
!macroend
