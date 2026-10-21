# Construit l'application Android (APK) d'Elegance Barber Shop à partir du site en ligne.
#
#   .\android\build-apk.ps1 -Url https://ADRESSE-DU-SITE
#
# L'APK est une « Trusted Web Activity » : le site s'ouvre en plein écran avec le moteur de Chrome
# (notifications comprises). Résultat :
#   public/download/elegance-barbershop.apk       → téléchargeable depuis le site
#   public/.well-known/assetlinks.json         → à mettre en ligne avec le site (deploy.ps1 le fait)
#
# ⚠️ Gardez précieusement android/elegance-barbershop.keystore et android/keystore-password.txt :
#    sans eux, impossible de publier une mise à jour de l'application.
param([Parameter(Mandatory = $true)][string]$Url)
$ErrorActionPreference = 'Stop'
# outils externes (keytool, npx) : ils écrivent leurs messages sur stderr, seul le code de sortie compte
function Native([scriptblock]$cmd) { $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { & $cmd 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $old } }
$here = $PSScriptRoot
$root = Split-Path $here -Parent
$uri = [uri]$Url
if ($uri.Scheme -ne 'https') { throw "L'adresse doit commencer par https://" }
$siteHost = $uri.Host
$origin = "https://$siteHost"
$packageId = 'tn.elegancebarbershop.app'
$alias = 'elegance'

# ----- Outils : JDK 17 et SDK Android -----
$jdk = @("C:\Program Files\Java\jdk-17", "C:\Program Files\Eclipse Adoptium\jdk-17*", "C:\Program Files\Microsoft\jdk-17*") |
  ForEach-Object { Get-Item $_ -ErrorAction SilentlyContinue } | Select-Object -First 1
if (-not $jdk) { throw 'JDK 17 introuvable (installez-le depuis https://adoptium.net)' }
# bubblewrap n'entoure pas le chemin de java de guillemets : lien sans espace (« Program Files ») vers le JDK
if ($jdk.FullName -match ' ') {
  $jdkLink = Join-Path $env:LOCALAPPDATA 'EleganceBarberShop\jdk17'
  New-Item -ItemType Directory -Force (Split-Path $jdkLink) | Out-Null
  if (-not (Test-Path $jdkLink)) { cmd /c mklink /J "$jdkLink" "$($jdk.FullName)" | Out-Null }
  $jdk = Get-Item $jdkLink
}
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
if (-not (Test-Path $sdk)) { throw "SDK Android introuvable ($sdk) : installez Android Studio" }
# Bubblewrap cherche sdkmanager dans <sdk>\bin (ancienne organisation du SDK) : lien vers cmdline-tools\latest\bin
$sdkBin = Join-Path $sdk 'bin'
$cmdBin = Join-Path $sdk 'cmdline-tools\latest\bin'
if (-not (Test-Path $sdkBin) -and -not (Test-Path (Join-Path $sdk 'tools')) -and (Test-Path $cmdBin)) {
  cmd /c mklink /J "$sdkBin" "$cmdBin" | Out-Null
}
$keytool = Join-Path $jdk.FullName 'bin\keytool.exe'
$bwDir = Join-Path $env:USERPROFILE '.bubblewrap'
New-Item -ItemType Directory -Force $bwDir | Out-Null
@{ jdkPath = $jdk.FullName; androidSdkPath = $sdk } | ConvertTo-Json | ForEach-Object { [IO.File]::WriteAllText((Join-Path $bwDir 'config.json'), $_) }

