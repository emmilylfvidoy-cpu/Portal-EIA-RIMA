'use strict';
/* ============================================================================
 * comprimir_tiles.js — guarda os tiles em gzip e ajusta o índice
 *
 * POR QUE: os tiles são binários com deltas e comprimem MUITO — medido: a visão de longe da
 * Pedologia vai de 4,65 MB para 1,09 MB (77% menor) e os exatos de 34,08 para 23,30 MB (32%).
 * O navegador descomprime nativamente (DecompressionStream), então o ganho é só de rede.
 *
 * O arquivo cru é REMOVIDO depois de comprimido: manter os dois dobraria o repositório sem
 * servir ninguém.
 *
 * Uso: node tools/comprimir_tiles.js pedologia --nivel exato
 *      node tools/comprimir_tiles.js            (todos os níveis de todas as camadas)
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const raiz = path.resolve(__dirname, '..');
const cat = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'catalogo.json'), 'utf8'));

function alvos(argv) {
  const id = argv[2];
  let nivel = null;
  for (let i = 3; i < argv.length; i++) if (argv[i] === '--nivel') nivel = argv[++i];
  const lista = [];
  for (const c of cat.camadas) {
    if (!c.tiles) continue;
    if (id && c.id !== id) continue;
    // os niveis sao os DIRETORIOS que existem: antes a lista era fixa em exato/visao e o
    // nivel medio foi ignorado em silencio
    const pasta = path.join(raiz, 'data', c.id);
    const niveis = fs.existsSync(pasta)
      ? fs.readdirSync(pasta).filter(function (n) { return fs.existsSync(path.join(pasta, n, 'indice.json')); })
      : [];
    for (const n of niveis) {
      if (nivel && n !== nivel) continue;
      lista.push({ id: c.id, nivel: n, arquivo: path.join(raiz, 'data', c.id, n, 'indice.json') });
    }
  }
  return lista;
}

for (const alvo of alvos(process.argv)) {
  const ind = JSON.parse(fs.readFileSync(alvo.arquivo, 'utf8'));
  let bruto = 0, comprimido = 0, feitos = 0;
  for (const t of ind.tiles) {
    const cru = path.join(raiz, t.arquivo.replace(/\.gz$/, ''));
    const destino = cru + '.gz';
    if (fs.existsSync(cru)) {
      const bytes = fs.readFileSync(cru);
      // nível 9: é uma vez só, e a diferença para o nível 6 é de alguns % no total
      fs.writeFileSync(destino, zlib.gzipSync(bytes, { level: 9 }));
      fs.unlinkSync(cru);
    }
    if (!fs.existsSync(destino)) { console.log('  FALTOU: ' + destino); continue; }
    const b = fs.statSync(destino).size;
    t.bytes_bruto = t.bytes;
    t.bytes = b;
    t.arquivo = t.arquivo.replace(/\.bin$/, '.bin.gz');
    t.comprimido = true;
    bruto += t.bytes_bruto;
    comprimido += b;
    feitos++;
  }
  ind.total.bytes_bruto = bruto;
  ind.total.bytes = comprimido;
  ind.total.comprimido = true;
  ind.observacao = (ind.observacao || '') + ' Os tiles estão em gzip: o navegador descomprime '
    + 'com DecompressionStream. Medido: ' + (bruto / 1048576).toFixed(2) + ' MB crus -> '
    + (comprimido / 1048576).toFixed(2) + ' MB na rede ('
    + Math.round((1 - comprimido / bruto) * 100) + '% menor).';
  fs.writeFileSync(alvo.arquivo, JSON.stringify(ind, null, 1) + '\n', 'utf8');
  console.log('  ' + alvo.id + '/' + alvo.nivel + ': ' + feitos + ' tiles   '
    + (bruto / 1048576).toFixed(2) + ' MB -> ' + (comprimido / 1048576).toFixed(2) + ' MB ('
    + Math.round((1 - comprimido / bruto) * 100) + '% menor)');
}
