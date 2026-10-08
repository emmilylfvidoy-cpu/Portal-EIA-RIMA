'use strict';
/* ============================================================================
 * coletar_servico.js — tira a FOTO de uma camada de serviço e publica na base fixa
 *
 * POR QUE ISSO EXISTE
 * Camada ao vivo alimenta o recorte com o que o servidor responder naquele dia: o mesmo estudo
 * refeito amanhã pode dar outro número, e num EIA/RIMA isso não se sustenta. Aqui a camada é
 * baixada UMA vez, com a data da consulta, e passa a ser dado do portal como as outras.
 *
 * A GEOMETRIA NÃO É ALTERADA: o que vem do serviço é o que entra. A única normalização é
 * arredondar para 6 casas decimais (~11 cm, a mesma precisão que o portal publica em GeoJSON e
 * nos tiles) e descartar a terceira coordenada quando o serviço devolve Z constante — área e
 * distância no portal são medidas em 2D de qualquer forma. Isso fica declarado na fonte.
 *
 * Uso:
 *   node tools/coletar_servico.js                      (todas as camadas com "congelar": true)
 *   node tools/coletar_servico.js cetesb-jurubatuba    (uma camada)
 * ========================================================================== */
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const CATALOGO = path.join(raiz, 'data', 'catalogo.json');
const PAGINA = 1000;
const CASAS = 6;

if (typeof fetch !== 'function') {
  console.error('Este script precisa de Node 18 ou mais novo (usa fetch).');
  process.exit(1);
}

function argumentos(argv) {
  const ids = [], a = { data: '', secar: false, baixarPara: '', limiteMb: 20 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--data') a.data = argv[++i];
    else if (argv[i] === '--baixar-para') a.baixarPara = argv[++i];
    else if (argv[i] === '--limite-mb') a.limiteMb = Number(argv[++i]);
    else if (argv[i] === '--secar') a.secar = true;   // só mostra o que faria
    else ids.push(argv[i]);
  }
  return { ids: ids, opcoes: a };
}

const hoje = () => new Date().toISOString().slice(0, 10);

/** URL de uma página, por tipo de serviço. Reaproveita o módulo do portal. */
const FAIXA = 20000;   // tamanho da faixa de OBJECTID: deslocamento sempre raso

function urlDaPagina(camada, offset, base) {
  const S = require(path.join(raiz, 'js', 'servicos.js'));
  /* filtro_bbox: baixa só o que cruza a caixa (a extensão de SP, no caso das camadas do IPHAN).
   * É SELEÇÃO, não recorte: a feição entra inteira. */
  const caixa = camada.filtro_bbox;
  if (S.tipoDe(camada) === 'wfs') {
    const p = new URLSearchParams();
    p.set('service', 'WFS');
    p.set('version', '2.0.0');
    p.set('request', 'GetFeature');
    p.set('typeNames', camada.servico.camada);
    p.set('outputFormat', 'application/json');
    p.set('srsName', camada.servico.eixo === 'lonlat' ? S.CRS84 : (camada.servico.crs || S.CRS_PADRAO));
    // sem count/startIndex: este GeoServer não pagina camada sem chave primária (medido)
    // caixa CRUA (vírgula não codificada) e na ordem do CRS: as duas coisas medidas no IPHAN
    return S.urlComCaixa(camada.servico.url, p, caixa ? S.caixaParaWfs(caixa, camada.servico.crs, camada.servico.eixo) : '');
  }
  const p = new URLSearchParams();
  /* POR FAIXA, NÃO POR OFFSET PROFUNDO: medido no Inventário Florestal — com resultOffset
   * chegando a 177.000 o serviço responde HTTP 500. Com a faixa, o deslocamento fica entre 0 e
   * FAIXA e a consulta passa. Faixa esgotada (página incompleta) salta para a próxima. */
  p.set('where', base === undefined
    ? '1=1'
    : 'OBJECTID>' + base + ' AND OBJECTID<=' + (base + FAIXA));
  p.set('orderByFields', 'OBJECTID ASC');
  if (caixa) {
    p.set('geometry', caixa.join(','));
    p.set('geometryType', 'esriGeometryEnvelope');
    p.set('inSR', '4326');
    p.set('spatialRel', 'esriSpatialRelIntersects');
  }
  p.set('outFields', '*');
  p.set('returnGeometry', 'true');
  p.set('outSR', '4326');
  p.set('f', 'geojson');
  p.set('resultOffset', String(offset || 0));
  p.set('resultRecordCount', String(PAGINA));
  return camada.servico.url + '/query?' + p.toString();
}

