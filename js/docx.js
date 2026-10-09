'use strict';
/* ============================================================================
 * docx.js — o relatório em .docx (Word), escrito à mão
 *
 * Um .docx é um ZIP com XML dentro. O portal já escreve ZIP (js/xlsx.js), então não há
 * biblioteca externa aqui — só as partes que o Word exige:
 *
 *   [Content_Types].xml          diz o que é cada arquivo
 *   _rels/.rels                  diz qual é o documento principal
 *   word/document.xml            o texto e a tabela
 *   word/styles.xml              os estilos usados (título, subtítulo, tabela)
 *
 * DOIS CUIDADOS QUE FAZEM O WORD RECUSAR O ARQUIVO QUANDO FALTAM:
 *  - todo & < > " do texto vira entidade (&amp; &lt; &gt; &quot;). Nome de classe e de município
 *    vem de arquivo de terceiro, então isso não é detalhe;
 *  - caractere de controle (o .dbf do IBGE tem) é REMOVIDO: o XML não aceita, e o Word abre o
 *    arquivo como "corrompido" sem explicar.
 * ========================================================================== */
(function (raiz, fabrica) {
  const api = fabrica(
    typeof module === 'object' && module.exports
      ? { xlsx: require('./xlsx.js'), tabela: require('./tabela.js'), math: require('./math.js') }
      : { xlsx: raiz.EIA.xlsx, tabela: raiz.EIA.tabela, math: raiz.EIA.math }
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (raiz) { raiz.EIA = raiz.EIA || {}; raiz.EIA.docx = api; }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : null), function (EIA) {
  'use strict';

  const MAX_LINHAS = 500;   // relatório não é planilha; o resto vai para o XLSX

  function escapar(v) {
    return String(v === null || v === undefined ? '' : v)
      // tira os caracteres que o XML não aceita (controle), preservando tabulação e quebra
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function paragrafo(texto, estilo) {
    return '<w:p><w:pPr><w:pStyle w:val="' + estilo + '"/></w:pPr>'
      + '<w:r><w:t xml:space="preserve">' + escapar(texto) + '</w:t></w:r></w:p>';
  }

  function celula(texto, largura, negrito) {
    return '<w:tc><w:tcPr><w:tcW w:w="' + largura + '" w:type="dxa"/>'
      + (negrito ? '<w:shd w:val="clear" w:fill="EEF2F5"/>' : '')
      + '</w:tcPr><w:p><w:pPr><w:pStyle w:val="Celula"/></w:pPr><w:r>'
      + (negrito ? '<w:rPr><w:b/></w:rPr>' : '')
      + '<w:t xml:space="preserve">' + escapar(texto) + '</w:t></w:r></w:p></w:tc>';
  }

  function tabela(cabecalhos, linhas, larguras) {
    const borda = '<w:tblBorders>'
      + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
        .map((l) => '<w:' + l + ' w:val="single" w:sz="4" w:space="0" w:color="B9C6CF"/>').join('')
      + '</w:tblBorders>';
    const cab = '<w:tr>' + cabecalhos.map((h, i) => celula(h, larguras[i], true)).join('') + '</w:tr>';
    const corpo = linhas.map((l) => '<w:tr>' + l.map((c, i) => celula(c, larguras[i], false)).join('') + '</w:tr>').join('');
    return '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>' + borda + '</w:tblPr>'
      + cab + corpo + '</w:tbl>' + paragrafo('', 'Normal');
  }

  function estilos() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>'
      + '<w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>'
      + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
      + '<w:style w:type="paragraph" w:styleId="Titulo"><w:name w:val="Titulo"/>'
      + '<w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>'
      + '<w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>'
      + '<w:style w:type="paragraph" w:styleId="Subtitulo"><w:name w:val="Subtitulo"/>'
      + '<w:pPr><w:spacing w:before="200" w:after="80"/></w:pPr>'
      + '<w:rPr><w:b/><w:sz w:val="24"/><w:color w:val="1F4E5A"/></w:rPr></w:style>'
      + '<w:style w:type="paragraph" w:styleId="Celula"><w:name w:val="Celula"/>'
      + '<w:pPr><w:spacing w:before="20" w:after="20"/></w:pPr>'
      + '<w:rPr><w:sz w:val="18"/></w:rPr></w:style>'
      + '<w:style w:type="paragraph" w:styleId="Nota"><w:name w:val="Nota"/>'
      + '<w:rPr><w:i/><w:sz w:val="18"/><w:color w:val="5A6B75"/></w:rPr></w:style>'
      + '</w:styles>';
  }

  function tipos() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
      + '</Types>';
  }

  /**
   * O relatório em .docx.
   * relato = { secoes: [{ titulo, paragrafos }] }
   * resultados = o que saiu do recorte (a mesma lista que alimenta a tabela e o PDF)
   */
  async function gerarDocx(relato, resultados, opcoes) {
    const o = opcoes || {};
    const projeto = o.projeto || {};
    const partes = [];
    const corpo = [];

    corpo.push(paragrafo(o.titulo || 'Relatório de caracterização ambiental', 'Titulo'));
    const linhaProjeto = [projeto.nome, projeto.cliente].filter((x) => x && String(x).trim()).join(' — ');
    if (linhaProjeto) corpo.push(paragrafo(linhaProjeto, 'Nota'));
    const responsavel = [projeto.responsavel, projeto.crea ? 'CREA ' + projeto.crea : '']
      .filter((x) => x && String(x).trim()).join(' · ');
    if (responsavel) corpo.push(paragrafo(responsavel, 'Nota'));
    if (o.data) corpo.push(paragrafo('Gerado em ' + o.data, 'Nota'));

    for (const secao of (relato && relato.secoes) || []) {
      corpo.push(paragrafo(secao.titulo || '', 'Subtitulo'));
      for (const p of secao.paragrafos || []) corpo.push(paragrafo(p, 'Normal'));
    }

    /* A TABELA: é aqui que os valores de área e o percentual ficam no documento — o pedido do
     * cliente era justamente ter o número, não só a frase. Sai a mesma conta da tela. */
    const linhas = EIA.tabela.porClasse(resultados || []);
    if (linhas.length) {
      corpo.push(paragrafo('Área e percentual por classe', 'Subtitulo'));
      const larguras = [1800, 2200, 2600, 1300, 1100, 900];
      const dados = linhas.slice(0, MAX_LINHAS).map((l) => [
        String(l.ai_nome || ''),
        String(l.camada_nome || ''),
        String(l.classe || ''),
        EIA.math.num(l.area_ha, 2),
        EIA.math.num(l.pct_ai, 2) + '%',
        String(l.feicoes === undefined ? '' : l.feicoes),
      ]);
      corpo.push(tabela(['Área de influência', 'Camada', 'Classe', 'Área (ha)', '% da AI', 'Feições'],
        dados, larguras));
      if (linhas.length > MAX_LINHAS) {
        corpo.push(paragrafo('A tabela mostra as ' + MAX_LINHAS + ' primeiras de ' + linhas.length
          + ' linhas. A lista completa sai na planilha (.xlsx).', 'Nota'));
      }
    }

    /* SOMATÓRIO POR ÁREA DE INFLUÊNCIA: o número que fecha o relatório.
     *
     * A ÁREA DA AI NÃO VEM DA LINHA DA TABELA. A linha traz a sigla e o nome da área, mas não a
     * área dela — a área é do RESULTADO do recorte. Ler `l.area_ai_ha` (que não existe) dava
     * coluna vazia e percentual "—", e foi o teste que pegou: justamente o valor que o cliente
     * pediu para ver no relatório. */
    const aiAreaPorNome = new Map();
    for (const r of (resultados || [])) {
      if (!r || !r.relatorio) continue;
      const chave = r.relatorio.ai_nome || r.relatorio.ai;
      if (chave) aiAreaPorNome.set(chave, Number(r.relatorio.ai_area_ha) || 0);
    }
    const porAi = new Map();
    for (const l of linhas) {
      const chave = l.ai_nome || '(sem área)';
      const atual = porAi.get(chave) || { area: 0, ai: aiAreaPorNome.get(chave) || 0 };
      atual.area += Number(l.area_ha) || 0;
      porAi.set(chave, atual);
    }
    if (porAi.size) {
      corpo.push(paragrafo('Total recortado por área de influência', 'Subtitulo'));
      const dados = Array.from(porAi.entries()).map(([nome, v]) => [
        nome,
        EIA.math.num(v.area, 2),
        EIA.math.num(v.ai, 2),
        v.ai > 0 ? EIA.math.num(v.area / v.ai * 100, 1) + '%' : '—',
      ]);
      corpo.push(tabela(['Área de influência', 'Área recortada (ha)', 'Área da AI (ha)', '% da AI'],
        dados, [3600, 2400, 2400, 1500]));
    }

    const documento = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + '<w:body>' + corpo.join('')
      + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
      + '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>'
      + '</w:body></w:document>';

    const agora = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const nucleo = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
      + ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"'
      + ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
      + '<dc:title>' + escapar(o.titulo || 'Relatório de caracterização ambiental') + '</dc:title>'
      + (projeto.nome ? '<dc:creator>' + escapar(projeto.responsavel || projeto.nome) + '</dc:creator>' : '')
      + '<dcterms:created xsi:type="dcterms:W3CDTF">' + agora + '</dcterms:created>'
      + '</cp:coreProperties>';

    partes.push({ nome: '[Content_Types].xml', texto: tipos() });
    partes.push({ nome: '_rels/.rels', texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
      + '</Relationships>' });
    partes.push({ nome: 'docProps/core.xml', texto: nucleo });
    partes.push({ nome: 'word/document.xml', texto: documento });
    partes.push({ nome: 'word/styles.xml', texto: estilos() });
    partes.push({ nome: 'word/_rels/document.xml.rels', texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '</Relationships>' });

    const zip = await EIA.xlsx.zipar(partes);
    return zip instanceof Uint8Array ? zip : new Uint8Array(zip);
  }

  return { gerarDocx: gerarDocx, MAX_LINHAS: MAX_LINHAS, escapar: escapar };
}));
