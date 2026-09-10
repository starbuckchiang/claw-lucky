# Auth-07C.2A — isolated localhost Postgres verification runner.
# Target: docker container claw-lucky-07c2a-pg on 127.0.0.1:55432 only.
# Never uses supabase link / db push / remote hosts.

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$MigDir = Join-Path $Root 'supabase\migrations'
$Container = 'claw-lucky-07c2a-pg'
$Db = 'claw_lucky_07c2a'
$Work = '/tmp/07c2a'

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

# Safety: container must publish only to 127.0.0.1
$ports = docker port $Container
if ($ports -notmatch '127\.0\.0\.1:55432') {
  throw "Refusing to run: container is not bound to 127.0.0.1:55432 (got: $ports)"
}
$hostHint = docker inspect $Container --format '{{json .HostConfig.PortBindings}}'
if ($hostHint -match 'supabase\.co|aws|pooler') {
  throw 'Refusing to run: remote-looking host binding detected'
}

Write-Host '=== Auth-07C.2A LOCAL_ISOLATED target confirmed (127.0.0.1:55432) ==='

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

  # Special order: seed legacy AFTER payment_orders migration, BEFORE subscriptions.
  if ($m.Name -eq '20260907000100_paypal_subscriptions_rpc.sql') {
    Write-Host '--- seed legacy payment rows ---'
    Invoke-PsqlFile (Join-Path $PSScriptRoot '10-seed-legacy.sql')
  }

  Invoke-PsqlFile $m.FullName
  Invoke-PsqlSql "INSERT INTO public.supabase_migrations_local(version,name) VALUES ('$ver','$($m.Name)') ON CONFLICT DO NOTHING;"
  $applied += $m.Name
}

Write-Host '--- re-run subscriptions migration (idempotency) ---'
$sub = Join-Path $MigDir '20260907000100_paypal_subscriptions_rpc.sql'
Invoke-PsqlFile $sub

Write-Host '--- behavior tests ---'
# Capture output for summary
$out = docker exec -e PGPASSWORD=localtest $Container `
  bash -lc "mkdir -p $Work && true"
docker cp (Join-Path $PSScriptRoot '30-behavior-tests.sql') "${Container}:${Work}/30-behavior-tests.sql" | Out-Null
$testOut = docker exec -e PGPASSWORD=localtest $Container `
  psql -v ON_ERROR_STOP=1 -U postgres -d $Db -f "${Work}/30-behavior-tests.sql" 2>&1
$testOut | Out-Host
$testOut | Set-Content -Encoding utf8 (Join-Path $PSScriptRoot 'last-run.out')

if ($LASTEXITCODE -ne 0) {
  throw 'Behavior tests failed'
}

Write-Host '=== 07C.2A runner complete ==='
Write-Host ("Applied this run: " + ($applied -join ', '))
