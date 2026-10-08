# ============================================================================
# publicar_ugrhis.ps1 — lote das 22 UGRHIs do Inventário Florestal 2020
#
# Para cada UGRHI: baixa o SHAPE-ZIP do DataGEO (endpoint por UGRHI, um pedido só), descompacta,
# converte para GeoJSON sem simplificar, gera os tiles (exato + visão de longe) e comprime.
#
# Cada etapa é conferida e registrada. Se uma UGRHI falhar, o lote CONTINUA nas outras e o
# resumo no fim diz quais ficaram pendentes — um lote longo não pode parar inteiro por causa de
# uma unidade.
#
# Uso: pwsh -File tools/publicar_ugrhis.ps1            (todas)
#      pwsh -File tools/publicar_ugrhis.ps1 17 18      (algumas)
# ============================================================================
param([int[]]$Numeros)

$ErrorActionPreference = 'Continue'
$raiz = Split-Path -Parent $PSScriptRoot
Push-Location $raiz
$log = Join-Path $raiz 'tools/_lote.log'
"lote iniciado em $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Set-Content $log

$lista = if ($Numeros -and $Numeros.Count) { $Numeros } else { 1..22 }
$falhas = @()
$feitas = @()

foreach ($n in $lista) {
  $id = "inventario-ugrhi-$n"
  "`n=== UGRHI $n ($id) ===" | Add-Content $log
  try {
    # 1) baixar (se o ZIP não estiver aqui)
    $zip = Join-Path $raiz "tools/_ugrhi$n.zip"
    if (-not (Test-Path $zip)) {
      node --max-old-space-size=4096 tools/_ugrhi.js baixar $n *>> $log
      if ($LASTEXITCODE -ne 0) { throw "download falhou (exit $LASTEXITCODE)" }
    } else {
      "  ZIP já estava baixado" | Add-Content $log
    }

    # 2) descompactar
    $pasta = Join-Path $raiz "tools/_ugrhi$n"
    if (-not (Test-Path $pasta)) {
      Expand-Archive -Path $zip -DestinationPath $pasta -Force
      "  descompactado" | Add-Content $log
    }

    # 3) converter (sem simplificar nada)
    node --max-old-space-size=6144 tools/inventario_ugrhi.js $n *>> $log
    if ($LASTEXITCODE -ne 0) { throw "conversão falhou (exit $LASTEXITCODE)" }

    # 4) tiles: exato (o dado) e visão de longe (desenho generalizado)
    node --max-old-space-size=6144 tools/gerar_tiles.js $id --de "data/$id.geojson" --nivel exato --celula 0.06 --alvo-mb 0.3 *>> $log
    if ($LASTEXITCODE -ne 0) { throw "tiles exato falharam (exit $LASTEXITCODE)" }
    node --max-old-space-size=6144 tools/gerar_tiles.js $id --de "data/$id.geojson" --nivel visao --celula 0.6 --alvo-mb 1.2 --escala 4000000 *>> $log
    if ($LASTEXITCODE -ne 0) { throw "tiles de visão falharam (exit $LASTEXITCODE)" }

    # 5) o GeoJSON de origem sai (os tiles são a cópia fiel) — só depois dos tiles prontos
    Remove-Item "data/$id.geojson" -Force -ErrorAction SilentlyContinue

    $feitas += $n
    "  OK" | Add-Content $log
  } catch {
    $falhas += "$n ($_)"
    "  FALHOU: $_" | Add-Content $log
  }
}

# 6) comprimir tudo de uma vez (o compressor lê o catálogo; aqui ele roda por pasta)
"`n=== comprimindo ===" | Add-Content $log
foreach ($n in $feitas) {
  node tools/comprimir_tiles.js "inventario-ugrhi-$n" *>> $log
}

"`n=== RESUMO ===" | Add-Content $log
"  concluídas: $($feitas.Count) -> $($feitas -join ', ')" | Add-Content $log
if ($falhas.Count) { "  FALHARAM: $($falhas -join ' | ')" | Add-Content $log } else { "  nenhuma falha" | Add-Content $log }
Get-Content $log -Tail 6
Pop-Location
