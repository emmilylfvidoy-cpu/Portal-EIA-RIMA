'use strict';
/* ============================================================================
 * inventario_quadrantes.js — baixa o Inventário Florestal 2020 por QUADRANTES
 *
 * POR QUE QUADRANTES: medido duas vezes — o serviço responde HTTP 500 quando o deslocamento
 * (resultOffset) passa de ~178.000, e isso NÃO depende da caixa consultada. Dividir a área em
 * quadrantes mantém o deslocamento raso por construção. Aprofundar o deslocamento não funciona.
 *
 * DOIS CUIDADOS QUE VALEM A PENA:
 *  - DEDUPLICAÇÃO POR OBJECTID: a consulta por caixa devolve a feição INTEIRA que cruza a
 *    borda, então quem está na divisa viria em dois quadrantes. Sem deduplicar, a mesma mancha
 *    entraria duas vezes e a área do relatório sairia dobrada.
 *  - GRAVAÇÃO EM FLUXO: o resultado passa de 800 MB. Montar isso na memória para gravar de uma
 *    vez é o que estoura o processo; aqui cada página é escrita e liberada, com respeito ao
 *    contrapressão do disco.
 *
 * Uso: node tools/inventario_quadrantes.js            (São Paulo em 4x2 quadrantes)
 *      node tools/inventario_quadrantes.js --teste    (um quadradinho, para validar)
 * ========================================================================== */
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const URL_SERVICO = 'https://mapas.semil.sp.gov.br/server/rest/services/TEMATICOS/InventarioFlorestal_2020/MapServer/0';
const CAIXA_SP = [-53.20419, -25.32118, -44.16341, -19.75800];
const NX = 4, NY = 2;          // 8 quadrantes: ~25 a 30 mil feições cada, longe do muro de 178 mil
const PAGINA = 1000;
const SAIDA = path.join(raiz, 'tools', '_inventario.geojson');

const CAMPOS_TECNICOS = /^(objectid|oid|fid|shape|geom|geometry|the_geom|ogc_fid)$|^shape\.|^st_|_sh$|^shape_leng$/i;

if (typeof fetch !== 'function') { console.error('Precisa de Node 18+ (fetch).'); process.exit(1); }

function limpar(props) {
  const saida = {};
  for (const k of Object.keys(props || {})) {
    if (CAMPOS_TECNICOS.test(k)) continue;
    saida[k] = props[k];
  }
  return saida;
}

/** 6 casas (~11 cm, a precisão que o portal publica) e sem a terceira coordenada. */
function arrumar(g) {
  const anda = (c) => typeof c[0] === 'number'
    ? [+c[0].toFixed(6), +c[1].toFixed(6)]
    : c.map(anda);
  return { type: g.type, coordinates: anda(g.coordinates) };
}

function caixas() {
  const [x0, y0, x1, y1] = CAIXA_SP;
  const dx = (x1 - x0) / NX, dy = (y1 - y0) / NY;
  const lista = [];
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NY; j++) {
      lista.push([
        +(x0 + i * dx).toFixed(5), +(y0 + j * dy).toFixed(5),
        +(x0 + (i + 1) * dx).toFixed(5), +(y0 + (j + 1) * dy).toFixed(5),
      ]);
    }
  }
  return lista;
}

function urlDaCaixa(caixa, offset, soContar) {
  const p = new URLSearchParams();
  p.set('where', '1=1');
  if (soContar) { p.set('returnCountOnly', 'true'); p.set('f', 'json'); }
  else {
    p.set('outFields', '*');
    p.set('returnGeometry', 'true');
    p.set('outSR', '4326');
    p.set('f', 'geojson');
    p.set('resultOffset', String(offset));
    p.set('resultRecordCount', String(PAGINA));
  }
  p.set('geometry', caixa.join(','));
  p.set('geometryType', 'esriGeometryEnvelope');
  p.set('inSR', '4326');
  p.set('spatialRel', 'esriSpatialRelIntersects');
  return URL_SERVICO + '/query?' + p.toString();
}

async function contarNoServico(caixa) {
  try {
    const r = await fetch(urlDaCaixa(caixa, 0, true));
    const d = await r.json();
    return typeof d.count === 'number' ? d.count : null;
  } catch (e) { return null; }
}

