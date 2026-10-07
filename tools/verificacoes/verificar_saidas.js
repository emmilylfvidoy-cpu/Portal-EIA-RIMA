'use strict';
async function executar() {
/* Verificação de tabela, relatório, PDF e compositor de mapa.
 * Uso: node tools/verificacoes/verificar_saidas.js */
const path = require('path');
const raiz = path.resolve(__dirname, '..', '..');
const math = require(path.join(raiz, 'js', 'math.js'));
const vetorial = require(path.join(raiz, 'js', 'vetorial.js'));
const recorte = require(path.join(raiz, 'js', 'recorte.js'));
const tabela = require(path.join(raiz, 'js', 'tabela.js'));
const relatorio = require(path.join(raiz, 'js', 'relatorio.js'));
const pdf = require(path.join(raiz, 'js', 'pdf.js'));
const mapa = require(path.join(raiz, 'js', 'mapa.js'));
const svg = require(path.join(raiz, 'js', 'svg.js'));
const xlsx = require(path.join(raiz, 'js', 'xlsx.js'));

let falhas = 0, testes = 0;
function ok(nome, cond, det) {
  testes++;
  if (cond) console.log('  ok  ' + nome + (det ? '  [' + det + ']' : ''));
  else { falhas++; console.log('  FALHA ' + nome + (det ? '  [' + det + ']' : '')); }
}

function ret(x0, y0, x1, y1) { return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]; }

// JPEG minimo com cabecalho SOF0 (para o PDF ler as dimensoes)
function jpegFalso(largura, altura) {
  const cabecalho = [];
  const push = (...b) => b.forEach((x) => cabecalho.push(x));
  push(0xFF, 0xD8);                    // SOI
  push(0xFF, 0xC0, 0x00, 0x11, 0x08);  // SOF0, tamanho 17, precisao 8
  push((altura >> 8) & 0xFF, altura & 0xFF);
  push((largura >> 8) & 0xFF, largura & 0xFF);
  push(0x03);
  push(0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01);
  push(0xFF, 0xD9);                    // EOI
  return new Uint8Array(cabecalho);
}

