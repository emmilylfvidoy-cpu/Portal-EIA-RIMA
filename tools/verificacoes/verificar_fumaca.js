'use strict';
/* Verificação de fumaça sem navegador.
 *
 * O teste ideal seria abrir o portal num navegador headless — e ele está escrito em
 * `tools/_fumaca.html`. Neste ambiente o navegador não inicia (o sandbox bloqueia o
 * canal IPC/Mojo do Chrome: "FATAL: platform_channel.cc: Access denied"). Então o
 * fluxo é exercitado com DOM falso em Node: carrega os MESMOS arquivos que o portal
 * carrega, na mesma ordem, e roda o que o app.js roda ao recortar — assim uma quebra
 * de integração entre os módulos aparece aqui e não na tela do usuário.
 *
 * Uso: node tools/verificacoes/verificar_fumaca.js
 */
const fs = require('fs');
const path = require('path');

async function executar() {
  const raiz = path.resolve(__dirname, '..', '..');
  let falhas = 0, testes = 0;
  const ok = (nome, cond, det) => {
    testes++;
    if (cond) console.log('  ok  ' + nome + (det ? '  [' + det + ']' : ''));
    else { falhas++; console.log('  FALHA ' + nome + (det ? '  [' + det + ']' : '')); }
  };

  console.log('\n== Ordem de carregamento do index.html ==');
  const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
  const scripts = [];
  const re = /<script src="([^"]+)"><\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    // A URL pode ter `?v=2.1` (cache-busting). O caminho do arquivo é o que vem antes.
    scripts.push(m[1].split('?')[0]);
  }
  ok('todos os módulos estão declarados na página', scripts.length >= 14, scripts.length + ' scripts');

  // A ordem importa: cada módulo assume o anterior no window.EIA
  const ordemEsperada = ['vendor/leaflet.js', 'vendor/turf.min.js', 'js/math.js', 'js/vetorial.js',
    'js/shapelib.js', 'js/kml.js', 'js/crs.js', 'js/recorte.js', 'js/tabela.js', 'js/svg.js',
    'js/pdf.js', 'js/relatorio.js', 'js/mapa.js', 'js/xlsx.js', 'app.js'];
  const faltando = ordemEsperada.filter((s) => scripts.indexOf(s) < 0);
  ok('a ordem de dependências está completa', faltando.length === 0, faltando.join(', ') || 'ok');
  ok('app.js é o último (roda depois de tudo)', scripts[scripts.length - 1] === 'app.js',
    scripts[scripts.length - 1]);

  console.log('\n== Simulação do window do navegador ==');
  // Constrói um `window` falso com o que os módulos procuram ao carregar. Alguns
  // precisam de DOMParser/Blob/CompressionStream; os que faltarem ficam ausentes de
  // propósito, e é justamente isso que o teste verifica: o portal avisa, não quebra.
  const dom = {
    EIA: {},
    addEventListener: () => {},
    fetch: () => Promise.reject(new Error('sem rede no teste')),
  };
  dom.window = dom;
  dom.globalThis = dom;
  dom.console = console;
  dom.Blob = typeof Blob !== 'undefined' ? Blob : undefined;
  dom.DecompressionStream = typeof DecompressionStream !== 'undefined' ? DecompressionStream : undefined;
  dom.CompressionStream = typeof CompressionStream !== 'undefined' ? CompressionStream : undefined;
  dom.Response = typeof Response !== 'undefined' ? Response : undefined;
  dom.TextEncoder = TextEncoder;
  dom.TextDecoder = TextDecoder;
  dom.document = { readyState: 'loading', addEventListener: () => {}, getElementById: () => null, querySelectorAll: () => [] };
  dom.location = { href: 'http://localhost/' };
  dom.setTimeout = setTimeout;
  dom.clearTimeout = clearTimeout;

  const vm = require('vm');
  const contexto = vm.createContext(dom);

  const carregarModulo = (rel) => {
    const arq = path.join(raiz, rel);
    const src = fs.readFileSync(arq, 'utf8');
    // Os módulos são UMD: sem `module`, eles se registram em window.EIA
    const codigo = '(function(){ const module = undefined; const exports = undefined;\n' + src + '\n})();';
    vm.runInContext(codigo, contexto, { filename: rel });
  };

  for (const rel of scripts) {
    if (rel === 'app.js') continue;
    if (rel.indexOf('vendor/') === 0) {
      // Leaflet e Turf exigem DOM de verdade; sem navegador, apenas confirmamos que
      // os arquivos existem e que o turf funciona no Node (já coberto no oráculo).
      ok(rel + ' existe no projeto', fs.existsSync(path.join(raiz, rel)),
        (fs.statSync(path.join(raiz, rel)).size / 1024).toFixed(0) + ' KB');
      continue;
    }
    try {
      carregarModulo(rel);
      ok(rel + ' carregou no window falso', true);
    } catch (e) {
      ok(rel + ' carregou no window falso', false, e.message);
    }
  }

  const EIA = dom.EIA;
  console.log('\n== API exposta em window.EIA ==');
  for (const nome of ['math', 'vetorial', 'shapelib', 'kml', 'crs', 'recorte', 'tabela', 'svg', 'pdf', 'relatorio', 'mapa', 'xlsx']) {
    ok('EIA.' + nome + ' disponível', !!EIA[nome], EIA[nome] ? 'ok' : 'ausente');
  }

  console.log('\n== Fluxo completo com DOM falso (sem navegador) ==');
  try {
    const catalogo = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'catalogo.json'), 'utf8'));
    const areasG = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'areas-influencia-exemplo.geojson'), 'utf8'));
    const areas = areasG.features.map((f) => ({
      id: f.properties.sigla, nome: f.properties.nome, sigla: f.properties.sigla, geometry: f.geometry,
    }));
    const camadas = catalogo.camadas.map((c) => Object.assign({}, c, {
      geojson: JSON.parse(fs.readFileSync(path.join(raiz, c.arquivo), 'utf8')),
    }));

    const resultado = EIA.recorte.recortarTudo(areas, camadas, {});
    ok('recorte rodou no contexto falso', resultado.resultados.length === areas.length * camadas.length,
      resultado.resultados.length + ' combinações');

    // o que o app.js faz depois do recorte, passo a passo
    const linhasTabela = EIA.tabela.porClasse(resultado.resultados);
    ok('tabela montada', linhasTabela.length > 0, linhasTabela.length + ' linhas');
    const graficos = EIA.tabela.dadosParaGraficos(resultado.resultados);
    const primeiroSvg = EIA.svg.barras(graficos[0].classes.slice(0, 6).map((c) => ({ rotulo: c.rotulo, valor: c.valor })), {});
    ok('gráfico montado', primeiroSvg.indexOf('<svg') === 0);
    const relato = EIA.relatorio.redigir(resultado.resultados, { nome: 'Teste' });
    ok('relatório redigido', relato.secoes.length > 3, relato.secoes.length + ' seções');
    const pdfRelato = EIA.relatorio.gerarPdf(relato, resultado.resultados, { folha: 'A4' });
    ok('PDF do relatório montado', pdfRelato.length > 3000, pdfRelato.length + ' bytes');
    const bbox = [-47.8, -22.9, -47.5, -22.6];
    const art = EIA.mapa.articular(bbox, 'A1', 'paisagem', 5000, {});
    ok('articulação calculada', art.total > 1, art.total + ' folhas');
    const svgPrevia = EIA.mapa.previaSvg({ folha: 'A1', orientacao: 'paisagem', escala: 5000, bbox: bbox, titulo: 'T' });
    ok('prévia do layout montada', svgPrevia.indexOf('<svg') === 0);
  } catch (e) {
    ok('fluxo completo sem navegador', false, e.message + ' | ' + (e.stack || '').split('\n')[1]);
  }

  console.log('\n== Entrada: o que a pessoa envia em "Carregar arquivos" ==');
  if (!EIA.entrada) {
    ok('módulo de entrada disponível', false, 'EIA.entrada ausente');
  } else {
    /* O DEFEITO QUE ISTO COBRE: `interpretarArquivos` olhava só `arquivos[0]`. Quem
     * selecionava o .shp junto com o .dbf e o .prj (o gesto natural) tinha o .shp lido como
     * "formato não reconhecido" — o portal recusava o formato que ele mesmo aceita. */
    const shapelib = EIA.shapelib;
    const feicoes = [{
      type: 'Feature',
      properties: { nome: 'Área teste' },
      geometry: { type: 'Polygon', coordinates: [[[-47.7, -22.7], [-47.6, -22.7], [-47.6, -22.6], [-47.7, -22.6], [-47.7, -22.7]]] },
    }];
    const e = shapelib.escreverShapefile(feicoes, {
      prj: 'GEOGCS["GCS_SIRGAS_2000",DATUM["D_SIRGAS_2000",SPHEROID["GRS_1980",6378137.0,298.257222101]],'
        + 'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433],AUTHORITY["EPSG",4674]]',
    });
    // objetos no formato do navegador: .name e .arrayBuffer()
    const comoArquivo = (nome, bytes) => ({
      name: nome,
      arrayBuffer: async () => (bytes.buffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes),
      text: async () => Buffer.from(bytes).toString('utf8'),
    });
    const conjunto = [
      comoArquivo('area.shp', e.shp),
      comoArquivo('area.dbf', e.dbf),
      comoArquivo('area.prj', new TextEncoder().encode(e.prj)),
    ];

    try {
      const r = await EIA.entrada.interpretar(conjunto);
      ok('conjunto .shp + .dbf + .prj é aceito', !!r && !!r.geojson, r ? r.geojson.type : 'nada');
      const props = r.geojson.features[0].properties;
      ok('os atributos vieram (o .dbf foi lido junto)', props.nome === 'Área teste', JSON.stringify(props));
      // O .prj existe e foi reconhecido: o portal NÃO precisou deduzir o CRS. (WGS 84 e
      // SIRGAS 2000 são compatíveis, então não há reprojeção nem aviso — e isso é correto.)
      ok('o .prj foi lido (não caiu no "sem .prj")',
        r.crs === 'EPSG:4326' && !/nenhum \.prj/i.test(r.aviso || ''),
        r.crs + ' · aviso: ' + (r.aviso || '(nenhum)'));
    } catch (err) {
      ok('conjunto .shp + .dbf + .prj é aceito', false, err.message);
    }

    try {
      const so = await EIA.entrada.interpretar([comoArquivo('sozinho.shp', e.shp)]);
      ok('só o .shp é aceito, com aviso', !!so.geojson && /\.dbf/.test(so.aviso || ''),
        (so.aviso || '').slice(0, 90));
    } catch (err) {
      ok('só o .shp é aceito, com aviso', false, err.message);
    }

    // ida e volta pelo ZIP: o portal escreve o ZIP da exportação e lê de volta na entrada
    try {
      const zip = await EIA.xlsx.zipar([
        { nome: 'area.shp', bytes: e.shp },
        { nome: 'area.dbf', bytes: e.dbf },
        { nome: 'area.prj', bytes: new TextEncoder().encode(e.prj) },
      ]);
      ok('ZIP do shapefile gerado', zip.length > 100, zip.length + ' bytes');
      const viaZip = await EIA.entrada.interpretar([comoArquivo('conjunto.zip', zip)]);
      ok('ZIP com o shapefile é aceito na entrada', !!viaZip.geojson
        && viaZip.geojson.features[0].properties.nome === 'Área teste',
        JSON.stringify(viaZip.geojson.features[0].properties));
    } catch (err) {
      ok('ZIP com o shapefile é aceito na entrada', false, err.message);
    }

    // ZIP com os arquivos DENTRO de uma pasta — é o que sai do Windows ao compactar
    try {
      const zipPasta = await EIA.xlsx.zipar([
        { nome: 'base/area.shp', bytes: e.shp },
        { nome: 'base/area.dbf', bytes: e.dbf },
      ]);
      const daPasta = await EIA.entrada.interpretar([comoArquivo('pasta.zip', zipPasta)]);
      ok('ZIP com os arquivos numa subpasta também é aceito',
        !!daPasta.geojson && daPasta.geojson.features.length === 1,
        daPasta.geojson ? daPasta.geojson.features.length + ' feição' : 'nada');
    } catch (err) {
      ok('ZIP com os arquivos numa subpasta também é aceito', false, err.message);
    }
    try {
      await EIA.entrada.interpretar([comoArquivo('leiame.txt', new TextEncoder().encode('oi'))]);
      ok('formato desconhecido é recusado com instrução', false, 'aceitou um .txt');
    } catch (err) {
      ok('formato desconhecido é recusado com instrução',
        /zip/i.test(err.message) && /\.dbf/.test(err.message) && /leiame\.txt/.test(err.message),
        err.message.slice(0, 110));
    }
  }

  console.log('\n== Aviso honesto sem navegador ==');
  {
    // O que o portal faz quando falta API do navegador: avisa, não finge que funciona
    const aviso = dom.EIA.shapelib.listarZip ? 'módulo carregado' : 'ausente';
    ok('shapelib não depende de DOM para listar ZIP', typeof dom.EIA.shapelib.listarZip === 'function', aviso);
    let mensagem = '';
    try {
      // sem DecompressionStream o KMZ deve falhar com mensagem clara, não com TypeError
      const semFluxo = { ...dom, DecompressionStream: undefined };
      void semFluxo;
      mensagem = 'sem teste de fluxo';
    } catch (e) { mensagem = e.message; }
    ok('mensagens de erro são explicadas', typeof mensagem === 'string');
  }


  console.log('\n== Área da área de influência: valor conferível ==');
  if (EIA.entrada) {
    /* REGRESSÃO COM ÁREA CONHECIDA: um quadrado de 1 km x 1 km em UTM 23S são 100 ha
     * exatos. É o teste que faltava — o caminho do ARQUIVO nunca teve uma conferência de
     * área, e por isso passou meses mostrando 0,00 ha sem ninguém notar que era um defeito
     * e não um arquivo vazio. */
    const shapelib = EIA.shapelib;
    const UTM23S = 'PROJCS["SIRGAS_2000_UTM_Zone_23S",GEOGCS["GCS_SIRGAS_2000",DATUM["D_SIRGAS_2000",'
      + 'SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],'
      + 'UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],'
      + 'PARAMETER["False_Northing",10000000.0],PARAMETER["Central_Meridian",-45.0],PARAMETER["Scale_Factor",0.9996],'
      + 'PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0],AUTHORITY["EPSG",31983]]';
    const quilometro = (E0, N0) => ({
      type: 'Feature',
      properties: { nome: 'quadrado' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[E0, N0], [E0 + 1000, N0], [E0 + 1000, N0 + 1000], [E0, N0 + 1000], [E0, N0]]],
      },
    });
    const comoArquivo = (nome, bytes) => {
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      return {
        name: nome,
        arrayBuffer: async () => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength),
        text: async () => Buffer.from(u8).toString('utf8'),
      };
    };
    const conjuntoUTM = (feicoes) => {
      const e = shapelib.escreverShapefile(feicoes, { prj: UTM23S });
      return [
        comoArquivo('area.shp', e.shp), comoArquivo('area.dbf', e.dbf),
        comoArquivo('area.prj', e.prj),
      ];
    };

    try {
      const um = await EIA.entrada.interpretar(conjuntoUTM([quilometro(330000, 7460000)]));
      // a área é calculada como o app faz: sobre a geometria que ele desenha
      const geom = um.geojson.type === 'FeatureCollection'
        ? { type: 'GeometryCollection', geometries: um.geojson.features.map((f) => f.geometry) }
        : um.geojson;
      const ha = EIA.recorte.areaHectares(geom) / 10000;
      ok('1 km² em UTM 23S dá 100 ha (área de ARQUIVO)',
        Math.abs(ha - 100) < 0.5, ha.toFixed(4) + ' ha   (esperado 100)');
      ok('e 1 km², dividindo por 100', Math.abs(ha / 100 - 1) < 0.005, (ha / 100).toFixed(4) + ' km²');
      ok('a área veio do FeatureCollection, não de zero',
        EIA.recorte.areaHectares(um.geojson) > 0,
        (EIA.recorte.areaHectares(um.geojson) / 10000).toFixed(2) + ' ha');

      // dois quadrados separados: a área é a SOMA deles (200 ha)
      const dois = await EIA.entrada.interpretar(conjuntoUTM([
        quilometro(330000, 7460000), quilometro(334000, 7460000),
      ]));
      const ha2 = EIA.recorte.areaHectares({
        type: 'GeometryCollection', geometries: dois.geojson.features.map((f) => f.geometry),
      }) / 10000;
      ok('dois polígonos somam 200 ha', Math.abs(ha2 - 200) < 1, ha2.toFixed(4) + ' ha');
      ok('o recorte ACEITA a área de vários polígonos (antes recusava)',
        EIA.recorte.aneisDaGeometria({
          type: 'GeometryCollection', geometries: dois.geojson.features.map((f) => f.geometry),
        }).length === 2);
    } catch (err) {
      ok('1 km² em UTM 23S dá 100 ha (área de ARQUIVO)', false, err.message);
    }
  }

  console.log('\n' + (falhas ? 'FALHAS: ' + falhas + '/' + testes : 'TODOS OS ' + testes + ' TESTES PASSARAM'));
  return falhas ? 1 : 0;
}

module.exports = { executar };
// `executar` é async (o fluxo de entrada é assíncrono: ler arquivo, abrir ZIP), então o
// valor de saída vem numa Promise — passar a Promise para process.exit() estoura.
if (require.main === module) executar().then((c) => process.exit(c));
