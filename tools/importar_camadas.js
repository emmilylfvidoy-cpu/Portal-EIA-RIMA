'use strict';
/* ============================================================================
 * importar_camadas.js — leva a SUA base de shapefiles para dentro do portal
 *
 * O portal serve a base do arquivo `data/catalogo.json` + os `data/*.geojson`. Para
 * uma camada ficar fixa (todo visitante vê, sem precisar subir nada), ela tem de
 * existir como arquivo em `data/` e estar declarada no catálogo. Este importador faz
 * essa conversão — e é a única ferramenta que escreve no catálogo.
 *
 * O que ele resolve que é chato de fazer na mão:
 *   - junta .shp/.dbf/.prj/.cpg da pasta e lê a codificação do .cpg;
 *   - lê o .prj e reprojeta para WGS 84 (UTM 23S -> graus), que é o que o portal usa;
 *   - SIMPLIFICA a geometria pesada: um SHP de 100 MB vira GeoJSON de centenas de MB
 *     e trava qualquer navegador. A tolerância pode vir da escala de visualização
 *     pretendida (0,2 mm no papel), que é um critério técnico, não um chute;
 *   - arredonda coordenada para 6 casas (~11 cm) e remove vértice repetido;
 *   - descobre qual campo serve de classe (o de menos valores distintos, com nome
 *     que combina com classe/uso/tipo/unidade);
 *   - cria a cor de cada classe, para o mapa não ficar de uma cor só;
 *   - escreve o GeoJSON EM FLUXO (não monta o arquivo inteiro na memória) e atualiza
 *     o `data/catalogo.json` preservando as camadas que já estavam lá.
 *
 * Uso:
 *   node tools/importar_camadas.js --rascunho "C:\minha\base"
 *   node tools/importar_camadas.js --inspecionar "C:\minha\base\geologia.shp"
 *   node tools/importar_camadas.js                       (usa data/camadas-fonte.json)
 *   node tools/importar_camadas.js --manifest outro.json --escala 50000
 *   node tools/importar_camadas.js --sem-simplificar --forcar
 *
 * Formatos: .shp (com .dbf/.prj/.cpg na mesma pasta), .zip de shapefile e .geojson.
 * Não abre File Geodatabase (.gdb): exporte para shapefile antes.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const EIA = {
  math: require(path.join(raiz, 'js', 'math.js')),
  vetorial: require(path.join(raiz, 'js', 'vetorial.js')),
  shapelib: require(path.join(raiz, 'js', 'shapelib.js')),
  crs: require(path.join(raiz, 'js', 'crs.js')),
  svg: require(path.join(raiz, 'js', 'svg.js')),
};

const MM_NO_PAPEL = 0.2;   // abaixo disso o olho não distingue no impresso
const CASAS_PADRAO = 6;    // ~11 cm: suficiente até 1:1.000

// ============================================================ utilidades de arquivo
function slug(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'camada';
}

function tituloDe(texto) {
  return String(texto || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function tamanhoLegivel(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

/** Sobe a árvore procurando arquivos com uma extensão (case-insensitive). */
function listarComExtensao(pasta, extensao) {
  const achados = [];
  const pilha = [pasta];
  let guarda = 0;
  while (pilha.length && guarda++ < 20000) {
    const atual = pilha.pop();
    let itens;
    try { itens = fs.readdirSync(atual, { withFileTypes: true }); } catch (e) { continue; }
    for (const item of itens) {
      const p = path.join(atual, item.name);
      if (item.isDirectory()) {
        if (/^\.|node_modules|\.git$/.test(item.name)) continue;
        pilha.push(p);
      } else if (item.name.toLowerCase().endsWith(extensao)) {
        achados.push(p);
      }
    }
  }
  return achados.sort();
}

