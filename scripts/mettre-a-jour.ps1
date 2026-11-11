# ============================================================================
#  MOUGNIER TRANSPORT - mise a jour du programme installe, SANS droits administrateur.
#      powershell -ExecutionPolicy Bypass -File scripts\mettre-a-jour.ps1
#  (ou double-clic sur scripts\mettre-a-jour.cmd)
#
#  1. lance tous les tests du projet : s'il y a un echec, rien n'est touche ;
#  2. copie le programme dans C:\MT\transport\app ;
#  3. demande au serveur de s'arreter (fichier C:\MT\transport\redemarrer.txt) :
#     le superviseur le relance avec le nouveau programme ; puis verifie qu'un
#     NOUVEAU serveur repond.
#  La base, les fichiers deposes et les sauvegardes ne sont pas touches (la base se
#  met a niveau toute seule au redemarrage si le programme l'exige).
#  installer.cmd reste necessaire pour une premiere installation, pour changer les
#  taches planifiees, ou si scripts\superviseur.js lui-meme change.
# ============================================================================
$ErrorActionPreference = 'Stop'

$Projet     = Split-Path -Parent $PSScriptRoot
$Racine     = 'C:\MT\transport'
$App        = Join-Path $Racine 'app'
$Signal     = Join-Path $Racine 'redemarrer.txt'
$Tache      = 'MT Transport - serveur'
$Adresse    = 'http://127.0.0.1:3210/connexion'
if (-not (Test-Path (Join-Path $App 'scripts\superviseur.js'))) {
    throw "Le superviseur n'est pas installe : lance une fois scripts\installer.cmd (droits administrateur)."
}
$ecoute = { Get-NetTCPConnection -LocalPort 3210 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess }

# --- 1. Tests --------------------------------------------------------------------
Write-Host 'Tests du programme...'
Push-Location $Projet
try { $sortie = (& node --test 2>&1 | Out-String); $code = $LASTEXITCODE } finally { Pop-Location }
($sortie -split "`r?`n") | Where-Object { $_ -match '^\S+ (tests|pass|fail) \d+' } | ForEach-Object { Write-Host "  $_" }
if ($code -ne 0) { throw 'Des tests echouent : la plateforme n a pas ete touchee.' }

# --- 2. Copie du programme (le serveur en marche garde l'ancien en memoire) ----------
Write-Host "Copie du programme dans $App..."
robocopy $Projet $App /MIR /XD .git .claude .superpowers docs tests /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "La copie a echoue (robocopy, code $LASTEXITCODE)." }

# --- 3. Redemarrage par le superviseur, puis verification ------------------------------
$avant = & $ecoute
if ((Get-ScheduledTask -TaskName $Tache).State -ne 'Running') { Start-ScheduledTask -TaskName $Tache }
Set-Content -Path $Signal -Value (Get-Date -Format o) -Encoding ascii
Write-Host 'Redemarrage du serveur...'
$nouveau = $null
foreach ($essai in 1..30) {
    Start-Sleep -Seconds 2
    $pid3210 = & $ecoute
    if ($pid3210 -and $pid3210 -ne $avant) {
        try { Invoke-WebRequest -Uri $Adresse -UseBasicParsing -TimeoutSec 3 | Out-Null; $nouveau = $pid3210; break } catch { }
    }
}
if (-not $nouveau) { throw "Aucun nouveau serveur ne repond apres 60 secondes. Journal : C:\MT\transport\logs\serveur.log" }
Write-Host "OK : plateforme mise a jour et relancee (processus $nouveau)." -ForegroundColor Green