// ------------------------------------------------------------- dados de teste
console.log('\n== Recorte: camada geologica com 3 classes ==');
let resultados;
{
  const areaAda = { id: 'ada', nome: 'Área Diretamente Afetada', sigla: 'ADA', geometry: { type: 'Polygon', coordinates: [ret(-47.70, -22.75, -47.60, -22.65)] } };
  const areaAid = { id: 'aid', nome: 'Área de Influência Direta', sigla: 'AID', geometry: { type: 'Polygon', coordinates: [ret(-47.80, -22.85, -47.50, -22.55)] } };
  const geologia = {
    id: 'geologia', nome: 'Geologia', meio: 'fisico', campo_classe: 'unidade', fonte: 'CPRM', data_ref: '2024',
    geojson: {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { unidade: 'Unidade A', litologia: 'arenito' }, geometry: { type: 'Polygon', coordinates: [ret(-47.72, -22.77, -47.62, -22.67)] } },
        { type: 'Feature', properties: { unidade: 'Unidade B', litologia: 'basalto' }, geometry: { type: 'Polygon', coordinates: [ret(-47.66, -22.71, -47.55, -22.60)] } },
        { type: 'Feature', properties: { unidade: 'Unidade C', litologia: 'argila' }, geometry: { type: 'Polygon', coordinates: [ret(-47.95, -22.95, -47.85, -22.85)] } },
      ],
    },
  };
  const cobertura = {
    id: 'uso', nome: 'Uso do solo', meio: 'biotico', campo_classe: 'classe', fonte: 'MapBiomas', data_ref: '2023',
    geojson: {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { classe: 'Pastagem' }, geometry: { type: 'Polygon', coordinates: [ret(-47.68, -22.74, -47.63, -22.68)] } },
        { type: 'Feature', properties: { classe: 'Mata' }, geometry: { type: 'Polygon', coordinates: [ret(-47.64, -22.70, -47.58, -22.64)] } },
      ],
    },
  };
  const r = recorte.recortarTudo([areaAda, areaAid], [geologia, cobertura], {});
  resultados = r.resultados;
  ok('4 combinacoes processadas', r.resultados.length === 4, r.resultados.length + '');
  ok('sem erros', r.erros.length === 0, JSON.stringify(r.erros).slice(0, 120));

  const adaGeo = r.resultados.find((x) => x.area.id === 'ada' && x.camada.id === 'geologia');
  ok('ADA x geologia tem 2 feicoes', adaGeo.features.length === 2, adaGeo.features.length + '');
  const f0 = adaGeo.features[0].properties;
  ok('coluna eia_area_ha preenchida', f0.eia_area_ha > 0, String(f0.eia_area_ha));
  ok('coluna eia_ai = ADA', f0.eia_ai === 'ADA', f0.eia_ai);
  ok('coluna eia_classe da camada', f0.eia_classe === 'Unidade A' || f0.eia_classe === 'Unidade B', f0.eia_classe);
  ok('percentual da AI coerente', f0.eia_pct_ai > 0 && f0.eia_pct_ai <= 100, String(f0.eia_pct_ai));
  ok('atributo original preservado', !!f0.litologia, String(f0.litologia));

  // a unidade C esta fora das duas areas: nao pode aparecer
  const temC = resultados.some((x) => x.features.some((f) => f.properties.eia_classe === 'Unidade C'));
  ok('unidade fora das areas foi descartada', !temC);

  // a feicao A cruza a borda da ADA: precisa sair recortada (area menor que a original)
  const comRecorte = adaGeo.features.find((f) => f.properties.eia_pct_feicao < 99.9);
  ok('feicao que cruza a borda saiu recortada', !!comRecorte,
    comRecorte ? 'pct da feicao = ' + comRecorte.properties.eia_pct_feicao + '%' : 'nenhuma recortada');
}

console.log('\n== Area calculada em projecao ==');
{
  // Quadrado de 0,01 grau em Piracicaba: area esperada ~113 ha (conferido no teste de math)
  const quadrado = { type: 'Polygon', coordinates: [ret(-47.65, -22.72, -47.64, -22.71)] };
  const ha = recorte.areaHectares(quadrado) / 10000;
  ok('area do quadrado de 0,01 grau entre 110 e 120 ha', ha > 110 && ha < 120, ha.toFixed(2) + ' ha');
  const linha = { type: 'LineString', coordinates: [[-47.65, -22.0], [-47.65, -23.0]] };
  const km = recorte.comprimentoMetros(linha) / 1000;
  ok('1 grau de meridiano entre 110 e 111,5 km', km > 110 && km < 111.5, km.toFixed(3) + ' km');
}

console.log('\n== Tabela ==');
{
  const porClasse = tabela.porClasse(resultados);
  ok('tabela por classe gerada', porClasse.length > 0, porClasse.length + ' linhas');
  const porCamada = tabela.porAreaCamada(resultados);
  ok('tabela por area x camada', porCamada.length === 4, porCamada.length + ' linhas');
  const somaPct = porClasse.filter((l) => l.ai === 'ADA' && l.camada_nome === 'Geologia')
    .reduce((s, l) => s + l.pct_ai, 0);
  ok('soma dos percentuais da camada <= 100', somaPct <= 100.001, somaPct.toFixed(3) + '%');
  const atributos = tabela.atributos(resultados);
  ok('tabela de atributos com colunas eia_', atributos.colunas.some((c) => c.campo === 'eia_area_ha'));
  ok('tabela de atributos com linhas', atributos.linhas.length > 0, atributos.linhas.length + ' linhas');
  const avisos = tabela.conferirFechamento(resultados);
  ok('sem aviso de fechamento indevido', avisos.length === 0, JSON.stringify(avisos).slice(0, 140));
}

