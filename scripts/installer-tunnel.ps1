# ============================================================================
#  MOUGNIER TRANSPORT - branche ce PC au tunnel Cloudflare "mt-srv01-transport"
#  (adresse publique protegee : transport.mougniertech.com).
#  Lance par installer-tunnel.cmd, avec les droits administrateur.
#
#  Ce script :
#   - installe cloudflared, le programme officiel de Cloudflare (via winget) ;
#   - lit dans le presse-papiers la commande copiee avec le bouton de Cloudflare
#     et n'en garde que la cle du tunnel (ecrite dans aucun fichier, effacee
#     du presse-papiers ensuite) ;
#   - installe le service Windows "cloudflared", qui demarre avec Windows.
#  Il n'ouvre aucun port : le PC se connecte lui-meme a Cloudflare.
# ============================================================================
$ErrorActionPreference = 'Stop'

$estAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $estAdmin) { throw "Lance installer-tunnel.cmd (double-clic) : il demande lui-meme les droits administrateur." }

function Trouver-Cloudflared {
    @("${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe", "$env:ProgramFiles\cloudflared\cloudflared.exe") |
        Where-Object { Test-Path $_ } | Select-Object -First 1
}

# --- 1. Le programme cloudflared ---------------------------------------------
$exe = Trouver-Cloudflared
if (-not $exe) {
    Write-Host 'Installation de cloudflared (programme officiel de Cloudflare)...'
    Write-Host 'Si winget pose une question sur les conditions, reponds Y puis Entree.'
    winget install --id Cloudflare.cloudflared --exact --source winget
    $exe = Trouver-Cloudflared
    if (-not $exe) { throw "cloudflared n'a pas pu etre installe. Envoie une capture de cette fenetre." }
}
Write-Host "cloudflared : $exe"

# --- 2. La cle du tunnel ------------------------------------------------------
# Lue dans le presse-papiers apres un clic sur le bouton COPIER de Cloudflare : rien a coller a la main.
function Lire-Cle([string]$texte) {
    "$texte" -split '\s+' | Where-Object { $_ -match '^eyJ[A-Za-z0-9_\-=.]+$' } | Select-Object -Last 1
}
Write-Host ''
Write-Host 'En attente de la cle du tunnel : dans Chrome, onglet Cloudflare, petit carre COPIER de l etape 4.' -ForegroundColor Yellow
$cle = $null
foreach ($seconde in 1..600) {
    $cle = Lire-Cle (Get-Clipboard -Raw -ErrorAction SilentlyContinue)
    if ($cle) { break }
    Start-Sleep -Seconds 1
}
if (-not $cle) { throw "Aucune cle copiee en 10 minutes. Relance installer-tunnel.cmd." }
Set-Clipboard -Value ' ' # la cle ne reste pas dans le presse-papiers
Write-Host 'Cle recue.'

# --- 3. Le service Windows ----------------------------------------------------
if (Get-Service cloudflared -ErrorAction SilentlyContinue) {
    Write-Host 'Un service cloudflared existe deja : il est remplace.'
    & $exe service uninstall
    Start-Sleep -Seconds 3
}
& $exe service install $cle
$cle = $null

$service = $null
foreach ($essai in 1..10) {
    Start-Sleep -Seconds 2
    $service = Get-Service cloudflared -ErrorAction SilentlyContinue
    if ($service -and $service.Status -eq 'Running') { break }
}
if (-not $service -or $service.Status -ne 'Running') { throw "Le service cloudflared ne demarre pas. Envoie une capture de cette fenetre." }
Set-Service cloudflared -StartupType Automatic
Write-Host ''
Write-Host 'OK : le tunnel est installe et demarre avec Windows.' -ForegroundColor Green
Write-Host 'Dans Cloudflare, sous "Etat de la connexion", le PC doit apparaitre comme connecte.'
