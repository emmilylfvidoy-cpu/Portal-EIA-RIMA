'use strict';
/* Monta o grupo "Inventário Florestal por UGRHI" com as 22 filhas.
 *
 * - as CLASSES e os CAMPOS saem dos próprios tiles (os atributos viajam neles);
 * - os NOMES das UGRHIs vêm do catálogo do INDE, que descreve cada uma ("... Recursos Hídricos
 *   17 Médio Paranapanema"). Se um nome não vier, a filha fica só com o número — melhor do que
 *   inventar nome de unidade de gerenciamento.
 * Temporário. */
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const tiles = require(path.join(raiz, 'js', 'tiles.js'));
const camadas = require(path.join(raiz, 'tools', 'verificacoes', '_camadas.js'));

const CAMPO = 'FITOFISIO';
const NUMEROS = Array.from({ length: 22 }, (_, i) => i + 1);

// ---------------------------------------------------------------- 1) nomes, do catálogo do INDE
async function nomesDasUgrhis() {
  const url = 'https://metadados.inde.gov.br/geonetwork/srv/por/csw?service=CSW&version=2.0.2'
    + '&request=GetRecords&typeNames=csw:Record&elementSetName=summary&resultType=results'
    + '&maxRecords=60&constraintLanguage=CQL_TEXT&constraint_language_version=1.1.0'
    + '&constraint=AnyText+like+%27%25Invent%C3%A1rio+Florestal+2020%25%27'
    + '&outputSchema=http://www.opengis.net/cat/csw/2.0.2';
  const nomes = {};
  try {
    const r = await fetch(url);
    const texto = await r.text();
    // "... Unidade de Gerenciamento de Recursos Hídricos 17 Médio Paranapanema."
    const re = /Recursos H[íi]dricos\s+(\d{1,2})\s+([^.<\n]+)/g;
    let m;
    while ((m = re.exec(texto))) {
      const n = Number(m[1]);
      const nome = m[2].trim().replace(/\s+/g, ' ');
      if (n >= 1 && n <= 22 && nome && !nomes[n]) nomes[n] = nome;
    }
    console.log('  nomes vindos do INDE: ' + Object.keys(nomes).length + ' de 22');
  } catch (e) {
    console.log('  NÃO consegui os nomes no INDE (' + e.message + ') — as filhas ficam com o número');
  }
  return nomes;
}

// ---------------------------------------------------------------- 2) classes, dos tiles
function classesDosTiles(n) {
  const id = 'inventario-ugrhi-' + n;
  const pasta = path.join(raiz, 'data', id);
  if (!fs.existsSync(path.join(pasta, 'exato', 'indice.json'))) return null;
  const indice = JSON.parse(fs.readFileSync(path.join(pasta, 'exato', 'indice.json'), 'utf8'));
  const contagem = new Map();
  const vistas = new Set();
  let feicoes = 0, vertices = 0;
  for (const t of indice.tiles) {
    const fc = tiles.decodificar(camadas.lerTile(path.join(raiz, t.arquivo)));
    for (const f of fc.features) {
      feicoes++;
      for (const k of Object.keys(f.properties || {})) vistas.add(k);
      let v = f.properties[CAMPO];
      if (v === null || v === undefined || v === '') continue;
      v = String(v).trim();
      contagem.set(v, (contagem.get(v) || 0) + 1);
      const anda = (c) => { if (typeof c[0] === 'number') { vertices++; return; } for (const p of c) anda(p); };
      if (f.geometry && f.geometry.coordinates) anda(f.geometry.coordinates);
    }
  }
  return {
    feicoes: feicoes,
    vertices: vertices,
    campos: Array.from(vistas).map((k) => ({ nome: k, tipo: 'C', rotulo: k })),
    classes: Array.from(contagem.entries()).sort((a, b) => b[1] - a[1])
      .map(([classe, n2]) => ({ classe: classe, feicoes: n2 })),
    bytes: indice.total.bytes,
  };
}

