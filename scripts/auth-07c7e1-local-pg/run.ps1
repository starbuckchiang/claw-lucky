# Auth-07C.7E.1 — isolated localhost Postgres verification for sale reconciliation hotfix.
# Target: docker container claw-lucky-07c7e1-pg on 127.0.0.1:55433 only.
# Never uses supabase link / db push / remote hosts.

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$MigDir = Join-Path $Root 'supabase\migrations'
$Container = 'claw-lucky-07c7e1-pg'
$Db = 'claw_lucky_07c7e1'
$Work = '/tmp/07c7e1'
$Port = 55433
$Image = 'postgres:16-alpine'
$OutFile = Join-Path $PSScriptRoot 'last-run.out'
$SummaryFile = Join-Path $PSScriptRoot 'behavior.out'

function Invoke-PsqlFile([string]$HostPath) {
  $name = Split-Path $HostPath -Leaf
  docker cp $HostPath "${Container}:${Work}/${name}" | Out-Null
  docker exec -e PGPASSWORD=localtest $Container `
    psql -v ON_ERROR_STOP=1 -U postgres -d $Db -f "${Work}/${name}"
  if ($LASTEXITCODE -ne 0) { throw "psql failed: $name" }
}

function Invoke-PsqlSql([string]$Sql) {
  docker exec -e PGPASSWORD=localtest $Container `
    psql -v ON_ERROR_STOP=1 -U postgres -d $Db -c $Sql
  if ($LASTEXITCODE -ne 0) { throw "psql failed: $Sql" }
}

function Stop-LocalContainer {
  cmd /c "docker rm -f $Container >nul 2>&1" | Out-Null
  $global:LASTEXITCODE = 0
}

Write-Host '=== Auth-07C.7E.1 starting isolated Docker Postgres ==='

# Ensure clean slate
cmd /c "docker rm -f $Container >nul 2>&1"
$global:LASTEXITCODE = 0

docker pull $Image | Out-Null
docker run -d `
  --name $Container `
  -e POSTGRES_PASSWORD=localtest `
  -e POSTGRES_DB=$Db `
  -p "127.0.0.1:${Port}:5432" `
  $Image | Out-Null

# Wait for ready
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 1
  docker exec -e PGPASSWORD=localtest $Container `
    pg_isready -U postgres -d $Db 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
}
if (-not $ready) {
  Stop-LocalContainer
  throw 'BLOCKED_LOCAL_DB: postgres never became ready'
}

# Safety: container must publish only to 127.0.0.1
$ports = docker port $Container
if ($ports -notmatch "127\.0\.0\.1:${Port}") {
  Stop-LocalContainer
  throw "Refusing to run: container is not bound to 127.0.0.1:${Port} (got: $ports)"
}
$hostHint = docker inspect $Container --format '{{json .HostConfig.PortBindings}}'
if ($hostHint -match 'supabase\.co|aws|pooler') {
  Stop-LocalContainer
  throw 'Refusing to run: remote-looking host binding detected'
}

Write-Host "=== Auth-07C.7E.1 LOCAL_ISOLATED target confirmed (127.0.0.1:${Port}) ==="

try {
  docker exec $Container mkdir -p $Work | Out-Null

  Write-Host '--- bootstrap ---'
  Invoke-PsqlFile (Join-Path $PSScriptRoot '00-bootstrap.sql')

  $migrations = Get-ChildItem $MigDir -Filter '*.sql' | Sort-Object Name
  $applied = @()
  foreach ($m in $migrations) {
    $ver = $m.BaseName
    Write-Host "--- migration $($m.Name) ---"
    $exists = docker exec -e PGPASSWORD=localtest $Container `
      psql -U postgres -d $Db -tAc "SELECT 1 FROM public.supabase_migrations_local WHERE version='$ver'"
    if (($exists | Out-String).Trim() -eq '1') {
      Write-Host "skip already applied $ver"
      continue
    }

    # Legacy Orders seed after payment_orders, before subscriptions.
    if ($m.Name -eq '20260907000100_paypal_subscriptions_rpc.sql') {
      Write-Host '--- seed legacy payment rows ---'
      Invoke-PsqlFile (Join-Path $PSScriptRoot '10-seed-legacy.sql')
    }

    # ACTIVE paid_through=null seed after subscriptions, before hotfix.
    if ($m.Name -eq '20260908000100_sale_reconciliation_hotfix.sql') {
      Write-Host '--- seed ACTIVE subscription (paid_through=null) ---'
      Invoke-PsqlFile (Join-Path $PSScriptRoot '20-seed-subscription.sql')
    }

    Invoke-PsqlFile $m.FullName
    Invoke-PsqlSql "INSERT INTO public.supabase_migrations_local(version,name) VALUES ('$ver','$($m.Name)') ON CONFLICT DO NOTHING;"
    $applied += $m.Name
  }

  Write-Host '--- re-run hotfix migration (idempotency) ---'
  $hotfix = Join-Path $MigDir '20260908000100_sale_reconciliation_hotfix.sql'
  Invoke-PsqlFile $hotfix

  Write-Host '--- behavior tests ---'
  docker cp (Join-Path $PSScriptRoot '30-behavior-tests.sql') "${Container}:${Work}/30-behavior-tests.sql" | Out-Null
  $testOut = docker exec -e PGPASSWORD=localtest $Container `
    psql -v ON_ERROR_STOP=1 -U postgres -d $Db -f "${Work}/30-behavior-tests.sql" 2>&1
  $testOut | Out-Host
  $testOut | Set-Content -Encoding utf8 $OutFile
  $testOut | Set-Content -Encoding utf8 $SummaryFile

  if ($LASTEXITCODE -ne 0) {
    throw 'Behavior tests failed'
  }

  Write-Host '=== 07C.7E.1 runner complete ==='
  Write-Host ("Applied this run: " + ($applied -join ', '))
}
finally {
  Write-Host '--- removing isolated container ---'
  Stop-LocalContainer
}
