param([switch]$SecondStartAuthorized)
$ErrorActionPreference = 'Stop'
if (-not $SecondStartAuthorized) { throw 'Se requiere autorización expresa del segundo arranque.' }
$codnRepo = Split-Path -Parent $PSScriptRoot
$codnRoot = Join-Path $codnRepo 'tmp/codn-cb03/20261103T172031Z-cb03-a3c5f7f4-mysql'
$codnRun = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-cb03-start2-' + [guid]::NewGuid().ToString('N').Substring(0,8)
$codnEvidence = Join-Path $codnRepo ('docs/tesis/pruebas/evidencias/' + $codnRun)
New-Item -ItemType Directory -Path $codnEvidence | Out-Null
$codnBefore = @{
    checked_utc=[DateTime]::UtcNow.ToString('o')
    target_listeners=@(Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq 33363 | Select-Object LocalAddress,LocalPort,OwningProcess)
    previous_process_present=($null -ne (Get-Process -Id 18768 -ErrorAction SilentlyContinue))
    habitual_listeners=@(Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 3306,33060 | Select-Object LocalAddress,LocalPort,OwningProcess)
    initialized_files=@('auto.cnf','ibdata1','mysql') | ForEach-Object { @{name=$_; exists=(Test-Path -LiteralPath (Join-Path $codnRoot ('data/' + $_)))} }
}
$codnBefore | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $codnEvidence 'antes.json') -Encoding utf8
if ($codnBefore.target_listeners.Count -ne 0 -or $codnBefore.previous_process_present) { throw 'Conflicto: detener sin arrancar.' }
$codnSourceHashes = @(git -C $codnRepo ls-files -m | ForEach-Object {
    if ($_ -notmatch '(^|/)\.env') { $codnItem = Get-FileHash -LiteralPath (Join-Path $codnRepo $_) -Algorithm SHA256; @{file=$_; sha256=$codnItem.Hash} }
})
ConvertTo-Json -InputObject $codnSourceHashes -Depth 5 | Set-Content (Join-Path $codnEvidence 'fuentes-previas.json') -Encoding utf8
git -C $codnRepo status --short | Set-Content (Join-Path $codnEvidence 'git-status-inicial.txt') -Encoding utf8
$codnCredentialDir = Join-Path ([IO.Path]::GetTempPath()) ('CodnCb03Credentials/' + $codnRun)
if (Test-Path -LiteralPath $codnCredentialDir) { throw 'Directorio de credencial ya existe; detener.' }
New-Item -ItemType Directory -Path $codnCredentialDir | Out-Null
$codnSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $codnCredentialDir '/inheritance:r' '/grant:r' "*$($codnSid):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' > (Join-Path $codnEvidence 'acl-credencial.log')
if ($LASTEXITCODE -ne 0) { throw 'No se pudo proteger directorio de credencial.' }
& (Join-Path $PSScriptRoot 'venv/Scripts/python.exe') -B -u (Join-Path $PSScriptRoot 'codn_resume_cb03_instance.py') --second-start-authorized --evidence $codnEvidence --credential-directory $codnCredentialDir > (Join-Path $codnEvidence 'ejecucion.log') 2>&1
$codnExit = $LASTEXITCODE
$codnExit | Set-Content (Join-Path $codnEvidence 'exit.txt')
$codnAfter = @{
    checked_utc=[DateTime]::UtcNow.ToString('o')
    target_listeners=@(Get-NetTCPConnection -State Listen | Where-Object LocalPort -eq 33363 | Select-Object LocalAddress,LocalPort,OwningProcess)
    habitual_listeners=@(Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 3306,33060 | Select-Object LocalAddress,LocalPort,OwningProcess)
}
$codnAfter | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $codnEvidence 'despues.json') -Encoding utf8
@{run_id=$codnRun; evidence=$codnEvidence; instance_root=$codnRoot; port=33363; exit_code=$codnExit} | ConvertTo-Json | Set-Content (Join-Path $codnRepo 'docs/tesis/pruebas/segundo_arranque_cb03_actual.json') -Encoding utf8
Get-Content (Join-Path $codnEvidence 'ejecucion.log')
Write-Output "EVIDENCIA: $codnEvidence"
if ($codnExit -ne 0) { throw 'Segundo arranque no completado: detener, no reintentar.' }
$codnResult = Get-Content (Join-Path $codnEvidence 'segundo-arranque.json') -Raw | ConvertFrom-Json
if ($codnAfter.target_listeners.Count -ne 1 -or $codnAfter.target_listeners[0].LocalAddress -ne '127.0.0.1' -or $codnAfter.target_listeners[0].OwningProcess -ne $codnResult.server_pid) {
    throw 'Verificación final de listener/PID no coincide.'
}