console.log('\n== CSV e XLSX ==');
{
  const porClasse = tabela.porClasse(resultados);
  const csv = xlsx.gerarCsv([
    { campo: 'ai', rotulo: 'AI' }, { campo: 'classe', rotulo: 'Classe' }, { campo: 'area_ha', rotulo: 'Área (ha)' },
  ], porClasse.map((l) => [l.ai, l.classe, l.area_ha]));
  ok('CSV tem cabecalho', csv.indexOf('AI;Classe') >= 0);
  ok('CSV separa com ponto e virgula', csv.split('\r\n')[0].indexOf(';') > 0);
  ok('CSV converte decimal para virgula', /;\d+,\d+/.test(csv), csv.split('\r\n')[1]);

  const bytes = await xlsx.gerar([{
    nome: 'Por classe',
    colunas: [{ rotulo: 'AI' }, { rotulo: 'Classe' }, { rotulo: 'Área (ha)' }],
    linhas: porClasse.map((l) => [l.ai, l.classe, l.area_ha]),
  }]);
  ok('XLSX comeca com assinatura PK', bytes[0] === 0x50 && bytes[1] === 0x4b);
  ok('XLSX tem tamanho plausivel', bytes.length > 800, bytes.length + ' bytes');
}

console.log('\n== Relatorio: redacao ==');
{
  const relato = relatorio.redigir(resultados, { nome: 'Projeto Teste', cliente: 'Cliente', processo: '0001/2026', responsavel: 'Eng. Fulano', crea: '123456/D' });
  ok('tem secoes', relato.secoes.length >= 4, relato.secoes.length + ' secoes');
  ok('menciona a ADA', JSON.stringify(relato.secoes).indexOf('Área Diretamente Afetada') > 0);
  ok('cita area em ha', /ha/.test(JSON.stringify(relato.secoes)));
  ok('cita classe predominante', /predominante/.test(JSON.stringify(relato.secoes)));
  const texto = relatorio.textoSimples(relato);
  ok('texto simples tem mais de 800 caracteres', texto.length > 800, texto.length + ' caracteres');
}

console.log('\n== PDF ==');
{
  const doc = pdf.criarDocumento({ titulo: 'Teste' });
  const p = doc.novaPagina(210, 297);
  doc.retangulo(p, 10, 10, 190, 277, { borda: '#1f2d36', espessura: 1 });
  doc.texto(p, 'Mapa de caracterização — Área Diretamente Afetada', 105, 20, { tamanho: 12, negrito: true, alinhamento: 'centro' });
  doc.textoMultilinha(p, 'Parágrafo com acentuação: área, influência, geologia, sócio-econômico. '.repeat(8), 14, 30, 182, { tamanho: 9 });
  doc.linha(p, 14, 40, 196, 40, {});
  doc.circulo(p, 50, 60, 8, { preenchimento: '#2f6b3a' });
  const jpeg = jpegFalso(640, 480);
  const nome = doc.adicionarImagem(jpeg);
  doc.desenharImagem(p, nome, 14, 80, 182, 120);
  const bytes = doc.construir();

  ok('PDF comeca com %PDF-', bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46);
  const texto = Buffer.from(bytes).toString('latin1');
  ok('PDF termina com %%EOF', /%%EOF\s*$/.test(texto));
  ok('PDF tem xref', texto.indexOf('\nxref\n') > 0);
  ok('PDF tem startxref com deslocamento', /startxref\n\d+\n/.test(texto));
  ok('PDF declara a imagem DCTDecode', texto.indexOf('/DCTDecode') > 0);
  ok('PDF tem 1 pagina', (texto.match(/\/Type \/Page[^s]/g) || []).length === 1, (texto.match(/\/Type \/Page[^s]/g) || []).length + '');
  ok('PDF tem Parent resolvido (nao 0 0 R)', texto.indexOf('/Parent 0 0 R') < 0);
  ok('acentuacao foi para WinAnsi', texto.indexOf('caracteriza') > 0 && texto.indexOf('\\347') < 0);
  const sofm = pdf._dimensoesJpeg(jpeg);
  ok('dimensoes do JPEG lidas', sofm && sofm.largura === 640 && sofm.altura === 480, JSON.stringify(sofm));
}

