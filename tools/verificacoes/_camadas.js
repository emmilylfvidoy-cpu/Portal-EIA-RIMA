'use strict';
/* Ajudante das verificações para carregar uma camada do catálogo, seja ela publicada como
 * arquivo GeoJSON ou como tiles binários. Existe para que a suíte não precise saber a
 * diferença — e para que a diferença não passe despercebida num teste. */

const fs = require('fs');
const path = require('path');

/** Arquivos que compõem a camada (o geojson, ou o índice + os tiles). */
function arquivos(raiz, camada) {
  // camada-PAI (grupo, como o Inventário por UGRHI): ela não tem dado próprio — quem tem são as filhas
  if (camada.filhos) {
    return camada.filhos.reduce((todos, f) => todos.concat(arquivos(raiz, f)), []);
  }
  if (camada.servico) return [];   // camada ao vivo: os dados vêm do serviço, não do repositório
  if (camada.tiles) {
    const indice = JSON.parse(fs.readFileSync(path.join(raiz, camada.tiles), 'utf8'));
    return [camada.tiles].concat(indice.tiles.map((t) => t.arquivo));
  }
  return [camada.arquivo];
}

/** Carrega a camada inteira como FeatureCollection (lê todos os tiles, quando for o caso). */
function carregar(raiz, camada) {
  if (camada.filhos) {
    /* AMOSTRA, de propósito: o grupo do Inventário por UGRHI tem 22 filhas e 404 mil feições —
     * carregar tudo estourava a memória do Node e derrubava a suíte inteira (crash do V8, sem
     * mensagem). A suíte confere ESTRUTURA e ATRIBUTOS, e para isso duas unidades bastam; a
     * exatidão de cada uma é conferida por camada, no verificador próprio. */
    const escolhidas = camada.filhos.slice(0, 2);
    const feicoes = [];
    for (const f of escolhidas) for (const x of carregar(raiz, f).features) feicoes.push(x);
    return {
      type: 'FeatureCollection', features: feicoes, grupo: true,
      filhos: camada.filhos.length, amostra: escolhidas.length,
    };
  }
  if (camada.servico) {
    // não há o que carregar de arquivo: a camada é consultada no serviço a cada uso
    return { type: 'FeatureCollection', features: [], ao_vivo: true };
  }
  if (!camada.tiles) {
    return JSON.parse(fs.readFileSync(path.join(raiz, camada.arquivo), 'utf8'));
  }
  const tiles = require(path.join(raiz, 'js', 'tiles.js'));
  const indice = JSON.parse(fs.readFileSync(path.join(raiz, camada.tiles), 'utf8'));
  const feicoes = [];
  for (const t of indice.tiles) {
    const fc = tiles.decodificar(lerTile(path.join(raiz, t.arquivo)));
    for (const f of fc.features) feicoes.push(f);
  }
  return { type: 'FeatureCollection', metadados: indice, features: feicoes };
}

/** A camada é publicada em tiles? */
function emTiles(camada) {
  return !!camada.tiles;
}

/** Le um tile publicado: aceita .bin cru ou .bin.gz (gzip, como ele e servido). */
function lerTile(caminho) {
  const bytes = fs.readFileSync(caminho);
  if (/\.gz$/i.test(caminho)) return new Uint8Array(require('zlib').gunzipSync(bytes));
  return new Uint8Array(bytes);
}

module.exports = { arquivos: arquivos, carregar: carregar, emTiles: emTiles, lerTile: lerTile };
