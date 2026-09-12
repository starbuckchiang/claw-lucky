# WEB-HOME-01B.1A local-only legacy dependency audit.
# Runs disposable PostgreSQL containers bound to 127.0.0.1 only.

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$MigrationDirectory = Join-Path $Root 'supabase\migrations'
$Bootstrap = Join-Path $Root 'scripts\auth-07c7e1-local-pg\00-bootstrap.sql'
$Container = 'claw-lucky-web-home-01b1a-audit'
$Database = 'claw_lucky_web_home_01b1a'
$Port = 55435
$Image = 'postgres:16-alpine'
$WorkDirectory = '/tmp/web-home-01b1a'
$LegacyObjects = @(
  'users',
  'mascots',
  'gifts',
  'user_mascots',
  'redeem_history',
  'shop_products',
  'shop_cart',
  'orders',
  'order_items'
)

function Remove-AuditContainer {
  docker rm -f $Container 2>$null | Out-Null
  $global:LASTEXITCODE = 0
}

function Invoke-LocalFile([string]$HostPath, [switch]$AllowFailure) {
  $name = Split-Path $HostPath -Leaf
  docker cp $HostPath "${Container}:${WorkDirectory}/${name}" | Out-Null
  $output = docker exec -e PGPASSWORD=localtest $Container `
    psql -v ON_ERROR_STOP=1 -U postgres -d $Database -f "${WorkDirectory}/${name}" 2>&1
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0 -and -not $AllowFailure) {
    throw "Local psql failed: $name"
  }
  return [pscustomobject]@{ ExitCode = $exitCode; Output = ($output | Out-String) }
}

function Start-AuditDatabase {
  Remove-AuditContainer
  docker run -d `
    --name $Container `
    -e POSTGRES_PASSWORD=localtest `
    -e POSTGRES_DB=$Database `
    -p "127.0.0.1:${Port}:5432" `
    $Image | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Unable to start local audit PostgreSQL' }

  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    docker exec -e PGPASSWORD=localtest $Container `
      pg_isready -U postgres -d $Database 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Local audit PostgreSQL did not become ready' }

  $publishedPort = (docker port $Container '5432/tcp' | Out-String).Trim()
  if ($publishedPort -ne "127.0.0.1:${Port}") {
    throw "Refusing non-local target: $publishedPort"
  }

  docker exec $Container mkdir -p $WorkDirectory | Out-Null
  Invoke-LocalFile $Bootstrap | Out-Null
  docker exec -e PGPASSWORD=localtest $Container `
    psql -v ON_ERROR_STOP=1 -U postgres -d $Database -c `
    'CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());' | Out-Null
}

function Invoke-Case([string]$MissingObject) {
  Start-AuditDatabase
  try {
    if ($MissingObject) {
      docker exec -e PGPASSWORD=localtest $Container `
        psql -v ON_ERROR_STOP=1 -U postgres -d $Database -c `
        "DROP TABLE public.$MissingObject CASCADE;" | Out-Null
    }

    $failedMigration = $null
    $sqlState = $null
    foreach ($migration in (Get-ChildItem $MigrationDirectory -File -Filter '*.sql' | Sort-Object Name)) {
      $result = Invoke-LocalFile $migration.FullName -AllowFailure
      if ($result.ExitCode -ne 0) {
        $failedMigration = $migration.Name
        if ($result.Output -match 'SQLSTATE\s+([0-9A-Z]{5})') {
          $sqlState = $Matches[1]
        } elseif ($result.Output -match '\(SQLSTATE\s+([0-9A-Z]{5})\)') {
          $sqlState = $Matches[1]
        }
        break
      }
    }

    [pscustomobject]@{
      MissingObject = $(if ($MissingObject) { "public.$MissingObject" } else { 'NONE_CONTROL' })
      FirstFailure = $(if ($failedMigration) { $failedMigration } else { 'NONE' })
      SqlState = $(if ($sqlState) { $sqlState } else { 'N/A' })
    }
  }
  finally {
    Remove-AuditContainer
  }
}

Write-Host "TARGET_HOST=127.0.0.1 TARGET_PORT=${Port} REMOTE=NO"
$results = @()
$results += Invoke-Case ''
foreach ($object in $LegacyObjects) {
  $results += Invoke-Case $object
}
$results | Format-Table -AutoSize