# ----- Clé de signature (créée une seule fois) -----
$keystore = Join-Path $here 'elegance-barbershop.keystore'
$passFile = Join-Path $here 'keystore-password.txt'
if (-not (Test-Path $keystore)) {
  Write-Host '==> Création de la clé de signature'
  $chars = [char[]]'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  $pass = -join (1..24 | ForEach-Object { $chars | Get-Random })
  [IO.File]::WriteAllText($passFile, $pass)
  Native { & $keytool -genkeypair -keystore $keystore -alias $alias -keyalg RSA -keysize 2048 -validity 10000 `
    -storepass $pass -keypass $pass -dname 'CN=Elegance Barber Shop, O=Elegance Barber Shop, C=TN' } | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'keytool a échoué' }
}
if (-not (Test-Path $passFile)) { throw "Mot de passe de la clé introuvable ($passFile)" }
$pass = [IO.File]::ReadAllText($passFile).Trim()
$sha = ((Native { & $keytool -list -v -keystore $keystore -alias $alias -storepass $pass }) | Select-String 'SHA256:').ToString().Split(' ', [StringSplitOptions]::RemoveEmptyEntries)[-1]

# ----- Numéro de version (augmente à chaque construction) -----
$verFile = Join-Path $here 'version.txt'
$code = if (Test-Path $verFile) { [int](Get-Content $verFile -Raw) + 1 } else { 1 }
[IO.File]::WriteAllText($verFile, [string]$code)
$version = "1.0.$code"

# ----- Projet Android -----
# construit hors de OneDrive : gradlew.bat ne démarre pas dans un dossier dont le chemin contient des accents
$proj = Join-Path $env:LOCALAPPDATA 'EleganceBarberShop\android-app'
New-Item -ItemType Directory -Force $proj | Out-Null
Copy-Item $keystore (Join-Path $proj 'signing.keystore') -Force
$twa = [ordered]@{
  packageId = $packageId; host = $siteHost; name = 'Elegance Barber Shop'; launcherName = 'Elegance Barber Shop'
  display = 'standalone'; orientation = 'portrait'; startUrl = '/'
  themeColor = '#ffffff'; themeColorDark = '#ffffff'; navigationColor = '#ffffff'; navigationColorDark = '#ffffff'
  navigationDividerColor = '#ffffff'; navigationDividerColorDark = '#ffffff'; backgroundColor = '#ffffff'
  enableNotifications = $true; enableSiteSettingsShortcut = $false; splashScreenFadeOutDuration = 300
  iconUrl = "$origin/icons/icon-512.png"; maskableIconUrl = "$origin/icons/icon-maskable.png"
  webManifestUrl = "$origin/manifest.webmanifest"; fullScopeUrl = "$origin/"
  signingKey = @{ path = (Join-Path $proj 'signing.keystore'); alias = $alias }
  appVersionName = $version; appVersionCode = $code; appVersion = $version
  shortcuts = @(); generatorApp = 'bubblewrap-cli'; fallbackType = 'customtabs'; features = @{}
  alphaDependencies = @{ enabled = $false }; isChromeOSOnly = $false; isMetaQuest = $false; minSdkVersion = 24
  fingerprints = @(); additionalTrustedOrigins = @(); retainedBundles = @()
}
[IO.File]::WriteAllText((Join-Path $proj 'twa-manifest.json'), ($twa | ConvertTo-Json -Depth 5))

$env:BUBBLEWRAP_KEYSTORE_PASSWORD = $pass
$env:BUBBLEWRAP_KEY_PASSWORD = $pass
$env:JAVA_HOME = $jdk.FullName
# bubblewrap lance « gradlew.bat » depuis le dossier du projet : cmd doit pouvoir chercher dans le dossier courant
$env:NoDefaultCurrentDirectoryInExePath = $null
Push-Location $proj
try {
  # un démon Gradle d'une construction précédente bloque les fichiers que bubblewrap régénère
  if (Test-Path '.\gradlew.bat') { Native { .\gradlew.bat --stop } | Out-Null }
  Write-Host "==> Génération du projet Android pour $siteHost (version $version)"
  Native { npx --yes @bubblewrap/cli@1.27.0 update --skipVersionUpgrade } | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'bubblewrap update a échoué' }
  Write-Host '==> Construction de l''APK (quelques minutes la première fois)'
  Native { npx --yes @bubblewrap/cli@1.27.0 build --skipPwaValidation } | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'bubblewrap build a échoué' }
} finally { Pop-Location }

# ----- Fichiers à mettre en ligne -----
$dl = Join-Path $root 'public\download'
New-Item -ItemType Directory -Force $dl | Out-Null
Copy-Item (Join-Path $proj 'app-release-signed.apk') (Join-Path $dl 'elegance-barbershop.apk') -Force
$wk = Join-Path $root 'public\.well-known'
New-Item -ItemType Directory -Force $wk | Out-Null
$links = '[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"android_app","package_name":"' + $packageId + '","sha256_cert_fingerprints":["' + $sha + '"]}}]'
[IO.File]::WriteAllText((Join-Path $wk 'assetlinks.json'), $links)

Write-Host ''
Write-Host "✅ APK prêt : public\download\elegance-barbershop.apk (version $version, site $siteHost)"
Write-Host '   Mettez le site à jour (deploy.ps1) pour publier l''APK et assetlinks.json.'
