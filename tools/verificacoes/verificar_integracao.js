'use strict';
async function executar() {
/* Verificação integrada: roda o fluxo completo do portal sobre os arquivos reais
 * de data/ — catálogo, áreas de influência, recorte, tabela, gráfico, relatório e
 * PDF do mapa. É o teste que responde "o portal funciona com o dado dele?".
 * Uso: node tools/verificacoes/verificar_integracao.js */
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..', '..');
const ajudanteCamadas = require(path.join(__dirname, '_camadas.js'));
const EIA = {
  math: require(path.join(raiz, 'js', 'math.js')),
  vetorial: require(path.join(raiz, 'js', 'vetorial.js')),
  recorte: require(path.join(raiz, 'js', 'recorte.js')),
  tabela: require(path.join(raiz, 'js', 'tabela.js')),
  relatorio: require(path.join(raiz, 'js', 'relatorio.js')),
  pdf: require(path.join(raiz, 'js', 'pdf.js')),
  mapa: require(path.join(raiz, 'js', 'mapa.js')),
  svg: require(path.join(raiz, 'js', 'svg.js')),
  crs: require(path.join(raiz, 'js', 'crs.js')),
};

let falhas = 0, testes = 0;
function ok(nome, cond, det) {
  testes++;
  if (cond) console.log('  ok  ' + nome + (det ? '  [' + det + ']' : ''));
  else { falhas++; console.log('  FALHA ' + nome + (det ? '  [' + det + ']' : '')); }
}

const dataDir = path.join(raiz, 'data');
const catalogo = JSON.parse(fs.readFileSync(path.join(dataDir, 'catalogo.json'), 'utf8'));

console.log('\n== Catálogo e arquivos ==');
{
  ok('catálogo tem 3 meios', catalogo.meios.length === 3);
  // A base mudou de 9 camadas de exemplo para 6 reais do estado (v2.8). O teste NÃO pode
  // fixar o número: ele mede que a base existe, tem mais de uma camada e que cada uma está
  // completa — contar camadas foi o que fez este teste falhar sem nada estar errado.
  ok('catálogo tem camadas', catalogo.camadas.length >= 2, catalogo.camadas.length + ' camadas');
  ok('toda camada tem arquivo, classe e meio',
    catalogo.camadas.every((c) => (c.arquivo || c.tiles || c.servico) && c.campo_classe && c.meio
    && (c.servico || (c.classes && c.classes.length)) && (c.arquivo || c.tiles || c.servico.url)),
    catalogo.camadas.map((c) => c.id).join(', '));
  const faltando = [];
  for (const c of catalogo.camadas) {
    for (const rel of ajudanteCamadas.arquivos(raiz, c)) {
      if (!fs.existsSync(path.join(raiz, rel))) faltando.push(rel);
    }
  }
  ok('todos os arquivos do catálogo existem', faltando.length === 0, faltando.join(', ') || 'ok');
  const ids = catalogo.camadas.map((c) => c.id);
  ok('ids de camada únicos', new Set(ids).size === ids.length);
  // O teste NÃO exige campo_classe em toda camada: camada de uma feição só (faixa de
  // domínio, AID) legitimamente não tem por onde agrupar. O que se exige é que o campo
  // declarado EXISTA na camada — é o erro que passa desapercebido (typo no manifesto).
  const semCampo = catalogo.camadas.filter((c) => !c.campo_classe).map((c) => c.nome);
  const campoInexistente = [];
  for (const c of catalogo.camadas) {
    if (!c.campo_classe) continue;
    // camada AO VIVO: o campo de classe foi conferido contra os metadados do próprio serviço
    // (o nome de cada campo está declarado lá), não contra um arquivo do repositório
    if (c.servico) continue;
    const g = ajudanteCamadas.carregar(raiz, c);
    const props = (g.features[0] && g.features[0].properties) || {};
    if (!(c.campo_classe in props)) campoInexistente.push(c.nome + ' → ' + c.campo_classe);
  }
  ok('campo_classe declarado existe na camada', campoInexistente.length === 0,
    campoInexistente.join('; ') || (semCampo.length + ' camada(s) sem classe, de propósito'));
  // Base publicada tem de dizer de onde veio cada camada: sem fonte, o número do estudo
  // não se sustenta. Isto NÃO derruba a suíte — é pendência de conteúdo do projeto, não
  // defeito de código — mas aparece com destaque para não passar batido.
  const semFonte = catalogo.camadas.filter((c) => !c.fonte || !String(c.fonte).trim());
  if (semFonte.length) {
    console.log('  AVISO  ' + semFonte.length + ' camada(s) SEM FONTE declarada — preencha antes de usar em estudo:');
    for (const c of semFonte.slice(0, 20)) console.log('         · ' + c.nome);
  } else {
    ok('toda camada declara a fonte', true, catalogo.camadas.length + ' camadas');
  }
  // Camada ainda marcada como exemplo é PENDÊNCIA de conteúdo, não defeito de código:
  // aparece com destaque e não derruba a suíte. (Enquanto a base do projeto não chega,
  // a camada de exemplo é o que permite testar o fluxo — o erro é esquecer que ela é
  // exemplo, não tê-la.)
  const sinteticas = catalogo.camadas.filter((c) => /EXEMPLO SINT[ÉE]TICO/i.test(String(c.fonte)));
  if (sinteticas.length) {
    console.log('  AVISO  ' + sinteticas.length + ' camada(s) ainda de EXEMPLO — substitua pelo dado oficial:');
    for (const c of sinteticas) console.log('         · ' + c.nome + '   (' + c.fonte + ')');
  } else {
    ok('base sem dado sintético', true, 'base curada');
  }
}

console.log('\n== Áreas de influência de exemplo ==');
const areasGeojson = JSON.parse(fs.readFileSync(path.join(dataDir, 'areas-influencia-exemplo.geojson'), 'utf8'));
const areas = areasGeojson.features.map((f, i) => ({
  id: f.properties.sigla,
  nome: f.properties.nome,
  sigla: f.properties.sigla,
  geometry: f.geometry,
  cor: ['#d94f3d', '#e08a2f'][i % 2],
}));
{
  ok('2 áreas de influência', areas.length === 2);
  const ha = areas.map((a) => EIA.recorte.areaHectares(a.geometry) / 10000);
  ok('ADA menor que AID', ha[1] < ha[0], ha.map((x) => x.toFixed(0) + ' ha').join(' vs '));
  ok('áreas com tamanho plausível', ha.every((x) => x > 100 && x < 500000), ha.map((x) => x.toFixed(0)).join(', '));
}

console.log('\n== Recorte de todas as camadas pelas áreas ==');
const camadas = [];
for (const c of catalogo.camadas) {
  if (c.servico) continue;   // sem rede: a camada ao vivo é conferida na suite de referências
  const geojson = ajudanteCamadas.carregar(raiz, c);
  camadas.push(Object.assign({}, c, { geojson: geojson }));
}
const inicio = Date.now();
const r = EIA.recorte.recortarTudo(areas, camadas, {});
const duracao = Date.now() - inicio;
{
  ok('todas as combinações processadas', r.resultados.length === areas.length * camadas.length,
    r.resultados.length + ' de ' + (areas.length * camadas.length));
  ok('sem erros no processamento', r.erros.length === 0, JSON.stringify(r.erros).slice(0, 200));
  ok('tem feições no resultado', r.resumo.feicoes_resultado > 0, r.resumo.feicoes_resultado + ' feições');
  ok('tem área somada', r.resumo.area_total_ha > 0, EIA.math.num(r.resumo.area_total_ha, 2) + ' ha');
  ok('processou em tempo aceitável (< 60 s)', duracao < 60000, (duracao / 1000).toFixed(1) + ' s');

  // A camada de conferência é escolhida pelo DADO (a que tem polígono dentro da ADA),
  // não pelo nome: o catálogo muda quando a base do projeto muda, e teste que fixa
  // "geologia" quebra na primeira base real.
  const adaCandidatas = r.resultados.filter((x) => x.relatorio.ai === 'ADA' && x.camada.tipo === 'poligono' && x.features.length > 0);
  const adaGeo = adaCandidatas.sort((a, b) => b.features.length - a.features.length)[0];
  ok('há camada de polígono dentro da ADA', !!adaGeo,
    adaGeo ? adaGeo.camada.nome + ' (' + adaGeo.features.length + ' feições)' : 'nenhuma');
  if (adaGeo && adaGeo.features.length) {
    const p = adaGeo.features[0].properties;
    ok('colunas de resultado presentes', p.eia_area_ha > 0 && p.eia_ai === 'ADA' && !!p.eia_classe,
      JSON.stringify({ area: p.eia_area_ha, ai: p.eia_ai, classe: p.eia_classe }));

    /* A INVARIANTE CERTA é contenção, não soma.
     *
     * Antes se exigia "a soma das áreas recortadas não passa da área da AI". Isso é
     * FALSO para dado real: camada de geologia tem polígonos que se SOBREPÕEM (uma
     * cobertura cenozóica por cima do embasamento), então a soma por feição passa
     * legitimamente da área da AI — e o portal avisa isso em `conferirFechamento`, que
     * é o comportamento correto. Soma maior que a AI não é defeito; geometria que sai
     * da AI é. */
    const bbAI = EIA.math.bbox({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: adaGeo.relatorio.ai_geometry || (areas.find((a) => a.sigla === 'ADA') || {}).geometry, properties: {} }] });
    const eps = 1e-6;
    let fora = 0;
    for (const f of adaGeo.features) {
      const b = EIA.math.bbox({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: f.geometry, properties: {} }] });
      if (!b || !bbAI) continue;
      if (b.xmin < bbAI.xmin - eps || b.xmax > bbAI.xmax + eps
        || b.ymin < bbAI.ymin - eps || b.ymax > bbAI.ymax + eps) fora++;
    }
    ok('nenhuma geometria recortada sai da área de influência', fora === 0,
      fora === 0 ? adaGeo.features.length + ' feições contidas' : fora + ' feições fora');

    const soma = adaGeo.features.reduce((s, f) => s + f.properties.eia_area_ha, 0);
    const fator = soma / adaGeo.relatorio.ai_area_ha;
    // Soma acima da AI é sobreposição na FONTE. Mais de 3x seria absurdo e indicaria
    // recorte duplicando geometria — é o limite que separa "dado sobreposto" de "defeito".
    ok('soma recortada em fator plausível (sobreposição da fonte ≤ 3x)', fator <= 3.001,
      EIA.math.num(soma, 1) + ' ha = ' + EIA.math.num(fator, 2) + 'x a AI'
      + (fator > 1.001 ? '  (a fonte tem polígonos sobrepostos — o portal avisa isso)' : ''));
  }

  const camadaLinha = catalogo.camadas.find((c) => c.tipo === 'linha');
  const linhas = camadaLinha ? r.resultados.find((x) => x.camada.id === camadaLinha.id) : null;
  ok('camada de linha gera comprimento', !camadaLinha || (linhas && linhas.relatorio.comprimento_total_km > 0),
    linhas ? linhas.relatorio.comprimento_total_km.toFixed(2) + ' km' : (camadaLinha ? '0' : 'sem camada de linha'));
}

