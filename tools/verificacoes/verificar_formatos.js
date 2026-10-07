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

console.log('\n== Layout contra a ESPECIFICACAO ESRI (codigo independente) ==');
{
  /* POR QUE ESTE BLOCO EXISTE
   * O teste de ida e volta acima NAO pega erro de layout: se o escritor e o leitor
   * erram os mesmos 4 bytes, o dado volta certo e o arquivo sai invalido para o QGIS.
   * Foi exatamente o que aconteceu (NumParts gravado em +32, dentro do double do
   * Ymax). Aqui os campos sao lidos e escritos com DataView cru, nos deslocamentos da
   * especificacao, sem passar por nenhuma funcao do portal. */

  function escreverInt32(v, pos, valor) { v.setInt32(pos, valor, true); }
  function escreverFloat64(v, pos, valor) { v.setFloat64(pos, valor, true); }

  // ---- 1) o que o portal ESCREVE segue a especificacao?
  const feats = [{
    type: 'Feature',
    properties: { nome: 'x' },
    geometry: { type: 'Polygon', coordinates: [ret(0, 0, 10, 10)] },
  }];
  const arq = shape.escreverShapefile(feats, {});
  const v = new DataView(arq.shp.buffer, arq.shp.byteOffset, arq.shp.length);
  const base = 108;   // 100 do cabecalho + 8 do cabecalho do registro

  ok('escritor: tipo em +0', v.getInt32(base, true) === 5, String(v.getInt32(base, true)));
  ok('escritor: Xmin em +4', v.getFloat64(base + 4, true) === 0, String(v.getFloat64(base + 4, true)));
  ok('escritor: Ymin em +12', v.getFloat64(base + 12, true) === 0, String(v.getFloat64(base + 12, true)));
  ok('escritor: Xmax em +20', v.getFloat64(base + 20, true) === 10, String(v.getFloat64(base + 20, true)));
  ok('escritor: Ymax em +28 (NAO pode estar corrompido)', v.getFloat64(base + 28, true) === 10,
    String(v.getFloat64(base + 28, true)));
  ok('escritor: NumParts em +36', v.getInt32(base + 36, true) === 1, String(v.getInt32(base + 36, true)));
  ok('escritor: NumPoints em +40', v.getInt32(base + 40, true) === 5, String(v.getInt32(base + 40, true)));
  ok('escritor: Parts[0] em +44', v.getInt32(base + 44, true) === 0, String(v.getInt32(base + 44, true)));
  ok('escritor: primeiro ponto em +48', v.getFloat64(base + 48, true) === 0 && v.getFloat64(base + 56, true) === 0,
    v.getFloat64(base + 48, true) + ',' + v.getFloat64(base + 56, true));

  const tamanhoConteudo = v.getInt32(104, false) * 2;
  ok('escritor: tamanho do registro = 44 + 4·nParts + 16·nPontos', tamanhoConteudo === 44 + 4 + 5 * 16,
    tamanhoConteudo + ' bytes');

  // a bbox do cabecalho do arquivo tem de casar com a dos registros
  ok('escritor: bbox do cabecalho bate com a do registro',
    v.getFloat64(36, true) === 0 && v.getFloat64(44, true) === 0
    && v.getFloat64(52, true) === 10 && v.getFloat64(60, true) === 10,
    [v.getFloat64(36, true), v.getFloat64(44, true), v.getFloat64(52, true), v.getFloat64(60, true)].join(', '));

  // ---- 2) o portal LE um arquivo montado a mao pela especificacao?
  // Poligono com 2 aneis: externo em sentido HORARIO e furo em ANTI-HORARIO (convencao
  // do shapefile). Se o leitor estiver com deslocamento errado, sai vazio.
  const externo = [[0, 0], [0, 10], [10, 10], [10, 0]];      // horario  -> externo
  const furo = [[5, 5], [7, 5], [7, 7], [5, 7]];             // anti-horario -> furo
  const pontos = externo.concat(furo);
  const nParts = 2, nPontos = pontos.length;
  const tamConteudo = 44 + nParts * 4 + nPontos * 16;
  const buffer = new ArrayBuffer(100 + 8 + tamConteudo);
  const w = new DataView(buffer);

  w.setInt32(0, 9994, false);                       // assinatura
  w.setInt32(24, (100 + 8 + tamConteudo) / 2, false); // tamanho do arquivo em palavras
  escreverInt32(w, 28, 1000);                        // versao
  escreverInt32(w, 32, 5);                           // tipo poligono
  escreverFloat64(w, 36, 0); escreverFloat64(w, 44, 0);
  escreverFloat64(w, 52, 10); escreverFloat64(w, 60, 10);
  w.setInt32(100, 1, false);                         // numero do registro
  w.setInt32(104, tamConteudo / 2, false);           // tamanho do conteudo em palavras
  escreverInt32(w, 108, 5);                          // tipo do registro
  escreverFloat64(w, 112, 0); escreverFloat64(w, 120, 0);
  escreverFloat64(w, 128, 10); escreverFloat64(w, 136, 10);
  escreverInt32(w, 144, nParts);                     // NumParts  <-- em +36 do conteudo
  escreverInt32(w, 148, nPontos);                    // NumPoints <-- em +40 do conteudo
  escreverInt32(w, 152, 0);                          // Parts[0]  <-- em +44 do conteudo
  escreverInt32(w, 156, 4);                          // Parts[1]
  pontos.forEach((p, i) => {
    escreverFloat64(w, 160 + i * 16, p[0]);
    escreverFloat64(w, 168 + i * 16, p[1]);
  });

  const lido = shape.abrirShapefile([
    { nome: 'manual.shp', bytes: new Uint8Array(buffer) },
  ]);
  const g = lido.geojson.features[0].geometry;
  ok('leitor: leu a geometria de um arquivo da especificacao', !!g && g.type === 'Polygon', g ? g.type : 'nulo');
  if (g && g.type === 'Polygon') {
    ok('leitor: os 2 aneis foram lidos', g.coordinates.length === 2, g.coordinates.length + ' aneis');
    const aExt = math.areaAnel(g.coordinates[0]);
    const aFuro = math.areaAnel(g.coordinates[1]);
    ok('leitor: anel externo com area 100', Math.abs(aExt - 100) < 1e-9, aExt.toFixed(3));
    ok('leitor: furo com area 4', Math.abs(aFuro - 4) < 1e-9, aFuro.toFixed(3));
    ok('leitor: o anel externo veio primeiro', aExt > aFuro, 'externo=' + aExt + ' furo=' + aFuro);
  }
  const bb = lido.bbox;
  ok('leitor: bbox do cabecalho lida', bb && Math.abs(bb.xmax - 10) < 1e-9, JSON.stringify(bb));

  // ---- 3) camada de ponto: registro de 20 bytes, sem bbox
  const bufP = new ArrayBuffer(100 + 8 + 20);
  const wp = new DataView(bufP);
  wp.setInt32(0, 9994, false);
  wp.setInt32(24, (100 + 8 + 20) / 2, false);
  escreverInt32(wp, 28, 1000);
  escreverInt32(wp, 32, 1);
  escreverFloat64(wp, 36, -47.65); escreverFloat64(wp, 44, -22.72);
  escreverFloat64(wp, 52, -47.65); escreverFloat64(wp, 60, -22.72);
  wp.setInt32(100, 1, false);
  wp.setInt32(104, 10, false);
  escreverInt32(wp, 108, 1);
  escreverFloat64(wp, 112, -47.65);
  escreverFloat64(wp, 120, -22.72);
  const lidoP = shape.abrirShapefile([{ nome: 'p.shp', bytes: new Uint8Array(bufP) }]);
  const gp = lidoP.geojson.features[0].geometry;
  ok('leitor: ponto lido corretamente', gp.type === 'Point'
    && Math.abs(gp.coordinates[0] + 47.65) < 1e-9 && Math.abs(gp.coordinates[1] + 22.72) < 1e-9,
    JSON.stringify(gp.coordinates));
}

console.log('\n' + (falhas ? 'FALHAS: ' + falhas + '/' + testes : 'TODOS OS ' + testes + ' TESTES PASSARAM'));
return falhas ? 1 : 0;
}
module.exports = { executar };
if (require.main === module) {
  executar(Number(process.argv[2] || 500)).then((c) => process.exit(c));
}
