'use strict';
function executar(nOraculo) {
/* Verificação do núcleo de matemática (roda no Node, sem navegador).
 * Uso: node tools/verificacoes/verificar_math.js */
const path = require('path');
const raiz = path.resolve(__dirname, '..', '..');
const m = require(path.join(raiz, 'js', 'math.js'));

let falhas = 0, testes = 0;
function ok(nome, condicao, detalhe) {
  testes++;
  if (condicao) { console.log('  ok  ' + nome + (detalhe ? '  [' + detalhe + ']' : '')); }
  else { falhas++; console.log('  FALHA ' + nome + (detalhe ? '  [' + detalhe + ']' : '')); }
}
function perto(a, b, tolRel) {
  const t = tolRel === undefined ? 1e-6 : tolRel;
  return Math.abs(a - b) <= Math.max(Math.abs(b) * t, 1e-9);
}

console.log('\n== UTM: ida e volta ==');
{
  const lon = -47.6476, lat = -22.7253; // Piracicaba
  const u = m.geoParaUTM(lon, lat);
  const g = m.utmParaGeo(u.x, u.y, { fuso: u.fuso, hemisferio: u.hemisferio });
  ok('Piracicaba volta ao mesmo ponto', perto(g.lon, lon, 1e-9) && perto(g.lat, lat, 1e-9),
    'dLon=' + (g.lon - lon).toExponential(2) + ' dLat=' + (g.lat - lat).toExponential(2));
  ok('fuso 23S', u.fuso === 23 && u.hemisferio === 'S', 'fuso=' + u.fuso + u.hemisferio);
  ok('EPSG 31983', m.epsgUTM(lat, lon) === 31983, 'epsg=' + m.epsgUTM(lat, lon));
}

console.log('\n== UTM: pontos de controle conhecidos ==');
{
  // Origem do fuso 23S, no equador: x = 500000, y = 10000000
  const u = m.geoParaUTM(-45, 0, { fuso: 23, hemisferio: 'S' });
  ok('origem do fuso', perto(u.x, 500000, 1e-9) && perto(u.y, 10000000, 1e-9),
    'x=' + u.x.toFixed(3) + ' y=' + u.y.toFixed(3));

  // Arco de meridiano: o y do equador no hemisfério sul é 10.000.000 m (falsa origem).
  // Conferência independente: 10 graus de latitude dão ~1.105,8 km de arco.
  const noEquador = m.geoParaUTM(-45, 0, { fuso: 23, hemisferio: 'S' });
  const dezGraus = m.geoParaUTM(-45, -10, { fuso: 23, hemisferio: 'S' });
  const arco10 = dezGraus.y - noEquador.y;
  ok('arco de 10 graus de meridiano ~ 1.105 km', Math.abs(Math.abs(arco10) - 1105400) < 2000,
    (arco10 / 1000).toFixed(2) + ' km (k0=0,9996 encolhe o arco real de ~1.107 km)');

  // Esse mesmo y tem de voltar para a latitude de partida
  const voltaSul = m.utmParaGeo(dezGraus.x, dezGraus.y, { fuso: 23, hemisferio: 'S' });
  ok('1000 km ao sul nao vira hemisferio norte', Math.abs(voltaSul.lat + 10) < 1e-9,
    'lat=' + voltaSul.lat.toFixed(9));

  // E sem informar o hemisfério a heurística tem de acertar (y > 5.000.000 = sul)
  const autoSul = m.utmParaGeo(dezGraus.x, dezGraus.y, { fuso: 23 });
  ok('hemisferio deduzido do y', Math.abs(autoSul.lat + 10) < 1e-9, 'lat=' + autoSul.lat.toFixed(9));

  // 1 grau a leste do meridiano central na latitude -22
  const p = m.geoParaUTM(-44, -22, { fuso: 23 });
  const volta = m.utmParaGeo(p.x, p.y, { fuso: 23, hemisferio: 'S' });
  ok('1 grau a leste volta certo', perto(volta.lon, -44, 1e-9), 'lon=' + volta.lon.toFixed(9));
}

console.log('\n== Area: UTM x geodesica ==');
{
  // Quadrado de 0,01 grau (~1,1 km) em Piracicaba
  const lon0 = -47.65, lat0 = -22.72, d = 0.01;
  const anel = [
    [lon0, lat0], [lon0 + d, lat0], [lon0 + d, lat0 + d], [lon0, lat0 + d],
  ];
  const c = m.conferirArea(anel, 'WGS84');
  const haUtm = c.area_utm_m2 / 1e4, haGeo = c.area_geodesica_m2 / 1e4;
  ok('diferenca UTM x geodesica < 0,5%', c.diferenca_relativa < 0.005,
    'UTM=' + haUtm.toFixed(1) + ' ha, geo=' + haGeo.toFixed(1) + ' ha, dif=' + (c.diferenca_relativa * 100).toFixed(4) + '%');
  // Ordem de grandeza: 0,01 grau de longitude a -22 = ~1029 m; de latitude = ~1106 m
  ok('area na ordem esperada (110 a 120 ha)', haUtm > 110 && haUtm < 120, haUtm.toFixed(2) + ' ha');
}

console.log('\n== Area: quadrado projetado exato ==');
{
  // Em coordenadas projetadas o shoelace tem de dar exatamente 1 km2
  const q = [[0, 0], [1000, 0], [1000, 1000], [0, 1000]];
  ok('shoelace = 1 km2', perto(m.areaAnel(q), 1e6, 1e-12), m.areaAnel(q));
  ok('anel fechado nao altera a area', perto(m.areaAnel(m.fecharAnel(q)), 1e6, 1e-12));
}

console.log('\n== Comprimento geodesico ==');
{
  // Meridiano: 1 grau de latitude ~ 110,6 km
  const linha = [[-47.65, -22.0], [-47.65, -23.0]];
  const km = m.comprimentoGeodesico(linha) / 1000;
  ok('1 grau de meridiano entre 110 e 111,5 km', km > 110 && km < 111.5, km.toFixed(3) + ' km');
  // Paralelo a -22: 1 grau de longitude ~ 103,1 km
  const linha2 = [[-48.0, -22.0], [-47.0, -22.0]];
  const km2 = m.comprimentoGeodesico(linha2) / 1000;
  ok('1 grau de paralelo a -22 entre 102 e 104 km', km2 > 102 && km2 < 104, km2.toFixed(3) + ' km');
}

console.log('\n== BBox e utilitarios ==');
{
  const geo = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 3], [0, 3], [0, 0]]] };
  ok('bbox', JSON.stringify(m.bbox(geo)) === JSON.stringify([0, 0, 2, 3]), JSON.stringify(m.bbox(geo)));
  ok('bbox intersecta', m.bboxIntersecta([1, 1, 5, 5], m.bbox(geo)));
  ok('bbox contem', m.bboxContem([-1, -1, 5, 5], m.bbox(geo)));
  ok('nao contem', !m.bboxContem([1, 1, 5, 5], m.bbox(geo)));
  ok('formato pt-BR', m.num(1234567.891, 2) === '1.234.567,89', m.num(1234567.891, 2));
  ok('hectare', m.ha(12345678, 2) === '1.234,57', m.ha(12345678, 2));
  ok('escala', m.escalaTexto(5000) === '1:5.000', m.escalaTexto(5000));
  ok('dms', m.dms(-22.5351, 'lat') === "22°32'06,4\"S", m.dms(-22.5351, 'lat'));
}

console.log('\n== Zoom x escala ==');
{
  const lat = -22.72;
  const z = m.zoomParaEscala(lat, 5000, 96);
  const res = m.resolucaoMercator(lat, Math.round(z));
  const escala = res * 96 / 0.0254;
  ok('zoom coerente com a escala em 96 dpi', Math.abs(escala - 5000) / 5000 < 0.25,
    'zoom=' + z.toFixed(2) + ' -> ' + Math.round(escala));
}

console.log('\n' + (falhas ? 'FALHAS: ' + falhas + '/' + testes : 'TODOS OS ' + testes + ' TESTES PASSARAM'));
  return falhas ? 1 : 0;
}

module.exports = { executar };
if (require.main === module) {
  process.exit(executar(Number(process.argv[2] || 500)));
}
