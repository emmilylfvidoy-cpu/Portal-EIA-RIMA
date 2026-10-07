'use strict';
/* ============================================================================
 * verificar_tiles_camada.js — os tiles reconstroem a camada EXATA?
 *
 * Compara, contra o shapefile de origem: número de feições, número de vértices, caixa
 * envolvente e ÁREA TOTAL. A área é a prova que interessa: qualquer vértice perdido ou movido
 * além da quantização de 11 cm muda o número.
 *
 * Uso: node tools/verificar_tiles_camada.js pedologia
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const shapelib = require(path.join(raiz, 'js', 'shapelib.js'));
const tiles = require(path.join(raiz, 'js', 'tiles.js'));
const recorte = require(path.join(raiz, 'js', 'recorte.js'));

const id = process.argv[2];
if (!id) { console.error('uso: node tools/verificar_tiles_camada.js <id>'); process.exit(1); }

const manifesto = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'camadas-fonte.json'), 'utf8'));
const entrada = manifesto.camadas.find((c) => c.id === id);
const pasta = path.join(raiz, 'data', id);
const indice = JSON.parse(fs.readFileSync(path.join(pasta, 'indice.json'), 'utf8'));

console.log('=== ' + indice.nome + '   ' + indice.tiles.length + ' tiles, '
  + (indice.total.bytes / 1048576).toFixed(2) + ' MB');

// ---- origem
const lido = shapelib.lerShp(new Uint8Array(fs.readFileSync(entrada.origem)).buffer);
let pontosOrig = 0, feicoesOrig = 0;
let bbOrig = [Infinity, Infinity, -Infinity, -Infinity];
for (const r of lido.registros) {
  if (!r || !r.geometry) continue;
  feicoesOrig++;
  const bb = tiles.bboxDe([{ geometry: r.geometry }]);
  bbOrig = [Math.min(bbOrig[0], bb[0]), Math.min(bbOrig[1], bb[1]), Math.max(bbOrig[2], bb[2]), Math.max(bbOrig[3], bb[3])];
  for (const parte of tiles.aneisDe(r.geometry)) for (const anel of parte) pontosOrig += anel.length;
}
lido.registros = null;

// ---- tiles
let pontosTile = 0, feicoesTile = 0, areaTile = 0;
let bbTile = [Infinity, Infinity, -Infinity, -Infinity];
const classes = new Set();
const t0 = Date.now();
for (const t of indice.tiles) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(raiz, t.arquivo)));
  const fc = tiles.decodificar(bytes);
  for (const f of fc.features) {
    feicoesTile++;
    const bb = tiles.bboxDe([f]);
    bbTile = [Math.min(bbTile[0], bb[0]), Math.min(bbTile[1], bb[1]), Math.max(bbTile[2], bb[2]), Math.max(bbTile[3], bb[3])];
    for (const parte of tiles.aneisDe(f.geometry)) for (const anel of parte) pontosTile += anel.length;
    areaTile += recorte.areaHectares(f.geometry) / 10000;
    classes.add(f.properties[entrada.campo_classe]);
  }
}
const segundos = (Date.now() - t0) / 1000;

// ---- origem, área (mesma função)
let areaOrig = 0;
const lido2 = shapelib.lerShp(new Uint8Array(fs.readFileSync(entrada.origem)).buffer);
for (const r of lido2.registros) {
  if (!r || !r.geometry) continue;
  areaOrig += recorte.areaHectares(r.geometry) / 10000;
}
lido2.registros = null;

const pct = (a, b) => ((a - b) / b * 100);
console.log('');
console.log('  grandeza                  origem            tiles             diferença');
console.log('  feições        ' + String(feicoesOrig).padStart(12) + String(feicoesTile).padStart(17)
  + (feicoesOrig === feicoesTile ? '        igual' : '   ' + (feicoesTile - feicoesOrig) + ' de diferença'));
console.log('  vértices       ' + pontosOrig.toLocaleString('pt-BR').padStart(12)
  + pontosTile.toLocaleString('pt-BR').padStart(17)
  + (pontosOrig === pontosTile ? '        igual' : '   ' + pct(pontosTile, pontosOrig).toFixed(4) + '%'));
console.log('  área (ha)      ' + Math.round(areaOrig).toLocaleString('pt-BR').padStart(12)
  + Math.round(areaTile).toLocaleString('pt-BR').padStart(17)
  + '   ' + pct(areaTile, areaOrig).toFixed(4) + '%');
console.log('  classes        ' + String(classes.size).padStart(12) + '   (no catálogo: '
  + (JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'catalogo.json'), 'utf8')).camadas
    .find((c) => c.id === id).classes.length) + ')');
console.log('');
console.log('  bbox origem ' + bbOrig.map((v) => v.toFixed(5)).join(', '));
console.log('  bbox tiles  ' + bbTile.map((v) => v.toFixed(5)).join(', '));
const bbIgual = bbOrig.every((v, i) => Math.abs(v - bbTile[i]) < 1e-5);
console.log('  -> ' + (bbIgual ? 'caixa envolvente IGUAL (tolerância de 1e-5° ≈ 1 m)' : 'CAIXA DIFERENTE'));
console.log('');
console.log('  decodificar os ' + indice.tiles.length + ' tiles levou ' + segundos.toFixed(1) + ' s');

const ok = feicoesOrig === feicoesTile && pontosOrig === pontosTile && bbIgual && Math.abs(pct(areaTile, areaOrig)) < 0.001;
console.log('');
console.log(ok
  ? 'RESULTADO: os tiles reconstroem a camada EXATA — mesmas feições, mesmos vértices, mesma área.'
  : 'RESULTADO: DIVERGÊNCIA — ver os números acima.');
process.exit(ok ? 0 : 1);
