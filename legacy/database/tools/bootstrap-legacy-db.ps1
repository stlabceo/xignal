param(
    [Parameter(Mandatory = $false)]
    [string]$TargetDatabase = "quantu_local",
    [Parameter(Mandatory = $false)]
    [string]$MySqlContainer = "quantu-mysql",
    [Parameter(Mandatory = $false)]
    [string]$MySqlUser = "quantu_migration",
    [Parameter(Mandatory = $false)]
    [string]$MySqlPassword = "",
    [Parameter(Mandatory = $false)]
    [switch]$PreflightOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

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

$bootstrapScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$bootstrapDatabaseRoot = Split-Path -Parent $bootstrapScriptRoot
$bootstrapLegacyRoot = Split-Path -Parent $bootstrapDatabaseRoot
Import-QuantuDotEnv (Join-Path $bootstrapLegacyRoot "backend\.env")

if ([string]::IsNullOrWhiteSpace($MySqlPassword)) {
    $MySqlPassword = $env:QUANTU_MYSQL_MIGRATION_PASSWORD
}
if ([string]::IsNullOrWhiteSpace($MySqlPassword)) {
    $MySqlPassword = $env:MYSQL_PWD
}

function Assert-QuantuBootstrapTarget {
    if ($TargetDatabase -notmatch '^quantu($|[_-])') {
        throw "QUANTU bootstrap guard failed: target database must use the QUANTU prefix"
    }
    if ($TargetDatabase -match '(?i)xignal') {
        throw "QUANTU bootstrap guard failed: XIGNAL database names are forbidden"
    }
    if ($MySqlContainer -match '(?i)xignal') {
        throw "QUANTU bootstrap guard failed: XIGNAL MySQL containers are forbidden"
    }
    if ($MySqlContainer -notmatch '(?i)quantu') {
        throw "QUANTU bootstrap guard failed: MySQL container must be QUANTU-scoped"
    }
    if ($MySqlUser -eq "root") {
        throw "QUANTU bootstrap guard failed: root user is forbidden for migration/seed runners"
    }
    if ([string]::IsNullOrWhiteSpace($MySqlPassword)) {
        throw "QUANTU bootstrap guard failed: migration password must be supplied via env or parameter"
    }
}

function Invoke-ContainerMySql {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    $output = & docker exec --env "MYSQL_PWD=$MySqlPassword" $MySqlContainer mysql @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "mysql command failed"
    }
    return $output
}

function Invoke-ContainerMySqlFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Database,
        [Parameter(Mandatory = $true)]
        [string]$FilePath
    )

    $sql = Get-Content -Raw $FilePath
    $sql = $sql -replace 'CREATE\s+DEFINER=`[^`]+`@`[^`]+`\s+', 'CREATE '
    $output = $sql | docker exec -i --env "MYSQL_PWD=$MySqlPassword" $MySqlContainer mysql "-u$MySqlUser" "-D" $Database 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "mysql file apply failed: $FilePath"
    }
    return $output
}

function ConvertTo-SqlLiteral {
    param([AllowNull()][object]$Value)
    if ($null -eq $Value) {
        return "NULL"
    }
    $text = [string]$Value
    return "'" + ($text -replace "'", "''") + "'"
}

function Get-GitValue {
    param([string[]]$Arguments)
    try {
        $value = & git @Arguments 2>$null
        if ($LASTEXITCODE -ne 0) {
            return "UNKNOWN"
        }
        return (($value | Select-Object -First 1) -as [string]).Trim()
    }
    catch {
        return "UNKNOWN"
    }
}

function Ensure-AuditTable {
    $sql = @"
CREATE TABLE IF NOT EXISTS quantu_seed_migration_audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  runId VARCHAR(64) NOT NULL,
  artifactType VARCHAR(32) NOT NULL,
  seedName VARCHAR(255) NULL,
  migrationName VARCHAR(255) NULL,
  operatorName VARCHAR(128) NULL,
  machineName VARCHAR(128) NULL,
  repoPath VARCHAR(512) NULL,
  gitHead VARCHAR(64) NULL,
  dbHost VARCHAR(128) NULL,
  dbName VARCHAR(128) NULL,
  serverUuid VARCHAR(128) NULL,
  startedAt DATETIME(6) NULL,
  finishedAt DATETIME(6) NULL,
  affectedRows BIGINT NULL,
  result VARCHAR(32) NOT NULL,
  reason TEXT NULL,
  createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  INDEX idx_quantu_audit_run (runId),
  INDEX idx_quantu_audit_artifact (artifactType, seedName, migrationName)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
"@
    Invoke-ContainerMySql @("-u$MySqlUser", "-D", $TargetDatabase, "-e", $sql) | Out-Null
}