/** Acha o arquivo irmão (.dbf/.prj/.cpg) tolerando maiúscula/minúscula. */
function irmao(caminhoShp, extensao) {
  const base = caminhoShp.replace(/\.shp$/i, '');
  for (const ext of [extensao, extensao.toUpperCase(), extensao[0].toUpperCase() + extensao.slice(1)]) {
    const p = base + '.' + ext;
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ============================================================ leitura
/**
 * Lê um shapefile (e os irmãos) da pasta.
 * @returns {{geojson:object, prj:string|null, codificacao:string|null, tipo:string, aviso:string|null, origem:string}}
 */
function lerShapefile(caminhoShp) {
  const arquivos = [{ nome: path.basename(caminhoShp), bytes: new Uint8Array(fs.readFileSync(caminhoShp)) }];
  for (const ext of ['dbf', 'prj', 'cpg']) {
    const p = irmao(caminhoShp, ext);
    if (p) arquivos.push({ nome: path.basename(p), bytes: new Uint8Array(fs.readFileSync(p)) });
  }
  const semDbf = !arquivos.some((a) => /\.dbf$/i.test(a.nome));
  const lido = EIA.shapelib.abrirShapefile(arquivos);
  if (semDbf) {
    lido.aviso = [lido.aviso, 'Não achei o .dbf ao lado do .shp: a camada entra sem atributos e sem classe.']
      .filter(Boolean).join(' ');
  }
  // `abrirShapefile` devolve os campos DENTRO do GeoJSON (`geojson.campos`). Sem esta
  // linha, `lido.campos` fica undefined e a sugestão de campo de classe não enxerga o
  // tipo dos campos — foi o defeito que o teste pegou.
  lido.campos = (lido.geojson && lido.geojson.campos) || [];
  lido.origem = caminhoShp;
  return lido;
}

/**
 * Infere os campos a partir das propriedades quando não veio .dbf (GeoJSON de entrada).
 * O tipo sai do primeiro valor não vazio; é o suficiente para a inspeção e para
 * escolher o campo de classe.
 */
function camposInferidos(geojson) {
  const tipos = new Map();
  for (const f of geojson.features.slice(0, 200)) {
    for (const k of Object.keys(f.properties || {})) {
      if (tipos.get(k)) continue;
      const v = f.properties[k];
      if (v === null || v === undefined || v === '') continue;
      tipos.set(k, typeof v === 'number' ? 'N' : (typeof v === 'boolean' ? 'L' : 'C'));
    }
  }
  return Object.keys(geojson.features[0] ? geojson.features[0].properties || {} : {})
    .map((nome) => ({ nome: nome, tipo: tipos.get(nome) || 'C', tamanho: 0, rotulo: nome }));
}

/** Lê .shp, .zip (com shapefiles) ou .geojson e devolve uma lista de camadas cruas. */
function lerEntrada(origem) {
  const ext = path.extname(origem).toLowerCase();

  if (ext === '.gdb') {
    throw new Error('File Geodatabase (.gdb) não é suportado. Abra no QGIS e exporte para shapefile '
      + '(clique com o botão direito na camada → Exportar → Salvar feições como → ESRI Shapefile).');
  }
  if (ext === '.gpkg') {
    throw new Error('GeoPackage (.gpkg) não é suportado. No QGIS: botão direito na camada → Exportar → Salvar feições como → ESRI Shapefile.');
  }
  if (ext === '.kml' || ext === '.kmz') {
    throw new Error('KML/KMZ não é lido por este importador. Converta para shapefile no QGIS '
      + '(ou use o botão de upload do portal, que lê KMZ no navegador).');
  }

  if (ext === '.shp') return [lerShapefile(origem)];

  if (ext === '.geojson' || ext === '.json') {
    const geojson = JSON.parse(fs.readFileSync(origem, 'utf8'));
    const features = geojson.type === 'FeatureCollection' ? geojson.features : [geojson];
    return [{ geojson: { type: 'FeatureCollection', features: features }, prj: null, codificacao: 'utf-8',
      tipo: 'geojson', aviso: null, origem: origem }];
  }

  if (ext === '.zip') {
    throw new Error('ZIP de shapefile: descompacte a pasta e aponte o importador para o .shp '
      + '(ou para a pasta, com --rascunho).');
  }

  throw new Error('Extensão não reconhecida: ' + ext + '. Aceito: .shp, .geojson.');
}

// ============================================================ geometria
function contarVertices(geometria) {
  let n = 0;
  EIA.math.percorrerCoords(geometria, () => { n++; });
  return n;
}

/** Aplica uma função a cada anel/linha da geometria (pontos passam intactos). */
function mapearLinhas(geometria, fn) {
  const t = geometria.type;
  if (t === 'LineString') return { type: t, coordinates: fn(geometria.coordinates) };
  if (t === 'MultiLineString' || t === 'Polygon') {
    return { type: t, coordinates: geometria.coordinates.map(fn) };
  }
  if (t === 'MultiPolygon') {
    return { type: t, coordinates: geometria.coordinates.map((parte) => parte.map(fn)) };
  }
  return geometria;
}

function arredondarPonto(p, f) {
  return [Math.round(p[0] * f) / f, Math.round(p[1] * f) / f];
}

function mesmoPonto(a, b, tol) {
  return Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol;
}

/**
 * Limpa e (opcionalmente) simplifica a geometria.
 *
 * Anel é simplificado ABERTO (tira o ponto de fechamento antes, devolve depois):
 * Douglas–Peucker com o primeiro e o último ponto iguais tende a preservar os dois
 * e achatar o meio. E, se a simplificação deixar o anel com menos de 4 pontos, ele
 * volta ao original — geometria inválida é pior que arquivo grande.
 */
function prepararGeometria(geometria, opcoes) {
  const o = opcoes || {};
  const fator = Math.pow(10, o.casas === undefined ? CASAS_PADRAO : o.casas);
  const tolerancia = o.tolerancia || 0;
  const escalaX = o.escalaX || 1;
  let antes = 0;
  let depois = 0;

  const processar = (pontos, fechado) => {
    antes += pontos.length;
    let lista = pontos;
    if (fechado && lista.length > 2 && mesmoPonto(lista[0], lista[lista.length - 1], 1e-12)) {
      lista = lista.slice(0, -1);
    }
    // arredonda e tira repetido
    let limpos = [];
    for (const p of lista) {
      const q = arredondarPonto(p, fator);
      const ultimo = limpos[limpos.length - 1];
      if (ultimo && mesmoPonto(ultimo, q, 1 / fator / 2)) continue;
      limpos.push(q);
    }
    if (fechado && limpos.length > 1 && mesmoPonto(limpos[0], limpos[limpos.length - 1], 1e-12)) limpos.pop();

    let resultado = limpos;
    if (tolerancia > 0 && limpos.length > 2) {
      const simplificado = EIA.vetorial.simplificar(limpos, tolerancia, escalaX);
      const minimo = fechado ? 3 : 2;
      if (simplificado.length >= minimo) resultado = simplificado;
    }
    if (fechado) {
      if (resultado.length < 3) { resultado = limpos; }
      resultado = resultado.concat([resultado[0].slice()]);
    }
    depois += resultado.length;
    return resultado;
  };

  const limpa = (g) => {
    const t = g.type;
    if (t === 'LineString') return { type: t, coordinates: processar(g.coordinates, false) };
    if (t === 'MultiLineString') return { type: t, coordinates: g.coordinates.map((l) => processar(l, false)) };
    if (t === 'Polygon') return { type: t, coordinates: g.coordinates.map((a) => processar(a, true)) };
    if (t === 'MultiPolygon') {
      return { type: t, coordinates: g.coordinates.map((p) => p.map((a) => processar(a, true))) };
    }
    if (t === 'Point') { antes++; depois++; return { type: t, coordinates: arredondarPonto(g.coordinates, fator) }; }
    return g;
  };

  const saida = limpa(geometria);
  return { geometria: saida, verticesAntes: antes, verticesDepois: depois };
}

/** Tolerância (em graus) para a escala de visualização pretendida. */
function toleranciaParaEscala(escala) {
  const metros = MM_NO_PAPEL * escala / 1000;   // 1:50.000 -> 10 m
  return metros / 110574;                        // graus de latitude
}

// ============================================================ classes e cor
const PALAVRAS_CLASSE = /classe|class|uso|tipo|tipolog|unidade|solo|geomorf|veget|zona|litolog|forma|fitofis|estagio|estágio|grupo|nome|descri|categoria|fase|dominio|domínio/i;

/**
 * Descobre qual campo do .dbf serve de classe: o que tem entre 2 e 40 valores
 * distintos e cujo nome combina com classe/uso/tipo/unidade. Menos valores = melhor
 * (classe serve para agrupar e colorir, não para identificar feição).
 */
function adivinharCampoClasse(campos, registros) {
  let melhor = null;
  let melhorNota = -Infinity;
  for (const c of campos) {
    if (c.tipo !== 'C' && c.tipo !== 'N') continue;
    const valores = new Set();
    for (let i = 0; i < registros.length && i < 400; i++) {
      const r = registros[i];
      if (!r) continue;
      const v = r[c.nome];
      if (v !== null && v !== undefined && v !== '') valores.add(String(v));
      if (valores.size > 40) break;
    }
    const n = valores.size;
    if (n < 2 || n > 40) continue;
    let nota = 100 - n;
    if (PALAVRAS_CLASSE.test(c.nome)) nota += 60;
    if (c.tipo === 'C') nota += 10;
    if (n > 20) nota -= 30;
    if (nota > melhorNota) { melhorNota = nota; melhor = c.nome; }
  }
  return melhor;
}

const PALAVRAS_MEIO = {
  fisico: /geo|solo|decliv|hidro|relevo|geomorf|clima|pedolog|litolog|bacia|drenag|eros|mde|altimetr|curva/i,
  biotico: /veget|flora|fauna|uso|cobert|fitofis|mata|cerrado|conserv|biodivers|app|silvicultur|pastag|agricultur/i,
  socioeconomico: /popul|socio|renda|censo|setor|bairro|infra|equipam|econom|demograf|indigena|indígena|quilombol|urbano|patrim/i,
};

function adivinharMeio(nome) {
  for (const meio of ['fisico', 'biotico', 'socioeconomico']) {
    if (PALAVRAS_MEIO[meio].test(nome)) return meio;
  }
  return '';
}

/** Conta as classes e sorteia uma cor para cada. */
function classesECores(geojson, campo) {
  const contagem = new Map();
  for (const f of geojson.features) {
    const bruto = campo && f.properties ? f.properties[campo] : undefined;
    const chave = (bruto === undefined || bruto === null || bruto === '') ? 'Sem classe' : String(bruto);
    contagem.set(chave, (contagem.get(chave) || 0) + 1);
  }
  const ordenado = Array.from(contagem.entries()).sort((a, b) => b[1] - a[1]);
  const cores = {};
  ordenado.forEach(([chave], i) => { cores[chave] = EIA.svg.cor(i); });
  return { cores: cores, classes: ordenado.map(([classe, n]) => ({ classe: classe, feicoes: n })) };
}

// ============================================================ inspeção
function inspecionar(origem) {
  const relatorio = { origem: origem, camadas: [] };
  const entradas = path.extname(origem).toLowerCase() === '.shp' ? [lerShapefile(origem)]
    : (fs.statSync(origem).isDirectory() ? listarComExtensao(origem, '.shp').map(lerShapefile) : lerEntrada(origem));

  for (const entrada of entradas) {
    const geojson = entrada.geojson;
    const bbox = EIA.math.bbox(geojson);
    const prjEpsg = entrada.prj ? EIA.crs.epsgDoPrj(entrada.prj) : null;
    const diag = EIA.crs.diagnosticar(geojson, prjEpsg, { declarado: !!entrada.prj });
    let vertices = 0;
    const tipos = {};
    const nulos = {};
    for (const f of geojson.features) {
      vertices += contarVertices(f.geometry);
      if (f.geometry) tipos[f.geometry.type] = (tipos[f.geometry.type] || 0) + 1;
      for (const k of Object.keys(f.properties || {})) {
        if (f.properties[k] === null || f.properties[k] === '') nulos[k] = (nulos[k] || 0) + 1;
      }
    }
    const campos = (entrada.campos && entrada.campos.length)
      ? entrada.campos
      : camposInferidos(geojson);

    const distintos = {};
    for (const c of campos.slice(0, 40)) {
      const s = new Set();
      for (let i = 0; i < geojson.features.length && i < 400 && s.size <= 40; i++) {
        const v = geojson.features[i].properties[c.nome];
        if (v !== null && v !== undefined && v !== '') s.add(String(v));
      }
      distintos[c.nome] = s.size > 40 ? '>40' : s.size;
    }

    const registros = geojson.features.map((f) => f.properties);
    relatorio.camadas.push({
      origem: entrada.origem,
      tipo: entrada.tipo,
      feicoes: geojson.features.length,
      vertices: vertices,
      geometrias: tipos,
      bbox: bbox,
      crs: prjEpsg || diag.epsg,
      crs_aviso: diag.aviso,
      codificacao: entrada.codificacao,
      campos: campos.map((c) => ({ nome: c.nome, tipo: c.tipo, tamanho: c.tamanho, distintos: distintos[c.nome], vazios: nulos[c.nome] || 0 })),
      campo_classe_sugerido: adivinharCampoClasse(campos, registros),
      meio_sugerido: adivinharMeio(path.basename(origem)),
      aviso: entrada.aviso || null,
    });
  }
  return relatorio;
}

// ============================================================ rascunho do manifesto
function gerarRascunho(origem, opcoes) {
  const o = opcoes || {};
  const pasta = fs.statSync(origem).isDirectory() ? origem : path.dirname(origem);
  const shps = fs.statSync(origem).isDirectory() ? listarComExtensao(origem, '.shp') : [origem];
  const camadas = [];

  for (const shp of shps) {
    const nome = tituloDe(path.basename(shp, '.shp'));
    let campo = null;
    let meio = adivinharMeio(nome);
    let feicoes = null;
    try {
      // só o .dbf, que é pequeno: o .shp pode ter centenas de MB
      const p = irmao(shp, 'dbf');
      if (p) {
        const dbf = EIA.shapelib.lerDbf(new Uint8Array(fs.readFileSync(p)).buffer);
        campo = adivinharCampoClasse(dbf.campos, dbf.registros);
        feicoes = dbf.registros.filter(Boolean).length;
      }
    } catch (e) { /* segue sem sugestão */ }

    camadas.push({
      origem: path.resolve(shp),
      id: slug(nome),
      arquivo: 'data/' + slug(nome) + '.geojson',
      nome: nome,
      meio: meio,
      campo_classe: campo || '',
      fonte: '',
      data_ref: '',
      cor: meio ? ({ fisico: '#8a6d3b', biotico: '#2f6b3a', socioeconomico: '#2f5b8a' })[meio] : '#7d8b93',
      opacidade: 0.3,
      epsg_origem: 'auto',
      obs: '',
      _pistas: { feicoes: feicoes, meio_adivinhado: !!meio, campo_adivinhado: !!campo },
    });
  }

  const manifesto = {
    _instrucoes: [
      'Preencha "meio" em todas as camadas: fisico, biotico ou socioeconomico. Sem isso o importador não roda.',
      '"campo_classe" é o campo que agrupa as feições (uso do solo, unidade geológica...).',
      '"fonte" e "data_ref" aparecem na tela e no relatório — preencha com a fonte real.',
      '"epsg_origem" aceita "auto" (lê o .prj) ou o código, tipo "EPSG:31983".',
      '"simplificar_graus" é opcional: sem ele a tolerância vem da escala (--escala).',
      'Rode: node tools/importar_camadas.js',
    ],
    destino: 'data',
    camadas: camadas.map((c) => { delete c._pistas; return c; }),
  };
  void o;
  return manifesto;
}

// ============================================================ escrita em fluxo
function escreverGeoJson(caminho, features, metadados) {
  const fd = fs.openSync(caminho, 'w');
  try {
    fs.writeSync(fd, '{"type":"FeatureCollection","metadados":' + JSON.stringify(metadados || {}) + ',"features":[');
    let primeiro = true;
    let buffer = [];
    for (const f of features) {
      buffer.push((primeiro ? '' : ',') + JSON.stringify(f));
      primeiro = false;
      if (buffer.length >= 400) { fs.writeSync(fd, buffer.join('')); buffer = []; }
    }
    if (buffer.length) fs.writeSync(fd, buffer.join(''));
    fs.writeSync(fd, ']}');
  } finally {
    fs.closeSync(fd);
  }
}

// ============================================================ importação
function importarCamada(entrada, opcoes) {
  const o = opcoes || {};
  const bruto = lerEntrada(entrada.origem)[0];
  const geojsonBruto = bruto.geojson;

  // 1) sistema de referência -> WGS 84
  let epsg = EIA.crs.normalizarEpsg(entrada.epsg_origem || 'auto');
  if (epsg === 'EPSG:AUTO' || epsg === 'AUTO' || !epsg) {
    epsg = bruto.prj ? EIA.crs.epsgDoPrj(bruto.prj) : null;
  }
  let geojson = geojsonBruto;
  let avisoCrs = '';
  if (epsg && epsg !== 'EPSG:4326') {
    const d = EIA.crs.definicao(epsg);
    if (!d) throw new Error('Não conheço o EPSG ' + epsg + '. Informe um código que o portal entenda (ex.: EPSG:31983).');
    geojson = EIA.crs.transformarGeoJson(geojsonBruto, epsg, 'EPSG:4326');
    avisoCrs = 'Reprojetado de ' + (d.nome || epsg) + ' para WGS 84.';
  } else {
    // O EPSG veio do .prj ou do manifesto: passa adiante para o aviso não dizer
    // "assumi WGS 84" quando na verdade o sistema estava declarado no arquivo.
    const diag = EIA.crs.diagnosticar(geojsonBruto, epsg, { declarado: !!epsg });
    if (!diag.epsg) {
      throw new Error('As coordenadas não estão em graus e não veio .prj. '
        + 'Informe "epsg_origem" no manifesto (ex.: "EPSG:31983") para ' + path.basename(entrada.origem) + '.');
    }
    avisoCrs = diag.aviso;
  }

  // 2) tolerância: explícita no manifesto, senão derivada da escala
  let tolerancia = 0;
  if (entrada.simplificar_graus !== undefined && entrada.simplificar_graus !== null && Number(entrada.simplificar_graus) > 0) {
    tolerancia = Number(entrada.simplificar_graus);
  } else if (!o.semSimplificar) {
    tolerancia = toleranciaParaEscala(o.escala || 50000);
  }

  // 3) limpeza e simplificação (a longitude encolhe com o cosseno da latitude)
  const bbox = EIA.math.bbox(geojson);
  const latMedia = bbox ? (bbox[1] + bbox[3]) / 2 : -15;
  const escalaX = Math.cos(latMedia * Math.PI / 180);

  let verticesAntes = 0, verticesDepois = 0, descartadas = 0;
  const features = [];
  for (const f of geojson.features) {
    if (!f || !f.geometry) { descartadas++; continue; }
    const prep = prepararGeometria(f.geometry, { casas: o.casas, tolerancia: tolerancia, escalaX: escalaX });
    verticesAntes += prep.verticesAntes;
    verticesDepois += prep.verticesDepois;
    if (prep.verticesDepois < 1) { descartadas++; continue; }
    features.push({ type: 'Feature', properties: f.properties || {}, geometry: prep.geometria });
  }
  if (!features.length) throw new Error('Nenhuma feição válida em ' + entrada.origem);

  // 4) ordem dos campos: a coluna de classe primeiro, que é a que a tabela mostra
  const camposOriginais = (bruto.campos && bruto.campos.length)
    ? bruto.campos.map((c) => ({ nome: c.nome, tipo: c.tipo, rotulo: c.nome }))
    : camposInferidos({ type: 'FeatureCollection', features: features });
  const campoClasse = entrada.campo_classe || null;
  const campos = (campoClasse && camposOriginais.some((c) => c.nome === campoClasse))
    ? [camposOriginais.find((c) => c.nome === campoClasse)].concat(camposOriginais.filter((c) => c.nome !== campoClasse))
    : camposOriginais;

  // 5) classes e cores
  const cc = classesECores({ type: 'FeatureCollection', features: features }, campoClasse);

  const destino = path.resolve(raiz, entrada.arquivo || ('data/' + (entrada.id || slug(entrada.nome)) + '.geojson'));
  const metadados = {
    gerado_por: 'tools/importar_camadas.js',
    gerado_em: new Date().toISOString(),
    camada: entrada.nome,
    meio: entrada.meio || '',
    fonte: entrada.fonte || '',
    data_ref: entrada.data_ref || '',
    origem_arquivo: path.basename(entrada.origem),
    crs_origem: epsg || 'EPSG:4326',
    simplificacao_graus: tolerancia,
    escala_alvo: o.escala || 50000,
    vertices_antes: verticesAntes,
    vertices_depois: verticesDepois,
    real: true,
  };

  fs.mkdirSync(path.dirname(destino), { recursive: true });
  escreverGeoJson(destino, features, metadados);

  return {
    id: entrada.id || slug(entrada.nome),
    arquivo: path.relative(raiz, destino).replace(/\\/g, '/'),
    nome: entrada.nome,
    meio: entrada.meio,
    tipo: tipoDeGeometria(features),
    campo_classe: campoClasse,
    campos: campos,
    classes: cc.classes,
    cor_por_classe: cc.cores,
    feicoes: features.length,
    descartadas: descartadas,
    vertices_antes: verticesAntes,
    vertices_depois: verticesDepois,
    tolerancia: tolerancia,
    escala: o.escala || 50000,
    bytes_origem: fs.existsSync(entrada.origem) ? fs.statSync(entrada.origem).size : 0,
    bytes_saida: fs.statSync(destino).size,
    fonte: entrada.fonte || '',
    data_ref: entrada.data_ref || '',
    observacao: entrada.obs || '',
    crs_origem: epsg || 'EPSG:4326',
    aviso_crs: avisoCrs,
    aviso: bruto.aviso || '',
  };
}

function tipoDeGeometria(features) {
  const tipos = {};
  for (const f of features) tipos[f.geometry.type] = (tipos[f.geometry.type] || 0) + 1;
  const chaves = Object.keys(tipos);
  if (chaves.some((t) => /Polygon/.test(t))) return 'poligono';
  if (chaves.some((t) => /LineString/.test(t))) return 'linha';
  if (chaves.some((t) => /Point/.test(t))) return 'ponto';
  return 'misto';
}

// ============================================================ catálogo
const MEIOS_PADRAO = [
  { id: 'fisico', nome: 'Meio Físico', cor: '#8a6d3b' },
  { id: 'biotico', nome: 'Meio Biótico', cor: '#2f6b3a' },
  { id: 'socioeconomico', nome: 'Meio Socioeconômico', cor: '#2f5b8a' },
];

/**
 * Atualiza `data/catalogo.json` preservando o que já estava lá.
 * O catálogo é a única fonte da lista de camadas da tela — por isso o importador é o
 * único que escreve nele, e por isso ele preserva as entradas que não são dele.
 */
function atualizarCatalogo(caminho, resultados, opcoes) {
  const o = opcoes || {};
  let cat;
  if (fs.existsSync(caminho)) {
    cat = JSON.parse(fs.readFileSync(caminho, 'utf8'));
  } else {
    cat = { versao: 1, meios: MEIOS_PADRAO.slice(), camadas: [] };
  }
  cat.meios = cat.meios && cat.meios.length ? cat.meios : MEIOS_PADRAO.slice();
  cat.camadas = cat.camadas || [];

  const porId = new Map();
  cat.camadas.forEach((c) => porId.set(c.id, c));

  const mudancas = { adicionadas: [], atualizadas: [], preservadas: 0, removidas: [] };
  for (const r of resultados) {
    const existente = porId.get(r.id);
    const entrada = {
      id: r.id,
      nome: r.nome,
      meio: r.meio,
      tipo: r.tipo,
      arquivo: r.arquivo,
      campo_classe: r.campo_classe || undefined,
      campos: r.campos,
      classes: r.classes,
      estilo: {
        cor: (r.cor_por_classe && r.classes.length === 1) ? Object.values(r.cor_por_classe)[0] : corDoMeio(r.meio),
        opacidade: 0.32,
        cores: r.cor_por_classe,
      },
      fonte: r.fonte,
      data_ref: r.data_ref,
      origem: 'importado',
      feicoes: r.feicoes,
      obs: r.observacao || '',
    };
    if (existente) { mudancas.atualizadas.push(r); Object.assign(existente, entrada); }
    else { mudancas.adicionadas.push(r); cat.camadas.push(entrada); }
  }
  mudancas.preservadas = cat.camadas.length - resultados.length + (resultados.length - mudancas.adicionadas.length) - mudancas.atualizadas.length;
  mudancas.preservadas = cat.camadas.filter((c) => c.origem !== 'importado').length;

  // ordena por meio (na ordem canônica) mantendo a ordem de importação dentro do meio
  const ordem = cat.meios.map((m) => m.id);
  cat.camadas.sort((a, b) => {
    const ia = ordem.indexOf(a.meio), ib = ordem.indexOf(b.meio);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  cat.gerado_em = new Date().toISOString();

  if (!o.simular) fs.writeFileSync(caminho, JSON.stringify(cat, null, 2));
  return { catalogo: cat, mudancas: mudancas };
}

function corDoMeio(meio) {
  const m = MEIOS_PADRAO.find((x) => x.id === meio);
  return m ? m.cor : '#7d8b93';
}

// ============================================================ relatório no terminal
function imprimirInspecao(rel) {
  for (const c of rel.camadas) {
    console.log('\n' + path.basename(c.origem) + '  (' + c.tipo + ')');
    console.log('  feições: ' + c.feicoes.toLocaleString('pt-BR') + '   vértices: ' + c.vertices.toLocaleString('pt-BR'));
    console.log('  geometrias: ' + Object.entries(c.geometrias).map(([t, n]) => t + ' (' + n + ')').join(', '));
    console.log('  CRS: ' + (c.crs || 'não identificado') + (c.codificacao ? '   codificação: ' + c.codificacao : ''));
    if (c.crs_aviso) console.log('  aviso: ' + c.crs_aviso);
    if (c.bbox) console.log('  extensão: ' + c.bbox.map((v) => v.toFixed(5)).join(', '));
    console.log('  campo de classe sugerido: ' + (c.campo_classe_sugerido || '(nenhum — a camada fica sem classe)'));
    console.log('  meio sugerido: ' + (c.meio_sugerido || '(preencha no manifesto)'));
    if (c.campos.length) {
      console.log('  campos:');
      for (const f of c.campos.slice(0, 25)) {
        console.log('    ' + f.nome.padEnd(18) + String(f.tipo).padEnd(4)
          + ('distintos: ' + f.distintos).padEnd(18) + (f.vazios ? 'vazios: ' + f.vazios : ''));
      }
    }
  }
}

function imprimirImportacao(resultados, mudancas, catalogoPath) {
  console.log('\n' + 'camada'.padEnd(28) + 'meio'.padEnd(17) + 'feições'.padStart(9)
    + 'vértices (antes→depois)'.padStart(26) + 'SHP'.padStart(10) + 'GeoJSON'.padStart(11));
  console.log('-'.repeat(101));
  for (const r of resultados) {
    console.log(
      r.nome.slice(0, 27).padEnd(28)
      + String(r.meio).padEnd(17)
      + r.feicoes.toLocaleString('pt-BR').padStart(9)
      + (r.vertices_antes.toLocaleString('pt-BR') + ' → ' + r.vertices_depois.toLocaleString('pt-BR')).padStart(26)
      + tamanhoLegivel(r.bytes_origem).padStart(10)
      + tamanhoLegivel(r.bytes_saida).padStart(11)
    );
  }
  console.log('-'.repeat(101));
  const totalSaida = resultados.reduce((s, r) => s + r.bytes_saida, 0);
  const reducao = resultados.reduce((s, r) => s + r.vertices_antes, 0) > 0
    ? Math.round((1 - resultados.reduce((s, r) => s + r.vertices_depois, 0) / resultados.reduce((s, r) => s + r.vertices_antes, 0)) * 100)
    : 0;
  console.log('publicado em data/: ' + tamanhoLegivel(totalSaida) + '   ·   vértices: −' + reducao + '%');
  console.log('catálogo: ' + mudancas.adicionadas.length + ' camada(s) nova(s), '
    + mudancas.atualizadas.length + ' atualizada(s), ' + mudancas.preservadas + ' preservada(s)');

  // Sistema de referência: uma linha consolidada em vez de repetir por camada.
  const origens = Array.from(new Set(resultados.map((r) => r.crs_origem || '(desconhecido)')));
  if (origens.length === 1) console.log('sistema de referência: ' + origens[0]);
  else console.log('sistemas de referência: ' + origens.join(', '));

  // Só o aviso que EXIGE conferência humana: CRS assumido (arquivo sem .prj).
  for (const r of resultados) {
    if (r.aviso_crs && !/declarado no \.prj/i.test(r.aviso_crs)) {
      console.log('  ! ' + r.nome + ': ' + r.aviso_crs);
    }
    if (r.aviso) console.log('  ! ' + r.nome + ': ' + r.aviso);
  }

  const grandes = resultados.filter((r) => r.bytes_saida > 8 * 1024 * 1024);
  if (grandes.length) {
    console.log('\nATENÇÃO — camada acima de 8 MB depois de simplificada:');
    for (const g of grandes) console.log('  · ' + g.nome + ' (' + tamanhoLegivel(g.bytes_saida) + ')');
    console.log('  Considere uma escala menor (--escala 100000) ou dividir a camada.');
  }
  void catalogoPath;
}

// ============================================================ linha de comando
function lerArgumentos(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rascunho') args.rascunho = argv[++i];
    else if (a === '--inspecionar') args.inspecionar = argv[++i];
    else if (a === '--manifest') args.manifest = argv[++i];
    else if (a === '--escala') args.escala = Number(argv[++i]);
    else if (a === '--tolerancia') args.tolerancia = Number(argv[++i]);
    else if (a === '--casas') args.casas = Number(argv[++i]);
    else if (a === '--sem-simplificar') args.semSimplificar = true;
    else if (a === '--forcar') args.forcar = true;
    else if (a === '--simular') args.simular = true;
    else if (a === '--ajuda' || a === '-h') args.ajuda = true;
    else args._.push(a);
  }
  return args;
}

function ajuda() {
  console.log([
    'Importador de camadas do Portal EIA/RIMA',
    '',
    '  node tools/importar_camadas.js --inspecionar <arquivo.shp|pasta>',
    '      Mostra feições, vértices, CRS, campos e sugere o campo de classe.',
    '',
    '  node tools/importar_camadas.js --rascunho <pasta>',
    '      Cria data/camadas-fonte.json com uma entrada por shapefile encontrado.',
    '',
    '  node tools/importar_camadas.js [--manifest data/camadas-fonte.json] [opções]',
    '      Importa as camadas do manifesto para data/ e atualiza data/catalogo.json.',
    '',
    'Opções:',
    '  --escala <n>        escala de visualização pretendida (padrão 50000).',
    '                      A tolerância sai de 0,2 mm no papel nessa escala.',
    '  --tolerancia <g>    tolerância de simplificação em graus (sobrepõe --escala).',
    '  --casas <n>         casas decimais da coordenada (padrão 6, ~11 cm).',
    '  --sem-simplificar   publica a geometria como veio.',
    '  --forcar            reimporta mesmo se o destino estiver atualizado.',
    '  --simular           mostra o que faria, sem escrever nada.',
  ].join('\n'));
}

function executar(argv) {
  const args = lerArgumentos(argv || process.argv.slice(2));
  if (args.ajuda) { ajuda(); return 0; }

  try {
    if (args.inspecionar) {
      imprimirInspecao(inspecionar(args.inspecionar));
      return 0;
    }

    if (args.rascunho) {
      const manifesto = gerarRascunho(args.rascunho);
      const destino = path.join(raiz, 'data', 'camadas-fonte.json');
      fs.writeFileSync(destino, JSON.stringify(manifesto, null, 2));
      console.log('Rascunho do manifesto em ' + path.relative(raiz, destino));
      console.log(manifesto.camadas.length + ' camada(s) encontrada(s):');
      for (const c of manifesto.camadas) {
        console.log('  ' + c.nome.padEnd(32) + 'meio: ' + (c.meio || '?? preencher')
          + '   classe: ' + (c.campo_classe || '?? preencher'));
      }
      if (!manifesto.camadas.length) {
        console.log('\nNão achei nenhum .shp em ' + args.rascunho + '. Confira o caminho.');
        return 1;
      }
      console.log('\nAgora edite o arquivo e preencha "meio", "fonte" e "data_ref". Depois rode:');
      console.log('  node tools/importar_camadas.js');
      return 0;
    }

    const caminhoManifesto = path.resolve(raiz, args.manifest || path.join('data', 'camadas-fonte.json'));
    if (!fs.existsSync(caminhoManifesto)) {
      console.log('Não encontrei o manifesto: ' + path.relative(raiz, caminhoManifesto));
      console.log('\nComece gerando o rascunho a partir da sua pasta de shapefiles:');
      console.log('  node tools/importar_camadas.js --rascunho "C:\\caminho\\da\\sua\\base"');
      return 1;
    }

    const manifesto = JSON.parse(fs.readFileSync(caminhoManifesto, 'utf8'));
    const camadas = manifesto.camadas || [];
    if (!camadas.length) { console.log('O manifesto não tem camadas.'); return 1; }

    const problemas = [];
    for (const c of camadas) {
      if (!c.meio || ['fisico', 'biotico', 'socioeconomico'].indexOf(c.meio) < 0) {
        problemas.push('"' + (c.nome || c.origem) + '": campo "meio" precisa ser fisico, biotico ou socioeconomico.');
      }
      if (!c.origem) problemas.push('"' + (c.nome || '?') + '": falta "origem" (caminho do shapefile).');
      else if (!fs.existsSync(c.origem)) problemas.push('"' + (c.nome || c.origem) + '": arquivo não encontrado: ' + c.origem);
    }
    if (problemas.length) {
      console.log('O manifesto tem pendências:\n');
      problemas.forEach((p) => console.log('  · ' + p));
      return 1;
    }

    const opcoes = {
      escala: args.escala || 50000,
      semSimplificar: args.semSimplificar,
      casas: args.casas,
      simular: args.simular,
    };
    if (args.tolerancia > 0) {
      for (const c of camadas) c.simplificar_graus = args.tolerancia;
    }

    console.log('Importando ' + camadas.length + ' camada(s) — escala alvo 1:' + opcoes.escala.toLocaleString('pt-BR')
      + (opcoes.semSimplificar
        ? ', SEM simplificar'
        : ', tolerância ' + Math.round(toleranciaParaEscala(opcoes.escala) * 110574) + ' m no terreno')
      + (opcoes.simular ? ' — SIMULAÇÃO' : ''));

    const resultados = [];
    for (const c of camadas) {
      process.stdout.write('  · ' + (c.nome || c.id) + ' … ');
      const inicio = Date.now();
      try {
        const r = importarCamada(c, opcoes);
        resultados.push(r);
        console.log(r.feicoes.toLocaleString('pt-BR') + ' feições, '
          + r.vertices_depois.toLocaleString('pt-BR') + ' vértices, '
          + tamanhoLegivel(r.bytes_saida) + ' (' + ((Date.now() - inicio) / 1000).toFixed(1) + ' s)');
      } catch (e) {
        console.log('FALHOU: ' + e.message);
        return 1;
      }
    }

    const catalogoPath = path.join(raiz, 'data', 'catalogo.json');
    const { mudancas } = atualizarCatalogo(catalogoPath, resultados, opcoes);
    imprimirImportacao(resultados, mudancas, catalogoPath);

    console.log('\nPróximo passo — publicar a base:');
    console.log('  git add data/');
    console.log('  git commit -m "Base de caracterizacao: ' + resultados.length + ' camada(s)"');
    console.log('  git push');
    console.log('A Vercel publica sozinha e a base fica fixa no portal.');
    return 0;
  } catch (e) {
    console.error('ERRO: ' + e.message);
    return 1;
  }
}

module.exports = {
  executar: executar,
  inspecionar: inspecionar,
  gerarRascunho: gerarRascunho,
  importarCamada: importarCamada,
  atualizarCatalogo: atualizarCatalogo,
  prepararGeometria: prepararGeometria,
  toleranciaParaEscala: toleranciaParaEscala,
  adivinharCampoClasse: adivinharCampoClasse,
  adivinharMeio: adivinharMeio,
  classesECores: classesECores,
  escreverGeoJson: escreverGeoJson,
  lerShapefile: lerShapefile,
  slug: slug,
  tamanhoLegivel: tamanhoLegivel,
};

if (require.main === module) process.exit(executar());