async function principal() {
  const teste = process.argv.indexOf('--teste') >= 0;
  const lista = teste ? [[-47.95, -23.05, -47.85, -22.95]] : caixas();
  const saida = teste ? path.join(raiz, 'tools', '_inventario_teste.geojson') : SAIDA;

  const vistos = new Set();
  const fluxo = fs.createWriteStream(saida, { encoding: 'utf8' });
  let pendente = '{"type":"FeatureCollection","features":[';
  let total = 0, primeiro = true;

  const juntar = (f) => {
    pendente += (primeiro ? '' : ',') + JSON.stringify(f);
    primeiro = false;
    total++;
  };
  const descarregar = async () => {
    if (!pendente) return;
    const pode = fluxo.write(pendente);
    pendente = '';
    if (!pode) await new Promise((ok) => fluxo.once('drain', ok));
  };

  console.log('  ' + lista.length + ' quadrante(s)' + (teste ? '  (MODO TESTE)' : '   São Paulo em ' + NX + 'x' + NY));
  let duplicadas = 0, semGeometria = 0, semId = 0;

  for (let i = 0; i < lista.length; i++) {
    const caixa = lista[i];
    const esperado = await contarNoServico(caixa);
    console.log('  quadrante ' + (i + 1) + '/' + lista.length + '  ' + caixa.join(', ')
      + '   serviço diz ' + (esperado === null ? '?' : esperado.toLocaleString('pt-BR')));
    let offset = 0, nesta = 0;
    for (let volta = 0; volta < 600; volta++) {
      const r = await fetch(urlDaCaixa(caixa, offset, false));
      if (!r.ok) {
        await descarregar();
        fluxo.end('');
        throw new Error('HTTP ' + r.status + ' no quadrante ' + (i + 1) + ', deslocamento ' + offset
          + '  (o muro medido é ~178.000; este quadrante deveria ficar bem abaixo)');
      }
      const d = await r.json();
      if (d.error) throw new Error(d.error.message || 'erro no serviço');
      const vieram = d.features || [];
      for (const f of vieram) {
        const id = f.properties && f.properties.OBJECTID;
        if (id === undefined) semId++;
        const chave = id === undefined ? 'sem-id-' + (total + semId) : 'id-' + id;
        if (vistos.has(chave)) { duplicadas++; continue; }
        vistos.add(chave);
        if (!f.geometry) { semGeometria++; continue; }
        juntar({ type: 'Feature', properties: limpar(f.properties), geometry: arrumar(f.geometry) });
      }
      nesta += vieram.length;
      await descarregar();
      process.stdout.write('\r    feições no quadrante ' + nesta.toLocaleString('pt-BR') + '   total ' + total.toLocaleString('pt-BR') + '   ');
      if (!d.exceededTransferLimit || !vieram.length) break;
      offset += vieram.length;
    }
    process.stdout.write('\r' + ' '.repeat(70) + '\r');
    console.log('    somadas ' + nesta.toLocaleString('pt-BR') + '   novas ' + total.toLocaleString('pt-BR')
      + '   duplicadas de borda ' + duplicadas.toLocaleString('pt-BR'));
  }

  await descarregar();
  pendente = ']}';
  await descarregar();
  await new Promise((ok) => fluxo.end(ok));

  const mb = fs.statSync(saida).size / 1048576;
  console.log('');
  console.log('  GRAVADO: ' + total.toLocaleString('pt-BR') + ' feições   ' + mb.toFixed(1) + ' MB   ' + saida);
  console.log('  duplicadas de borda descartadas: ' + duplicadas.toLocaleString('pt-BR'));
  if (semGeometria) console.log('  sem geometria (descartadas): ' + semGeometria);
  if (semId) console.log('  sem OBJECTID: ' + semId);

  /* CONFERÊNCIA DE COMPLETUDE: a consulta única pela caixa de São Paulo devolve o mesmo conjunto
   * que a união dos quadrantes (a feição de borda aparece nos dois, e a deduplicação já tratou
   * disso). Se não bater, faltou pedaço — e dado pela metade passando por inteiro é o pior
   * defeito possível aqui. */
  if (!teste) {
    const esperado = await contarNoServico(CAIXA_SP);
    console.log('');
    if (esperado === null) {
      console.log('  CONFERÊNCIA: não consegui perguntar ao serviço quantas feições ele tem em SP.');
    } else if (esperado === total) {
      console.log('  CONFERÊNCIA: FECHA — o serviço declara ' + esperado.toLocaleString('pt-BR')
        + ' feições cruzando São Paulo, e foram gravadas ' + total.toLocaleString('pt-BR') + '.');
    } else {
      console.log('  CONFERÊNCIA: NÃO FECHA — serviço declara ' + esperado.toLocaleString('pt-BR')
        + ', gravadas ' + total.toLocaleString('pt-BR') + ' (diferença de '
        + (esperado - total).toLocaleString('pt-BR') + '). NÃO publicar antes de entender.');
    }
  }
}

principal().catch((e) => { console.error('\nFALHOU: ' + e.message); process.exit(1); });