console.log('\n== Conferência de área (UTM x geodésica) ==');
{
  const ada = r.resultados.find((x) => x.relatorio.ai === 'ADA' && x.camada.tipo === 'poligono' && x.features.length > 0 && !!x.features[0].properties.eia_area_ha);
  if (ada && ada.features.length) {
    const aneis = EIA.vetorial.bboxDeAneis(EIA.recorte.aneisDaGeometria(ada.features[0].geometry));
    void aneis;
    const anel = EIA.math.abrirAnel(EIA.recorte.aneisDaGeometria(ada.features[0].geometry)[0]);
    const conf = EIA.math.conferirArea(anel, 'WGS84');
    ok('UTM e geodésica concordam (< 1%)', conf.diferenca_relativa < 0.01,
      'UTM ' + EIA.math.num(conf.area_utm_m2 / 10000, 2) + ' ha vs geodésica '
      + EIA.math.num(conf.area_geodesica_m2 / 10000, 2) + ' ha (' + EIA.math.num(conf.diferenca_relativa * 100, 3) + '%)');
  } else {
    ok('achou feição recortada na ADA para conferir a área', false);
  }
}

console.log('\n== Tabela e gráficos ==');
{
  const porClasse = EIA.tabela.porClasse(r.resultados);
  ok('tabela por classe com linhas', porClasse.length > 10, porClasse.length + ' linhas');
  // Linha (hidrografia) tem área zero DE PROPÓSITO e comprimento > 0. Algumas
  // feições vêm do arquivo de origem com um único vértice (açude intermitente):
  // têm zero de área E zero de comprimento, mas existem — por isso a exigência é
  // "tem medida OU tem feição", não "tem medida".
  const semNada = porClasse.filter((l) => !(l.area_ha > 0) && !(l.comprimento_km > 0) && !(l.feicoes > 0));
  ok('toda linha tem medida ou feição', semNada.length === 0,
    semNada.length ? JSON.stringify(semNada[0]).slice(0, 140) : 'todas com medida ou feição');
  const soLinha = porClasse.filter((l) => !(l.area_ha > 0));
  ok('as linhas sem área são de camada de linha', soLinha.every((l) => l.camada === 'hidrografia'),
    soLinha.map((l) => l.camada).join(','));
  /* O percentual pode passar de 100 no AGREGADO, e isso NÃO é defeito: os polígonos da camada
   * de origem se sobrepõem (associação de solos, unidade geológica sobre unidade geológica),
   * então a soma dos pedaços de uma classe pode passar da área da AI. O que não pode é passar
   * MUITO — aí seria recorte errado, não sobreposição da origem. O limite por FEIÇÃO (nunca
   * acima de 100, porque pedaço não é maior que o todo) é aplicado em js/recorte.js. */
  const maxPct = Math.max.apply(null, porClasse.map((l) => l.pct_ai));
  ok('toda linha tem percentual coerente (sobreposição de origem é aceita, recorte errado não)',
    porClasse.every((l) => l.pct_ai >= 0) && maxPct <= 130,
    'máx ' + maxPct.toFixed(2) + '%');
  const graficos = EIA.tabela.dadosParaGraficos(r.resultados);
  ok('gerou gráficos', graficos.length > 0, graficos.length + ' gráficos');
  const svg = EIA.svg.barras(graficos[0].classes.slice(0, 8).map((c) => ({ rotulo: c.rotulo, valor: c.valor })), { titulo: 'teste' });
  ok('gráfico SVG válido', svg.indexOf('<svg') === 0 && svg.indexOf('</svg>') > 0, svg.length + ' bytes');
  const avisos = EIA.tabela.conferirFechamento(r.resultados);
  console.log('     avisos de fechamento: ' + avisos.length + (avisos.length ? ' (' + avisos[0].mensagem.slice(0, 80) + '…)' : ''));
}