function Write-AuditRow {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ArtifactType,
        [Parameter(Mandatory = $false)]
        [string]$SeedName = "",
        [Parameter(Mandatory = $false)]
        [string]$MigrationName = "",
        [Parameter(Mandatory = $true)]
        [string]$StartedAt,
        [Parameter(Mandatory = $true)]
        [string]$Result,
        [Parameter(Mandatory = $false)]
        [string]$Reason = "",
        [Parameter(Mandatory = $false)]
        [Nullable[int64]]$AffectedRows = $null
    )

    $finishedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss.ffffff")
    $affectedRowsValue = if ($null -eq $AffectedRows) { "NULL" } else { [string]$AffectedRows }
    $sql = @(
        "INSERT INTO quantu_seed_migration_audit",
        "(runId, artifactType, seedName, migrationName, operatorName, machineName, repoPath, gitHead, dbHost, dbName, serverUuid, startedAt, finishedAt, affectedRows, result, reason)",
        "VALUES (",
        (ConvertTo-SqlLiteral $script:RunId), ",",
        (ConvertTo-SqlLiteral $ArtifactType), ",",
        (ConvertTo-SqlLiteral $SeedName), ",",
        (ConvertTo-SqlLiteral $MigrationName), ",",
        (ConvertTo-SqlLiteral $script:OperatorName), ",",
        (ConvertTo-SqlLiteral $script:MachineName), ",",
        (ConvertTo-SqlLiteral $script:RepoPath), ",",
        (ConvertTo-SqlLiteral $script:GitHead), ",",
        (ConvertTo-SqlLiteral $MySqlContainer), ",",
        (ConvertTo-SqlLiteral $TargetDatabase), ",",
        (ConvertTo-SqlLiteral $script:ServerUuid), ",",
        (ConvertTo-SqlLiteral $StartedAt), ",",
        (ConvertTo-SqlLiteral $finishedAt), ",",
        $affectedRowsValue, ",",
        (ConvertTo-SqlLiteral $Result), ",",
        (ConvertTo-SqlLiteral $Reason),
        ");"
    ) -join " "
    Invoke-ContainerMySql @("-u$MySqlUser", "-D", $TargetDatabase, "-e", $sql) | Out-Null
}

function Invoke-AuditedSqlFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ArtifactType,
        [Parameter(Mandatory = $true)]
        [string]$FilePath
    )

    $startedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss.ffffff")
    $fileName = Split-Path -Leaf $FilePath
    try {
        Invoke-ContainerMySqlFile -Database $TargetDatabase -FilePath $FilePath | Out-Null
        if ($ArtifactType -eq "seed") {
            Write-AuditRow -ArtifactType $ArtifactType -SeedName $fileName -StartedAt $startedAt -Result "SUCCESS"
        }
        elseif ($ArtifactType -eq "migration") {
            Write-AuditRow -ArtifactType $ArtifactType -MigrationName $fileName -StartedAt $startedAt -Result "SUCCESS"
        }
        else {
            Write-AuditRow -ArtifactType $ArtifactType -MigrationName $fileName -StartedAt $startedAt -Result "SUCCESS"
        }
    }
    catch {
        $reason = $_.Exception.Message
        if ($ArtifactType -eq "seed") {
            Write-AuditRow -ArtifactType $ArtifactType -SeedName $fileName -StartedAt $startedAt -Result "FAILED" -Reason $reason
        }
        else {
            Write-AuditRow -ArtifactType $ArtifactType -MigrationName $fileName -StartedAt $startedAt -Result "FAILED" -Reason $reason
        }
        throw
    }
}

Assert-QuantuBootstrapTarget

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$databaseRoot = Split-Path -Parent $scriptRoot
$schemaFile = Join-Path $databaseRoot "schema\tables\001_legacy_tables.sql"
$seedDir = Join-Path $databaseRoot "seed"
$migrationsDir = Join-Path $databaseRoot "migrations"
$bootstrapReport = Join-Path $databaseRoot "bootstrap_report.md"

