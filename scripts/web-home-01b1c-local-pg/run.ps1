# WEB-HOME-01B.1C local-only rebuild and convergence verification.
# Every database is disposable and bound only to 127.0.0.1.

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$MigrationDirectory = Join-Path $Root 'supabase\migrations'
$PlatformSetup = Join-Path $Root 'scripts\web-home-01b1-local-pg\00-platform.sql'
$AuthUsersSetup = Join-Path $Root 'scripts\web-home-01b1-local-pg\10-auth-users.sql'
$Database = 'claw_lucky_web_home_01b1c'
$Image = 'postgres:16-alpine'
$WorkDirectory = '/tmp/web-home-01b1c'
$ConvergenceMigration = '20260912000100_legacy_rls_grants_convergence.sql'

function Remove-LocalContainer([string]$Container) {
  docker rm -f $Container 2>$null | Out-Null
  $global:LASTEXITCODE = 0
}

function Start-LocalContainer([string]$Container, [int]$Port) {
  Remove-LocalContainer $Container
  docker run -d `
    --name $Container `
    -e POSTGRES_PASSWORD=localtest `
    -e POSTGRES_DB=$Database `
    -p "127.0.0.1:${Port}:5432" `
    $Image | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Unable to start $Container" }

  docker exec $Container sh -c "until pg_isready -U postgres -d $Database >/dev/null 2>&1; do true; done"
  if ($LASTEXITCODE -ne 0) { throw "$Container did not become ready" }

  $publishedPort = (docker port $Container '5432/tcp' | Out-String).Trim()
  if ($publishedPort -ne "127.0.0.1:${Port}") {
    throw "Refusing non-local database target: $publishedPort"
  }
}

function Invoke-LocalPsqlFile([string]$Container, [string]$HostPath) {
  $name = Split-Path $HostPath -Leaf
  docker cp $HostPath "${Container}:${WorkDirectory}/${name}" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Copy failed: $name" }
  docker exec -e PGPASSWORD=localtest $Container `
    psql -q -v ON_ERROR_STOP=1 -U postgres -d $Database -f "${WorkDirectory}/${name}" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Local psql failed: $name" }
}

function Get-CatalogFingerprint([string]$Container) {
  $path = Join-Path $PSScriptRoot 'catalog-fingerprint.sql'
  $name = Split-Path $path -Leaf
  docker cp $path "${Container}:${WorkDirectory}/${name}" | Out-Null
  $output = docker exec -e PGPASSWORD=localtest $Container `
    psql -q -v ON_ERROR_STOP=1 -U postgres -d $Database -f "${WorkDirectory}/${name}"
  if ($LASTEXITCODE -ne 0) { throw 'Catalog fingerprint query failed' }
  $fingerprint = ($output | Where-Object { $_ -match '^[0-9a-f]{32}$' } | Select-Object -Last 1).Trim()
  if ($fingerprint -notmatch '^[0-9a-f]{32}$') { throw 'Catalog fingerprint was not produced' }
  return $fingerprint
}

function Initialize-Platform([string]$Container) {
  docker exec $Container mkdir -p $WorkDirectory | Out-Null
  Invoke-LocalPsqlFile $Container $PlatformSetup
  Invoke-LocalPsqlFile $Container $AuthUsersSetup
}

function Apply-Migrations([string]$Container, [bool]$IncludeConvergence) {
  $migrations = Get-ChildItem $MigrationDirectory -File -Filter '*.sql' | Sort-Object Name
  foreach ($migration in $migrations) {
    if (-not $IncludeConvergence -and $migration.Name -eq $ConvergenceMigration) { continue }
    Write-Host "LOCAL_ONLY applying=$($migration.Name)"
    Invoke-LocalPsqlFile $Container $migration.FullName
  }
}

function Invoke-CleanRebuild([int]$Number, [int]$Port) {
  $container = "claw-lucky-web-home-01b1c-clean-${Number}"
  Write-Host "=== CLEAN_REBUILD_${Number} TARGET=127.0.0.1:${Port} ==="
  Start-LocalContainer $container $Port
  try {
    Initialize-Platform $container
    Apply-Migrations $container $true
    Invoke-LocalPsqlFile $container (Join-Path $PSScriptRoot 'production-compatibility-check.sql')
    $fingerprint = Get-CatalogFingerprint $container
    $concurrencyResult = node (Join-Path $PSScriptRoot 'order-number-concurrency.cjs') $container $Database
    if ($LASTEXITCODE -ne 0) { throw 'Order-number concurrency test failed' }
    Write-Host $concurrencyResult
    Invoke-LocalPsqlFile $container (Join-Path $PSScriptRoot 'security-runtime-tests.sql')
    Write-Host "CLEAN_REBUILD_${Number}_PASS fingerprint=$fingerprint"
    return $fingerprint
  }
  finally {
    Remove-LocalContainer $container
  }
}

function Invoke-ProductionShapedConvergence([int]$Port, [string]$ExpectedFingerprint) {
  $container = 'claw-lucky-web-home-01b1c-convergence'
  Write-Host "=== PRODUCTION_SHAPED_CONVERGENCE TARGET=127.0.0.1:${Port} ==="
  Start-LocalContainer $container $Port
  try {
    Initialize-Platform $container
    Apply-Migrations $container $false
    Invoke-LocalPsqlFile $container (Join-Path $PSScriptRoot 'legacy-security-shape.sql')
    Invoke-LocalPsqlFile $container (Join-Path $MigrationDirectory $ConvergenceMigration)
    Invoke-LocalPsqlFile $container (Join-Path $MigrationDirectory $ConvergenceMigration)
    $fingerprint = Get-CatalogFingerprint $container
    if ($fingerprint -ne $ExpectedFingerprint) {
      throw "Converged fingerprint mismatch: clean=$ExpectedFingerprint convergence=$fingerprint"
    }
    Invoke-LocalPsqlFile $container (Join-Path $PSScriptRoot 'security-runtime-tests.sql')
    Write-Host "PRODUCTION_SHAPED_CONVERGENCE_PASS fingerprint=$fingerprint"
  }
  finally {
    Remove-LocalContainer $container
  }
}

$containers = @(
  'claw-lucky-web-home-01b1c-clean-1',
  'claw-lucky-web-home-01b1c-clean-2',
  'claw-lucky-web-home-01b1c-convergence'
)

try {
  $firstFingerprint = Invoke-CleanRebuild 1 55437
  $secondFingerprint = Invoke-CleanRebuild 2 55438
  if ($firstFingerprint -ne $secondFingerprint) {
    throw "Clean rebuild fingerprints differ: first=$firstFingerprint second=$secondFingerprint"
  }
  Write-Host "CATALOG_FINGERPRINTS_MATCH value=$firstFingerprint"
  Invoke-ProductionShapedConvergence 55439 $firstFingerprint
  Write-Host 'WEB_HOME_01B1C_LOCAL_POSTGRES_PASS'
}
finally {
  foreach ($container in $containers) { Remove-LocalContainer $container }
}