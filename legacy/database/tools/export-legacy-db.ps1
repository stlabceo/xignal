param(
    [Parameter(Mandatory = $false)]
    [string]$MySqlContainer = "quantu-mysql"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-EnvValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Key
    )

    $line = Get-Content $Path | Where-Object { $_ -match "^$Key=" } | Select-Object -First 1
    if (-not $line) {
        throw "Missing env key: $Key"
    }

    return (($line -replace "^$Key='?", "") -replace "'?$", "").Trim()
}

function Invoke-MySql {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & docker exec --env "MYSQL_PWD=$script:MySqlPassword" $MySqlContainer mysql @Arguments 2>$null
}

function Invoke-MySqlDump {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    & docker exec --env "MYSQL_PWD=$script:MySqlPassword" $MySqlContainer mysqldump @Arguments 2>$null
}

function Assert-QuantuExportTarget {
    param(
        [string]$HostName,
        [string]$DatabaseName,
        [string]$UserName
    )

    $allowedHosts = @("127.0.0.1", "localhost", "::1", "mysql", "host.docker.internal", "quantu-mysql", "quantu_mysql", "quantu-db", "quantu_db")
    if ($HostName -eq "1.234.63.146") {
        throw "QUANTU export guard failed: remote XIGNAL DB host is forbidden"
    }
    if ($allowedHosts -notcontains $HostName) {
        throw "QUANTU export guard failed: export host must be local QUANTU Docker/localhost"
    }
    if ($DatabaseName -notmatch '^quantu($|[_-])') {
        throw "QUANTU export guard failed: database must use the QUANTU prefix"
    }
    if ($DatabaseName -match '(?i)xignal') {
        throw "QUANTU export guard failed: XIGNAL database names are forbidden"
    }
    if ($UserName -eq "root") {
        throw "QUANTU export guard failed: root DB user is forbidden"
    }
    if ($MySqlContainer -match '(?i)xignal') {
        throw "QUANTU export guard failed: XIGNAL MySQL containers are forbidden"
    }
}

