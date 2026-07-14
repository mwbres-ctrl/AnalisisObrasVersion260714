# ============================================================
# Script para generar los archivos JS de componentes HTML
# Permite carga de componentes sin fetch() (funciona con file://)
# ============================================================

$basePath = 'c:\Users\mcastellano\Desktop\4 - Analisis de faltante de obras Antigravity Engine'
$compPath = Join-Path $basePath 'components'

function ConvertHtmlToJsComponent {
    param(
        [string]$htmlFile,
        [string]$jsFile,
        [string]$varName
    )
    
    # Leer el HTML
    $html = [System.IO.File]::ReadAllText($htmlFile, [System.Text.Encoding]::UTF8)
    
    # Escapar caracteres especiales para JSON (lo usamos como JSON string, no template literal)
    # Esto evita problemas con backticks y ${ en el HTML
    $jsonStr = $html | ConvertTo-Json -Compress
    
    # Construir el JS
    $js = @"
/* AUTO-GENERADO - No editar directamente. */
/* Fuente: $([System.IO.Path]::GetFileName($htmlFile)) */
window.$varName = $jsonStr;
"@
    
    [System.IO.File]::WriteAllText($jsFile, $js, [System.Text.Encoding]::UTF8)
    $size = [System.IO.FileInfo]::new($jsFile).Length
    Write-Host "[OK] $([System.IO.Path]::GetFileName($jsFile)) generado ($size bytes)"
}

# Generar etapa1BCMO.js
ConvertHtmlToJsComponent `
    -htmlFile (Join-Path $compPath 'etapa1BCMO.html') `
    -jsFile   (Join-Path $compPath 'etapa1BCMO.js') `
    -varName  '__COMP_ETAPA1_BCMO__'

# Generar etapa2Consolidacion.js
ConvertHtmlToJsComponent `
    -htmlFile (Join-Path $compPath 'etapa2Consolidacion.html') `
    -jsFile   (Join-Path $compPath 'etapa2Consolidacion.js') `
    -varName  '__COMP_ETAPA2_CONSOLIDACION__'

Write-Host ""
Write-Host "=== Archivos JS generados ==="
Get-ChildItem (Join-Path $compPath '*.js') | Select-Object Name, Length | Format-Table -AutoSize
Write-Host "Listo. Ahora actualizar el loader en el HTML principal."
