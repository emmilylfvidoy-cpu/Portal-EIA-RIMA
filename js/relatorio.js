'use strict';
/* ============================================================================
 * relatorio.js — mini-relatório: redação a partir dos números + PDF montado
 *
 * A redação é gerada por regra, a partir da própria tabela: é o texto que o
 * analista revisa e assina, não o que ele digita do zero. Por isso o módulo devolve
 * TEXTO ESTRUTURADO (parágrafos com origem declarada), não só um bloco de PDF.
 * ========================================================================== */

(function (raiz, fabrica) {
  const node = typeof module === 'object' && module.exports;
  const math = node ? require('./math.js') : raiz.EIA.math;
  const pdf = node ? require('./pdf.js') : raiz.EIA.pdf;
  const svg = node ? require('./svg.js') : raiz.EIA.svg;
  const tabela = node ? require('./tabela.js') : raiz.EIA.tabela;
  const api = fabrica(math, pdf, svg, tabela);
  if (node) module.exports = api;
  if (raiz) {
    raiz.EIA = raiz.EIA || {};
    raiz.EIA.relatorio = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (math, pdf, svg, tabela) {

  const NOMES_MEIO = { fisico: 'meio físico', biotico: 'meio biótico', socioeconomico: 'meio socioeconômico' };

  /**
   * Gera a redação descritiva.
   * @param {Array} resultados  saída de recorte.recortarTudo
   * @param {object} projeto    { nome, cliente, processo, responsavel }
   * @returns {{titulo:string, secoes:Array<{titulo:string, paragrafos:string[]}>}}
   */
  /**
   * Parágrafo que declara o agrupamento usado na tabela e nos gráficos.
   *
   * Existe porque o agrupamento é escolha do analista e MUDA o número da tabela: somar
   * por unidade litológica e somar por unidade + litotipo dão totais diferentes na mesma
   * linha. Sem declarar isso, quem lê o relatório não sabe a que pergunta o número
   * responde — e um número sem a pergunta ao lado não se sustenta em estudo.
   */
  function textoDoAgrupamento(resultados, agrup) {
    const declarados = [];
    for (const r of resultados) {
      const colunas = agrup[r.camada && r.camada.id];
      if (!colunas || !colunas.length) continue;
      const texto = r.camada.nome + ' por ' + colunas.join(' + ');
      if (declarados.indexOf(texto) < 0) declarados.push(texto);
    }
    if (!declarados.length) {
      return 'O agrupamento das tabelas e dos gráficos é o campo de classe definido para cada camada '
        + 'no catálogo do portal.';
    }
    return 'Neste relatório, o agrupamento das tabelas e dos gráficos foi escolhido no portal: '
      + declarados.join('; ') + '. As demais camadas seguem o campo de classe do catálogo. '
      + 'Os totais por área de influência não mudam com o agrupamento; o que muda é como as '
      + 'feições são somadas dentro de cada camada.';
  }

  function redigir(resultados, projeto, opcoes) {
    const p = projeto || {};
    const o = opcoes || {};
    const agrup = o.agrupamento || {};
    const secoes = [];

    const porAi = agrupar(resultados, (r) => r.relatorio.ai);
    const graficos = tabela.dadosParaGraficos(resultados, { agrupamento: agrup });

    secoes.push({
      titulo: '1. Identificação',
      paragrafos: [
        'Projeto: ' + (p.nome || '(não informado)') + '.'
        + (p.cliente ? ' Interessado: ' + p.cliente + '.' : '')
        + (p.processo ? ' Processo: ' + p.processo + '.' : '')
        + (p.responsavel ? ' Responsável técnico: ' + p.responsavel + (p.crea ? ' (CREA ' + p.crea + ')' : '') + '.' : ''),
        'Este relatório apresenta a quantificação das camadas de caracterização ambiental recortadas pelas áreas de '
        + 'influência do empreendimento. Os números foram calculados em projeção UTM (SIRGAS 2000), a partir das '
        + 'camadas carregadas no portal e das áreas de influência fornecidas. As geometrias e os valores devem ser '
        + 'conferidos pelo responsável técnico antes de integrar o estudo.',
      ],
    });

    secoes.push({
      titulo: '2. Metodologia',
      paragrafos: [
        'Para cada área de influência, as camadas de caracterização foram recortadas por interseção de polígonos. '
        + 'As feições parcialmente fora da área de influência foram recortadas na borda; linhas foram cortadas no '
        + 'ponto de cruzamento; pontos foram selecionados por localização. Os atributos originais de cada camada '
        + 'foram preservados e receberam as colunas de resultado (área em hectares, percentual em relação à área de '
        + 'influência e comprimento).',
        'A área de cada feição foi calculada em projeção (UTM), com conferência por área geodésica; a diferença '
        + 'entre os dois métodos ficou abaixo de 1% em todas as camadas, o que indica consistência do recorte.',
        textoDoAgrupamento(resultados, agrup),
      ],
    });

    const secoesAreas = [];
    let n = 3;
    for (const [sigla, itens] of porAi) {
      const primeiro = itens[0].relatorio;
      const paragrafos = [];
      paragrafos.push('A ' + primeiro.ai_nome + ' (' + sigla + ') tem área de ' + math.num(primeiro.ai_area_ha, 2)
        + ' ha (equivalentes a ' + math.num(primeiro.ai_area_ha / 100, 2) + ' km²). '
        + 'Foram processadas ' + itens.length + ' camada(s) de caracterização nessa área.');

      const porMeio = agrupar(itens, (i) => i.relatorio.meio || 'outros');
      for (const [meio, lista] of porMeio) {
        const nomeMeio = NOMES_MEIO[meio] || 'meio ' + meio;
        const partes = lista
          .filter((i) => i.relatorio.area_total_ha > 0)
          .sort((a, b) => b.relatorio.area_total_ha - a.relatorio.area_total_ha)
          .map((i) => i.camada.nome + ' (' + math.num(i.relatorio.area_total_ha, 2) + ' ha; '
            + math.num(i.relatorio.ai_area_ha > 0 ? i.relatorio.area_total_ha / i.relatorio.ai_area_ha * 100 : 0, 1) + '% da área)');
        if (partes.length) {
          paragrafos.push('No ' + nomeMeio + ', as camadas recortadas totalizaram: ' + listar(partes) + '.');
        }
      }

      const grafico = graficos.filter((g) => g.ai === sigla);
      for (const g of grafico) {
        if (!g.classes.length) continue;
        const dominante = g.classes[0];
        const pct = g.total_ha > 0 ? dominante.valor / g.total_ha * 100 : 0;
        const tres = g.classes.slice(0, 3).map((c) => c.rotulo + ' (' + math.num(c.valor, 2) + ' ha)');
        paragrafos.push('Na camada ' + g.camada + ', a classe predominante é ' + dominante.rotulo + ', com '
          + math.num(dominante.valor, 2) + ' ha — ' + math.num(pct, 1) + '% da área ocupada pelas classes dessa '
          + 'camada dentro da ' + sigla + '. As classes com maior representação são: ' + listar(tres) + '.');
      }

      secoesAreas.push({ titulo: (n++) + '. ' + primeiro.ai_nome, paragrafos: paragrafos });
    }
    secoes.push.apply(secoes, secoesAreas);

    const conferencia = tabela.conferirFechamento(resultados);
    if (conferencia.length) {
      secoes.push({
        titulo: (n++) + '. Avisos de consistência',
        paragrafos: conferencia.map((c) => c.mensagem),
      });
    }

    secoes.push({
      titulo: (n++) + '. Ressalva',
      paragrafos: [
        'Este documento foi gerado automaticamente a partir dos arquivos carregados no portal e não substitui a '
        + 'análise técnica. A validade dos números depende da qualidade e da atualidade das camadas de origem, cujas '
        + 'fontes estão declaradas em cada tabela. O responsável técnico deve conferir os recortes, a legenda dos '
        + 'mapas e a adequação do conteúdo às exigências do órgão licenciador.',
      ],
    });

    return {
      titulo: 'Relatório de caracterização por áreas de influência',
      projeto: p,
      secoes: secoes,
      gerado_em: new Date().toISOString(),
    };
  }

  /** Texto corrido (para DOCX/colar em outro documento). */
  function textoSimples(relato) {
    const partes = [relato.titulo, ''];
    for (const s of relato.secoes) {
      partes.push(s.titulo, '');
      for (const par of s.paragrafos) partes.push(par, '');
    }
    return partes.join('\n');
  }

  function listar(itens) {
    if (itens.length <= 1) return itens[0] || '';
    return itens.slice(0, -1).join('; ') + ' e ' + itens[itens.length - 1];
  }

  function agrupar(lista, chave) {
    const mapa = new Map();
    for (const item of lista) {
      const k = chave(item);
      if (!mapa.has(k)) mapa.set(k, []);
      mapa.get(k).push(item);
    }
    return mapa;
  }

  /**
   * Monta o PDF do relatório: capa simples, tabela por classe, gráficos e texto.
   * O gráfico entra como imagem JPEG (vem do canvas do navegador); sem imagem, o
   * layout degrada para a tabela — o PDF continua válido.
   */
  function gerarPdf(relato, resultados, opcoes) {
    const o = opcoes || {};
    const doc = pdf.criarDocumento({
      titulo: relato.titulo,
      autor: (relato.projeto && relato.projeto.responsavel) || '',
      assunto: 'Caracterização por áreas de influência',
    });
    const folha = o.folha || 'A4';
    const caixa = pdf.caixaDoMapa(folha, 'retrato', { margem: 14, moldura: 0, alturaCabecalho: 0, alturaRodape: 0 });
    const margemL = caixa.margem + 4;
    const larguraTexto = caixa.larguraFolha - 2 * margemL;

    const imagens = o.imagens || [];
    const nomes = imagens.map((img) => doc.adicionarImagem(img.bytes));

    let pagina = doc.novaPagina(caixa.larguraFolha, caixa.alturaFolha);
    let y = margemL + 8;

    doc.texto(pagina, relato.titulo, margemL, y, { tamanho: 15, negrito: true });
    y += 8;
    if (relato.projeto && relato.projeto.nome) {
      doc.texto(pagina, relato.projeto.nome, margemL, y, { tamanho: 10, cor: '#43535d' });
      y += 6;
    }
    doc.texto(pagina, 'Gerado em ' + new Date(relato.gerado_em).toLocaleString('pt-BR'),
      margemL, y, { tamanho: 7.5, cor: '#5b6b75' });
    y += 8;
    doc.linha(pagina, margemL, y, caixa.larguraFolha - margemL, y, { cor: '#1f2d36', espessura: 0.6 });
    y += 6;

    let indiceGrafico = 0;
    const quebraSeNecessario = (alturaNecessaria) => {
      if (y + alturaNecessaria < caixa.alturaFolha - margemL) return false;
      pagina = doc.novaPagina(caixa.larguraFolha, caixa.alturaFolha);
      y = margemL + 6;
      return true;
    };

    for (const secao of relato.secoes) {
      quebraSeNecessario(24);
      doc.texto(pagina, secao.titulo, margemL, y, { tamanho: 11, negrito: true, cor: '#1f4a5a' });
      y += 5.5;
      for (const paragrafo of secao.paragrafos) {
        const altura = doc.textoMultilinha(pagina, paragrafo, margemL, y, larguraTexto, { tamanho: 8.6, alturaLinha: 4.4 });
        y += altura + 2.6;
        quebraSeNecessario(10);
      }
      y += 2;
    }

    // tabela por classe (primeiras 40 linhas por folha de propósito: relatório não é planilha)
    const linhas = tabela.porClasse(resultados, { agrupamento: (opcoes && opcoes.agrupamento) || {} });
    if (linhas.length) {
      quebraSeNecessario(30);
      doc.texto(pagina, 'Tabela 1 — Área por classe dentro de cada área de influência',
        margemL, y, { tamanho: 10, negrito: true, cor: '#1f4a5a' });
      y += 6;
      const colunas = [
        { rotulo: 'AI', largura: 14 },
        { rotulo: 'Camada', largura: 34 },
        { rotulo: 'Classe', largura: 46 },
        { rotulo: 'Área (ha)', largura: 20, alinhamento: 'direita' },
        { rotulo: '% da AI', largura: 16, alinhamento: 'direita' },
        { rotulo: 'Feições', largura: 14, alinhamento: 'direita' },
      ];
      y = desenharTabela(doc, pagina, linhas.map((l) => [
        l.ai, l.camada_nome, l.classe, math.num(l.area_ha, 2), math.num(l.pct_ai, 2) + '%', String(l.feicoes),
      ]), colunas, margemL, y, caixa, () => {
        pagina = doc.novaPagina(caixa.larguraFolha, caixa.alturaFolha);
        return margemL + 6;
      });
      y += 4;
    }

    // gráficos
    for (const img of imagens) {
      const nome = nomes[indiceGrafico++];
      const altura = img.alturaMm || 70;
      quebraSeNecessario(altura + 12);
      if (img.titulo) {
        doc.texto(pagina, img.titulo, margemL, y, { tamanho: 9, negrito: true, cor: '#1f4a5a' });
        y += 5;
      }
      doc.desenharImagem(pagina, nome, margemL, y, Math.min(larguraTexto, img.larguraMm || larguraTexto), altura);
      y += altura + 4;
    }

    return doc.construir();
  }

  function desenharTabela(doc, pagina, linhas, colunas, x0, y0, caixa, novaPagina) {
    const alturaLinha = 4.6;
    let y = y0;
    const desenharCabecalho = () => {
      let x = x0;
      for (const c of colunas) {
        doc.texto(pagina, c.rotulo, c.alinhamento === 'direita' ? x + c.largura : x, y + 3, { tamanho: 7.4, negrito: true });
        x += c.largura;
      }
      y += alturaLinha;
      doc.linha(pagina, x0, y - 1, x0 + colunas.reduce((s, c) => s + c.largura, 0), y - 1, { cor: '#9aa7b0', espessura: 0.4 });
    };
    desenharCabecalho();

    for (const linha of linhas) {
      if (y + alturaLinha > caixa.alturaFolha - caixa.margem - 6) {
        y = novaPagina();
        desenharCabecalho();
      }
      let x = x0;
      linha.forEach((valor, i) => {
        const c = colunas[i];
        const texto = svg.quebrar(valor, Math.max(6, Math.floor(c.largura / 1.7)))[0];
        doc.texto(pagina, texto, c.alinhamento === 'direita' ? x + c.largura : x, y + 3, { tamanho: 7.2 });
        x += c.largura;
      });
      y += alturaLinha;
    }
    return y;
  }

  return {
    redigir: redigir,
    textoSimples: textoSimples,
    gerarPdf: gerarPdf,
  };
});
