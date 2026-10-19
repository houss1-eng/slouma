# Envoie l'application sur le VPS et l'installe / la met à jour (depuis le PC Windows).
#
#   Première fois (la base, photos comprises, est sur PostgreSQL : npm run migrate pour y copier les anciennes données) :
#     .\deploy\deploy.ps1 -Server root@IP_DU_VPS -WithData
#   Mises à jour suivantes (le code seulement) :
#     .\deploy\deploy.ps1 -Server root@IP_DU_VPS
#   Avec un nom de domaine (pointé vers l'IP du VPS) :
#     .\deploy\deploy.ps1 -Server root@IP_DU_VPS -Domain elegancebarbershop.tn
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [string]$Domain = '',
  [switch]$WithData
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$archive = Join-Path $env:TEMP 'elegance-barbershop.tgz'

# les fichiers secrets de l'application Android (android/) ne partent jamais sur le serveur
if (-not (Test-Path (Join-Path $root '.env'))) { throw 'Fichier .env absent : copiez .env.example en .env et mettez-y DATABASE_URL (PostgreSQL Neon)' }
$exclude = @('--exclude=./node_modules', '--exclude=./tools', '--exclude=./android', '--exclude=./.git', '--exclude=./data/barber.db*')
if (-not $WithData) { $exclude += '--exclude=./data' }
Write-Host '==> Préparation de l''archive'
tar -czf $archive -C $root @exclude .
if ($LASTEXITCODE -ne 0) { throw 'tar a échoué' }

Write-Host "==> Envoi vers $Server"
scp $archive "${Server}:/tmp/elegance-barbershop.tgz"
if ($LASTEXITCODE -ne 0) { throw 'scp a échoué (vérifiez l''IP et le mot de passe du VPS)' }

Write-Host '==> Installation sur le serveur'
ssh $Server "rm -rf /tmp/elegance-barbershop && mkdir -p /tmp/elegance-barbershop && tar -xzf /tmp/elegance-barbershop.tgz -C /tmp/elegance-barbershop && bash /tmp/elegance-barbershop/deploy/setup.sh $Domain"
if ($LASTEXITCODE -ne 0) { throw 'L''installation sur le serveur a échoué (voir les messages ci-dessus)' }
Remove-Item $archive
