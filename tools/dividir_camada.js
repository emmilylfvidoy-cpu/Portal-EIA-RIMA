'use strict';
/* ============================================================================
 * dividir_camada.js — parte uma camada grande em pedaços por região, SEM ALTERAR a feição.
 *
 * POR QUE ISSO EXISTE: "não pode alterar a feição" e "tem de carregar no navegador" são
 * exigências que brigam quando a camada tem 10,8 milhões de pontos (Pedologia) — o GeoJSON
 * exato dela tem ~265 MB. Simplificar resolve o peso e DESTRÓI a feição; publicar inteiro
 * resolve a feição e inviabiliza o portal.
 *
 * A saída é a mesma que um serviço de mapas usa: dividir por REGIÃO. Cada feição vai INTEIRA
 * para o pedaço que contém o seu centro (nada é cortado, nada é movido), e um índice diz
 * quais pedaços interessam para uma janela do mapa. O portal carrega só o que aparece na tela.
 *
 * Uso:
 *   node tools/dividir_camada.js pedologia --alvo-mb 4
 *   node tools/dividir_camada.js unidades-conservacao --alvo-mb 4
 *   node tools/dividir_camada.js pedologia --so-contar      (só mede, não grava)
 * ========================================================================== */
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const shapelib = require(path.join(raiz, 'js', 'shapelib.js'));
const importador = require(path.join(__dirname, 'importar_camadas.js'));
const simbologia = require(path.join(raiz, 'js', 'simbologia.js'));

function argumentos(argv) {
  const a = { id: argv[2], alvoMb: 4, contar: false, celulas: 0 };
  for (let i = 3; i < argv.length; i++) {
    if (argv[i] === '--alvo-mb') a.alvoMb = Number(argv[++i]);
    else if (argv[i] === '--so-contar') a.contar = true;
    else if (argv[i] === '--celulas') a.celulas = Number(argv[++i]);
  }
  return a;
}

function bboxDeCoords(geometria) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const anda = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < x0) x0 = c[0];
      if (c[1] < y0) y0 = c[1];
      if (c[0] > x1) x1 = c[0];
      if (c[1] > y1) y1 = c[1];
      return;
    }
    for (const p of c) anda(p);
  };
  if (geometria && geometria.coordinates) anda(geometria.coordinates);
  if (geometria && geometria.geometries) for (const g of geometria.geometries) anda(g.coordinates);
  return x0 === Infinity ? null : [x0, y0, x1, y1];
}

function pontosDe(geometria) {
  let n = 0;
  const anda = (c) => {
    if (typeof c[0] === 'number') { n++; return; }
    for (const p of c) anda(p);
  };
  if (geometria && geometria.coordinates) anda(geometria.coordinates);
  if (geometria && geometria.geometries) for (const g of geometria.geometries) anda(g.coordinates);
  return n;
}

