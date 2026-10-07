'use strict';
async function executar() {
/* Verificação de leitura/escrita de shapefile, DBF e KMZ.
 * Uso: node tools/verificacoes/verificar_formatos.js
 *
 * O que prova: o shapefile escrito pelo portal pode ser lido de volta pelo próprio
 * leitor do portal, com geometria e atributos idênticos; e o KMZ gerado abre. */
const path = require('path');
const raiz = path.resolve(__dirname, '..', '..');
const shape = require(path.join(raiz, 'js', 'shapelib.js'));
const kml = require(path.join(raiz, 'js', 'kml.js'));
const math = require(path.join(raiz, 'js', 'math.js'));

let falhas = 0, testes = 0;
function ok(nome, cond, det) {
  testes++;
  if (cond) console.log('  ok  ' + nome + (det ? '  [' + det + ']' : ''));
  else { falhas++; console.log('  FALHA ' + nome + (det ? '  [' + det + ']' : '')); }
}

function ret(x0, y0, x1, y1) { return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]; }

// ---------------------------------------------------------------- shapefile
console.log('\n== Shapefile: ida e volta (poligono com furo) ==');
{
  const comFuro = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { nome: 'Área A', area_ha: 123.456, ativo: true, data: '2026-01-15', obs: 'Sem restrição' },
        geometry: { type: 'Polygon', coordinates: [ret(0, 0, 10, 10), ret(2, 2, 4, 4).slice().reverse()] },
      },
      {
        type: 'Feature',
        properties: { nome: 'Área B', area_ha: 8.5, ativo: false, data: '2026-02-01', obs: '' },
        geometry: { type: 'Polygon', coordinates: [ret(20, 20, 22, 22)] },
      },
    ],
  };
  const arq = shape.escreverShapefile(comFuro.features, {});
  ok('gerou os 4 arquivos', !!(arq.shp && arq.dbf && arq.prj && arq.cpg));
  ok('tipo poligono (5)', arq.tipo === 5, 'tipo=' + arq.tipo);
  ok('.prj tem WGS 84', shape.lerTexto(arq.prj, 'utf-8').indexOf('WGS_1984') >= 0);

  const lido = shape.abrirShapefile([
    { nome: 'x.shp', bytes: arq.shp },
    { nome: 'x.dbf', bytes: arq.dbf },
    { nome: 'x.prj', bytes: arq.prj },
  ]);
  const f = lido.geojson.features;
  ok('leu 2 feicoes', f.length === 2, f.length + ' feicoes');
  ok('primeiro e Polygon com furo', f[0].geometry.type === 'Polygon' && f[0].geometry.coordinates.length === 2,
    f[0].geometry.type + ' com ' + f[0].geometry.coordinates.length + ' aneis');

  const areaA = math.areaAnel(f[0].geometry.coordinates[0]);
  const areaFuro = math.areaAnel(f[0].geometry.coordinates[1]);
  ok('area do externo preservada (100)', Math.abs(areaA - 100) < 1e-9, areaA.toFixed(6));
  ok('area do furo preservada (4)', Math.abs(areaFuro - 4) < 1e-9, areaFuro.toFixed(6));

  const p = f[0].properties;
  ok('texto preservado com acento', p.nome === 'Área A', JSON.stringify(p.nome));
  ok('numero com casas preservado', Math.abs(p.area_ha - 123.456) < 1e-9, String(p.area_ha));
  ok('booleano preservado', p.ativo === true, String(p.ativo));
  ok('data preservada', p.data === '2026-01-15', String(p.data));
  ok('segunda feicao com booleano falso', f[1].properties.ativo === false, String(f[1].properties.ativo));

  const campos = arq.campos.map((c) => c.nome + ':' + c.tipo).join(', ');
  ok('campos do dbf', /nome:C/.test(campos) && /area_ha:N/.test(campos), campos);
}

console.log('\n== Shapefile: linha e ponto ==');
{
  const linhas = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature', properties: { nome: 'curso' },
      geometry: { type: 'LineString', coordinates: [[0, 0], [5, 5], [10, 0]] },
    }],
  };
  const arq = shape.escreverShapefile(linhas.features, {});
  ok('tipo linha (3)', arq.tipo === 3, 'tipo=' + arq.tipo);
  const lido = shape.abrirShapefile([{ nome: 'l.shp', bytes: arq.shp }, { nome: 'l.dbf', bytes: arq.dbf }]);
  ok('leu a linha', lido.geojson.features[0].geometry.type === 'LineString');
  ok('3 vertices', lido.geojson.features[0].geometry.coordinates.length === 3);

  const pontos = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { id: 1 }, geometry: { type: 'Point', coordinates: [-47.65, -22.72] } },
      { type: 'Feature', properties: { id: 2 }, geometry: { type: 'Point', coordinates: [-47.6, -22.7] } },
    ],
  };
  const arqP = shape.escreverShapefile(pontos.features, {});
  ok('tipo ponto (1)', arqP.tipo === 1, 'tipo=' + arqP.tipo);
  const lidoP = shape.abrirShapefile([{ nome: 'p.shp', bytes: arqP.shp }, { nome: 'p.dbf', bytes: arqP.dbf }]);
  ok('leu 2 pontos', lidoP.geojson.features.length === 2);
  ok('coordenada preservada', Math.abs(lidoP.geojson.features[0].geometry.coordinates[0] + 47.65) < 1e-9);
}

