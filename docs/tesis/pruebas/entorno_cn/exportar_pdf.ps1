$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../../..'))
$docxPath = Join-Path $projectRoot 'docs/tesis/pruebas/INFORME_CONSOLIDADO_PRUEBAS_CODN.docx'
$pdfPath = Join-Path $projectRoot 'docs/tesis/pruebas/INFORME_CONSOLIDADO_PRUEBAS_CODN.pdf'
$wordApp = $null
$ownDocument = $null
$isolated = $false
try {
    # Create a separate authoring instance; never attach to the user's active document.
    $wordApp = New-Object -ComObject Word.Application
    if ($wordApp.Documents.Count -ne 0) { throw 'La instancia recibida contiene documentos ajenos. Se cancela sin alterarlos.' }
    $isolated = $true
    $wordApp.Visible = $false
    $wordApp.DisplayAlerts = 0
    $ownDocument = $wordApp.Documents.Open($docxPath, $false, $true)
    $ownDocument.Repaginate()
    $pageCount = $ownDocument.ComputeStatistics(2)
    $ownDocument.ExportAsFixedFormat($pdfPath, 17)
    Write-Output "PDF exportado desde Word. Paginas: $pageCount"
} finally {
    if ($null -ne $ownDocument) {
        $ownDocument.Close(0)
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($ownDocument)
    }
    if ($null -ne $wordApp) {
        if ($isolated -and $wordApp.Documents.Count -eq 0) { $wordApp.Quit(0) }
        [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($wordApp)
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}
