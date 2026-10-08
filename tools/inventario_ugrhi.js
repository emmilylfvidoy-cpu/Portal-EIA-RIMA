'use strict';
/* ============================================================================
 * inventario_ugrhi.js — converte o shapefile do Inventário Florestal (por UGRHI) em GeoJSON
 * pronto para o gerador de tiles.
 *
 * A GEOMETRIA NÃO É ALTERADA: o que está no .shp é o que sai. A única normalização é arredondar
 * em 6 casas decimais (~11 cm), a mesma precisão que o portal publica em GeoJSON e nos tiles.
 * Nada de simplificar: a regra do projeto é não alterar a feição.
 *
 * Uso: node tools/inventario_ugrhi.js 17          (lê tools/_ugrhi17/, extraído do ZIP do DataGEO)
 *      node tools/inventario_ugrhi.js 17 18 19    (várias)
 * ========================================================================== */
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const shapelib = require(path.join(raiz, 'js', 'shapelib.js'));

function achar(folder, extensao) {
  const achados = [];
  const anda = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) anda(p);
      else if (new RegExp('\\.' + extensao + '$', 'i').test(e.name)) achados.push(p);
    }
  };
  anda(folder);
  return achados[0] || null;
}

function converter(n) {
  const pasta = path.join(raiz, 'tools', '_ugrhi' + n);
  const id = 'inventario-ugrhi-' + n;
  if (!fs.existsSync(pasta)) {
    console.log('  UGRHI ' + n + ': pasta ' + pasta + ' não existe — baixe antes.');
    return null;
  }
  const shp = achar(pasta, 'shp');
  const dbf = achar(pasta, 'dbf');
  if (!shp) { console.log('  UGRHI ' + n + ': sem .shp'); return null; }

  const lido = shapelib.lerShp(new Uint8Array(fs.readFileSync(shp)).buffer);
  /* CODIFICAÇÃO: o ZIP do IPA não traz o arquivo .cpg, que é de onde o leitor deduz a
   * codificação do .dbf. Sem ele o leitor assume UTF-8 e os acentos das classes saem quebrados
   * ("est?gio m?dio"). Os shapefiles do IPA são CP1252 (o padrão brasileiro antigo), então a
   * codificação vai declarada aqui. Se algum dia vier um .cpg, ele manda. */
  const cpg = achar(pasta, 'cpg');
  const codificacao = cpg ? fs.readFileSync(cpg, 'utf8').trim() : 'windows-1252';
  const tabela = dbf
    ? shapelib.lerDbf(new Uint8Array(fs.readFileSync(dbf)).buffer, codificacao)
    : { registros: [] };
  console.log('  .dbf lido como ' + codificacao + (cpg ? ' (do .cpg)' : ' (sem .cpg no ZIP)'));
  const feicoes = [];
  let vertices = 0;
  for (let i = 0; i < lido.registros.length; i++) {
    const r = lido.registros[i];
    if (!r || !r.geometry) continue;
    const anda = (c) => {
      if (typeof c[0] === 'number') { vertices++; return [+c[0].toFixed(6), +c[1].toFixed(6)]; }
      return c.map(anda);
    };
    const g = { type: r.geometry.type, coordinates: anda(r.geometry.coordinates) };
    feicoes.push({ type: 'Feature', properties: tabela.registros[i] || {}, geometry: g });
  }
  const arquivo = path.join(raiz, 'data', id + '.geojson');
  fs.writeFileSync(arquivo, JSON.stringify({ type: 'FeatureCollection', features: feicoes }), 'utf8');
  console.log('  UGRHI ' + n + ': ' + feicoes.length.toLocaleString('pt-BR') + ' feições, '
    + vertices.toLocaleString('pt-BR') + ' vértices   ->   ' + id + '.geojson  ('
    + (fs.statSync(arquivo).size / 1048576).toFixed(1) + ' MB)');
  if (tabela.registros.length && tabela.registros.length !== feicoes.length) {
    console.log('    ATENÇÃO: o .dbf tem ' + tabela.registros.length + ' registros e o .shp '
      + feicoes.length + ' geometrias — confira antes de publicar.');
  }
  return { id: id, feicoes: feicoes.length, vertices: vertices };
}

const numeros = process.argv.slice(2).filter((a) => /^\d+$/.test(a));
if (!numeros.length) { console.log('uso: node tools/inventario_ugrhi.js <n> [<n> ...]'); process.exit(1); }
const feitos = [];
for (const n of numeros) {
  const r = converter(n);
  if (r) feitos.push(r);
}
console.log('');
console.log('  convertidas ' + feitos.length + ' de ' + numeros.length + ' UGRHIs');
