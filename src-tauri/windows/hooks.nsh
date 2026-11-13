; Profile Hub installer hooks (Tauri NSIS, per-machine install).
; Every profile is a separate Windows account, therefore:
;  * Hub must start at sign-in of ANY account -> Run key in HKLM;
;  * the config is shared by all accounts     -> C:\ProgramData\ProfileHub writable by BUILTIN\Users.

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "ProfileHub" '"$INSTDIR\profile-hub.exe" --autostart'
  ReadEnvStr $0 "PROGRAMDATA"
  CreateDirectory "$0\ProfileHub"
  ; *S-1-5-32-545 = BUILTIN\Users (language independent)
  nsExec::Exec 'icacls "$0\ProfileHub" /grant *S-1-5-32-545:(OI)(CI)M /T /C /Q'
  Pop $1
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "ProfileHub"
!macroend
