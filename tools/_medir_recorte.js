'use strict';
/* Onde o recorte gasta tempo: (1) quantos tiles ele CARREGA contra quantos ele PRECISA
 * (os que cruzam a área de influência), e (2) quanto tempo leva o recorte em si.
 * Temporário. */
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const tiles = require(path.join(raiz, 'js', 'tiles.js'));
const recorte = require(path.join(raiz, 'js', 'recorte.js'));
const camadas = require(path.join(raiz, 'tools', 'verificacoes', '_camadas.js'));
global.EIA = { math: require(path.join(raiz, 'js', 'math.js')), vetorial: require(path.join(raiz, 'js', 'vetorial.js')), recorte: recorte, tiles: tiles };

const cat = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'catalogo.json'), 'utf8'));
const exemplo = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'areas-influencia-exemplo.geojson'), 'utf8'));
const planas = [];
for (const c of cat.camadas) {
  if (c.grupo && Array.isArray(c.filhos)) for (const f of c.filhos) planas.push(f);
  else planas.push(c);
}

// caixa da área de influência de exemplo
let b = [Infinity, Infinity, -Infinity, -Infinity];
const anda = (c) => {
  if (typeof c[0] === 'number') { b = [Math.min(b[0], c[0]), Math.min(b[1], c[1]), Math.max(b[2], c[0]), Math.max(b[3], c[1])]; return; }
  for (const p of c) anda(p);
};
for (const f of exemplo.features) anda(f.geometry.coordinates);
const cruza = (x) => !(x[2] < b[0] || x[0] > b[2] || x[3] < b[1] || x[1] > b[3]);

console.log('  ===== 1) TILES: quantos o portal carrega hoje contra quantos bastariam');
console.log('  camada                                 hoje (todos)      bastaria (cruzam a AI)');
let todosBytes = 0, necessariosBytes = 0, todosN = 0, necessariosN = 0;
for (const c of planas) {
  if (!c.tiles) continue;
  const ind = JSON.parse(fs.readFileSync(path.join(raiz, c.tiles), 'utf8'));
  const precisam = ind.tiles.filter((t) => cruza(t.bbox));
  const bTodos = ind.tiles.reduce((s, t) => s + t.bytes, 0);
  const bPrec = precisam.reduce((s, t) => s + t.bytes, 0);
  todosBytes += bTodos; necessariosBytes += bPrec; todosN += ind.tiles.length; necessariosN += precisam.length;
  if (precisam.length !== ind.tiles.length && bTodos > 0.4 * 1048576) {
    console.log('  ' + c.id.padEnd(38) + String(ind.tiles.length).padStart(6) + ' tiles '
      + (bTodos / 1048576).toFixed(1).padStart(6) + ' MB   ' + String(precisam.length).padStart(5) + ' tiles '
      + (bPrec / 1048576).toFixed(2).padStart(6) + ' MB');
  }
}
console.log('  ' + 'TOTAL'.padEnd(38) + String(todosN).padStart(6) + ' tiles '
  + (todosBytes / 1048576).toFixed(1).padStart(6) + ' MB   ' + String(necessariosN).padStart(5) + ' tiles '
  + (necessariosBytes / 1048576).toFixed(2).padStart(6) + ' MB   -> '
  + (todosBytes / Math.max(necessariosBytes, 1)).toFixed(1) + 'x menos');

console.log('');
console.log('  ===== 2) TEMPO DO RECORTE em si (a camada mais pesada)');
const ped = planas.find((c) => c.id === 'pedologia');
if (ped) {
  const ind = JSON.parse(fs.readFileSync(path.join(raiz, ped.tiles), 'utf8'));
  const ativa = Object.assign({}, ped, { geojson: { type: 'FeatureCollection', features: [] } });
  let t0 = Date.now();
  for (const t of ind.tiles) {
    const fc = tiles.decodificar(camadas.lerTile(path.join(raiz, t.arquivo)));
    for (const f of fc.features) ativa.geojson.features.push(f);
  }
  console.log('  carregar os ' + ind.tiles.length + ' tiles da Pedologia: ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s'
    + '  (' + ativa.geojson.features.length.toLocaleString('pt-BR') + ' feições)');
  const areas = exemplo.features.map((f, i) => ({ id: 'ai' + i, nome: 'AI' + i, sigla: 'AI' + i, geometry: f.geometry, area_ha: 0 }));
  t0 = Date.now();
  const r = recorte.recortarTudo(areas, [ativa], { operacao: 'intersecao', areaMinimaHa: 0, simplificar: 0 });
  const n = (r.resultados || []).reduce((s, x) => s + (x.features ? x.features.length : 0), 0);
  console.log('  recortar: ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s   (' + n + ' feições recortadas)');
}
