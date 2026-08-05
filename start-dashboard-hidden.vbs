' Launches start-dashboard.bat with no visible console window.
' Invoked by the "EternalgyInstallationDashboard" scheduled task at logon.
Dim shell, fso, here
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = here
' 0 = hidden window, False = do not wait for the server to exit
shell.Run """" & here & "\start-dashboard.bat""", 0, False
