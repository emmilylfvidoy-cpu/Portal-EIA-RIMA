'use strict';
/* ============================================================================
 * verificar_recorte_areas.js — o recorte respeita a ESTRUTURA da área de influência?
 *
 * A invariante que este teste usa não depende de conta complicada: se a área de influência
 * CONTÉM as feições, a soma das áreas recortadas tem de ser IGUAL à soma das áreas originais.
 * Vale para área de um polígono, de vários polígonos (MultiPolygon) e com furo.
 *
 * Foi este o defeito encontrado com os arquivos do cliente: área multiparte devolvia ZERO,
 * porque o segundo polígono em diante virava FURO do primeiro. A área de influência "AID Socio"
 * (4 partes) dava 0 feições; a "AID Meios Físico e Biótico" (1 parte) dava 121.
 *
 * Uso: node tools/verificacoes/verificar_recorte_areas.js
 * ========================================================================== */
function executar() {
  const path = require('path');
  const raiz = path.resolve(__dirname, '..', '..');
  const EIA = {
    math: require(path.join(raiz, 'js', 'math.js')),
    vetorial: require(path.join(raiz, 'js', 'vetorial.js')),
    recorte: require(path.join(raiz, 'js', 'recorte.js')),
  };
  global.EIA = EIA;

  let falhas = 0, testes = 0;
  function ok(nome, condicao, detalhe) {
    testes++;
    if (condicao) console.log('  ok  ' + nome + (detalhe ? '  [' + detalhe + ']' : ''));
    else { falhas++; console.log('  FALHA ' + nome + (detalhe ? '  [' + detalhe + ']' : '')); }
  }

  // ---- o sujeito: quatro quadrados de 0,01° lado a lado, na mesma latitude
  const quadrado = (lon, lat, lado) => ({
    type: 'Polygon',
    coordinates: [[
      [lon, lat], [lon + lado, lat], [lon + lado, lat + lado], [lon, lat + lado], [lon, lat],
    ]],
  });
  const LADO = 0.01, LAT = -23.5;
  const sujeito = {
    type: 'FeatureCollection',
    features: [-45.06, -45.04, -45.02, -45.0].map((lon, i) => ({
      type: 'Feature', properties: { id: i }, geometry: quadrado(lon, LAT, LADO),
    })),
  };
  const camada = {
    id: 'teste', nome: 'Camada de teste', meio: 'fisico', campo_classe: 'id',
    geojson: sujeito, campos: [{ nome: 'id', tipo: 'N', rotulo: 'id' }], tipo: 'poligono',
  };

  // área de referência: a soma das áreas das quatro feições (calculada pelo próprio portal)
  const areaOriginal = sujeito.features.reduce((s, f) => s + EIA.recorte.areaHectares(f.geometry) / 10000, 0);

  function recortar(geometriaArea, nomeArea) {
    const areas = [{ id: 'ai', nome: nomeArea, sigla: nomeArea, geometry: geometriaArea, area_ha: 0 }];
    const r = EIA.recorte.recortarTudo(areas, [camada], { operacao: 'intersecao', areaMinimaHa: 0, simplificar: 0 });
    const res = r.resultados || [];
    const feicoes = res.reduce((s, x) => s + (x.features ? x.features.length : 0), 0);
    const ha = res.reduce((s, x) => s + (x.features || []).reduce((t, f) => t + (Number(f.properties.eia_area_ha) || 0), 0), 0);
    return { feicoes, ha, descartadas: r.resumo ? r.resumo.descartadas : undefined };
  }

  console.log('\n== área de UM polígono (o caso que sempre funcionou) ==');
  {
    const caixa = {
      type: 'Polygon',
      coordinates: [[[-45.10, -23.55], [-44.95, -23.55], [-44.95, -23.45], [-45.10, -23.45], [-45.10, -23.55]]],
    };
    const r = recortar(caixa, 'UM');
    ok('contém tudo -> recorta tudo', Math.abs(r.ha - areaOriginal) < areaOriginal * 1e-6,
      r.feicoes + ' feições, ' + r.ha.toFixed(4) + ' ha de ' + areaOriginal.toFixed(4) + ' ha');
  }

  console.log('\n== área de VÁRIOS polígonos (MultiPolygon) — o defeito encontrado ==');
  {
    // duas caixas que juntas contêm as quatro feições: 1ª cobre as duas da esquerda, 2ª as da direita
    const multi = {
      type: 'MultiPolygon',
      coordinates: [
        [[[-45.075, -23.55], [-45.03, -23.55], [-45.03, -23.45], [-45.075, -23.45], [-45.075, -23.55]]],
        [[[-45.03, -23.55], [-44.95, -23.55], [-44.95, -23.45], [-45.03, -23.45], [-45.03, -23.55]]],
      ],
    };
    const r = recortar(multi, 'MULTI');
    ok('as duas partes juntas contêm tudo -> recorta tudo', Math.abs(r.ha - areaOriginal) < areaOriginal * 1e-6,
      r.feicoes + ' feições, ' + r.ha.toFixed(4) + ' ha de ' + areaOriginal.toFixed(4) + ' ha'
      + (Math.abs(r.ha - areaOriginal) >= areaOriginal * 1e-6 ? '   <-- PERDEU ÁREA' : ''));
  }

  console.log('\n== área com FURO (o furo não pode virar parte) ==');
  {
    const comFuro = {
      type: 'Polygon',
      coordinates: [
        [[-45.10, -23.55], [-44.95, -23.55], [-44.95, -23.45], [-45.10, -23.45], [-45.10, -23.55]],
        // furo DENTRO DO VÃO entre as manchas (as manchas vão de -45,06 a -45,05, de -45,04 a
        // -45,03, de -45,02 a -45,01 e de -45,00 a -44,99: os vãos são -45,05..-45,04 etc.).
        // A primeira versão deste teste punha o furo em -45,035..-45,025, que INVADE a mancha de
        // -45,04..-45,03 — e aí o desconto de área estava certo e o teste é que estava errado.
        [[-45.048, -23.51], [-45.042, -23.51], [-45.042, -23.49], [-45.048, -23.49], [-45.048, -23.51]],
      ],
    };
    const r = recortar(comFuro, 'FURO');
    ok('furo que não toca as feições -> recorta tudo', Math.abs(r.ha - areaOriginal) < areaOriginal * 1e-6,
      r.feicoes + ' feições, ' + r.ha.toFixed(4) + ' ha');
  }

  console.log('\n== área multiparte com uma parte LONGE (não pode atrapalhar) ==');
  {
    const longe = {
      type: 'MultiPolygon',
      coordinates: [
        [[[-45.10, -23.55], [-44.95, -23.55], [-44.95, -23.45], [-45.10, -23.45], [-45.10, -23.55]]],
        [[[-40.00, -20.00], [-39.99, -20.00], [-39.99, -19.99], [-40.00, -19.99], [-40.00, -20.00]]],
      ],
    };
    const r = recortar(longe, 'LONGE');
    ok('parte longe vazia não muda o resultado', Math.abs(r.ha - areaOriginal) < areaOriginal * 1e-6,
      r.feicoes + ' feições, ' + r.ha.toFixed(4) + ' ha');
  }

  console.log('\n== área que NÃO cobre nada (tem de dar zero, e não erro) ==');
  {
    const fora = {
      type: 'Polygon',
      coordinates: [[[-46.10, -24.55], [-46.09, -24.55], [-46.09, -24.54], [-46.10, -24.54], [-46.10, -24.55]]],
    };
    const r = recortar(fora, 'FORA');
    ok('área longe das feições -> zero feições, sem lançar', r.feicoes === 0, r.feicoes + ' feições');
  }

  console.log('\n' + (falhas ? 'FALHAS: ' + falhas + '/' + testes : 'TODOS OS ' + testes + ' TESTES PASSARAM'));
  return falhas ? 1 : 0;
}

module.exports = { executar };
if (require.main === module) process.exit(executar());
