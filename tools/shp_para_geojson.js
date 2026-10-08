'use strict';
/* ============================================================================
 * shp_para_geojson.js — converte um shapefile do projeto em GeoJSON pronto para os tiles
 *
 * A GEOMETRIA NÃO É ALTERADA: o que está no .shp é o que sai. A única normalização é arredondar
 * em 6 casas decimais (~11 cm), a mesma precisão que o portal publica em GeoJSON e nos tiles.
 *
 * Não escreve no catálogo — de propósito. O importador faz isso, e reescrever o catálogo aqui
 * apagaria a configuração de tiles das camadas já publicadas. Publicar é passo separado.
 *
 * A codificação do .dbf vem do .cpg (o IPA/ArcGIS às vezes não traz, e aí vale CP1252).
 *
 * Uso: node tools/shp_para_geojson.js "D:\...\Camada.shp" data/camada.geojson
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const shapelib = require(path.join(raiz, 'js', 'shapelib.js'));

const origem = process.argv[2];
const destino = process.argv[3];
if (!origem || !destino) {
  console.log('uso: node tools/shp_para_geojson.js "<caminho.shp>" data/<id>.geojson');
  process.exit(1);
}

const base = origem.replace(/\.shp$/i, '');
let cpg = null;
for (const ext of ['.cpg', '.CPG']) {
  try { cpg = fs.readFileSync(base + ext, 'utf8').trim(); break; } catch (e) { /* tenta o outro */ }
}
// 'UTF-8' / '65001' = utf-8; o resto (ANSI 1252, vazio) cai no padrão brasileiro antigo
const codificacao = cpg && /^(utf-?8|65001)$/i.test(cpg) ? 'utf-8' : 'windows-1252';

const lido = shapelib.lerShp(new Uint8Array(fs.readFileSync(origem)).buffer);
const dbf = fs.existsSync(base + '.dbf')
  ? shapelib.lerDbf(new Uint8Array(fs.readFileSync(base + '.dbf')).buffer, codificacao)
  : { registros: [] };

const feicoes = [];
let vertices = 0;
for (let i = 0; i < lido.registros.length; i++) {
  const r = lido.registros[i];
  if (!r || !r.geometry) continue;
  const anda = (c) => {
    if (typeof c[0] === 'number') { vertices++; return [+c[0].toFixed(6), +c[1].toFixed(6)]; }
    return c.map(anda);
  };
  feicoes.push({
    type: 'Feature',
    properties: dbf.registros[i] || {},
    geometry: { type: r.geometry.type, coordinates: anda(r.geometry.coordinates) },
  });
}

const saida = path.isAbsolute(destino) ? destino : path.join(raiz, destino);
fs.mkdirSync(path.dirname(saida), { recursive: true });
fs.writeFileSync(saida, JSON.stringify({ type: 'FeatureCollection', features: feicoes }), 'utf8');

console.log('  ' + path.basename(origem));
console.log('    .cpg: ' + (cpg || '(nenhum — li como ' + codificacao + ')')
  + '   .dbf: ' + (dbf.registros.length || 'sem') + ' registros');
console.log('    ' + feicoes.length + ' feições, ' + vertices.toLocaleString('pt-BR') + ' vértices  ->  '
  + destino + '  (' + (fs.statSync(saida).size / 1048576).toFixed(1) + ' MB)');
if (dbf.registros.length && dbf.registros.length !== feicoes.length) {
  console.log('    ATENÇÃO: .dbf com ' + dbf.registros.length + ' registros e .shp com ' + feicoes.length
    + ' geometrias — confira antes de publicar.');
}
