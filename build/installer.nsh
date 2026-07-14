; Custom NSIS installer include for IndexArc.
; Default install location = current user's profile folder, e.g.
; C:\Users\<user>\.IndexArc  (writable, no admin rights needed, and the
; vault data written next to the exe is always writable).

!macro preInit
  StrCpy $R0 "$PROFILE"
  StrCpy $R0 "$R0\.IndexArc"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$R0"
!macroend
