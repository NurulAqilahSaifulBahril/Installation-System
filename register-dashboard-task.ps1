# Run this as Administrator to (re)create the EternalgyInstallationDashboard
# scheduled task: starts the Installation Operations dashboard hidden at logon
# and re-runs it every 5 minutes as a health check (start-dashboard.bat is a
# no-op if the server is already listening on port 3000).

$vbsPath = "C:\Users\User\OneDrive\Documents\backup admin\1. Installation\start-dashboard-hidden.vbs"
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbsPath`""

$trigger = New-ScheduledTaskTrigger -AtLogOn
$repeatSrc = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$trigger.Repetition = $repeatSrc.Repetition

$principal = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\$env:USERNAME" -LogonType Interactive -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 0)

Register-ScheduledTask -TaskName "EternalgyInstallationDashboard" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Keeps the Eternalgy Installation Operations dashboard running on http://127.0.0.1:3000/. Starts hidden at logon and re-runs every 5 minutes as a health check." -Force

Write-Host "Registered. Starting it now as a smoke test..."
Start-ScheduledTask -TaskName "EternalgyInstallationDashboard"
Start-Sleep -Seconds 5
Get-ScheduledTaskInfo -TaskName "EternalgyInstallationDashboard" | Format-List LastRunTime,LastTaskResult,NextRunTime