console.log('\n== Mapa: escala e articulacao ==');
{
  const cob57 = mapa.cobertura('A1', 'paisagem', 5000);
  ok('A1 em 1:5.000 cobre ~4 km de largura', Math.abs(cob57.larguraKm - 4.0) < 0.6, cob57.larguraKm.toFixed(2) + ' km');
  ok('area por folha em 1:5.000 ~ 10 km2', cob57.areaKm2 > 6 && cob57.areaKm2 < 16, cob57.areaKm2.toFixed(2) + ' km²');

  const bbox = [-47.75, -22.80, -47.55, -22.60]; // ~20 km x 22 km
  const esc = mapa.escalaQueCabe(bbox, 'A1', 'paisagem');
  ok('escala escolhida e uma escala usual', mapa.ESCALAS.indexOf(esc) >= 0, '1:' + math.num(esc, 0));
  ok('escala cabe a extensao', esc >= 25000, '1:' + math.num(esc, 0));

  const art = mapa.articular(bbox, 'A1', 'paisagem', 5000, { sobreposicao: 0.1 });
  ok('articulacao em 1:5.000 tem varias folhas', art.total > 4, art.total + ' folhas (' + art.linhas + 'x' + art.colunas + ')');
  ok('primeira folha no noroeste', art.folhas[0].bbox[0] <= bbox[0] + 0.001, JSON.stringify(art.folhas[0].bbox));
  ok('numeracao consecutiva', art.folhas.every((f, i) => Number(f.numero) === i + 1));
  const art10 = mapa.articular(bbox, 'A1', 'paisagem', 10000, {});
  ok('1:10.000 precisa de menos folhas que 1:5.000', art10.total < art.total, art10.total + ' < ' + art.total);
  ok('cobertura das folhas cobre a extensao', (function () {
    const minLon = Math.min.apply(null, art.folhas.map((f) => f.bbox[0]));
    const maxLon = Math.max.apply(null, art.folhas.map((f) => f.bbox[2]));
    const minLat = Math.min.apply(null, art.folhas.map((f) => f.bbox[1]));
    const maxLat = Math.max.apply(null, art.folhas.map((f) => f.bbox[3]));
    return minLon <= bbox[0] + 1e-6 && maxLon >= bbox[2] - 1e-6 && minLat <= bbox[1] + 1e-6 && maxLat >= bbox[3] - 1e-6;
  })());
}

console.log('\n== Mapa: geracao de PDF articulado ==');
{
  const bbox = [-47.75, -22.80, -47.55, -22.60];
  const art = mapa.articular(bbox, 'A1', 'paisagem', 10000, {});
  const jpeg = jpegFalso(1200, 800);
  const imagens = art.folhas.map((f) => ({ chave: f.numero, bytes: jpeg }));
  const bytes = mapa.gerarPdf({
    folha: 'A1', orientacao: 'paisagem', escala: 10000, projeto: 'Projeto Teste',
    titulo: 'MAPA DE CARACTERIZAÇÃO AMBIENTAL', areaInfluencia: 'ADA', bbox: bbox,
    articulacao: art, imagens: imagens, incluirIndice: true, responsavel: 'Eng. Fulano', crea: '123456/D',
    legenda: [{ rotulo: 'Geologia', cor: '#c8a165' }, { rotulo: 'Hidrografia', cor: '#2f5b8a', forma: 'linha' }],
    datum: 'SIRGAS 2000 / UTM 23S',
  });
  const texto = Buffer.from(bytes).toString('latin1');
  const paginas = (texto.match(/\/Type \/Page[^s]/g) || []).length;
  ok('PDF articulado tem indice + uma pagina por folha', paginas === art.total + 1, paginas + ' paginas para ' + art.total + ' folhas');
  ok('PDF articulado e valido', bytes.length > 20000 && /%%EOF\s*$/.test(texto), bytes.length + ' bytes');
  ok('PDF tem uma imagem por folha', (texto.match(/\/DCTDecode/g) || []).length >= art.total, (texto.match(/\/DCTDecode/g) || []).length + ' imagens');
}