// ---------------------------------------------------------------- 3) monta
(async () => {
  const nomes = await nomesDasUgrhis();
  const filhos = [];
  let totalFeicoes = 0, totalBytes = 0;

  for (const n of NUMEROS) {
    const info = classesDosTiles(n);
    if (!info) { console.log('  UGRHI ' + n + ': SEM TILES — fora do catálogo'); continue; }
    totalFeicoes += info.feicoes;
    totalBytes += info.bytes;
    const nome = nomes[n] ? 'UGRHI ' + n + ' — ' + nomes[n] : 'UGRHI ' + n;
    filhos.push({
      id: 'inventario-ugrhi-' + n,
      nome: nome,
      meio: 'biotico',
      campo_classe: CAMPO,
      data_ref: '2021-11-25',
      data_coleta: new Date().toISOString().slice(0, 10),
      fonte: 'IPA (Instituto de Pesquisas Ambientais) — Inventário Florestal 2020, publicado por '
        + 'UGRHI no DataGEO. Imagens WorldView/GeoEye/QuickBird de 2017 a 2019, legenda '
        + 'fitofisionômica IBGE 2012, área mínima mapeada de 0,1 ha, Kappa 0,81.',
      cor: '#4e7a3a',
      opacidade: 1,
      estilo: {
        cor: '#4e7a3a', opacidade: 1, cores: {}, cores_origem: 'paleta do portal',
        contorno_cor: '#5d5d5d', contornos: null,
      },
      obs: 'GEOMETRIA EXATA: shapefile do DataGEO convertido sem simplificar nada, arredondado em '
        + '6 casas (~11 cm). O campo AREA do próprio arquivo permite conferir a área calculada '
        + 'pelo portal. As cores do IPA não vêm no shapefile — a paleta é a do portal.',
      tiles: 'data/inventario-ugrhi-' + n + '/exato/indice.json',
      niveis: [{ nivel: 'visao', indice: 'data/inventario-ugrhi-' + n + '/visao/indice.json', zoom_max: 9 }],
      geometria: 'exata',
      classes: info.classes,
      campos: info.campos,
      _resumo: info.feicoes + ' feições, ' + info.classes.length + ' classes',
    });
  }

  const pai = {
    id: 'inventario-florestal',
    nome: 'Inventário Florestal por UGRHI',
    grupo: true,
    meio: 'biotico',
    fonte: 'IPA (Instituto de Pesquisas Ambientais) — Inventário Florestal 2020 do Estado de São Paulo',
    obs: 'Uma camada por UGRHI, como o IPA publica. Clique na seta para abrir a lista e escolher a '
      + 'sua unidade. Área mínima mapeada de 0,1 hectare: é um mapeamento de altíssimo detalhe, '
      + 'então cada UGRHI traz milhares de fragmentos. Total: ' + totalFeicoes.toLocaleString('pt-BR')
      + ' feições, ' + (totalBytes / 1048576).toFixed(0) + ' MB de tiles.',
    filhos: filhos,
  };
  for (const f of filhos) delete f._resumo;

  const pc = path.join(raiz, 'data', 'catalogo.json');
  const cat = JSON.parse(fs.readFileSync(pc, 'utf8'));
  const i = cat.camadas.findIndex((x) => x.id === 'inventario-florestal');
  if (i >= 0) cat.camadas[i] = pai; else cat.camadas.push(pai);
  fs.writeFileSync(pc, JSON.stringify(cat, null, 2) + '\n', 'utf8');

  console.log('  catálogo: grupo com ' + filhos.length + ' filhas');
  console.log('  total: ' + totalFeicoes.toLocaleString('pt-BR') + ' feições, '
    + (totalBytes / 1048576).toFixed(0) + ' MB de tiles (crus)');
  console.log('  nomes por unidade:');
  for (const f of filhos) console.log('    ' + f.nome);
})();
