'use strict';
/* Confere, camada por camada, que os TILES do nivel exato reconstroem o GeoJSON de origem:
 * mesmas feicoes, mesmos vertices, mesma caixa. E a conferencia que autoriza apagar a origem.
 * Temporario (tools/_*.js nao entra no repositorio). */
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const tiles = require(path.join(raiz, 'js', 'tiles.js'));
const camadas = require(path.join(raiz, 'tools', 'verificacoes', '_camadas.js'));

const IDS = ['geologia', 'geomorfologia', 'aquiferos', 'biomas', 'cetesb-pontos',
  'iphan-sitios-arqueologicos', 'iphan-bens-materiais'];

function medir(geometrias) {
  let vertices = 0, aneis = 0;
  const bb = [Infinity, Infinity, -Infinity, -Infinity];
  const anda = (c) => {
    if (typeof c[0] === 'number') {
      vertices++;
      if (c[0] < bb[0]) bb[0] = c[0]; if (c[1] < bb[1]) bb[1] = c[1];
      if (c[0] > bb[2]) bb[2] = c[0]; if (c[1] > bb[3]) bb[3] = c[1];
      return;
    }
    if (typeof c[0][0] === 'number') aneis++;
    for (const p of c) anda(p);
  };
  for (const g of geometrias) if (g && g.coordinates) anda(g.coordinates);
  return { vertices: vertices, aneis: aneis, bb: bb };
}

let problemas = 0;
console.log('  camada                              feições        vértices      anéis    caixa');
for (const id of IDS) {
  const origem = JSON.parse(fs.readFileSync(path.join(raiz, 'data', id + '.geojson'), 'utf8'));
  const indice = JSON.parse(fs.readFileSync(path.join(raiz, 'data', id, 'exato', 'indice.json'), 'utf8'));
  const feicoes = [];
  for (const t of indice.tiles) {
    const fc = tiles.decodificar(camadas.lerTile(path.join(raiz, t.arquivo)));
    for (const f of fc.features) feicoes.push(f);
  }
  const a = medir(origem.features.map((f) => f.geometry));
  const b = medir(feicoes.map((f) => f.geometry));
  const caixa = a.bb.every((v, i) => Math.abs(v - b.bb[i]) < 1e-5);
  const ok = a.vertices === b.vertices && feicoes.length === origem.features.length && caixa;
  if (!ok) problemas++;
  console.log('  ' + id.padEnd(34)
    + String(origem.features.length).padStart(7) + '->' + String(feicoes.length).padStart(6)
    + String(a.vertices).padStart(13) + '->' + String(b.vertices).padStart(9)
    + String(a.aneis).padStart(9) + (caixa ? '      igual' : '   DIFERENTE')
    + (ok ? '' : '   <-- DIVERGE'));
}
console.log('');
console.log(problemas ? ('  ' + problemas + ' camada(s) DIVERGEM — NÃO apagar a origem.') : '  TODAS IGUAIS: os tiles reconstroem a origem, feição por feição.');
process.exit(problemas ? 1 : 0);
