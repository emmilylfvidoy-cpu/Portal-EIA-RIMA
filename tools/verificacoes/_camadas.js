'use strict';
/* Ajudante das verificações para carregar uma camada do catálogo, seja ela publicada como
 * arquivo GeoJSON ou como tiles binários. Existe para que a suíte não precise saber a
 * diferença — e para que a diferença não passe despercebida num teste. */

const fs = require('fs');
const path = require('path');

/** Arquivos que compõem a camada (o geojson, ou o índice + os tiles). */
function arquivos(raiz, camada) {
  if (camada.tiles) {
    const indice = JSON.parse(fs.readFileSync(path.join(raiz, camada.tiles), 'utf8'));
    return [camada.tiles].concat(indice.tiles.map((t) => t.arquivo));
  }
  return [camada.arquivo];
}

/** Carrega a camada inteira como FeatureCollection (lê todos os tiles, quando for o caso). */
function carregar(raiz, camada) {
  if (!camada.tiles) {
    return JSON.parse(fs.readFileSync(path.join(raiz, camada.arquivo), 'utf8'));
  }
  const tiles = require(path.join(raiz, 'js', 'tiles.js'));
  const indice = JSON.parse(fs.readFileSync(path.join(raiz, camada.tiles), 'utf8'));
  const feicoes = [];
  for (const t of indice.tiles) {
    const fc = tiles.decodificar(new Uint8Array(fs.readFileSync(path.join(raiz, t.arquivo))));
    for (const f of fc.features) feicoes.push(f);
  }
  return { type: 'FeatureCollection', metadados: indice, features: feicoes };
}

/** A camada é publicada em tiles? */
function emTiles(camada) {
  return !!camada.tiles;
}

module.exports = { arquivos: arquivos, carregar: carregar, emTiles: emTiles };
