# WEB-HOME-01B.1 isolated local PostgreSQL runtime verification.
# Target is hard-bound to 127.0.0.1:55434. No Supabase remote commands.

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$MigrationDirectory = Join-Path $Root 'supabase\migrations'
$PlatformSetup = Join-Path $PSScriptRoot '00-platform.sql'
$Container = 'claw-lucky-web-home-01b1-pg'
$Database = 'claw_lucky_web_home_01b1'
$WorkDirectory = '/tmp/web-home-01b1'
$Port = 55434
$Image = 'postgres:16-alpine'

function Invoke-LocalPsqlFile([string]$HostPath) {
  $name = Split-Path $HostPath -Leaf
  docker cp $HostPath "${Container}:${WorkDirectory}/${name}" | Out-Null
  docker exec -e PGPASSWORD=localtest $Container `
    psql -v ON_ERROR_STOP=1 -U postgres -d $Database -f "${WorkDirectory}/${name}"
  if ($LASTEXITCODE -ne 0) { throw "Local psql failed: $name" }
}

function Remove-LocalContainer {
  docker rm -f $Container 2>$null | Out-Null
  $global:LASTEXITCODE = 0
}

Write-Host '=== WEB-HOME-01B.1 isolated PostgreSQL ==='
Remove-LocalContainer

docker run -d `
  --name $Container `
  -e POSTGRES_PASSWORD=localtest `
  -e POSTGRES_DB=$Database `
  -p "127.0.0.1:${Port}:5432" `
  $Image | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Unable to start local PostgreSQL container' }

try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    docker exec -e PGPASSWORD=localtest $Container `
      pg_isready -U postgres -d $Database 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'Local PostgreSQL did not become ready' }

  $publishedPort = (docker port $Container '5432/tcp' | Out-String).Trim()
  if ($publishedPort -ne "127.0.0.1:${Port}") {
    throw "Refusing non-local database target: $publishedPort"
  }
  Write-Host "TARGET_HOST=127.0.0.1 TARGET_PORT=${Port} REMOTE=NO"

  docker exec $Container mkdir -p $WorkDirectory | Out-Null
  Invoke-LocalPsqlFile $PlatformSetup
  Invoke-LocalPsqlFile (Join-Path $PSScriptRoot '10-auth-users.sql')

  $migrations = Get-ChildItem $MigrationDirectory -File -Filter '*.sql' | Sort-Object Name
  foreach ($migration in $migrations) {
    Write-Host "TARGET_HOST=127.0.0.1 applying=$($migration.Name)"
    Invoke-LocalPsqlFile $migration.FullName
  }

  Write-Host 'TARGET_HOST=127.0.0.1 running=20-consent-runtime-tests.sql'
  Invoke-LocalPsqlFile (Join-Path $PSScriptRoot '20-consent-runtime-tests.sql')
  Write-Host 'WEB_HOME_01B1_LOCAL_POSTGRES_PASS'
}
finally {
  Write-Host 'Removing isolated local PostgreSQL container'
  Remove-LocalContainer
}
