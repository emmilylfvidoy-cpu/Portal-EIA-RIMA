'use strict';
/* ============================================================================
 * verificar_docx.js — o relatório em .docx
 *
 * O teste ABRE o arquivo gerado de volta, com o próprio leitor de ZIP do portal, e confere:
 *  - as partes que o Word exige existem;
 *  - os VALORES de área e o percentual estão no documento (era o pedido do cliente);
 *  - o texto vindo de arquivo de terceiro entra ESCAPADO (nome com & e < não pode quebrar o XML);
 *  - caractere de controle é removido (o Word abre como "corrompido" se ele passar);
 *  - o XML tem as tags balanceadas.
 *
 * Uso: node tools/verificacoes/verificar_docx.js
 * ========================================================================== */
function executar() {
  const path = require('path');
  const raiz = path.resolve(__dirname, '..', '..');
  const EIA = {
    math: require(path.join(raiz, 'js', 'math.js')),
    xlsx: require(path.join(raiz, 'js', 'xlsx.js')),
    tabela: require(path.join(raiz, 'js', 'tabela.js')),
    shapelib: require(path.join(raiz, 'js', 'shapelib.js')),
    vetorial: require(path.join(raiz, 'js', 'vetorial.js')),
  };
  global.EIA = EIA;
  const docx = require(path.join(raiz, 'js', 'docx.js'));

  let falhas = 0, testes = 0;
  function ok(nome, condicao, detalhe) {
    testes++;
    if (condicao) console.log('  ok  ' + nome + (detalhe ? '  [' + detalhe + ']' : ''));
    else { falhas++; console.log('  FALHA ' + nome + (detalhe ? '  [' + detalhe + ']' : '')); }
  }

  // O nome da classe e da camada vêm de arquivo de terceiro: testados com os caracteres que quebram XML
  const camada = { id: 'geologia', nome: 'Geologia & Solos <SP>', tipo: 'poligono' };
  const resultados = [
    {
      camada: camada,
      relatorio: { ai: 'ADA', ai_nome: 'Área de Influência Direta', ai_area_ha: 1434.5, area_total_ha: 648.25 },
      features: [
        { type: 'Feature', properties: { eia_classe: 'Argissolo & Vermelho <úmido>', eia_area_ha: 300.25 }, geometry: null },
        { type: 'Feature', properties: { eia_classe: 'Argissolo & Vermelho <úmido>', eia_area_ha: 200 }, geometry: null },
        // caractere de controle no meio do texto (o .dbf antigo tem): o XML não aceita
        { type: 'Feature', properties: { eia_classe: 'Latossolo\u0007Amarelo', eia_area_ha: 148 }, geometry: null },
      ],
    },
    {
      camada: { id: 'biomas', nome: 'Biomas', tipo: 'poligono' },
      relatorio: { ai: 'ADA', ai_nome: 'Área de Influência Direta', ai_area_ha: 1434.5, area_total_ha: 120 },
      features: [{ type: 'Feature', properties: { eia_classe: 'Mata Atlântica', eia_area_ha: 120 }, geometry: null }],
    },
  ];
  const relato = {
    secoes: [
      { titulo: '1. Identificação', paragrafos: ['Projeto teste & Cia.', 'Responsável: Eng. Teste'] },
      { titulo: '2. Metodologia', paragrafos: ['Recorte por interseção, sem alterar a feição.'] },
    ],
  };

  const bytes = docx.gerarDocx(relato, resultados, {
    titulo: 'Relatório de caracterização', projeto: { nome: 'Projeto <Tamoios>', cliente: 'Cliente & Cia', responsavel: 'Eng. Teste', crea: '000000/D' },
    data: '01/01/2026',
  }).then ? null : null;   // a função é assíncrona: tratada abaixo

  return (async () => {
    const arquivo = await docx.gerarDocx(relato, resultados, {
      titulo: 'Relatório de caracterização',
      projeto: { nome: 'Projeto <Tamoios>', cliente: 'Cliente & Cia', responsavel: 'Eng. Teste', crea: '000000/D' },
      data: '01/01/2026',
    });
    void bytes;

    console.log('\n== o arquivo é um ZIP válido e tem as partes que o Word exige ==');
    ok('começa com PK (assinatura de ZIP)', arquivo[0] === 0x50 && arquivo[1] === 0x4B,
      String.fromCharCode(arquivo[0], arquivo[1]));
    const entradas = await EIA.shapelib.abrirZip(arquivo.buffer.slice(arquivo.byteOffset, arquivo.byteOffset + arquivo.byteLength));
    const nomes = entradas.map((e) => e.nome);
    for (const parte of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'docProps/core.xml']) {
      ok('tem ' + parte, nomes.indexOf(parte) >= 0);
    }
    const texto = (nome) => {
      const e = entradas.find((x) => x.nome === nome);
      return e ? new TextDecoder('utf-8').decode(e.bytes) : '';
    };
    const doc = texto('word/document.xml');

    console.log('\n== os valores de área e o percentual estão no documento ==');
    ok('o texto do relatório entrou', doc.indexOf('2. Metodologia') >= 0);
    // Argissolo & Vermelho = 300,25 + 200 = 500,25 ha (a tabela de classe soma as feições)
    ok('a área da classe entrou (soma das feições)', doc.indexOf(EIA.math.num(500.25, 2)) >= 0,
      'procurando ' + EIA.math.num(500.25, 2));
    // total recortado = 500,25 + 148 + 120 = 768,25 ha
    ok('o total recortado entrou', doc.indexOf(EIA.math.num(768.25, 2)) >= 0,
      'procurando ' + EIA.math.num(768.25, 2));
    ok('o percentual entrou', doc.indexOf('%') >= 0);
    ok('a área da AI entrou na tabela de totais (vem do resultado, não da linha)', doc.indexOf(EIA.math.num(1434.5, 2)) >= 0,
      'procurando ' + EIA.math.num(1434.5, 2));
    ok('nenhum campo saiu vazio ou NaN', doc.indexOf('NaN') < 0 && doc.indexOf('undefined') < 0);
    ok('o nome da área de influência entrou', doc.indexOf('Área de Influência Direta') >= 0);

    console.log('\n== texto de terceiro NÃO quebra o XML ==');
    ok('o & virou &amp;', doc.indexOf('Argissolo &amp; Vermelho &lt;úmido&gt;') >= 0);
    ok('não sobrou & cru', doc.indexOf(' & ') < 0, 'ocorrências de " & ": ' + (doc.split(' & ').length - 1));
    ok('o < da camada virou &lt;', doc.indexOf('Geologia &amp; Solos &lt;SP&gt;') >= 0);
    ok('o título do projeto também foi escapado', doc.indexOf('Projeto &lt;Tamoios&gt;') >= 0);

    console.log('\n== caractere de controle ==');
    ok('o \\u0007 foi REMOVIDO (o Word recusaria o arquivo)', doc.indexOf('\u0007') < 0
      && doc.indexOf('LatossoloAmarelo') >= 0);

    console.log('\n== as tags estão balanceadas ==');
    for (const tag of ['w:p', 'w:tbl', 'w:tr', 'w:tc', 'w:r']) {
      const abre = (doc.match(new RegExp('<' + tag + '[ >]', 'g')) || []).length;
      const fecha = (doc.match(new RegExp('</' + tag + '>', 'g')) || []).length;
      ok('<' + tag + '> abre e fecha igual', abre === fecha && abre > 0, abre + ' / ' + fecha);
    }
    ok('o XML começa com a declaração', doc.indexOf('<?xml version="1.0" encoding="UTF-8"') === 0);
    ok('o documento fecha com </w:document>', /<\/w:document>$/.test(doc.trim()));

    console.log('\n== estilos e propriedades ==');
    const est = texto('word/styles.xml');
    ok('os estilos usados estão declarados',
      ['Titulo', 'Subtitulo', 'Celula', 'Nota', 'Normal'].every((s) => est.indexOf('w:styleId="' + s + '"') >= 0));
    const nucleo = texto('docProps/core.xml');
    ok('o título foi para as propriedades do arquivo', nucleo.indexOf('Relatório de caracterização') >= 0);
    ok('a data de criação está no formato do Word', /dcterms:created[^>]*>\d{4}-\d{2}-\d{2}T/.test(nucleo));

    console.log('\n== caso vazio, para não quebrar quando não há resultado ==');
    {
      const vazio = await docx.gerarDocx({ secoes: [] }, [], {});
      ok('gera arquivo mesmo sem resultados', vazio.length > 400, vazio.length + ' bytes');
      const e2 = await EIA.shapelib.abrirZip(vazio.buffer.slice(vazio.byteOffset, vazio.byteOffset + vazio.byteLength));
      ok('e o ZIP abre', e2.some((x) => x.nome === 'word/document.xml'));
    }

    console.log('\n' + (falhas ? 'FALHAS: ' + falhas + '/' + testes : 'TODOS OS ' + testes + ' TESTES PASSARAM'));
    return falhas ? 1 : 0;
  })();
}

module.exports = { executar };
if (require.main === module) executar().then((c) => process.exit(c));