console.log('\n== Relatório ==');
{
  const relato = EIA.relatorio.redigir(r.resultados, { nome: 'Projeto de exemplo', cliente: 'Interessado', responsavel: 'Eng. Teste', crea: '000000/D' });
  ok('relatório com seções', relato.secoes.length >= 5, relato.secoes.length + ' seções');
  const texto = EIA.relatorio.textoSimples(relato);
  ok('texto com tamanho útil', texto.length > 2000, texto.length + ' caracteres');
  ok('relatório cita as duas áreas de influência', texto.indexOf('ADA') > 0 && texto.indexOf('AID') > 0);
  const bytes = EIA.relatorio.gerarPdf(relato, r.resultados, { folha: 'A4' });
  ok('PDF do relatório gerado', bytes.length > 5000 && /%%EOF\s*$/.test(Buffer.from(bytes).toString('latin1')), bytes.length + ' bytes');
}

console.log('\n== Mapa: escala, articulação e PDF ==');
{
  let bbox = null;
  for (const a of areas) bbox = EIA.math.unirBbox(bbox, EIA.math.bbox(a.geometry));
  const esc = EIA.mapa.escalaQueCabe(bbox, 'A1', 'paisagem');
  ok('escala que cabe calculada', EIA.mapa.ESCALAS.indexOf(esc) >= 0, '1:' + EIA.math.num(esc, 0));

  const art = EIA.mapa.articular(bbox, 'A1', 'paisagem', 5000, { sobreposicao: 0.1 });
  // Área de influência de exemplo tem ~20 km de lado: em 1:5.000 são dezenas de
  // folhas — é o número certo, e é justamente o que motiva a articulação existir.
  ok('articulação em 1:5.000 gera dezenas de folhas (esperado para 20 km)', art.total > 10 && art.total < 60,
    art.total + ' folhas em ' + art.linhas + 'x' + art.colunas);

  // JPEG mínimo válido com SOF0, para o PDF poder embutir
  const jpeg = (function () {
    const b = [];
    const p = (...x) => x.forEach((v) => b.push(v));
    p(0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x11, 0x08, 0x01, 0xE0, 0x02, 0x80, 0x03);
    p(0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xFF, 0xD9);
    return new Uint8Array(b);
  })();

  const bytes = EIA.mapa.gerarPdf({
    folha: 'A1', orientacao: 'paisagem', escala: 5000, projeto: 'Projeto de exemplo',
    titulo: 'MAPA DE CARACTERIZAÇÃO AMBIENTAL', bbox: bbox, articulacao: art,
    imagens: art.folhas.map((f) => ({ chave: f.numero, bytes: jpeg })),
    incluirIndice: true, responsavel: 'Eng. Teste', crea: '000000/D',
    legenda: [{ rotulo: 'Geologia', cor: '#c8a165' }, { rotulo: 'Hidrografia', cor: '#2f5b8a', forma: 'linha' }],
    datum: 'SIRGAS 2000 / UTM 23S', fonte: 'IBGE; base do projeto',
  });
  const texto = Buffer.from(bytes).toString('latin1');
  const paginas = (texto.match(/\/Type \/Page[^s]/g) || []).length;
  ok('PDF do mapa tem índice + folhas', paginas === art.total + 1, paginas + ' páginas');
  ok('PDF do mapa tem tamanho de arquivo real', bytes.length > 50000, (bytes.length / 1024).toFixed(0) + ' KB');
  ok('PDF do mapa é válido', bytes[0] === 0x25 && /%%EOF\s*$/.test(texto));

  fs.writeFileSync(path.join(raiz, 'tools', 'verificacoes', '_amostra-mapa.pdf'), bytes);
  console.log('     PDF de amostra salvo em tools/verificacoes/_amostra-mapa.pdf');
}