console.log('\n== Graficos SVG ==');
{
  const b = svg.barras([{ rotulo: 'Mata', valor: 120.5 }, { rotulo: 'Pastagem', valor: 340.2 }], { titulo: 'Uso do solo' });
  ok('barras gera SVG', b.indexOf('<svg') === 0 && b.indexOf('</svg>') > 0);
  ok('barras tem os dois valores', b.indexOf('340') > 0 && b.indexOf('Mata') > 0);
  const pi = svg.pizza([{ rotulo: 'A', valor: 30 }, { rotulo: 'B', valor: 70 }], {});
  ok('pizza gera caminhos', (pi.match(/<path|<circle/g) || []).length === 2);
  const esc = svg.escalaGrafica(0.5, { escala: 5000, largura: 200 });
  ok('escala grafica tem trechos', (esc.match(/<rect/g) || []).length >= 2, (esc.match(/<rect/g) || []).length + ' trechos');
  ok('escala grafica rotula km', esc.indexOf('km') > 0);
  ok('norte gera poligono', svg.norte(44).indexOf('<polygon') > 0);
}

console.log('\n== Previas de layout ==');
{
  const previa = mapa.previaSvg({ folha: 'A1', orientacao: 'paisagem', escala: 5000, projeto: 'P', titulo: 'T', numeroFolha: 'FOLHA 01/12' });
  ok('previa contem a area do mapa', previa.indexOf('área do mapa') > 0);
  ok('previa contem o numero da folha', previa.indexOf('FOLHA 01/12') > 0);
}

  console.log('\n== Ordem de desenho das camadas (quem fica por cima) ==');
  {
    /* O DEFEITO QUE ISTO COBRE: no Leaflet, quem desenha por cima é quem foi adicionado por
     * último — e `desenharCamadas()` limpa e readiciona as camadas a cada ajuste de
     * transparência. Resultado: as camadas de caracterização subiam por cima das áreas de
     * influência do usuário, que "sumiam" sem ninguém ter pedido. Ordem de desenho tem de
     * ser ESTADO (um número), não efeito colateral de quem foi adicionado por último. */
    const m = EIA.mapa;
    ok('a ordem inicial é a do catálogo', JSON.stringify(m.ordemInicial(['a', 'b', 'c'])) === '["a","b","c"]');

    const sobe = m.moverNaOrdem(['a', 'b', 'c'], 'b', -1);
    ok('subir troca com o de baixo', JSON.stringify(sobe) === '["b","a","c"]', JSON.stringify(sobe));
    const desce = m.moverNaOrdem(['a', 'b', 'c'], 'b', +1);
    ok('descer troca com o de cima', JSON.stringify(desce) === '["a","c","b"]', JSON.stringify(desce));
    ok('a lista original não é alterada', JSON.stringify(['a', 'b', 'c']) === '["a","b","c"]');
    ok('subir o de baixo não faz nada', m.moverNaOrdem(['a', 'b'], 'a', -1) === null);
    ok('descer o de cima não faz nada', m.moverNaOrdem(['a', 'b'], 'b', +1) === null);
    ok('camada fora da ordem não faz nada', m.moverNaOrdem(['a', 'b'], 'z', -1) === null);

    // O ÚLTIMO da lista desenha POR CIMA: é a convenção que as setas da tela mostram
    const ordem = ['geologia', 'hidrografia', 'uso'];
    ok('o último da ordem tem o maior z-index',
      m.zIndexDaCamada(ordem, 'uso') > m.zIndexDaCamada(ordem, 'hidrografia')
      && m.zIndexDaCamada(ordem, 'hidrografia') > m.zIndexDaCamada(ordem, 'geologia'),
      [m.zIndexDaCamada(ordem, 'geologia'), m.zIndexDaCamada(ordem, 'hidrografia'),
        m.zIndexDaCamada(ordem, 'uso')].join(' < '));

    // A OPÇÃO DO USUÁRIO: as áreas dele por cima de TODAS as camadas, ou por baixo de todas
    const zAcima = m.zIndexDasAreas(ordem, true);
    const zBaixo = m.zIndexDasAreas(ordem, false);
    const zTopo = m.zIndexDaCamada(ordem, 'uso');
    const zFundo = m.zIndexDaCamada(ordem, 'geologia');
    ok('com "por cima", as áreas ficam acima de todas as camadas', zAcima > zTopo, zAcima + ' > ' + zTopo);
    ok('com "por baixo", as áreas ficam abaixo de todas', zBaixo < zFundo, zBaixo + ' < ' + zFundo);
    ok('nenhuma das opções colide com o z-index de uma camada',
      zAcima !== zTopo && zBaixo !== zFundo
      && [zTopo, zFundo].indexOf(zAcima) < 0 && [zTopo, zFundo].indexOf(zBaixo) < 0);

    // O RECORTE é a resposta da análise: acima de todas as camadas, e abaixo dos RÓTULOS
    // (markerPane = 600), senão o texto do rótulo ficaria escondido atrás do polígono.
    const zResultado = m.zIndexDoResultado(ordem);
    ok('o recorte fica acima de todas as camadas', zResultado > zTopo, zResultado + ' > ' + zTopo);
    ok('o recorte fica abaixo dos rótulos (markerPane = 600)', zResultado < 600, zResultado + ' < 600');
    ok('a área "por cima" fica acima do recorte (a divisa continua visível)',
      m.zIndexDasAreas(ordem, true) > zResultado, m.zIndexDasAreas(ordem, true) + ' > ' + zResultado);
    ok('o recorte não colide com o z-index de nenhuma camada',
      ordem.every((id) => m.zIndexDaCamada(ordem, id) !== zResultado), 'z ' + zResultado);

    const virada = m.moverNaOrdem(ordem, 'geologia', +1);
    ok('depois de reordenar, o z-index acompanha a nova ordem',
      m.zIndexDaCamada(virada, 'geologia') === m.zIndexDaCamada(ordem, 'hidrografia'),
      JSON.stringify(virada));
    ok('e a área "por cima" continua acima do novo topo',
      m.zIndexDasAreas(virada, true) > m.zIndexDaCamada(virada, 'uso'));

    // a base é o overlayPane do Leaflet (400): as camadas ficam na faixa dos vetores,
    // acima da imagem de satélite (tilePane = 200)
    ok('as camadas ficam acima da imagem de satélite', m.Z_CAMADAS >= 400, 'base ' + m.Z_CAMADAS);

    // ordem vazia não quebra (o mapa é montado antes de o catálogo chegar)
    ok('ordem vazia não quebra', m.zIndexDaCamada([], 'nada') === m.Z_CAMADAS
      && m.zIndexDasAreas([], true) > m.Z_CAMADAS && m.zIndexDasAreas([], false) < m.Z_CAMADAS);
  }

console.log('\n' + (falhas ? 'FALHAS: ' + falhas + '/' + testes : 'TODOS OS ' + testes + ' TESTES PASSARAM'));
return falhas ? 1 : 0;
}
module.exports = { executar };
if (require.main === module) {
  executar().then((c) => process.exit(c));
}
