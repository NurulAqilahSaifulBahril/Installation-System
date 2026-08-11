' Launches start-dashboard.bat with no visible console window.
' Invoked by the "EternalgyInstallationDashboard" scheduled task at logon.
Dim shell, fso, here
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = here
' Tells start-dashboard.bat this is a silent watchdog run, so it never opens
' a browser tab on its own (unlike a manual double-click).
shell.Environment("PROCESS")("DASHBOARD_WATCHDOG") = "1"
' 0 = hidden window, False = do not wait for the server to exit
shell.Run """" & here & "\start-dashboard.bat""", 0, False