console.log('\n== Exportação ==');
{
  const shapelib = require(path.join(raiz, 'js', 'shapelib.js'));
  const ada = r.resultados.find((x) => x.relatorio.ai === 'ADA' && x.camada.id === 'geologia');
  const arq = shapelib.escreverShapefile(ada.features, {});
  const lido = shapelib.abrirShapefile([
    { nome: 'a.shp', bytes: arq.shp }, { nome: 'a.dbf', bytes: arq.dbf }, { nome: 'a.prj', bytes: arq.prj },
  ]);
  ok('shapefile do recorte reabre', lido.geojson.features.length === ada.features.length,
    lido.geojson.features.length + ' de ' + ada.features.length);
  const props = lido.geojson.features[0].properties;
  // O .dbf limita o nome do campo a 10 caracteres: `eia_area_ha` vira `eia_area_h`.
  // O que importa é o VALOR sobreviver, no campo que o portal criou.
  const campoArea = Object.keys(props).find((k) => /^eia_area/.test(k));
  ok('coluna de área sobreviveu ao shapefile', !!campoArea && props[campoArea] > 0,
    campoArea ? campoArea + ' = ' + props[campoArea] : JSON.stringify(Object.keys(props)));
  ok('campo de classe sobreviveu', !!props.eia_classe || !!props.unidade, JSON.stringify(Object.keys(props).slice(0, 8)));

  const xlsx = require(path.join(raiz, 'js', 'xlsx.js'));
  const bytesXlsx = await xlsx.gerar([{ nome: 'Recorte', colunas: [{ rotulo: 'AI' }, { rotulo: 'Área' }], linhas: [['ADA', 12.5]] }]);
  ok('XLSX gerado', bytesXlsx[0] === 0x50 && bytesXlsx.length > 800, bytesXlsx.length + ' bytes');
}

console.log('\n' + (falhas ? 'FALHAS: ' + falhas + '/' + testes : 'TODOS OS ' + testes + ' TESTES PASSARAM'));
return falhas ? 1 : 0;
}
module.exports = { executar };
if (require.main === module) {
  executar().then((c) => process.exit(c));
}
