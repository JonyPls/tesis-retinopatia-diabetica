param([switch]$InitializeAuthorizedInstance)
$ErrorActionPreference = 'Stop'
if (-not $InitializeAuthorizedInstance) { throw 'Se requiere autorización explícita de inicialización.' }
$codnRepo = Split-Path -Parent $PSScriptRoot
$codnRoot = Join-Path $codnRepo 'tmp/codn-cb03/20261103T172031Z-cb03-a3c5f7f4-mysql'
$codnExpected = 'D:\Universidad\CICLO XII\SEMINARIO DE TESIS I\tesis-retinopatia-diabetica\tmp\codn-cb03\20261103T172031Z-cb03-a3c5f7f4-mysql'
if ([IO.Path]::GetFullPath($codnRoot) -ne $codnExpected) { throw 'Ruta distinta de la autorizada.' }
$codnRunId = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-cb03-init-' + [guid]::NewGuid().ToString('N').Substring(0,8)
$codnEvidence = Join-Path $codnRepo ('docs/tesis/pruebas/evidencias/' + $codnRunId)
New-Item -ItemType Directory -Path $codnEvidence | Out-Null
$codnBefore = @{
    observed_utc=[DateTime]::UtcNow.ToString('o')
    root_exists=(Test-Path -LiteralPath $codnRoot)
    datadir_exists=(Test-Path -LiteralPath (Join-Path $codnRoot 'data'))
    target_listeners=@(Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq 33363 | Select-Object LocalAddress,LocalPort,OwningProcess)
    habitual_listeners=@(Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 3306,33060 | Select-Object LocalAddress,LocalPort,OwningProcess)
    mysql_processes=@(Get-CimInstance Win32_Process -Filter "Name='mysqld.exe'" | Select-Object ProcessId,ExecutablePath)
}
$codnBefore | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $codnEvidence 'antes.json') -Encoding utf8
if ($codnBefore.root_exists -or $codnBefore.datadir_exists -or $codnBefore.target_listeners.Count -gt 0) {
    throw "Conflicto de ruta/puerto: detenido. Evidencia: $codnEvidence"
}
git -C $codnRepo check-ignore 'tmp/codn-cb03/20261103T172031Z-cb03-a3c5f7f4-mysql/data/auto.cnf' > (Join-Path $codnEvidence 'git-ignore.txt')
if ($LASTEXITCODE -ne 0) { throw 'El datadir no está excluido de Git; no inicializar.' }
$codnTracked = @(git -C $codnRepo ls-files -- 'tmp/codn-cb03/20261103T172031Z-cb03-a3c5f7f4-mysql')
if ($codnTracked.Count -ne 0) { throw 'Ruta contiene archivos rastreados; detener.' }
New-Item -ItemType Directory -Path $codnRoot | Out-Null
$codnSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $codnRoot '/inheritance:r' '/grant:r' "*$($codnSid):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' > (Join-Path $codnEvidence 'acl-preparacion.log')
if ($LASTEXITCODE -ne 0) { throw 'No se pudo restringir ACL de raíz; no inicializar.' }
foreach ($codnName in @('private','logs','work')) { New-Item -ItemType Directory -Path (Join-Path $codnRoot $codnName) | Out-Null }
& (Join-Path $PSScriptRoot 'venv/Scripts/python.exe') -B -u (Join-Path $PSScriptRoot 'codn_provision_cb03_instance.py') --initialize-authorized-instance --evidence $codnEvidence > (Join-Path $codnEvidence 'preparacion.log') 2>&1
$codnExit = $LASTEXITCODE
$codnExit | Set-Content (Join-Path $codnEvidence 'exit.txt')
$codnAfter = @{
    observed_utc=[DateTime]::UtcNow.ToString('o')
    target_listeners=@(Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq 33363 | Select-Object LocalAddress,LocalPort,OwningProcess)
    habitual_listeners=@(Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 3306,33060 | Select-Object LocalAddress,LocalPort,OwningProcess)
    mysql_processes=@(Get-CimInstance Win32_Process -Filter "Name='mysqld.exe'" | Select-Object ProcessId,ExecutablePath)
}
$codnAfter | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $codnEvidence 'despues.json') -Encoding utf8
@{run_id=$codnRunId; evidence=$codnEvidence; instance_root=$codnRoot; port=33363; exit_code=$codnExit} | ConvertTo-Json | Set-Content (Join-Path $codnRepo 'docs/tesis/pruebas/instancia_cb03_actual.json') -Encoding utf8
Get-Content (Join-Path $codnEvidence 'preparacion.log')
Write-Output "EVIDENCIA: $codnEvidence"
if ($codnExit -ne 0) { throw 'Inicialización/arranque no completado; detener y revisar evidencia.' }
$codnResult = Get-Content (Join-Path $codnEvidence 'inicializacion-arranque.json') -Raw | ConvertFrom-Json
if ($codnAfter.target_listeners.Count -ne 1 -or $codnAfter.target_listeners[0].LocalAddress -ne '127.0.0.1' -or $codnAfter.target_listeners[0].OwningProcess -ne $codnResult.server_pid) {
    throw 'Listener final no coincide con el proceso nuevo; detener procedimiento.'
}