/** Quantas feições o serviço diz que tem (checagem do que foi baixado). */
async function contarNoServico(camada) {
  const S = require(path.join(raiz, 'js', 'servicos.js'));
  try {
    if (S.tipoDe(camada) === 'wfs') {
      const p = new URLSearchParams();
      p.set('service', 'WFS'); p.set('version', '2.0.0');
      p.set('request', 'GetFeature'); p.set('typeNames', camada.servico.camada);
      p.set('outputFormat', 'application/json'); p.set('resultType', 'hits');
      const r = await fetch(camada.servico.url + '?' + p.toString());
      const d = await r.json();
      return typeof d.totalFeatures === 'number' ? d.totalFeatures : null;
    }
    const r = await fetch(camada.servico.url + '/query?where=1%3D1&returnCountOnly=true&f=json');
    const d = await r.json();
    return typeof d.count === 'number' ? d.count : null;
  } catch (e) {
    return null;   // não é motivo para abortar: a contagem é conferência, não requisito
  }
}

const CAMPOS_TECNICOS = /^(objectid|oid|fid|shape|geom|geometry|the_geom|ogc_fid)$|^shape\.|^st_|_sh$|^shape_leng$/i;

function limparAtributos(props) {
  const saida = {};
  for (const k of Object.keys(props || {})) {
    if (CAMPOS_TECNICOS.test(k)) continue;
    let v = props[k];
    // data em milissegundos (ArcGIS) vira data legível, como o portal já faz ao vivo
    if (typeof v === 'number' && v > 1e11 && v < 4e12) v = new Date(v).toISOString().slice(0, 10);
    saida[k] = v;
  }
  return saida;
}

/** Arredonda para 6 casas e descarta a terceira coordenada (o serviço manda Z=0). */
function arrumarGeometria(g) {
  const anda = (c) => {
    if (typeof c[0] === 'number') return c.length > 2 ? [+c[0].toFixed(CASAS), +c[1].toFixed(CASAS)] : [+c[0].toFixed(CASAS), +c[1].toFixed(CASAS)];
    return c.map(anda);
  };
  if (!g || !g.coordinates) return g;
  return { type: g.type, coordinates: anda(g.coordinates) };
}

async function baixar(camada) {
  const feicoes = [];
  let offset = 0, zerado = 0, base = 0;
  const S = require(path.join(raiz, 'js', 'servicos.js'));   // declarado aqui: era usado antes
  // teto alto de proposito: o Inventário Florestal tem 386 páginas de 1000. O que impede
  // publicar dado pela metade é a conferência de contagem no fim, não este teto.
  for (let volta = 0; volta < 3000; volta++) {
    const url = urlDaPagina(camada, offset, S.tipoDe(camada) === 'wfs' ? undefined : base);
    const r = await fetch(url);
    if (!r.ok) {
      let recado = '';
      try {
        const texto = await r.text();
        const m = texto.match(/ExceptionText>([^<]+)</);
        recado = m ? ' — ' + m[1].replace(/\s+/g, ' ').slice(0, 200) : '';
      } catch (e) { /* sem corpo legível */ }
      throw new Error('HTTP ' + r.status + recado + '  [' + url.slice(0, 150) + ']');
    }
    const d = await r.json();
    if (d.error) throw new Error(d.error.message || 'erro no serviço');
    const vieram = d.features || [];
    for (const f of vieram) {
      if (!f.geometry) { zerado++; continue; }
      feicoes.push({ type: 'Feature', properties: limparAtributos(f.properties), geometry: arrumarGeometria(f.geometry) });
    }
    process.stdout.write('\r    baixadas ' + feicoes.length.toLocaleString('pt-BR') + ' feições…');
    // S já vem declarado no topo de baixar: redeclarar aqui sombreava o de fora e deixava a
    // linha que monta a URL na zona morta da declaração ('Cannot access S before initialization')
    const porFaixa = S.tipoDe(camada) !== 'wfs';
    if (porFaixa && vieram.length < 1000) {
      // a faixa acabou (página incompleta): salta para a próxima, sem offset profundo
      base += FAIXA;
      offset = 0;
      continue;
    }
    if (!S.temMais(S.tipoDe(camada), d, vieram.length)) break;
    offset += vieram.length;
  }
  process.stdout.write('\r' + ' '.repeat(60) + '\r');
  return { feicoes: feicoes, semGeometria: zerado };
}

