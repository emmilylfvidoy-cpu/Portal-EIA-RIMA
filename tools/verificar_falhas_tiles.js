'use strict';
/* PASSO 5 DO OBJETIVO: a camada em tiles bate com o shapefile de origem, numa janela DENSA e
 * bem de perto — a mesma medida que provou o defeito da generalização (área preenchida).
 *
 * Escreve as duas máscaras em JSON de pixels; o Python desenha e conta.
 * Uso: node tools/verificar_falhas_tiles.js pedologia
 */
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const camadas = require(path.join(__dirname, 'verificacoes', '_camadas.js'));
const shapelib = require(path.join(raiz, 'js', 'shapelib.js'));
const tiles = require(path.join(raiz, 'js', 'tiles.js'));

const id = process.argv[2];
const L = 900, A = 560;
const manifesto = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'camadas-fonte.json'), 'utf8'));
const entrada = manifesto.camadas.find((c) => c.id === id);
const indice = JSON.parse(fs.readFileSync(path.join(raiz, 'data', id, 'indice.json'), 'utf8'));

function bboxDe(g) { const b = tiles.bboxDe([{ geometry: g }]); return b[0] === 0 && b[2] === 0 ? null : b; }

// ---- tiles: carrega tudo e acha a janela mais densa de ~1 km
const doTile = [];
for (const t of indice.tiles) {
  const fc = tiles.decodificar(camadas.lerTile(path.join(raiz, t.arquivo)));
  for (const f of fc.features) doTile.push({ geometry: f.geometry, bbox: bboxDe(f.geometry) });
}
console.log('  ' + id + ': ' + doTile.length.toLocaleString('pt-BR') + ' feições nos tiles');

const rx = 0.0045, ry = 0.0028;      // ~1,0 km x 0,6 km
let janela = null;
for (let i = 0; i < doTile.length; i += Math.max(1, Math.floor(doTile.length / 400))) {
  const b = doTile[i].bbox;
  if (!b) continue;
  const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
  let n = 0;
  for (const f of doTile) {
    const q = f.bbox;
    if (q && q[0] >= cx - rx && q[2] <= cx + rx && q[1] >= cy - ry && q[3] <= cy + ry) n++;
  }
  if (!janela || n > janela.n) janela = { cx: cx, cy: cy, n: n };
}
const bbox = [janela.cx - rx, janela.cy - ry, janela.cx + rx, janela.cy + ry];
console.log('  janela de ~' + Math.round(rx * 2 * 111320) + ' m x ' + Math.round(ry * 2 * 111320)
  + ' m com ' + janela.n + ' manchas');

const px = (p) => [(p[0] - bbox[0]) / (bbox[2] - bbox[0]) * L, (bbox[3] - p[1]) / (bbox[3] - bbox[1]) * A];
const cruza = (q) => !(q[2] < bbox[0] || q[0] > bbox[2] || q[3] < bbox[1] || q[1] > bbox[3]);
const recorta = (lista) => {
  const out = [];
  for (const f of lista) {
    if (!f.bbox || !cruza(f.bbox)) continue;
    for (const parte of tiles.aneisDe(f.geometry)) for (const anel of parte) out.push(anel.map(px));
  }
  return out;
};

// ---- origem
const lido = shapelib.lerShp(new Uint8Array(fs.readFileSync(entrada.origem)).buffer);
const daOrigem = [];
for (const r of lido.registros) {
  if (!r || !r.geometry) continue;
  daOrigem.push({ geometry: r.geometry, bbox: bboxDe(r.geometry) });
}
lido.registros = null;

const o = recorta(daOrigem), t = recorta(doTile);
console.log('  anéis na janela: origem ' + o.length + '   tiles ' + t.length);
fs.writeFileSync(path.join(raiz, 'tools', '_tiles_janela.json'),
  JSON.stringify({ nome: entrada.nome, largura: L, altura: A, origem: o, tiles: t }), 'utf8');
console.log('  gravado tools/_tiles_janela.json');