if ($PreflightOnly) {
    Write-Output ("preflight=PASS")
    Write-Output ("database={0}" -f $TargetDatabase)
    Write-Output ("container={0}" -f $MySqlContainer)
    Write-Output ("user=REDACTED")
    exit 0
}

if (-not (Test-Path $schemaFile)) {
    throw "Missing schema file: $schemaFile"
}

$databaseExists = Invoke-ContainerMySql @(
    "-u$MySqlUser",
    "-Nse",
    "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='$TargetDatabase';"
)
if ((($databaseExists | Select-Object -Last 1).Trim()) -ne "1") {
    throw "Target database does not exist; create QUANTU local DB before running migrations"
}

$script:RunId = [guid]::NewGuid().ToString()
$script:OperatorName = $env:USERNAME
$script:MachineName = $env:COMPUTERNAME
$script:RepoPath = Get-GitValue @("rev-parse", "--show-toplevel")
$script:GitHead = Get-GitValue @("rev-parse", "HEAD")
$script:ServerUuid = ((Invoke-ContainerMySql @("-u$MySqlUser", "-Nse", "SELECT @@server_uuid;")) | Select-Object -Last 1).Trim()

Ensure-AuditTable
Invoke-AuditedSqlFile -ArtifactType "schema" -FilePath $schemaFile

$routineObjectDir = Join-Path $databaseRoot "procedures\objects"
$routineFiles = Get-ChildItem $routineObjectDir -File -Filter *.sql | Sort-Object Name
$routineFailures = New-Object System.Collections.Generic.List[string]
foreach ($routineFile in $routineFiles) {
    try {
        Invoke-AuditedSqlFile -ArtifactType "routine" -FilePath $routineFile.FullName
    }
    catch {
        [void]$routineFailures.Add($routineFile.Name)
    }
}

$seedFiles = Get-ChildItem $seedDir -File -Filter *.sql | Sort-Object Name
foreach ($seedFile in $seedFiles) {
    Invoke-AuditedSqlFile -ArtifactType "seed" -FilePath $seedFile.FullName
}

$migrationFiles = Get-ChildItem $migrationsDir -File -Filter *.sql | Sort-Object Name
$appliedMigrations = New-Object System.Collections.Generic.List[string]
foreach ($migrationFile in $migrationFiles) {
    Invoke-AuditedSqlFile -ArtifactType "migration" -FilePath $migrationFile.FullName
    [void]$appliedMigrations.Add($migrationFile.Name)
}

$tableCount = Invoke-ContainerMySql @(
    "-u$MySqlUser",
    "-Nse",
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$TargetDatabase' AND table_type='BASE TABLE';"
)

$routineCount = Invoke-ContainerMySql @(
    "-u$MySqlUser",
    "-Nse",
    "SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema='$TargetDatabase';"
)

$failedRoutineLines = if ($routineFailures.Count -eq 0) {
    @("- none")
}
else {
    $routineFailures | ForEach-Object { "- $_" }
}

$appliedMigrationLines = if ($appliedMigrations.Count -eq 0) {
    @("- none")
}
else {
    $appliedMigrations | ForEach-Object { "- $_" }
}

$bootstrapReportLines = @(
    "# Bootstrap Report",
    "",
    "- Target DB: $TargetDatabase",
    "- Run ID: $script:RunId",
    "- Table count after bootstrap: $(($tableCount | Select-Object -Last 1).Trim())",
    "- Routine count after bootstrap: $(($routineCount | Select-Object -Last 1).Trim())",
    "- Failed routine count: $($routineFailures.Count)",
    "- Applied migration count: $($appliedMigrations.Count)",
    "",
    "## Failed routines",
    ""
) + $failedRoutineLines + @(
    "",
    "## Applied migrations",
    ""
) + $appliedMigrationLines

$bootstrapReportLines | Set-Content -Path $bootstrapReport -Encoding UTF8

Write-Output ("database={0}" -f $TargetDatabase)
Write-Output ("run_id={0}" -f $script:RunId)
Write-Output ("table_count={0}" -f (($tableCount | Select-Object -Last 1).Trim()))
Write-Output ("routine_count={0}" -f (($routineCount | Select-Object -Last 1).Trim()))
Write-Output ("failed_routines={0}" -f $routineFailures.Count)
Write-Output ("applied_migrations={0}" -f $appliedMigrations.Count)
Write-Output ("bootstrap_report={0}" -f $bootstrapReport)
