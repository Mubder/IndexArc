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

; ── `indexarc` command on the user's PATH ────────────────────────────────
; The CLI ships as resources\cli\indexarc.exe (a standalone binary, no Node
; needed). Install adds that folder to the CURRENT USER's PATH
; (HKCU\Environment, no admin rights); uninstall removes it. The uninstall
; that runs before every update removes it and the new install adds it back.
;
; Safety: the user's PATH is only rewritten when it was read in full. NSIS
; strings have a fixed maximum length (NSIS_MAX_STRLEN); a PATH that does not
; fit is left untouched rather than truncated, and the CLI can still be run
; by its full path. %VARIABLES% are kept: the value is read and written
; unexpanded (REG_EXPAND_SZ).
!include WinMessages.nsh

; $R5 = $R3 (a PATH value) without any segment equal to $R4 (case-insensitive,
; with or without a trailing backslash). Empty segments are dropped.
!macro IndexArcPathFilter
  Push $R6
  Push $R7
  Push $R8
  Push $R9
  StrCpy $R9 $R3
  StrCpy $R5 ""
  ${Do}
    ${If} $R9 == ""
      ${ExitDo}
    ${EndIf}
    StrLen $R8 $R9
    StrCpy $R6 0
    ${Do}
      ${If} $R6 >= $R8
        ${ExitDo}
      ${EndIf}
      StrCpy $R7 $R9 1 $R6
      ${If} $R7 == ";"
        ${ExitDo}
      ${EndIf}
      IntOp $R6 $R6 + 1
    ${Loop}
    StrCpy $R7 $R9 $R6
    IntOp $R6 $R6 + 1
    StrCpy $R9 $R9 "" $R6
    ${If} $R7 != ""
    ${AndIf} $R7 != $R4
    ${AndIf} $R7 != "$R4\"
      ${If} $R5 == ""
        StrCpy $R5 $R7
      ${Else}
        StrCpy $R5 "$R5;$R7"
      ${EndIf}
    ${EndIf}
  ${Loop}
  Pop $R9
  Pop $R8
  Pop $R7
  Pop $R6
!macroend

; ADD = 1 to add the CLI folder to the user PATH, 0 to remove it.
!macro IndexArcCliPath ADD
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  StrCpy $R4 "$INSTDIR\resources\cli"
  ClearErrors
  ReadRegStr $R3 HKCU "Environment" "Path"
  ${If} ${Errors}
    ; Missing, or longer than NSIS can hold: do not touch it.
    DetailPrint "IndexArc: the user PATH could not be read in full; it was not changed."
  ${Else}
    !insertmacro IndexArcPathFilter
    ${If} ${ADD} == 1
      ${If} $R5 == ""
        StrCpy $R5 $R4
      ${Else}
        StrCpy $R5 "$R5;$R4"
      ${EndIf}
    ${EndIf}
    StrLen $R2 $R5
    IntOp $R2 $R2 + 1
    ${If} $R2 >= ${NSIS_MAX_STRLEN}
      DetailPrint "IndexArc: the user PATH would be too long; it was not changed."
    ${ElseIf} $R5 S!= $R3
      WriteRegExpandStr HKCU "Environment" "Path" $R5
      SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
    ${EndIf}
  ${EndIf}
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
!macroend

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
  ; Put the `indexarc` command on the user's PATH.
  !insertmacro IndexArcCliPath 1
!macroend

!macro customUnInstall
  ; User-data folders are preserved by customRemoveFiles below. Here: take
  ; the `indexarc` command off the user's PATH (an update adds it back).
  !insertmacro IndexArcCliPath 0
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
