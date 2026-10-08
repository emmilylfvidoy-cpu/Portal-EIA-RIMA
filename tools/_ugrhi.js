'use strict';
/* Prova o caminho do Inventario por UGRHI: baixa o SHAPE-ZIP do DataGEO e, depois de
 * descompactado pelo PowerShell, le o .shp com o leitor do proprio portal.
 *
 * Uso: node tools/_ugrhi.js baixar 17
 *      node tools/_ugrhi.js ler ../tools/_ugrhi17
 * Temporario. */
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');

function urlDaUgrhi(n) {
  const camada = 'INVENTARIO_FLORESTAL_UGRHI' + n + '_IPA_2020_POL';
  return 'https://datageo.ambiente.sp.gov.br/geoserver/datageo/' + camada + '/wfs'
    + '?version=1.0.0&request=GetFeature&outputFormat=SHAPE-ZIP&typeName=' + camada;
}

async function baixar(n) {
  const destino = path.join(raiz, 'tools', '_ugrhi' + n + '.zip');
  const t0 = Date.now();
  console.log('  baixando UGRHI ' + n + ' …');
  const r = await fetch(urlDaUgrhi(n));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const total = Number(r.headers.get('content-length') || 0);
  const pedacos = [];
  let recebido = 0;
  if (r.body) {
    const leitor = r.body.getReader();
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      pedacos.push(Buffer.from(value));
      recebido += value.length;
      if (recebido % (5 * 1048576) < value.length) {
        process.stdout.write('\r    ' + (recebido / 1048576).toFixed(1) + ' MB'
          + (total ? ' de ' + (total / 1048576).toFixed(1) + ' MB' : '') + '…');
      }
    }
  } else {
    pedacos.push(Buffer.from(await r.arrayBuffer()));
    recebido = pedacos[0].length;
  }
  process.stdout.write('\r' + ' '.repeat(60) + '\r');
  fs.writeFileSync(destino, Buffer.concat(pedacos));
  console.log('  gravado ' + destino + '  ' + (fs.statSync(destino).size / 1048576).toFixed(1)
    + ' MB em ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
}

function ler(pasta) {
  const shapelib = require(path.join(raiz, 'js', 'shapelib.js'));
  const dir = path.isAbsolute(pasta) ? pasta : path.join(raiz, pasta);
  const arquivos = fs.readdirSync(dir, { recursive: true });
  const shp = arquivos.map(String).find((f) => /\.shp$/i.test(f));
  if (!shp) { console.log('  nenhum .shp em ' + dir + '   conteudo: ' + arquivos.slice(0, 8).join(', ')); return; }
  const caminho = path.join(dir, shp);
  const lido = shapelib.lerShp(new Uint8Array(fs.readFileSync(caminho)).buffer);
  let pontos = 0;
  for (const r of lido.registros) {
    if (!r || !r.geometry) continue;
    const anda = (c) => { if (typeof c[0] === 'number') { pontos++; return; } for (const p of c) anda(p); };
    if (r.geometry.coordinates) anda(r.geometry.coordinates);
  }
  const comDbf = arquivos.map(String).find((f) => /\.dbf$/i.test(f));
  const comPrj = arquivos.map(String).find((f) => /\.prj$/i.test(f));
  console.log('  ' + shp + '  ->  ' + lido.registros.length.toLocaleString('pt-BR')
    + ' feições, ' + pontos.toLocaleString('pt-BR') + ' vértices');
  console.log('  .dbf: ' + (comDbf ? 'sim' : 'NÃO') + '    .prj: ' + (comPrj ? 'sim' : 'NÃO'));
  if (comPrj) {
    const p = fs.readFileSync(path.join(dir, comPrj), 'utf8');
    console.log('  projeção: ' + p.replace(/\s+/g, ' ').slice(0, 120));
  }
  if (comDbf) {
    const dbf = shapelib.lerDbf(new Uint8Array(fs.readFileSync(path.join(dir, comDbf))).buffer);
    const props = dbf.registros.find((x) => x) || {};
    console.log('  campos: ' + Object.keys(props).join(', '));
  }
}

(async () => {
  const modo = process.argv[2];
  if (modo === 'baixar') await baixar(process.argv[3] || '17');
  else if (modo === 'ler') ler(process.argv[3] || 'tools/_ugrhi17');
  else console.log('uso: node tools/_ugrhi.js baixar|ler [n|pasta]');
})().catch((e) => { console.error('FALHOU: ' + e.message); process.exit(1); });
