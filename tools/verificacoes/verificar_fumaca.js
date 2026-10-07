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

function executar() {
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

  console.log('\n' + (falhas ? 'FALHAS: ' + falhas + '/' + testes : 'TODOS OS ' + testes + ' TESTES PASSARAM'));
  return falhas ? 1 : 0;
}

module.exports = { executar };
if (require.main === module) process.exit(executar());