async function principal() {
  const args = argumentos(process.argv);
  const manifesto = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'camadas-fonte.json'), 'utf8'));
  const entrada = manifesto.camadas.find((c) => c.id === args.id);
  if (!entrada) {
    console.error('Camada "' + args.id + '" não está no manifesto.');
    process.exit(1);
  }
  const base = entrada.origem.replace(/\.shp$/i, '');
  console.log('Lendo ' + entrada.origem + ' …');
  const t0 = Date.now();
  const lido = shapelib.lerShp(new Uint8Array(fs.readFileSync(entrada.origem)).buffer);
  const dbf = shapelib.lerDbf(new Uint8Array(fs.readFileSync(base + '.dbf')).buffer);
  console.log('  ' + lido.registros.length.toLocaleString('pt-BR') + ' feições em '
    + ((Date.now() - t0) / 1000).toFixed(1) + ' s');

  // monta as feições (geometria exata + atributos), sem simplificar
  const feicoes = [];
  let pontosTotais = 0;
  for (let i = 0; i < lido.registros.length; i++) {
    const r = lido.registros[i];
    if (!r || !r.geometry) continue;
    const props = dbf.registros[i];
    if (!props) continue;
    const bb = bboxDeCoords(r.geometry);
    if (!bb) continue;
    pontosTotais += pontosDe(r.geometry);
    feicoes.push({ geometry: r.geometry, properties: props, bbox: bb });
  }
  console.log('  ' + feicoes.length.toLocaleString('pt-BR') + ' feições com geometria, '
    + pontosTotais.toLocaleString('pt-BR') + ' pontos');
  if (args.contar) return;

  // quantas células? estima pelo alvo de MB (≈25 bytes por ponto em JSON)
  const bytesTotais = pontosTotais * 25;
  let celulas = args.celulas || Math.max(4, Math.ceil(bytesTotais / (args.alvoMb * 1048576)));
  celulas = Math.min(400, celulas);
  // grade quadrada na extensão da camada
  const geral = feicoes.reduce((s, f) => [
    Math.min(s[0], f.bbox[0]), Math.min(s[1], f.bbox[1]),
    Math.max(s[2], f.bbox[2]), Math.max(s[3], f.bbox[3]),
  ], [Infinity, Infinity, -Infinity, -Infinity]);
  const lado = Math.max(2, Math.round(Math.sqrt(celulas)));
  const passoX = (geral[2] - geral[0]) / lado;
  const passoY = (geral[3] - geral[1]) / lado;
  console.log('  grade de ' + lado + ' x ' + lado + ' células ('
    + (passoX * 111320).toFixed(0) + ' m x ' + (passoY * 110574).toFixed(0) + ' m)');

  // cada feição vai INTEIRA para a célula do seu centro
  const mapa = new Map();
  for (const f of feicoes) {
    const cx = (f.bbox[0] + f.bbox[2]) / 2;
    const cy = (f.bbox[1] + f.bbox[3]) / 2;
    const ix = Math.min(lado - 1, Math.max(0, Math.floor((cx - geral[0]) / passoX)));
    const iy = Math.min(lado - 1, Math.max(0, Math.floor((cy - geral[1]) / passoY)));
    const chave = ix + '_' + iy;
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push(f);
  }

  const destino = path.join(raiz, 'data', args.id);
  fs.rmSync(destino, { recursive: true, force: true });
  fs.mkdirSync(destino, { recursive: true });

  const indice = [];
  let n = 0;
  for (const [chave, lista] of mapa) {
    const nome = 'p' + chave + '.geojson';
    const fc = {
      type: 'FeatureCollection',
      metadados: {
        camada: entrada.nome, parte: chave, gerado_por: 'tools/dividir_camada.js',
        geometria: 'exata', feicoes: lista.length,
      },
      features: lista.map((f) => ({ type: 'Feature', properties: f.properties, geometry: f.geometry })),
    };
    const texto = JSON.stringify(fc);
    fs.writeFileSync(path.join(destino, nome), texto, 'utf8');
    const bb = lista.reduce((s, f) => [
      Math.min(s[0], f.bbox[0]), Math.min(s[1], f.bbox[1]),
      Math.max(s[2], f.bbox[2]), Math.max(s[3], f.bbox[3]),
    ], [Infinity, Infinity, -Infinity, -Infinity]);
    indice.push({ arquivo: 'data/' + args.id + '/' + nome, bbox: bb.map((v) => Number(v.toFixed(6))), feicoes: lista.length, mb: Number((texto.length / 1048576).toFixed(2)) });
    n++;
  }
  indice.sort((a, b) => b.mb - a.mb);
  fs.writeFileSync(path.join(destino, 'indice.json'), JSON.stringify({
    camada: args.id, nome: entrada.nome, gerado_por: 'tools/dividir_camada.js',
    geometria: 'exata',
    observacao: 'Feições inteiras, agrupadas pela célula que contém o centro delas. Nada é cortado nem movido: a feição é a do shapefile de origem.',
    total: { partes: n, feicoes: feicoes.length, pontos: pontosTotais, mb: Number((indice.reduce((s, i) => s + i.mb, 0)).toFixed(2)) },
    partes: indice,
  }, null, 1), 'utf8');

  console.log('');
  console.log('  ' + n + ' partes em data/' + args.id + '/');
  console.log('  total ' + indice.reduce((s, i) => s + i.mb, 0).toFixed(2) + ' MB');
  console.log('  maior parte ' + indice[0].mb.toFixed(2) + ' MB   menor '
    + indice[indice.length - 1].mb.toFixed(2) + ' MB   média '
    + (indice.reduce((s, i) => s + i.mb, 0) / n).toFixed(2) + ' MB');
  const pesadas = indice.filter((i) => i.mb > args.alvoMb * 2);
  if (pesadas.length) console.log('  ' + pesadas.length + ' parte(s) acima do dobro do alvo (feição grande sozinha)');
}

principal().catch((e) => { console.error('FALHOU: ' + e.message); process.exit(1); });
