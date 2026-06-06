$ErrorActionPreference = "Stop"

$basePath = "C:\Progetti\Timage\3D\x CT PACK - PROVA\RIC_M.VRTX.CLSR.000012_REV 1.3_250929\RIC_M.VRTX.CLSR.000012_REV 1.3_250929"
$dbPath = "$basePath\Data\M.VRTX.CLSR.000012\catalog.dat"
$outputDir = "C:\Progetti\Timage\timage-catalog\data\models\M.VRTX.CLSR.000012"
$password = "KeithHaring"

# Carica la DLL dal vecchio progetto
$sqliteDll = "$basePath\System.Data.SQLite.dll"
$interopDir = "$basePath\x64"

# Copia l'interop DLL nella directory corrente se necessario
# Interop DLL e gia nella sottocartella x64 accanto alla DLL principale

[System.Reflection.Assembly]::LoadFile($sqliteDll) | Out-Null
Write-Host "System.Data.SQLite caricato"

$connStr = "Data Source=$dbPath;Password=$password"
$conn = New-Object System.Data.SQLite.SQLiteConnection($connStr, $true)
$conn.Open()
Write-Host "Database aperto!"

# Lista tabelle
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT name FROM sqlite_master WHERE type='table'"
$reader = $cmd.ExecuteReader()
$tables = @()
while ($reader.Read()) { $tables += $reader.GetString(0) }
$reader.Close()
Write-Host "Tabelle: $($tables -join ', ')"

New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

foreach ($table in $tables) {
    $cmd2 = $conn.CreateCommand()
    $cmd2.CommandText = "SELECT * FROM [$table]"
    $reader2 = $cmd2.ExecuteReader()

    $rows = @()
    while ($reader2.Read()) {
        $row = @{}
        for ($i = 0; $i -lt $reader2.FieldCount; $i++) {
            $name = $reader2.GetName($i)
            $val = if ($reader2.IsDBNull($i)) { "" } else { $reader2.GetValue($i) }
            $row[$name] = $val
        }
        $rows += $row
    }
    $reader2.Close()

    Write-Host "  $table : $($rows.Count) righe"
    if ($rows.Count -gt 0) {
        Write-Host "    Colonne: $($rows[0].Keys -join ', ')"
    }

    $json = $rows | ConvertTo-Json -Depth 10 -Compress:$false
    [System.IO.File]::WriteAllText("$outputDir\${table}_raw.json", $json, [System.Text.Encoding]::UTF8)
}

$conn.Close()
Write-Host "`nEstrazione completata! JSON salvati in $outputDir"