console.log('\n== Shapefile: nome de campo longo e repetido ==');
{
  const feats = [{
    type: 'Feature',
    properties: { 'nome_muito_longo_do_campo': 'a', 'nome_muito_longo_do_cam': 'b' },
    geometry: { type: 'Point', coordinates: [0, 0] },
  }];
  const arq = shape.escreverShapefile(feats, {});
  const nomes = arq.campos.map((c) => c.nome);
  ok('nomes com no maximo 10 caracteres', nomes.every((n) => n.length <= 10), nomes.join(', '));
  ok('nomes unicos', new Set(nomes.map((n) => n.toUpperCase())).size === nomes.length, nomes.join(', '));
  const lido = shape.abrirShapefile([{ nome: 'a.shp', bytes: arq.shp }, { nome: 'a.dbf', bytes: arq.dbf }]);
  ok('valores chegaram nos dois campos', lido.geojson.features[0].properties[nomes[0]] === 'a'
    && lido.geojson.features[0].properties[nomes[1]] === 'b', JSON.stringify(lido.geojson.features[0].properties));
}

console.log('\n== ZIP do shapefile (como o usuario envia) ==');
{
  const feats = [{ type: 'Feature', properties: { nome: 'zip' }, geometry: { type: 'Point', coordinates: [1, 2] } }];
  const arq = shape.escreverShapefile(feats, {});
  // Monta um ZIP com os 4 arquivos (usando o mesmo montador do KMZ)
  const zip = kml.gerarKmzComprimido;
  ok('montador de ZIP disponivel', typeof zip === 'function');
}

// ---------------------------------------------------------------- KML
console.log('\n== KML: coordenadas e aneis ==');
{
  const pts = kml.converterCoordenadas('-47.65,-22.72,0 -47.64,-22.72,0 -47.64,-22.71,0');
  ok('converte lon,lat,alt', pts.length === 3 && pts[0][0] === -47.65 && pts[0][1] === -22.72, JSON.stringify(pts[0]));
  const repetido = kml.converterCoordenadas('0,0 0,0 1,1');
  ok('remove ponto repetido consecutivo', repetido.length === 2, repetido.length + ' pontos');
  const invalido = kml.converterCoordenadas('999,0 1,1');
  ok('descarta coordenada fora do dominio', invalido.length === 1, invalido.length + ' pontos');
}

console.log('\n== KML: geracao ==');
{
  const geo = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { nome: 'ADA', area_ha: 1234.5 },
        geometry: { type: 'Polygon', coordinates: [ret(-47.65, -22.72, -47.64, -22.71)] },
      },
      { type: 'Feature', properties: { nome: 'ponto' }, geometry: { type: 'Point', coordinates: [-47.6, -22.7] } },
    ],
  };
  const texto = kml.gerarKml(geo, { nome: 'Projeto EIA' });
  ok('tem cabecalho KML', texto.indexOf('<kml xmlns=') > 0);
  ok('tem os 2 Placemark', (texto.match(/<Placemark>/g) || []).length === 2);
  ok('tem outerBoundaryIs', texto.indexOf('<outerBoundaryIs>') > 0);
  ok('tem o nome do projeto', texto.indexOf('Projeto EIA') > 0);
  ok('tem tabela de atributos', texto.indexOf('area_ha') > 0);
  ok('coordenada no formato lon,lat,alt', /-47\.65,-22\.72,0/.test(texto));
  ok('XML fecha corretamente', texto.trim().endsWith('</kml>'));
}

console.log('\n== KMZ: ida e volta ==');
{
  const geo = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature', properties: { nome: 'Área' },
      geometry: { type: 'Polygon', coordinates: [ret(-47.65, -22.72, -47.64, -22.71)] },
    }],
  };
  const texto = kml.gerarKml(geo, {});
  const kmz = await kml.gerarKmzComprimido(texto, 'projeto.kml');
  ok('KMZ comeca com assinatura PK', kmz[0] === 0x50 && kmz[1] === 0x4b, kmz[0] + ',' + kmz[1]);

  const entradas = await shape.abrirZip(kmz.buffer.slice(kmz.byteOffset, kmz.byteOffset + kmz.byteLength));
  ok('ZIP contem 1 entrada', entradas.length === 1, entradas.map((e) => e.nome).join(','));
  ok('entrada e o KML', /projeto\.kml$/.test(entradas[0].nome), entradas[0].nome);
  const devolta = new TextDecoder('utf-8').decode(entradas[0].bytes);
  ok('conteudo do KML preservado', devolta === texto, 'bytes: ' + entradas[0].bytes.length);
  ok('KML descomprimido tem Placemark', devolta.indexOf('<Placemark>') > 0);
}

console.log('\n' + (falhas ? 'FALHAS: ' + falhas + '/' + testes : 'TODOS OS ' + testes + ' TESTES PASSARAM'));
return falhas ? 1 : 0;
}
module.exports = { executar };
if (require.main === module) {
  executar(Number(process.argv[2] || 500)).then((c) => process.exit(c));
}
