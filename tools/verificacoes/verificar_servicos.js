'use strict';
/* Verificação dos montadores de consulta das camadas AO VIVO (ArcGIS e WFS).
 * São as duas coisas que quebram em silêncio: a URL e a decisão de paginar.
 * Uso: node tools/verificacoes/verificar_servicos.js */
function executar() {
  const path = require('path');
  const raiz = path.resolve(__dirname, '..', '..');
  const S = require(path.join(raiz, 'js', 'servicos.js'));

  let falhas = 0, testes = 0;
  function ok(nome, condicao, detalhe) {
    testes++;
    if (condicao) console.log('  ok  ' + nome + (detalhe ? '  [' + detalhe + ']' : ''));
    else { falhas++; console.log('  FALHA ' + nome + (detalhe ? '  [' + detalhe + ']' : '')); }
  }
  const parametros = (url) => new URLSearchParams(url.slice(url.indexOf('?') + 1));
  const CAIXA = [-47.5, -22.5, -47.0, -22.0];

  console.log('\n== ArcGIS (o serviço da CETESB, que já está no portal) ==');
  {
    const camada = {
      id: 'x', nome: 'Teste', campo_classe: 'Sigla_DG',
      servico: { tipo: 'arcgis', url: 'https://exemplo/MapServer/2' },
    };
    const url = S.urlDaPagina(camada, CAIXA, 0);
    const p = parametros(url);
    ok('endereço termina em /query', /\/MapServer\/2\/query\?/.test(url), url.slice(0, 48) + '…');
    ok('pede GeoJSON', p.get('f') === 'geojson', p.get('f'));
    ok('pede todos os campos e a geometria', p.get('outFields') === '*' && p.get('returnGeometry') === 'true');
    ok('caixa em lon,lat (EPSG:4326 do ArcGIS é assim)', p.get('geometry') === '-47.500000,-22.500000,-47.000000,-22.000000',
      p.get('geometry'));
    ok('filtro por interseção de envelope', p.get('spatialRel') === 'esriSpatialRelIntersects');
    ok('página começa em 0 e vale 1000', p.get('resultOffset') === '0' && p.get('resultRecordCount') === '1000');

    const url2 = S.urlDaPagina(camada, CAIXA, 2000);
    ok('offset da segunda chamada entra na URL', parametros(url2).get('resultOffset') === '2000');
  }

  console.log('\n== WFS (GeoServer, MapServer, deegree: o padrão OGC) ==');
  {
    const camada = {
      id: 'y', nome: 'APA', campo_classe: 'nome',
      servico: { tipo: 'wfs', url: 'https://exemplo/geoserver/wfs', camada: 'INEA:apa_dos_frades' },
    };
    const url = S.urlDaPagina(camada, CAIXA, 0);
    const p = parametros(url);
    ok('endereço é o do WFS, sem /query', /\/geoserver\/wfs\?/.test(url) && url.indexOf('/query') < 0);
    ok('operação GetFeature', p.get('request') === 'GetFeature' && p.get('service') === 'WFS');
    ok('camada pedida por typeNames', p.get('typeNames') === 'INEA:apa_dos_frades', p.get('typeNames'));
    ok('pede GeoJSON', p.get('outputFormat') === 'application/json');
    ok('página por count e startIndex', p.get('count') === '1000' && p.get('startIndex') === '0');

    /* O ERRO CLÁSSICO DO WFS 2.0: em EPSG:4326 a ordem do EPSG é LATITUDE,longitude. Pedir a
     * caixa em lon,lat dizendo EPSG:4326 devolve o retângulo trocado, sem erro nenhum. Por isso
     * o portal usa CRS84, que é longitude,latitude por definição. */
    ok('a caixa usa CRS84 (lon,lat), não EPSG:4326 (que no WFS 2.0 é lat,lon)',
      p.get('bbox') === '-47.500000,-22.500000,-47.000000,-22.000000,' + S.CRS84, p.get('bbox'));
    ok('o srsName também é CRS84', p.get('srsName') === S.CRS84, p.get('srsName'));
    ok('a URL não usa EPSG:4326 na caixa', p.get('bbox').indexOf('EPSG:4326') < 0);

    ok('offset entra como startIndex', parametros(S.urlDaPagina(camada, CAIXA, 1000)).get('startIndex') === '1000');
  }

  console.log('\n== paginação: cada serviço avisa de um jeito ==');
  {
    ok('ArcGIS: exceededTransferLimit true = tem mais', S.temMais('arcgis', { exceededTransferLimit: true }, 1000) === true);
    ok('ArcGIS: sem o campo = acabou', S.temMais('arcgis', {}, 1000) === false);
    ok('ArcGIS: resposta vazia = acabou', S.temMais('arcgis', { exceededTransferLimit: true }, 0) === false);

    ok('WFS: numberMatched maior que o devolvido = tem mais',
      S.temMais('wfs', { numberMatched: 2500, numberReturned: 1000 }, 1000) === true);
    ok('WFS: numberMatched igual = acabou',
      S.temMais('wfs', { numberMatched: 879, numberReturned: 879 }, 879) === false);
    ok('WFS: sem numberMatched, página cheia indica mais',
      S.temMais('wfs', {}, 1000) === true);
    ok('WFS: página incompleta = acabou', S.temMais('wfs', {}, 379) === false);
    ok('WFS: a resposta real do GeoServer do INDE (1 de 1) encerra',
      S.temMais('wfs', { totalFeatures: 1, numberMatched: 1, numberReturned: 1 }, 1) === false);
  }

  console.log('\n== resposta dos serviços ==');
  {
    const fc = { type: 'FeatureCollection', features: [{ type: 'Feature' }] };
    ok('aceita FeatureCollection', S.feicoesDe(fc).length === 1);
    ok('erro do serviço vira exceção com a mensagem dele', (() => {
      try { S.feicoesDe({ error: { code: 400, message: 'Failed to execute query.' } }); return false; }
      catch (e) { return /Failed to execute query/.test(e.message); }
    })());
    ok('resposta vazia devolve lista vazia', S.feicoesDe({}).length === 0 && S.feicoesDe(null).length === 0);
  }

  console.log('\n== o erro tem de dizer o que fazer ==');
  {
    const m = S.explicarFalha({ nome: 'Áreas Contaminadas', servico: { tipo: 'wfs' } }, 'Failed to fetch');
    ok('cita a camada, o tipo de serviço e o caminho (CORS / foto na base)',
      /Áreas Contaminadas/.test(m) && /WFS/.test(m) && /CORS/.test(m) && /foto/.test(m), m.slice(0, 90) + '…');
    ok('sem serviço declarado assume arcgis (as camadas que já existem)',
      S.tipoDe({ servico: { url: 'x' } }) === 'arcgis');
    ok('camada sem serviço devolve null', S.tipoDe({ id: 'z' }) === null);
  }

  console.log('\n' + (falhas ? 'FALHAS: ' + falhas + '/' + testes : 'TODOS OS ' + testes + ' TESTES PASSARAM'));
  return falhas ? 1 : 0;
}

module.exports = { executar };
if (require.main === module) process.exit(executar());
