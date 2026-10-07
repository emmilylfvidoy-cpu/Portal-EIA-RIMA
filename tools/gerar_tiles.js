'use strict';
/* ============================================================================
 * gerar_tiles.js — publica uma camada grande em tiles binários, SEM ALTERAR a feição
 *
 * Cada feição entra INTEIRA (nada é cortado, nada é simplificado): ela vai para o tile que
 * contém o centro dela, e o tile é uma região compacta montada por CRESCIMENTO a partir das
 * células mais densas — crescer em ordem de leitura produziria tiles compridos, com bbox
 * enorme, e o portal carregaria meia camada para mostrar um pedaço.
 *
 * O índice diz, por tile, a bbox e o tamanho. Com ele o portal carrega só o que aparece na
 * tela (para desenhar) e só o que intersecta a área de influência (para recortar).
 *
 * Uso: node tools/gerar_tiles.js pedologia --alvo-mb 1.5
 * ========================================================================== */
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const shapelib = require(path.join(raiz, 'js', 'shapelib.js'));
const tiles = require(path.join(raiz, 'js', 'tiles.js'));

const CELULA_GRAUS = 0.05;          // ~5,5 km: célula fina que só agrupa, não define tile

function argumentos(argv) {
  const a = { id: argv[2], alvoMb: 1.5, contar: false, nivel: 'exato', celula: CELULA_GRAUS, escala: 0 };
  for (let i = 3; i < argv.length; i++) {
    if (argv[i] === '--alvo-mb') a.alvoMb = Number(argv[++i]);
    else if (argv[i] === '--nivel') a.nivel = argv[++i];
    else if (argv[i] === '--celula') a.celula = Number(argv[++i]);
    else if (argv[i] === '--escala') a.escala = Number(argv[++i]);
    else if (argv[i] === '--so-contar') a.contar = true;
  }
  return a;
}

/** Bytes aproximados de uma feição no tile: ~3,4 por ponto + o texto dos atributos. */
function estimarBytes(f) {
  let pontos = 0;
  for (const parte of tiles.aneisDe(f.geometry)) for (const anel of parte) pontos += anel.length;
  let attrs = 0;
  for (const k of Object.keys(f.properties || {})) {
    const v = f.properties[k];
    attrs += k.length + 1 + (v === null || v === undefined ? 1 : String(v).length + 3);
  }
  return pontos * 3.4 + attrs + 12;
}

function bboxDeGeometria(geometria) {
  const bb = tiles.bboxDe([{ geometry: geometria }]);
  return bb[0] === 0 && bb[2] === 0 ? null : bb;
}

