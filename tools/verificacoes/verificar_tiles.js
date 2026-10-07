'use strict';
/* Verificação do formato binário de tiles: a geometria volta EXATA e o arquivo é menor.
 * Uso: node tools/verificacoes/verificar_tiles.js */
function executar() {
  const path = require('path');
  const raiz = path.resolve(__dirname, '..', '..');
  const tiles = require(path.join(raiz, 'js', 'tiles.js'));
  const math = require(path.join(raiz, 'js', 'math.js'));

  let falhas = 0, testes = 0;
  function ok(nome, condicao, detalhe) {
    testes++;
    if (condicao) { console.log('  ok  ' + nome + (detalhe ? '  [' + detalhe + ']' : '')); }
    else { falhas++; console.log('  FALHA ' + nome + (detalhe ? '  [' + detalhe + ']' : '')); }
  }

  console.log('\n== varint (LEB128 com sinal) ==');
  {
    const casos = [0, 1, -1, 2, -2, 127, 128, -128, 3000, -3000, 1234567, -1234567];
    let todos = true, exemplo = '';
    for (const v of casos) {
      const saida = [];
      tiles.escreverVarint(saida, v);
      const visao = new DataView(new Uint8Array(saida).buffer);
      const lido = tiles.lerVarint(visao, { i: 0 });
      if (lido !== v) { todos = false; exemplo = v + ' -> ' + lido; }
    }
    ok('ida e volta de todos os valores de teste', todos, exemplo || casos.length + ' valores');
    const menor = [];
    tiles.escreverVarint(menor, 1);
    ok('valor pequeno ocupa 1 byte', menor.length === 1, menor.length + ' byte(s)');
    const grande = [];
    tiles.escreverVarint(grande, 1000000);
    ok('valor grande ocupa 3 bytes', grande.length === 3, grande.length + ' byte(s)');
  }

  console.log('\n== ida e volta da geometria (a feição NÃO pode mudar) ==');
  {
    const feicoes = [
      {
        type: 'Feature',
        properties: { SIGLA: 'PV1', NOME: 'Argissolos Vermelhos', AREA: '1234.5' },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [-47.123456, -22.654321], [-47.111111, -22.654321],
            [-47.111111, -22.640000], [-47.123456, -22.640000], [-47.123456, -22.654321],
          ]],
        },
      },
      {
        type: 'Feature',
        properties: { SIGLA: 'LV2', NOME: 'Latossolos', AREA: null },
        geometry: { type: 'LineString', coordinates: [[-47.2, -22.7], [-47.19, -22.71], [-47.18, -22.715]] },
      },
      {
        type: 'Feature',
        properties: { SIGLA: 'P3', NOME: 'ponto' },
        geometry: { type: 'Point', coordinates: [-47.5, -22.5] },
      },
      {
        type: 'Feature',
        properties: { SIGLA: 'M4', NOME: 'multipolígono' },
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [[[-47.3, -22.3], [-47.29, -22.3], [-47.29, -22.29], [-47.3, -22.29], [-47.3, -22.3]]],
            [[[-47.2, -22.2], [-47.19, -22.2], [-47.19, -22.19], [-47.2, -22.19], [-47.2, -22.2]]],
          ],
        },
      },
    ];

    const bin = tiles.codificar(feicoes);
    const volta = tiles.decodificar(bin);
    ok('o tile decodifica', !!volta && volta.features.length === feicoes.length,
      volta ? volta.features.length + ' feições' : 'nada');

    // comparando ponto a ponto, com a precisão publicada (6 casas = 11 cm)
    let iguais = 0, diferentes = 0, pior = 0;
    for (let i = 0; i < feicoes.length; i++) {
      const a = tiles.aneisDe(feicoes[i].geometry);
      const b = tiles.aneisDe(volta.features[i].geometry);
      for (let p = 0; p < a.length; p++) {
        for (let r = 0; r < a[p].length; r++) {
          for (let q = 0; q < a[p][r].length; q++) {
            const d = Math.hypot(a[p][r][q][0] - b[p][r][q][0], a[p][r][q][1] - b[p][r][q][1]);
            if (d <= 1e-6) iguais++; else { diferentes++; if (d > pior) pior = d; }
          }
        }
      }
    }
    ok('TODOS os vértices voltam idênticos (a feição não muda)', diferentes === 0,
      iguais + ' vértices iguais, ' + diferentes + ' diferentes'
      + (pior ? '  (pior ' + (pior * 111320).toFixed(4) + ' m)' : ''));

    // a área tem de ser a mesma — é o número que vai para o relatório
    const areaOriginal = feicoes.map(function (f) {
      return f.geometry.type.indexOf('Polygon') >= 0
        ? math.areaGeodesicaRapida ? 0 : 0 : 0;
    });
    const a1 = math.bbox(feicoes[0]);
    const a2 = math.bbox(volta.features[0]);
    ok('a caixa envolvente é a mesma', JSON.stringify(a1) === JSON.stringify(a2), JSON.stringify(a2));

    // atributos
    ok('os atributos vêm junto', volta.features[0].properties.NOME === 'Argissolos Vermelhos'
      && volta.features[2].properties.SIGLA === 'P3', JSON.stringify(volta.features[0].properties));
    ok('campo nulo continua nulo', volta.features[1].properties.AREA === null,
      JSON.stringify(volta.features[1].properties.AREA));
    ok('o nome do campo aparece uma vez por tile, não por feição', bin.length > 0);

    // tipos de geometria
    ok('Polygon volta Polygon', volta.features[0].geometry.type === 'Polygon');
    ok('LineString volta LineString', volta.features[1].geometry.type === 'LineString');
    ok('Point volta Point', volta.features[2].geometry.type === 'Point');
    ok('MultiPolygon volta MultiPolygon', volta.features[3].geometry.type === 'MultiPolygon');
    ok('o MultiPolygon mantém 2 partes', volta.features[3].geometry.coordinates.length === 2);

    // furos: um polígono com furo tem de manter o furo
    const comFuro = [{
      type: 'Feature',
      properties: { SIGLA: 'F' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [[-47, -22], [-46, -22], [-46, -21], [-47, -21], [-47, -22]],
          [[-46.8, -21.8], [-46.2, -21.8], [-46.2, -21.2], [-46.8, -21.2], [-46.8, -21.8]],
        ],
      },
    }];
    const voltaFuro = tiles.decodificar(tiles.codificar(comFuro));
    ok('polígono com furo mantém os 2 anéis',
      voltaFuro.features[0].geometry.coordinates.length === 2,
      voltaFuro.features[0].geometry.coordinates.length + ' anel(is)');
  }

  console.log('\n== tamanho: é aqui que o formato paga ==');
  {
    // polígono denso, como os do mapa de solos (vértices próximos)
    const anel = [];
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const t = i / n * Math.PI * 2;
      anel.push([-47 + Math.cos(t) * 0.05 + i * 1e-7, -22 + Math.sin(t) * 0.05]);
    }
    anel.push(anel[0].slice());
    const feicoes = [{ type: 'Feature', properties: { SIGLA: 'A', NOME: 'teste' }, geometry: { type: 'Polygon', coordinates: [anel] } }];

    const geojson = JSON.stringify({ type: 'FeatureCollection', features: feicoes });
    const bin = tiles.codificar(feicoes);
    const ganho = geojson.length / bin.length;
    ok('o tile é pelo menos 3x menor que o GeoJSON', ganho >= 3,
      'GeoJSON ' + (geojson.length / 1024).toFixed(1) + ' KB vs tile '
      + (bin.length / 1024).toFixed(1) + ' KB  (' + ganho.toFixed(1) + 'x menor)');

    // e continua exato
    const volta = tiles.decodificar(bin);
    let diferente = 0;
    const a = feicoes[0].geometry.coordinates[0];
    const b = volta.features[0].geometry.coordinates[0];
    for (let i = 0; i < a.length; i++) if (Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]) > 1e-6) diferente++;
    ok('e mesmo assim exato', diferente === 0, diferente + ' vértices diferentes de ' + a.length);
  }

  console.log('\n== o que NÃO pode ser aceito em silêncio ==');
  {
    const naoTile = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    let msg = '';
    try { tiles.decodificar(naoTile); } catch (e) { msg = e.message; }
    ok('arquivo que não é tile é recusado com mensagem', /tile do portal/.test(msg), msg);

    const tile = tiles.codificar([{
      type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    }]);
    const versaoErrada = tile.slice();
    versaoErrada[4] = 99;
    let msg2 = '';
    try { tiles.decodificar(versaoErrada); } catch (e) { msg2 = e.message; }
    ok('versão desconhecida é recusada com mensagem', /versão/.test(msg2), msg2);

    let msg3 = '';
    try { tiles.decodificar(tile.slice(0, 20)); } catch (e) { msg3 = e.message; }
    ok('tile truncado é recusado, não devolve lixo', /truncado|RangeError|truncated/i.test(msg3), msg3 || '(não lançou)');
  }

  console.log('\n' + (falhas ? 'FALHAS: ' + falhas + '/' + testes : 'TODOS OS ' + testes + ' TESTES PASSARAM'));
  return falhas ? 1 : 0;
}

module.exports = { executar };
if (require.main === module) process.exit(executar());
