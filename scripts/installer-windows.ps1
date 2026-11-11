# ============================================================================
#  MOUGNIER TRANSPORT - mise en service sur Windows (MT-SRV01)
#  A lancer dans PowerShell ouvert "en tant qu'administrateur", avec TON compte
#  Windows habituel (celui qui a OneDrive) :
#      powershell -ExecutionPolicy Bypass -File scripts\installer-windows.ps1
#  A relancer apres chaque mise a jour du code : il recopie le programme.
#
#  Ce script :
#   - copie le programme dans C:\MT\transport\app (hors OneDrive, pour qu'il
#     demarre meme quand OneDrive n'est pas lance) ;
#   - cree le dossier de la base, celui des photos et documents deposes, celui
#     des journaux et celui des sauvegardes ;
#   - cree deux taches planifiees : le serveur au demarrage de Windows,
#     et la sauvegarde tous les jours a 20 h ;
#   - verifie que la plateforme repond et qu'une sauvegarde s'ecrit.
#  Il n'installe pas Tailscale et n'ouvre aucun port dans le pare-feu.
# ============================================================================
$ErrorActionPreference = 'Stop'

$Projet      = Split-Path -Parent $PSScriptRoot
$Racine      = 'C:\MT\transport'
$App         = Join-Path $Racine 'app'
$Donnees     = Join-Path $Racine 'data'
$Fichiers    = Join-Path $Racine 'fichiers'
$Journaux    = Join-Path $Racine 'logs'
$OneDrive    = if ($env:OneDrive) { $env:OneDrive } else { $env:USERPROFILE }
$Sauvegardes = Join-Path $OneDrive 'Sauvegardes\MT-Transport'
$Node        = (Get-Command node -ErrorAction Stop).Source
$Utilisateur = "$env:USERDOMAIN\$env:USERNAME"
$Adresse     = 'http://127.0.0.1:3210/connexion'

$estAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $estAdmin) { throw "Ouvre PowerShell 'en tant qu'administrateur' puis relance ce script." }
if (-not (Test-Path (Join-Path $Projet 'node_modules\express'))) { throw "Lance d'abord 'npm install' dans $Projet." }

Write-Host "Compte Windows  : $Utilisateur"
Write-Host "Programme       : $App"
Write-Host "Base de donnees : $Donnees"
Write-Host "Fichiers        : $Fichiers"
Write-Host "Sauvegardes     : $Sauvegardes"
New-Item -ItemType Directory -Force $App, $Donnees, $Fichiers, $Journaux, $Sauvegardes | Out-Null

# Le serveur doit etre arrete pendant la copie du programme.
Stop-ScheduledTask -TaskName 'MT Transport - serveur' -ErrorAction SilentlyContinue
# Arreter la tache ne tue pas les programmes qu'elle a lances : le superviseur d'abord (sinon il relancerait le serveur)...
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'superviseur\.js' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1
# ... puis tout serveur qui occupe encore le port 3210 (lance par la tache ou a la main), sinon le nouveau ne pourrait pas demarrer.
Get-NetTCPConnection -LocalPort 3210 -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    $processus = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
    if ($processus -and $processus.ProcessName -eq 'node') { Stop-Process -Id $processus.Id -Force }
}
robocopy $Projet $App /MIR /XD .git .claude .superpowers docs tests /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "La copie du programme vers $App a echoue (robocopy, code $LASTEXITCODE)." }

# Les deux taches lisent ces reglages (variables d'environnement de l'utilisateur).
[Environment]::SetEnvironmentVariable('MT_DATA_DIR', $Donnees, 'User')
[Environment]::SetEnvironmentVariable('MT_BACKUP_DIR', $Sauvegardes, 'User')
[Environment]::SetEnvironmentVariable('MT_FILES_DIR', $Fichiers, 'User')

# S4U : la tache tourne meme si personne n'a ouvert de session, sans mot de passe enregistre.
$Compte = New-ScheduledTaskPrincipal -UserId $Utilisateur -LogonType S4U -RunLevel Limited
# cmd /c ... >> journal : ce que le serveur ecrit (erreurs comprises) est garde dans un fichier.
$Commande = { param($Script, $Journal) "/c `"`"$Node`" $Script >> `"$Journaux\$Journal`" 2>&1`"" }

# Le superviseur lance le serveur et le relance a chaque arret : une mise a jour se fait ensuite sans droits administrateur.
$Serveur = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument (& $Commande 'scripts\superviseur.js' 'serveur.log') -WorkingDirectory $App
$ReglagesServeur = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName 'MT Transport - serveur' -Force -Principal $Compte -Action $Serveur `
    -Trigger (New-ScheduledTaskTrigger -AtStartup) -Settings $ReglagesServeur `
    -Description 'Plateforme MOUGNIER TRANSPORT (http://127.0.0.1:3210)' | Out-Null

$Sauvegarde = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument (& $Commande 'scripts\sauvegarde.js' 'sauvegarde.log') -WorkingDirectory $App
$ReglagesSauvegarde = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName 'MT Transport - sauvegarde' -Force -Principal $Compte -Action $Sauvegarde `
    -Trigger (New-ScheduledTaskTrigger -Daily -At '20:00') -Settings $ReglagesSauvegarde `
    -Description 'Copie quotidienne de la base MOUGNIER TRANSPORT dans OneDrive (30 jours gardes)' | Out-Null

# --- Verification 1 : la plateforme repond-elle vraiment ? ---------------------
Start-ScheduledTask -TaskName 'MT Transport - serveur'
$repond = $false
foreach ($essai in 1..15) {
    Start-Sleep -Seconds 2
    try { Invoke-WebRequest -Uri $Adresse -UseBasicParsing -TimeoutSec 3 | Out-Null; $repond = $true; break } catch { }
}
if (-not $repond) { throw "La plateforme ne repond pas sur $Adresse. Regarde le journal : $Journaux\serveur.log" }
Write-Host "OK : la plateforme repond sur $Adresse" -ForegroundColor Green

# --- Verification 2 : une sauvegarde s'ecrit-elle ? ----------------------------
Start-ScheduledTask -TaskName 'MT Transport - sauvegarde'
$copie = Join-Path $Sauvegardes ("transport-{0}.db" -f (Get-Date -Format 'yyyy-MM-dd'))
foreach ($essai in 1..10) { Start-Sleep -Seconds 2; if (Test-Path $copie) { break } }
if (-not (Test-Path $copie)) { throw "La sauvegarde ne s'est pas ecrite dans $Sauvegardes. Regarde le journal : $Journaux\sauvegarde.log" }
Write-Host "OK : sauvegarde ecrite dans $copie" -ForegroundColor Green

Write-Host ''
Write-Host 'Termine. Etape suivante : README.md, partie "Acces a distance avec Tailscale".'
