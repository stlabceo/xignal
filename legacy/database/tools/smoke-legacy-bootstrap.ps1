param(
    [Parameter(Mandatory = $false)]
    [string]$TargetDatabase = "quantu_local",
    [Parameter(Mandatory = $false)]
    [int]$BackendPort = 3011,
    [Parameter(Mandatory = $false)]
    [string]$MySqlContainer = "quantu-mysql",
    [Parameter(Mandatory = $false)]
    [string]$MySqlUser = "quantu_migration",
    [Parameter(Mandatory = $false)]
    [string]$MySqlPassword = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$databaseRoot = Split-Path -Parent $scriptRoot
$legacyRoot = Split-Path -Parent $databaseRoot
$backendRoot = Join-Path $legacyRoot "backend"
$bootstrapScript = Join-Path $scriptRoot "bootstrap-legacy-db.ps1"
$reportPath = Join-Path $databaseRoot "smoke_report.md"
$logPath = Join-Path (Split-Path -Parent $legacyRoot) ("logs\legacy-backend-bootstrap-{0}.log" -f $BackendPort)
$errorLogPath = Join-Path (Split-Path -Parent $legacyRoot) ("logs\legacy-backend-bootstrap-{0}.err.log" -f $BackendPort)
$smokeUserId = "bootstrap_user"
$smokeUserName = "bootstrap"
$smokePassword = "Bootstrap!" + ([guid]::NewGuid().ToString("N").Substring(0, 12))

function Import-QuantuDotEnv {
    param([string]$EnvPath)
    if (-not (Test-Path $EnvPath)) {
        return
    }
    foreach ($line in Get-Content $EnvPath) {
        if ($line -notmatch '^\s*([^#=\s]+)\s*=\s*(.*)\s*$') {
            continue
        }
        $key = $Matches[1]
        $value = $Matches[2].Trim()
        if (($value.StartsWith("'") -and $value.EndsWith("'")) -or ($value.StartsWith('"') -and $value.EndsWith('"'))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($key, "Process"))) {
            [Environment]::SetEnvironmentVariable($key, $value, "Process")
        }
    }
}

function Assert-QuantuSmokeTarget {
    if ($TargetDatabase -notmatch '^quantu($|[_-])') {
        throw "QUANTU smoke guard failed: target database must use the QUANTU prefix"
    }
    if ($TargetDatabase -match '(?i)xignal') {
        throw "QUANTU smoke guard failed: XIGNAL database names are forbidden"
    }
    if ($MySqlContainer -match '(?i)xignal') {
        throw "QUANTU smoke guard failed: XIGNAL MySQL containers are forbidden"
    }
    if ($MySqlUser -eq "root") {
        throw "QUANTU smoke guard failed: root DB user is forbidden"
    }
}

Import-QuantuDotEnv (Join-Path $backendRoot ".env")
if ([string]::IsNullOrWhiteSpace($MySqlPassword)) {
    $MySqlPassword = $env:QUANTU_MYSQL_MIGRATION_PASSWORD
}
$appMySqlUser = $env:MYSQL_USER
$appMySqlPassword = $env:MYSQL_PW
if ([string]::IsNullOrWhiteSpace($appMySqlUser) -or [string]::IsNullOrWhiteSpace($appMySqlPassword)) {
    throw "QUANTU smoke guard failed: app DB credentials are missing from local env"
}
Assert-QuantuSmokeTarget

function Invoke-ContainerMySql {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & docker exec --env "MYSQL_PWD=$MySqlPassword" $MySqlContainer mysql @Arguments 2>$null
}

function Invoke-ContainerMySqlText {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Database,
        [Parameter(Mandatory = $true)]
        [string]$Sql
    )

    $tmp = [System.IO.Path]::GetTempFileName()
    try {
        $Sql | Set-Content -Path $tmp -Encoding UTF8
        Get-Content -Raw $tmp | docker exec -i --env "MYSQL_PWD=$MySqlPassword" $MySqlContainer mysql "-u$MySqlUser" "-D" $Database 2>$null
    }
    finally {
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    }
}

function Wait-HttpReady {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url,
        [int]$TimeoutSeconds = 20
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 3 | Out-Null
            return $true
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }

    return $false
}

$bootstrapOutput = & powershell -ExecutionPolicy Bypass -File $bootstrapScript -TargetDatabase $TargetDatabase -MySqlContainer $MySqlContainer -MySqlUser $MySqlUser -MySqlPassword $MySqlPassword
if ($LASTEXITCODE -ne 0) {
    throw "bootstrap failed"
}

Invoke-ContainerMySqlText -Database $TargetDatabase -Sql @"
DELETE FROM admin_member WHERE mem_id = '$smokeUserId';
CALL SP_U_USER_ADD('$smokeUserId','$smokeUserName','01012345678','$smokePassword','bootstrap@example.com',NULL);
"@ | Out-Null

$proc = $null
$loginJson = $null
$myinfoJson = $null

try {
    $env:PORT = [string]$BackendPort
    $env:RUNTIME_OWNER_PORT = [string]$BackendPort
    $env:MYSQL_HOST = "127.0.0.1"
    $env:MYSQL_PORT = "3307"
    $env:MYSQL_USER = $appMySqlUser
    $env:MYSQL_PW = $appMySqlPassword
    $env:MYSQL_DB = $TargetDatabase
    $proc = Start-Process node -ArgumentList "--max-old-space-size=4096", ".\bin\www" -WorkingDirectory $backendRoot -RedirectStandardOutput $logPath -RedirectStandardError $errorLogPath -WindowStyle Hidden -PassThru

    Start-Sleep -Seconds 5

    $loginResponse = Invoke-RestMethod -Method Post -Uri ("http://127.0.0.1:{0}/user/admin/login" -f $BackendPort) -ContentType "application/json" -Body (@{
        userId = $smokeUserId
        password = $smokePassword
    } | ConvertTo-Json)

    $accessToken = $loginResponse.token.accessToken
    $loginResponse.token.accessToken = "<redacted>"
    $loginResponse.token.refreshToken = "<redacted>"
    $loginJson = $loginResponse | ConvertTo-Json -Depth 8

    $myinfoResponse = Invoke-RestMethod -Method Get -Uri ("http://127.0.0.1:{0}/admin/myinfo" -f $BackendPort) -Headers @{
        Authorization = "Bearer $accessToken"
    }

    $myinfoJson = $myinfoResponse | ConvertTo-Json -Depth 8
}
finally {
    if ($proc -and -not $proc.HasExited) {
        Stop-Process -Id $proc.Id -Force
    }
}

$report = @"
# Legacy Bootstrap Smoke Report

- Target DB: $TargetDatabase
- Backend Port: $BackendPort
- Bootstrap Result: success
- Smoke user: $smokeUserId
- Login API: success
- /admin/myinfo: success

## Login Response

~~~json
$loginJson
~~~

## MyInfo Response

~~~json
$myinfoJson
~~~

## Backend Log

- $logPath

## Bootstrap Output

~~~text
$($bootstrapOutput -join [Environment]::NewLine)
~~~
"@

$report | Set-Content -Path $reportPath -Encoding UTF8

Write-Output ("report={0}" -f $reportPath)
