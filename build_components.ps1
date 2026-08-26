# build_components.ps1
# Regenera los archivos .js de componentes a partir de sus .html fuente
# Uso: .\build_components.ps1

function Build-ComponentJS {
    param(
        [string]$HtmlPath,
        [string]$JsPath,
        [string]$VarName
    )
    $html = [System.IO.File]::ReadAllText($HtmlPath, [System.Text.Encoding]::UTF8)
    $json = $html | ConvertTo-Json -Compress
    $content = "/* AUTO-GENERADO - No editar directamente. */`n/* Fuente: $([System.IO.Path]::GetFileName($HtmlPath)) */`nwindow.$VarName = $json;"
    [System.IO.File]::WriteAllText($JsPath, $content, [System.Text.Encoding]::UTF8)
    $size = (Get-Item $JsPath).Length
    Write-Host "OK: $([System.IO.Path]::GetFileName($JsPath)) regenerado. Tamanio: $size bytes"
}

$base = Split-Path $MyInvocation.MyCommand.Path

Build-ComponentJS `
    -HtmlPath "$base\components\etapa1BCMO.html" `
    -JsPath   "$base\components\etapa1BCMO.js" `
    -VarName  "__COMP_ETAPA1_BCMO__"

Build-ComponentJS `
    -HtmlPath "$base\components\etapa2Consolidacion.html" `
    -JsPath   "$base\components\etapa2Consolidacion.js" `
    -VarName  "__COMP_ETAPA2_CONSOLIDACION__"

Write-Host "`nListo. Recargue index.html en el navegador."
