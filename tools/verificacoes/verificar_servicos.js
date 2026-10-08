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
    /* SEM PAGINAÇÃO no WFS: medida no GeoServer do IPHAN: com count/startIndex ele responde
     * HTTP 400 — 'Cannot do natural order without a primary key' (a camada não tem chave
     * primária). Sem paginação, devolve tudo que cruza a caixa. */
    ok('não pede página no WFS (o servidor do IPHAN não pagina sem chave primária)',
      p.get('count') === null && p.get('startIndex') === null);

    /* O ERRO CLÁSSICO DO WFS 2.0: em EPSG:4326 a ordem do EPSG é LATITUDE,longitude. Pedir a
     * caixa em lon,lat dizendo EPSG:4326 devolve o retângulo trocado, sem erro nenhum. Por isso
     * o portal usa CRS84, que é longitude,latitude por definição. */
    /* ORDEM DE EIXOS: medida no GeoServer do IPHAN, camada SICG:sitios, extensão de SP:
     *   lon,lat sem CRS                          -> 0 feições
     *   lat,lon com urn:ogc:def:crs:EPSG::4674   -> 4.036 feições   (certo)
     *   lon,lat com o mesmo CRS                  -> 0 feições
     * O padrão do portal é o brasileiro: SIRGAS 2000, latitude,longitude. */
    ok('a caixa vai em lat,lon com EPSG:4674 (o padrão do Brasil)',
      p.get('bbox') === '-22.500000,-47.500000,-22.000000,-47.000000,' + S.CRS_PADRAO, p.get('bbox'));
    ok('o srsName acompanha o CRS da caixa', p.get('srsName') === S.CRS_PADRAO, p.get('srsName'));

    // e continua dando para pedir lon,lat (CRS84) quando o servidor exigir
    const camadaLonLat = { nome: 'x', servico: { tipo: 'wfs', url: 'https://exemplo/wfs', camada: 'a:b', eixo: 'lonlat' } };
    const pl = parametros(S.urlDaPagina(camadaLonLat, CAIXA, 0));
    ok('camada com eixo lonlat pede CRS84 em lon,lat',
      pl.get('bbox') === '-47.500000,-22.500000,-47.000000,-22.000000,' + S.CRS84, pl.get('bbox'));

    /* A VÍRGULA NÃO PODE IR CODIFICADA: o GeoServer do IPHAN responde 400 com %2C na caixa.
     * As consultas que funcionaram levaram vírgula crua. O que se confere é a CAIXA — o
     * URLSearchParams lê a caixa crua sem problema, então exigir que ele não a ache seria erro
     * do teste (foi o que estava aqui). */
    const depoisDoBbox = url.slice(url.indexOf('&bbox='));
    ok('a caixa vai CRUA na URL, sem %2C',
      url.indexOf('&bbox=-22.500000,-47.500000') > 0 && depoisDoBbox.indexOf('%2C') < 0,
      depoisDoBbox.slice(0, 60));

    ok('caixaParaWfs troca a ordem conforme o eixo',
      S.caixaParaWfs([1, 2, 3, 4], null, 'latlon').indexOf('2.000000,1.000000,4.000000,3.000000') === 0
      && S.caixaParaWfs([1, 2, 3, 4], null, 'lonlat').indexOf('1.000000,2.000000,3.000000,4.000000') === 0);

    /* O WFS NÃO PEDE PÁGINA: o GeoServer do IPHAN responde 400 a count/startIndex em camada sem
     * chave primária. Consequência que precisa ficar registrada: pedir um offset maior devolve a
     * MESMA consulta — quem pagina em WFS tem de parar pelo numberMatched, nunca pelo offset. */
    ok('no WFS o offset não entra na URL (a parada é pelo numberMatched)',
      parametros(S.urlDaPagina(camada, CAIXA, 1000)).get('startIndex') === null
      && S.temMais('wfs', { numberMatched: 2500, numberReturned: 1000 }, 1000) === true
      && S.temMais('wfs', { numberMatched: 1000, numberReturned: 1000 }, 1000) === false);
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