/** Colunas e classes, como o importador faz nas camadas de arquivo. */
function colunasEClasses(feicoes, campo) {
  const nomes = [], vistas = new Set();
  for (const f of feicoes) {
    for (const k of Object.keys(f.properties)) {
      if (vistas.has(k)) continue;
      vistas.add(k); nomes.push(k);
    }
  }
  const campos = nomes.map((n) => {
    let tipo = 'C';
    for (const f of feicoes) {
      const v = f.properties[n];
      if (v === null || v === undefined || v === '') continue;
      tipo = typeof v === 'number' ? 'N' : 'C';
      break;
    }
    return { nome: n, tipo: tipo, rotulo: n };
  });
  let classes = null;
  if (campo) {
    const contagem = new Map();
    for (const f of feicoes) {
      let v = f.properties[campo];
      if (v === null || v === undefined || v === '') continue;
      v = String(v).trim();
      contagem.set(v, (contagem.get(v) || 0) + 1);
    }
    classes = Array.from(contagem.entries()).sort((a, b) => b[1] - a[1]).map(([classe, n]) => ({ classe: classe, feicoes: n }));
  }
  return { campos: campos, classes: classes };
}

async function principal() {
  const { ids, opcoes } = argumentos(process.argv);
  const catalogo = JSON.parse(fs.readFileSync(CATALOGO, 'utf8'));
  const alvos = catalogo.camadas.filter((c) => {
    if (!c.servico || !c.congelar) return false;
    return !ids.length || ids.indexOf(c.id) >= 0;
  });
  if (!alvos.length) {
    console.log('Nenhuma camada marcada com "congelar": true' + (ids.length ? ' com esses nomes.' : '.'));
    console.log('Camadas de serviço no catálogo:');
    for (const c of catalogo.camadas) {
      if (c.servico) console.log('  ' + c.id + (c.congelar ? '   (congelar)' : '   (fica ao vivo)'));
    }
    return;
  }

  const data = opcoes.data || hoje();
  console.log('Foto de ' + data + ' — ' + alvos.length + ' camada(s)');
  for (const camada of alvos) {
    console.log('\n  ' + camada.nome + '  (' + camada.id + ')');
    console.log('    serviço: ' + camada.servico.url + (camada.servico.camada ? '  camada ' + camada.servico.camada : ''));
    const { feicoes, semGeometria } = await baixar(camada);
    const noServico = await contarNoServico(camada);
    console.log('    baixadas ' + feicoes.length.toLocaleString('pt-BR') + ' feições'
      + (noServico !== null ? '   (o serviço diz ter ' + noServico.toLocaleString('pt-BR') + ')' : '')
      + (semGeometria ? '   ' + semGeometria + ' sem geometria foram descartadas' : ''));
    if (!feicoes.length) { console.log('    NADA baixado — camada não publicada.'); continue; }
    if (noServico !== null && feicoes.length + semGeometria !== noServico) {
      console.log('    ATENÇÃO: a contagem não fecha com o serviço. Publiquei o que veio, mas confira.');
    }
    if (opcoes.secar) { console.log('    (--secar: não gravou nada)'); continue; }

    /* DUAS DATAS, e elas não são a mesma coisa:
     *  - data do DADO: até quando a fonte atualizou aquilo (o serviço da CETESB tem DatAtualiza
     *    por feição; a data da camada é a mais recente delas);
     *  - data da COLETA: o dia em que esta foto foi tirada.
     * O relatório precisa da primeira; a auditoria precisa das duas. */
    let dataDoDado = '';
    for (const f of feicoes) {
      const v = f.properties.DatAtualiza || f.properties.DATA_ATUALIZACAO || f.properties.data_atualizacao;
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && v > dataDoDado) dataDoDado = v;
    }
    const fc = { type: 'FeatureCollection', features: feicoes };
    if (opcoes.baixarPara) {
      fs.writeFileSync(opcoes.baixarPara, JSON.stringify(fc), 'utf8');
      const mb = fs.statSync(opcoes.baixarPara).size / 1048576;
      console.log('    gravado (SEM publicar, só para gerar tiles): ' + opcoes.baixarPara
        + '  (' + mb.toFixed(1) + ' MB)');
      console.log('    próximo passo: gerar tiles a partir desse arquivo e apontar o catálogo para eles.');
      continue;
    }
    const arquivo = 'data/' + camada.id + '.geojson';
    const tamanhoMb = JSON.stringify(fc).length / 1048576;
    if (tamanhoMb > opcoes.limiteMb) {
      /* Trava de tamanho: publicar um GeoJSON desta ordem deixaria a camada inútil no navegador
       * (e o erro passaria silencioso, porque o arquivo existe e o catálogo aponta para ele). */
      console.log('    RECUSEI publicar: o GeoJSON daria ' + tamanhoMb.toFixed(1) + ' MB, acima do '
        + 'limite de ' + opcoes.limiteMb + ' MB.');
      console.log('    Camada deste tamanho precisa do caminho dos tiles (como a Pedologia e as UCs).');
      console.log('    Baixe com:  node tools/coletar_servico.js ' + camada.id
        + ' --baixar-para tools/_' + camada.id + '.geojson');
      continue;
    }
    fs.writeFileSync(path.join(raiz, arquivo), JSON.stringify(fc), 'utf8');
    const { campos, classes } = colunasEClasses(feicoes, camada.campo_classe);

    // vira camada de arquivo: sai o serviço, entra o dado com data
    const i = catalogo.camadas.findIndex((c) => c.id === camada.id);
    const nova = Object.assign({}, camada);
    delete nova.servico;
    delete nova.congelar;
    nova.arquivo = arquivo;
    nova.geometria = 'exata';
    nova.data_ref = dataDoDado || data;          // a data que vai para o relatório
    nova.data_coleta = data;                      // o dia em que esta foto foi tirada
    nova.fonte = (camada.fonte || '').replace(/\s*\(consulta ao vivo\)\s*/i, ' ')
      .replace(/\s*Camada consultada AO VIVO[^.]*\.\s*/i, ' ')
      .trim()
      + (camada.filtro_bbox ? ' SELEÇÃO: só as feições que cruzam a caixa '
        + camada.filtro_bbox.join(', ') + ' (extensão de São Paulo) — feições inteiras, nenhuma geometria alterada.' : '')
      + (dataDoDado
        ? ' — dados atualizados até ' + dataDoDado + '; foto (consulta única ao serviço) de ' + data + '.'
        : ' — foto (consulta única ao serviço) de ' + data + '; a fonte não declara data de atualização por feição.')
      + ' A geometria é a do serviço, sem simplificação: só arredondada em 6 casas (~11 cm), a '
      + 'precisão que o portal publica.';
    nova.classes = classes || [];
    nova.campos = campos;
    catalogo.camadas[i] = nova;

    console.log('    gravado ' + arquivo + '  (' + (fs.statSync(path.join(raiz, arquivo)).size / 1048576).toFixed(2) + ' MB)');
    console.log('    data do dado: ' + (dataDoDado || '(a fonte não declara)') + '   data da coleta: ' + data);
    console.log('    campos: ' + campos.length + '   classes: ' + (classes ? classes.length : 0)
      + (classes ? '  (' + classes.slice(0, 4).map((c) => c.classe).join(', ') + (classes.length > 4 ? '…' : '') + ')' : ''));
  }
  if (!opcoes.secar) {
    fs.writeFileSync(CATALOGO, JSON.stringify(catalogo, null, 2) + '\n', 'utf8');
    console.log('\nCatálogo atualizado: as camadas acima agora são dado do portal, com data.');
    console.log('Rode a verificação:  node tools/verificar.js 300');
  }
}

principal().catch((e) => { console.error('\nFALHOU: ' + e.message); process.exit(1); });
