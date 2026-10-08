'use strict';
/* Mede o ganho do filtro por caixa: recortar com uma área de 200 polígonos (só 2 perto das
 * feições) contra a mesma área já reduzida aos 2 que importam. Temporário. */
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const tiles = require(path.join(raiz, 'js', 'tiles.js'));
const recorte = require(path.join(raiz, 'js', 'recorte.js'));
const camadas = require(path.join(raiz, 'tools', 'verificacoes', '_camadas.js'));
global.EIA = { math: require(path.join(raiz, 'js', 'math.js')), vetorial: require(path.join(raiz, 'js', 'vetorial.js')), recorte: recorte, tiles: tiles };

const cat = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'catalogo.json'), 'utf8'));
const ped = cat.camadas.find((c) => c.id === 'pedologia');
const ind = JSON.parse(fs.readFileSync(path.join(raiz, ped.tiles), 'utf8'));

// carrega SÓ os tiles perto da área de exemplo (o portal agora faz isso)
const exemplo = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'areas-influencia-exemplo.geojson'), 'utf8'));
let b = [Infinity, Infinity, -Infinity, -Infinity];
const anda = (c) => { if (typeof c[0] === 'number') { b = [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[0]), Math.max(b[3], c[1])]; return; } for (const p of c) anda(p); };
for (const f of exemplo.features) anda(f.geometry.coordinates);
const perto = ind.tiles.filter((t) => !(t.bbox[2] < b[0] || t.bbox[0] > b[2] || t.bbox[3] < b[1] || t.bbox[1] > b[3]));
const ativa = Object.assign({}, ped, { geojson: { type: 'FeatureCollection', features: [] } });
for (const t of perto) {
  const fc = tiles.decodificar(camadas.lerTile(path.join(raiz, t.arquivo)));
  for (const f of fc.features) ativa.geojson.features.push(f);
}
console.log('  tiles carregados (só os da área): ' + perto.length + ' de ' + ind.tiles.length
  + '   feições: ' + ativa.geojson.features.length.toLocaleString('pt-BR'));

// a área de influência real (2 polígonos) e uma versão inflada com 200 polígonos longe
const reais = exemplo.features.map((f) => f.geometry);
const longe = [];
for (let i = 0; i < 198; i++) {
  const lon = -52 + (i % 20) * 0.02, lat = -24 + Math.floor(i / 20) * 0.02;
  longe.push({
    type: 'Polygon',
    coordinates: [[[lon, lat], [lon + 0.01, lat], [lon + 0.01, lat + 0.01], [lon, lat + 0.01], [lon, lat]]],
  });
}
const geoTodas = { type: 'GeometryCollection', geometries: reais.concat(longe) };

function montar(geom) {
  return [{ id: 'ai', nome: 'AI', sigla: 'AI', geometry: geom, area_ha: 0 }];
}
function cronometrar(rotulo, geom) {
  const t0 = Date.now();
  const r = recorte.recortarTudo(montar(geom), [ativa], { operacao: 'intersecao', areaMinimaHa: 0, simplificar: 0 });
  const n = (r.resultados || []).reduce((s, x) => s + (x.features ? x.features.length : 0), 0);
  console.log('  ' + rotulo.padEnd(56) + ((Date.now() - t0) / 1000).toFixed(2) + ' s   (' + n + ' feições)');
  return n;
}
console.log('');
console.log('  === recorte da Pedologia (tiles já carregados)');
const n1 = cronometrar('área com 200 polígonos (198 deles longe)', geoTodas);
const n2 = cronometrar('a mesma área já reduzida aos 2 que importam', { type: 'GeometryCollection', geometries: reais });
console.log('');
console.log('  o filtro por caixa faz o primeiro caso custar o mesmo que o segundo'
  + (n1 === n2 ? '  (mesmo resultado: ' + n1 + ' feições)' : '  ATENÇÃO: resultados diferentes (' + n1 + ' vs ' + n2 + ')'));