async function principal() {
  const args = argumentos(process.argv);
  if (!args.id) { console.error('uso: node tools/gerar_tiles.js <id-da-camada> [--alvo-mb 1.5]'); process.exit(1); }
  const manifesto = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'camadas-fonte.json'), 'utf8'));
  const entrada = manifesto.camadas.find((c) => c.id === args.id);
  if (!entrada) { console.error('Camada "' + args.id + '" não está no manifesto.'); process.exit(1); }
  const base = entrada.origem.replace(/\.shp$/i, '');

  console.log('Lendo ' + path.basename(entrada.origem) + ' …');
  const t0 = Date.now();
  const lido = shapelib.lerShp(new Uint8Array(fs.readFileSync(entrada.origem)).buffer);
  const dbf = shapelib.lerDbf(new Uint8Array(fs.readFileSync(base + '.dbf')).buffer);
  console.log('  ' + lido.registros.length.toLocaleString('pt-BR') + ' registros em '
    + ((Date.now() - t0) / 1000).toFixed(1) + ' s');

  const feicoes = [];
  let pontos = 0, bytesEstimados = 0;
  for (let i = 0; i < lido.registros.length; i++) {
    const r = lido.registros[i];
    const props = dbf.registros[i];
    if (!r || !r.geometry || !props) continue;
    const bb = bboxDeGeometria(r.geometry);
    if (!bb) continue;
    const f = { geometry: r.geometry, properties: props, bbox: bb };
    f.pontos = 0;
    for (const parte of tiles.aneisDe(r.geometry)) for (const anel of parte) f.pontos += anel.length;
    f.bytes = estimarBytes(f);
    pontos += f.pontos;
    bytesEstimados += f.bytes;
    feicoes.push(f);
  }
  console.log('  ' + feicoes.length.toLocaleString('pt-BR') + ' feições, '
    + pontos.toLocaleString('pt-BR') + ' pontos, ~' + (bytesEstimados / 1048576).toFixed(1) + ' MB em tile');
  if (args.contar) return;

  /* NÍVEL DE VISÃO: quando o usuário está LONGE, desenhar 350 mil vértices para uma tela de
   * 1000 pixels é desperdício — e era o que deixava a camada lenta. O nível de visão é
   * generalizado (não é o dado: é o desenho de longe) e o nível exato continua no seu lugar,
   * carregado quando o zoom aproxima e SEMPRE usado no recorte. */
  if (args.escala > 0) {
    const imp = require(path.join(raiz, 'tools', 'importar_camadas.js'));
    const tolerancia = imp.toleranciaParaEscala(args.escala);
    console.log('  nível de visão: generalizando a 1:' + args.escala.toLocaleString('pt-BR')
      + ' (' + Math.round(tolerancia * 110574) + ' m)');
    let antes = 0, depois = 0;
    for (const f of feicoes) {
      const r = imp.prepararGeometria(f.geometry, {
        tolerancia: tolerancia, casas: 5, capEspessura: false, descartarColapsados: true,
      });
      if (!r.geometria) { f.geometry = null; continue; }
      f.geometry = r.geometria;
      f.bbox = bboxDeGeometria(r.geometria);
      antes += r.verticesAntes; depois += r.verticesDepois;
      f.pontos = 0;
      // r.geometria (e não r.geometry): o importador devolve em português
      for (const parte of tiles.aneisDe(r.geometria)) for (const anel of parte) f.pontos += anel.length;
      f.bytes = estimarBytes(f);
    }
    for (let i = feicoes.length - 1; i >= 0; i--) if (!feicoes[i].geometry) feicoes.splice(i, 1);
    pontos = 0; bytesEstimados = 0;
    for (const f of feicoes) { pontos += f.pontos; bytesEstimados += f.bytes; }
    console.log('  vértices ' + antes.toLocaleString('pt-BR') + ' -> ' + depois.toLocaleString('pt-BR')
      + '   ' + feicoes.length.toLocaleString('pt-BR') + ' feições, ~'
      + (bytesEstimados / 1048576).toFixed(2) + ' MB');
  }

  // ---- células finas, por centro da feição
  const celulas = new Map();
  for (const f of feicoes) {
    const cx = (f.bbox[0] + f.bbox[2]) / 2;
    const cy = (f.bbox[1] + f.bbox[3]) / 2;
    const ix = Math.floor(cx / args.celula);
    const iy = Math.floor(cy / args.celula);
    const chave = ix + ':' + iy;
    if (!celulas.has(chave)) celulas.set(chave, { ix: ix, iy: iy, feicoes: [], bytes: 0 });
    const c = celulas.get(chave);
    c.feicoes.push(f);
    c.bytes += f.bytes;
  }
  console.log('  ' + celulas.size + ' células de ' + (CELULA_GRAUS * 111320 / 1000).toFixed(0) + ' km');

  // ---- agrupamento por ORDEM ESPACIAL (curva de Morton)
  //
  // A primeira versão crescia por vizinhança: só agregava célula que ENCOSTAVA na anterior.
  // Numa camada esparsa — Unidades de Conservação ocupam uma fração pequena do estado — quase
  // nenhuma célula tem vizinha, e o resultado foram 1831 tiles de 1 KB: o portal faria 1831
  // requisições para desenhar a camada.
  //
  // A ordem de Morton resolve sem heurística: ordena as células de modo que vizinhas no espaço
  // fiquem vizinhas na lista (curva em Z, entrelaçando os bits de x e y). Cortar a lista pelo
  // tamanho-alvo dá tiles compactos e equilibrados, em qualquer densidade.
  const alvo = args.alvoMb * 1048576;
  const morton = (ix, iy) => {
    let codigo = 0;
    for (let b = 0; b < 16; b++) {
      codigo += ((ix >> b) & 1) * Math.pow(2, 2 * b + 1);
      codigo += ((iy >> b) & 1) * Math.pow(2, 2 * b);
    }
    return codigo;
  };
  const ordenadas = Array.from(celulas.values()).sort(function (a, b) {
    return morton(a.ix, a.iy) - morton(b.ix, b.iy);
  });
  const bboxDoGrupo = (g) => g.celulas.reduce((s, c) => c.feicoes.reduce((t, f) => [
    Math.min(t[0], f.bbox[0]), Math.min(t[1], f.bbox[1]),
    Math.max(t[2], f.bbox[2]), Math.max(t[3], f.bbox[3]),
  ], s), [Infinity, Infinity, -Infinity, -Infinity]);

  const grupos = [];
  let atual = null;
  for (const c of ordenadas) {
    if (!atual || atual.bytes + c.bytes > alvo) {
      atual = { celulas: [], bytes: 0 };
      grupos.push(atual);
    }
    atual.celulas.push(c);
    atual.bytes += c.bytes;
  }
  for (const g of grupos) g.bbox = bboxDoGrupo(g);

  // ---- grava os tiles
  const destino = path.join(raiz, 'data', args.id, args.nivel);
  fs.rmSync(destino, { recursive: true, force: true });
  fs.mkdirSync(destino, { recursive: true });

  const indice = [];
  let n = 0;
  for (const g of grupos) {
    const feicoesDoTile = [];
    for (const c of g.celulas) for (const f of c.feicoes) feicoesDoTile.push(f);
    const bin = tiles.codificar(feicoesDoTile.map((f) => ({
      type: 'Feature', properties: f.properties, geometry: f.geometry,
    })));
    const nome = 't' + String(n).padStart(3, '0') + '.bin';
    fs.writeFileSync(path.join(destino, nome), bin);
    indice.push({
      arquivo: 'data/' + args.id + '/' + args.nivel + '/' + nome,
      bbox: g.bbox.map((v) => Number(v.toFixed(6))),
      feicoes: feicoesDoTile.length,
      pontos: feicoesDoTile.reduce((s, f) => s + f.pontos, 0),
      bytes: bin.length,
    });
    n++;
  }
  const total = indice.reduce((s, i) => s + i.bytes, 0);
  indice.sort((a, b) => b.bytes - a.bytes);
  fs.writeFileSync(path.join(destino, 'indice.json'), JSON.stringify({
    camada: args.id, nome: entrada.nome, formato: 'EIAT' + tiles.VERSAO,
    casas: tiles.CASAS,
    nivel: args.nivel,
    geometria: args.escala > 0 ? 'generalizada para o desenho de longe' : 'exata',
    escala: args.escala || null,
    observacao: 'Feições inteiras, agrupadas por região. A geometria NÃO foi simplificada: '
      + 'cada vértice do shapefile está no tile, quantizado em ' + tiles.CASAS
      + ' casas decimais (~11 cm), a mesma precisão do GeoJSON do portal.',
    // somado dos tiles (e não de uma variável do caminho): o total já saiu errado uma vez
    total: {
      tiles: n,
      feicoes: indice.reduce((s, i) => s + i.feicoes, 0),
      pontos: indice.reduce((s, i) => s + i.pontos, 0),
      bytes: total,
    },
    campos: Object.keys(feicoes[0] ? feicoes[0].properties : {}),
    tiles: indice,
  }, null, 1), 'utf8');

  console.log('');
  console.log('  ' + n + ' tiles em data/' + args.id + '/');
  console.log('  total ' + (total / 1048576).toFixed(2) + ' MB   (estimado '
    + (bytesEstimados / 1048576).toFixed(1) + ' MB)');
  console.log('  maior ' + (indice[0].bytes / 1048576).toFixed(2) + ' MB   menor '
    + (indice[indice.length - 1].bytes / 1024).toFixed(0) + ' KB   média '
    + (total / n / 1048576).toFixed(2) + ' MB');
  const acima = indice.filter((i) => i.bytes > args.alvoMb * 1048576 * 2);
  if (acima.length) {
    console.log('  ' + acima.length + ' tile(s) acima do dobro do alvo — é feição grande sozinha:');
    for (const a of acima.slice(0, 3)) {
      console.log('     ' + path.basename(a.arquivo) + '  ' + (a.bytes / 1048576).toFixed(2)
        + ' MB, ' + a.feicoes + ' feição(ões), ' + a.pontos.toLocaleString('pt-BR') + ' pontos');
    }
  }
}

principal().catch((e) => { console.error('FALHOU: ' + e.message); process.exit(1); });