function Ensure-Dir {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$databaseRoot = Split-Path -Parent $scriptRoot
$legacyRoot = Split-Path -Parent $databaseRoot
$backendEnv = Join-Path $legacyRoot "backend\.env"
$legacyDump = Join-Path $legacyRoot "sql.sql"

$archiveDir = Join-Path $databaseRoot "archive"
$schemaDir = Join-Path $databaseRoot "schema"
$tablesDir = Join-Path $schemaDir "tables"
$tableObjectsDir = Join-Path $tablesDir "objects"
$proceduresDir = Join-Path $databaseRoot "procedures"
$procedureObjectsDir = Join-Path $proceduresDir "objects"
$seedDir = Join-Path $databaseRoot "seed"
$migrationsDir = Join-Path $databaseRoot "migrations"

@(
    $databaseRoot,
    $archiveDir,
    $schemaDir,
    $tablesDir,
    $tableObjectsDir,
    $proceduresDir,
    $procedureObjectsDir,
    $seedDir,
    $migrationsDir
) | ForEach-Object { Ensure-Dir $_ }

$dbHost = Get-EnvValue -Path $backendEnv -Key "MYSQL_HOST"
$dbUser = Get-EnvValue -Path $backendEnv -Key "MYSQL_USER"
$dbPw = Get-EnvValue -Path $backendEnv -Key "MYSQL_PW"
$dbName = Get-EnvValue -Path $backendEnv -Key "MYSQL_DB"
Assert-QuantuExportTarget -HostName $dbHost -DatabaseName $dbName -UserName $dbUser
$script:MySqlPassword = $dbPw
$todayStamp = Get-Date -Format "yyyyMMdd"
$nl = [Environment]::NewLine

Copy-Item $legacyDump (Join-Path $archiveDir "legacy_full_dump_latest.sql") -Force
Copy-Item $legacyDump (Join-Path $archiveDir ("legacy_full_dump_{0}.sql" -f $todayStamp)) -Force

$mysqlQueryBaseArgs = @(
    "-h$dbHost",
    "-u$dbUser",
    "-D",
    $dbName
)

$mysqlDumpBaseArgs = @(
    "-h$dbHost",
    "-u$dbUser"
)

$tableList = Invoke-MySql ($mysqlQueryBaseArgs + @(
    "-Nse",
    "SELECT table_name FROM information_schema.tables WHERE table_schema='$dbName' AND table_type='BASE TABLE' ORDER BY table_name;"
))

$routineList = Invoke-MySql ($mysqlQueryBaseArgs + @(
    "-Nse",
    "SELECT CONCAT(routine_type, ' ', routine_name) FROM information_schema.routines WHERE routine_schema='$dbName' ORDER BY routine_name;"
))

$tableListPath = Join-Path $tablesDir "table_list.txt"
$routineListPath = Join-Path $proceduresDir "routine_list.txt"
$combinedTablesPath = Join-Path $tablesDir "001_legacy_tables.sql"
$combinedRoutinesPath = Join-Path $proceduresDir "001_legacy_routines.sql"
$inventoryPath = Join-Path $databaseRoot "inventory.md"

$tableList | Set-Content -Path $tableListPath -Encoding UTF8
$routineList | Set-Content -Path $routineListPath -Encoding UTF8

Get-ChildItem $tableObjectsDir -File -ErrorAction SilentlyContinue | Remove-Item -Force
Get-ChildItem $procedureObjectsDir -File -ErrorAction SilentlyContinue | Remove-Item -Force

"" | Set-Content -Path $combinedTablesPath -Encoding UTF8
"" | Set-Content -Path $combinedRoutinesPath -Encoding UTF8

$tableIndex = 1
foreach ($tableName in $tableList) {
    if ([string]::IsNullOrWhiteSpace($tableName)) {
        continue
    }

    $tableFile = Join-Path $tableObjectsDir ("{0:D3}_{1}.sql" -f $tableIndex, $tableName)
    $tableDump = Invoke-MySqlDump ($mysqlDumpBaseArgs + @(
        "--no-data",
        "--skip-triggers",
        "--skip-comments",
        "--no-tablespaces",
        "--column-statistics=0",
        $dbName,
        $tableName
    ))

    $tableDump | Set-Content -Path $tableFile -Encoding UTF8
    Add-Content -Path $combinedTablesPath -Value ((Get-Content $tableFile -Raw) + $nl)
    $tableIndex++
}

$routineIndex = 1
foreach ($entry in $routineList) {
    if ([string]::IsNullOrWhiteSpace($entry)) {
        continue
    }

    $firstSpace = $entry.IndexOf(" ")
    if ($firstSpace -lt 1) {
        continue
    }

    $routineType = $entry.Substring(0, $firstSpace).Trim().ToUpperInvariant()
    $routineName = $entry.Substring($firstSpace + 1).Trim()

    $showCreateLines = Invoke-MySql ($mysqlQueryBaseArgs + @(
        "-B",
        "-Nse",
        "SHOW CREATE $routineType $routineName"
    ))

    if (-not $showCreateLines) {
        continue
    }

    $showCreateText = ($showCreateLines -join "")
    $showCreateParts = $showCreateText -split "`t"
    if ($showCreateParts.Count -lt 3) {
        continue
    }

    $statement = $showCreateParts[2]
    $statement = $statement -replace "\\r", ""
    $statement = $statement -replace "\\n", $nl
    $statement = $statement -replace "\\t", "`t"

    $dropKeyword = if ($routineType -eq "FUNCTION") { "FUNCTION" } else { "PROCEDURE" }
    $routineContent = @(
        "DROP $dropKeyword IF EXISTS ``$routineName``;",
        'DELIMITER $$',
        ($statement.Trim() + ' $$'),
        'DELIMITER ;',
        ""
    ) -join $nl

    $routineFile = Join-Path $procedureObjectsDir ("{0:D3}_{1}_{2}.sql" -f $routineIndex, $routineType.ToLowerInvariant(), $routineName)
    $routineContent | Set-Content -Path $routineFile -Encoding UTF8
    Add-Content -Path $combinedRoutinesPath -Value ($routineContent + $nl)
    $routineIndex++
}

$tableCount = (Get-ChildItem $tableObjectsDir -File | Measure-Object).Count
$routineCount = (Get-ChildItem $procedureObjectsDir -File | Measure-Object).Count

@(
    "# Legacy DB Inventory",
    "",
    "- Source DB: runtime DB referenced by legacy/backend/.env",
    ("- Exported at: {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz")),
    "- Table count: $tableCount",
    "- Routine count: $routineCount",
    "",
    "## Paths",
    "",
    "- Archive dump: archive/legacy_full_dump_latest.sql",
    "- Table schema: schema/tables/001_legacy_tables.sql",
    "- Table objects: schema/tables/objects/",
    "- Routine bundle: procedures/001_legacy_routines.sql",
    "- Routine objects: procedures/objects/",
    "- Seed policy: see seed/README.md",
    "- Migration policy: see migrations/README.md"
) | Set-Content -Path $inventoryPath -Encoding UTF8

Write-Output ("table_count={0}" -f $tableCount)
Write-Output ("routine_count={0}" -f $routineCount)
Write-Output ("inventory={0}" -f $inventoryPath)
