'use strict';
/* ============================================================================
 * mapa.js — compositor de mapa: layout padrão, escala, folha e articulação
 *
 * A articulação é resolvida aqui como problema de LAYOUT, não de dado: a mesma
 * camada recortada aparece em várias folhas. O motor calcula a grade de folhas a
 * partir da escala e do tamanho da folha, numera em ordem de leitura e gera o
 * mapa-índice com a posição de cada folha.
 * ========================================================================== */

(function (raiz, fabrica) {
  const node = typeof module === 'object' && module.exports;
  const math = node ? require('./math.js') : raiz.EIA.math;
  const pdf = node ? require('./pdf.js') : raiz.EIA.pdf;
  const svg = node ? require('./svg.js') : raiz.EIA.svg;
  const api = fabrica(math, pdf, svg);
  if (node) module.exports = api;
  if (raiz) {
    raiz.EIA = raiz.EIA || {};
    raiz.EIA.mapa = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (math, pdf, svg) {

  /**
   * Escalas usuais de projeto. A lista é fechada porque escala de mapa é norma,
   * não valor livre: 1:7.500 não existe em carta topográfica.
   */
  const ESCALAS = [500, 1000, 2000, 2500, 5000, 10000, 25000, 50000, 100000, 250000];

  /** Cobertura no terreno (km) de uma folha, dada a escala. */
  function cobertura(folha, orientacao, escala, opcoes) {
    const caixa = pdf.caixaDoMapa(folha, orientacao, opcoes);
    const larguraKm = caixa.mapa.largura / 1000 * escala / 1000;
    const alturaKm = caixa.mapa.altura / 1000 * escala / 1000;
    return {
      larguraKm: larguraKm,
      alturaKm: alturaKm,
      areaKm2: larguraKm * alturaKm,
      caixa: caixa,
    };
  }

  /**
   * Maior escala (denominador) em que a extensão cabe numa folha, arredondando para
   * uma escala usual. Menor denominador = mais detalhe.
   */
  function escalaQueCabe(bboxGraus, folha, orientacao, opcoes) {
    const o = opcoes || {};
    const caixa = pdf.caixaDoMapa(folha, orientacao, o);
    const latCentro = (bboxGraus[1] + bboxGraus[3]) / 2;
    // extensão em metros (aprox. local, suficiente para escolher a escala)
    const mPorGrauLon = 111320 * Math.cos(latCentro * Math.PI / 180);
    const larguraM = (bboxGraus[2] - bboxGraus[0]) * mPorGrauLon;
    const alturaM = (bboxGraus[3] - bboxGraus[1]) * 110574;
    const escalaPorLargura = larguraM / (caixa.mapa.largura / 1000) * 1000;
    const escalaPorAltura = alturaM / (caixa.mapa.altura / 1000) * 1000;
    const necessaria = Math.max(escalaPorLargura, escalaPorAltura) * (o.folga || 1.08);
    for (const e of ESCALAS) if (e >= necessaria) return e;
    return ESCALAS[ESCALAS.length - 1];
  }

  /** Graus de latitude/longitude cobertos pela folha na escala, na latitude dada. */
  function grausDaFolha(folha, orientacao, escala, lat, opcoes) {
    const cob = cobertura(folha, orientacao, escala, opcoes);
    const mPorGrauLon = 111320 * Math.cos(lat * Math.PI / 180);
    return {
      dLon: cob.larguraKm * 1000 / mPorGrauLon,
      dLat: cob.alturaKm * 1000 / 110574,
    };
  }

  /**
   * Grade de articulação sobre uma extensão.
   * @returns {{folhas:Array, colunas:number, linhas:number, dLon:number, dLat:number, total:number}}
   */
  function articular(bboxGraus, folha, orientacao, escala, opcoes) {
    const o = opcoes || {};
    const sobreposicao = o.sobreposicao === undefined ? 0.1 : o.sobreposicao;
    const latCentro = (bboxGraus[1] + bboxGraus[3]) / 2;
    const passo = grausDaFolha(folha, orientacao, escala, latCentro, o);
    const passoComSobreposicao = { dLon: passo.dLon * (1 - sobreposicao), dLat: passo.dLat * (1 - sobreposicao) };

    const larguraTotal = bboxGraus[2] - bboxGraus[0];
    const alturaTotal = bboxGraus[3] - bboxGraus[1];
    const colunas = Math.max(1, Math.ceil(larguraTotal / passoComSobreposicao.dLon));
    const linhas = Math.max(1, Math.ceil(alturaTotal / passoComSobreposicao.dLat));

    // Centraliza a grade na extensão (sobra igual dos dois lados)
    const larguraGrade = colunas * passo.dLon - (colunas - 1) * (passo.dLon - passoComSobreposicao.dLon);
    const alturaGrade = linhas * passo.dLat - (linhas - 1) * (passo.dLat - passoComSobreposicao.dLat);
    const inicioLon = (bboxGraus[0] + bboxGraus[2]) / 2 - larguraGrade / 2;
    const inicioLat = (bboxGraus[1] + bboxGraus[3]) / 2 - alturaGrade / 2;

    const folhas = [];
    let n = 0;
    for (let li = 0; li < linhas; li++) {          // norte -> sul
      for (let ci = 0; ci < colunas; ci++) {       // oeste -> leste
        n++;
        const oeste = inicioLon + ci * passoComSobreposicao.dLon;
        const norte = inicioLat + alturaGrade - li * passoComSobreposicao.dLat;
        const bbox = [oeste, norte - passo.dLat, oeste + passo.dLon, norte];
        folhas.push({
          numero: String(n).padStart(2, '0'),
          indice: n,
          coluna: ci + 1,
          linha: li + 1,
          bbox: bbox,
          nome: 'FOLHA ' + String(n).padStart(2, '0') + '/' + String(linhas * colunas).padStart(2, '0'),
        });
      }
    }
    return {
      folhas: folhas,
      colunas: colunas,
      linhas: linhas,
      total: folhas.length,
      dLon: passo.dLon,
      dLat: passo.dLat,
      sobreposicao: sobreposicao,
      escala: escala,
      folha: folha,
      orientacao: orientacao,
      bbox: bboxGraus,
    };
  }

  /** Coordenada (grau) -> ponto na caixa do mapa (mm), com o norte para cima. */
  function projetarNaCaixa(lon, lat, bbox, caixa) {
    const x = caixa.x + (lon - bbox[0]) / (bbox[2] - bbox[0]) * caixa.largura;
    const y = caixa.y + (bbox[3] - lat) / (bbox[3] - bbox[1]) * caixa.altura;
    return [x, y];
  }

  /** Metros por milímetro na escala (1 mm da folha = escala/1000 m no terreno). */
  function metrosPorMilimetro(escala) { return escala / 1000; }

  /**
   * Desenha o layout padrão de UMA folha no documento PDF.
   * O layout segue o que os órgãos pedem: moldura dupla, cabeçalho com logos e
   * nome do projeto, área do mapa, legenda e escala no rodapé, numeração de folha
   * quando articulado.
   */
  function desenharFolha(doc, especificacao) {
    const e = especificacao;
    const caixa = pdf.caixaDoMapa(e.folha, e.orientacao, e.layout);
    const pagina = doc.novaPagina(caixa.larguraFolha, caixa.alturaFolha);
    const cor = (e.layout && e.layout.cor) || '#1f2d36';

    // moldura dupla
    const m = caixa.margem;
    doc.retangulo(pagina, m, m, caixa.larguraFolha - 2 * m, caixa.alturaFolha - 2 * m, { borda: cor, espessura: 1.1 });
    doc.retangulo(pagina, m + caixa.moldura * 0.6, m + caixa.moldura * 0.6,
      caixa.larguraFolha - 2 * (m + caixa.moldura * 0.6), caixa.alturaFolha - 2 * (m + caixa.moldura * 0.6),
      { borda: cor, espessura: 0.4 });

    // cabeçalho
    const cab = caixa.cabecalho;
    doc.linha(pagina, cab.x, cab.y + cab.altura, cab.x + cab.largura, cab.y + cab.altura, { cor: cor, espessura: 0.6 });
    const titulo = e.titulo || 'MAPA DE CARACTERIZAÇÃO';
    doc.texto(pagina, titulo, cab.x + cab.largura / 2, cab.y + 12, { tamanho: e.folha === 'A4' ? 12 : 15, negrito: true, alinhamento: 'centro', cor: cor });
    const subtitulo = [e.projeto, e.assunto].filter(Boolean).join(' · ');
    if (subtitulo) {
      doc.texto(pagina, subtitulo, cab.x + cab.largura / 2, cab.y + 22, { tamanho: e.folha === 'A4' ? 8 : 10, alinhamento: 'centro', cor: '#43535d' });
    }
    if (e.areaInfluencia) {
      doc.texto(pagina, e.areaInfluencia, cab.x + cab.largura / 2, cab.y + 31, { tamanho: e.folha === 'A4' ? 8 : 9, negrito: true, alinhamento: 'centro', cor: cor });
    }

    // logos (data URL ou bytes) — desenhados nos cantos do cabeçalho
    const logos = (e.logos || []).filter((l) => l && l.nomeImagem);
    logos.forEach((logo, i) => {
      const largura = logo.larguraMm || 22;
      const altura = logo.alturaMm || 12;
      const x = i === 0 ? cab.x + 2 : cab.x + cab.largura - largura - 2;
      doc.desenharImagem(pagina, logo.nomeImagem, x, cab.y + (cab.altura - altura) / 2, largura, altura);
    });

    // área do mapa (o raster entra aqui, desenhado por quem chama)
    const mapa = caixa.mapa;
    doc.retangulo(pagina, mapa.x, mapa.y, mapa.largura, mapa.altura, { borda: cor, espessura: 0.7 });
    if (e.nomeImagemMapa) {
      doc.desenharImagem(pagina, e.nomeImagemMapa, mapa.x, mapa.y, mapa.largura, mapa.altura);
    }

    // grade de coordenadas (rótulos nas bordas)
    if (e.bbox) {
      desenharGrade(pagina, e, caixa, doc);
    }

    // rodapé: legenda, escala gráfica, norte, fonte
    const rod = caixa.rodape;
    doc.linha(pagina, rod.x, rod.y, rod.x + rod.largura, rod.y, { cor: cor, espessura: 0.6 });

    const itensLegenda = e.legenda || [];
    if (itensLegenda.length) {
      /* Quantas entradas cabem no rodapé desta folha?
       *
       * Antes eram 2 colunas fixas em A4 e 3 nas outras — servia para 6 camadas, não
       * para uma legenda de unidade litológica, que pode ter dezenas de entradas numa
       * folha. Agora a conta é feita a partir da ALTURA do rodapé, e o número de colunas
       * cresce até caber; se ainda não couber (folha pequena com legenda enorme), o que
       * sobra é declarado em uma linha, em vez de sair do papel em silêncio. */
      const alturaLinha = 5.2;   // mm por linha de legenda
      const linhasPorColuna = Math.max(3, Math.floor((rod.altura - 10) / alturaLinha));
      const larguraMinimaColuna = 34;   // mm — abaixo disso o rótulo não cabe
      const colunasQueCabem = Math.max(1, Math.floor((rod.largura - 4) / larguraMinimaColuna));
      const colunasNecessarias = Math.ceil(itensLegenda.length / linhasPorColuna);
      const colunas = Math.max(1, Math.min(colunasQueCabem, Math.max(e.folha === 'A4' ? 2 : 3, colunasNecessarias)));
      const porColuna = Math.ceil(itensLegenda.length / colunas);
      const capacidade = porColuna * colunas;
      const cabem = itensLegenda.slice(0, capacidade);
      const sobra = itensLegenda.length - cabem.length;

      for (let c = 0; c < colunas; c++) {
        const x = rod.x + 2 + c * (rod.largura / colunas);
        const fatia = cabem.slice(c * porColuna, (c + 1) * porColuna);
        fatia.forEach((item, i) => {
          const y = rod.y + 7 + i * alturaLinha;
          if (item.forma === 'linha') {
            doc.linha(pagina, x, y, x + 8, y, { cor: item.cor, espessura: item.espessura || 0.9 });
          } else if (item.forma === 'ponto') {
            doc.circulo(pagina, x + 3, y, 1.4, { preenchimento: item.cor, borda: '#ffffff' });
          } else {
            doc.retangulo(pagina, x, y - 1.8, 6.5, 3.6, { preenchimento: item.cor, borda: '#7d8b93' });
          }
          doc.texto(pagina, item.rotulo, x + 10, y + 1.4, { tamanho: 6.6 });
        });
      }
      if (sobra > 0) {
        doc.texto(pagina, 'e mais ' + sobra + ' classes — tabela de áreas em anexo',
          rod.x + 2, rod.y + 7 + linhasPorColuna * alturaLinha + 1, { tamanho: 6.6, cor: '#43535d' });
      }
    }

    // escala gráfica em vetor
    const metrosPorPx = 1; // a escala gráfica abaixo é desenhada em mm direto
    desenharEscalaGrafica(pagina, doc, caixa, e, metrosPorPx);

    // norte
    doc.circulo(pagina, rod.x + rod.largura - 16, rod.y + rod.altura / 2, 6, { borda: cor, espessura: 0.5 });
    doc.linha(pagina, rod.x + rod.largura - 16, rod.y + rod.altura / 2 + 4, rod.x + rod.largura - 16, rod.y + rod.altura / 2 - 4, { cor: cor, espessura: 0.7 });
    doc.texto(pagina, 'N', rod.x + rod.largura - 16, rod.y + rod.altura / 2 - 7, { tamanho: 7, negrito: true, alinhamento: 'centro' });

    // textos de responsabilidade
    const fonte = e.fonte || '';
    const datum = e.datum || 'SIRGAS 2000 / UTM 23S · WGS 84';
    doc.texto(pagina, 'Base: ' + (fonte || 'arquivos fornecidos ao projeto'), rod.x + rod.largura - 34, rod.y + 8, { tamanho: 7, alinhamento: 'direita', cor: '#43535d' });
    doc.texto(pagina, datum, rod.x + rod.largura - 34, rod.y + 14, { tamanho: 7, alinhamento: 'direita', cor: '#43535d' });
    if (e.responsavel) {
      doc.texto(pagina, 'Resp. técnico: ' + e.responsavel + (e.crea ? ' — CREA ' + e.crea : ''),
        rod.x + rod.largura - 34, rod.y + 20, { tamanho: 7, alinhamento: 'direita', cor: '#43535d' });
    }
    if (e.numeroFolha) {
      doc.texto(pagina, e.numeroFolha, rod.x + rod.largura - 34, rod.y + rod.altura - 4, { tamanho: 7.5, negrito: true, alinhamento: 'direita', cor: cor });
    }
    if (e.data) {
      doc.texto(pagina, e.data, rod.x + 2, rod.y + rod.altura - 4, { tamanho: 7, cor: '#43535d' });
    }
    return pagina;
  }

  /** Escala gráfica desenhada em milímetros reais na folha. */
  function desenharEscalaGrafica(pagina, doc, caixa, e, _ignorado) {
    const rod = caixa.rodape;
    const escala = e.escala || 50000;
    const mPorMm = escala / 1000;      // metros no terreno por mm na folha
    const passosM = [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];
    const larguraAlvo = Math.min(90, rod.largura * 0.32);
    let passo = passosM[passosM.length - 1];
    for (const p of passosM) {
      if (p / mPorMm * 4 <= larguraAlvo) { passo = p; break; }
    }
    const mmPasso = passo / mPorMm;
    const trechos = Math.max(2, Math.min(5, Math.floor(larguraAlvo / mmPasso)));
    const x0 = rod.x + 2;
    const y = rod.y + rod.altura - 12;
    for (let i = 0; i < trechos; i++) {
      doc.retangulo(pagina, x0 + i * mmPasso, y, mmPasso, 2.2,
        { preenchimento: i % 2 === 0 ? '#1f2d36' : '#ffffff', borda: '#1f2d36', espessura: 0.3 });
    }
    for (let i = 0; i <= trechos; i++) {
      const metros = i * passo;
      const rotulo = metros >= 1000 ? math.num(metros / 1000, metros % 1000 === 0 ? 0 : 1) + ' km' : metros + ' m';
      doc.texto(pagina, rotulo, x0 + i * mmPasso, y + 7, { tamanho: 6.4, alinhamento: 'centro' });
    }
    doc.texto(pagina, 'Escala 1:' + math.num(escala, 0), x0, y - 3, { tamanho: 7.5, negrito: true });
  }

  /**
   * Grade de coordenadas: rótulos nas bordas com cruzamento na moldura do mapa.
   * Desenha com as primitivas públicas do documento (linha/texto) para não repetir
   * aqui as contas de conversão de milímetro para ponto — que é onde se erra.
   */
  function desenharGrade(pagina, e, caixa, doc) {
    const bbox = e.bbox;
    const mapa = caixa.mapa;
    const nDivisoes = 4;
    for (let i = 0; i <= nDivisoes; i++) {
      const lon = bbox[0] + (bbox[2] - bbox[0]) * i / nDivisoes;
      const x = mapa.x + mapa.largura * i / nDivisoes;
      doc.linha(pagina, x, mapa.y + mapa.altura, x, mapa.y + mapa.altura + 2.5, { cor: '#b8c2c8', espessura: 0.4 });
      doc.texto(pagina, math.dms(lon, 'lon'), x, mapa.y + mapa.altura + 6, { tamanho: 6, alinhamento: 'centro', cor: '#5b6b75' });

      const lat = bbox[1] + (bbox[3] - bbox[1]) * i / nDivisoes;
      const y = mapa.y + mapa.altura * (1 - i / nDivisoes);
      doc.linha(pagina, mapa.x, y, mapa.x - 2.5, y, { cor: '#b8c2c8', espessura: 0.4 });
      doc.texto(pagina, math.dms(lat, 'lat'), mapa.x - 3.5, y + 1, { tamanho: 6, alinhamento: 'direita', cor: '#5b6b75' });
    }
  }

  /**
   * Desenha o MAPA-ÍNDICE da articulação: a grade completa numerada, com a folha
   * em foco destacada. É a página que o órgão usa para saber onde cada folha cai.
   */
  function desenharIndice(doc, articulacao, especificacao) {
    const e = especificacao || {};
    const caixa = pdf.caixaDoMapa(e.folha || 'A3', e.orientacao || 'paisagem', e.layout);
    const pagina = doc.novaPagina(caixa.larguraFolha, caixa.alturaFolha);
    const cor = '#1f2d36';
    const m = caixa.margem;
    doc.retangulo(pagina, m, m, caixa.larguraFolha - 2 * m, caixa.alturaFolha - 2 * m, { borda: cor, espessura: 1 });
    doc.texto(pagina, e.titulo || 'MAPA-ÍNDICE DE ARTICULAÇÃO', caixa.larguraFolha / 2, m + 14,
      { tamanho: 14, negrito: true, alinhamento: 'centro' });
    doc.texto(pagina, (e.projeto || '') + ' · Escala 1:' + math.num(articulacao.escala, 0)
      + ' · ' + articulacao.total + ' folhas em ' + articulacao.linhas + '×' + articulacao.colunas
      + ' · sobreposição ' + math.num(articulacao.sobreposicao * 100, 0) + '%',
      caixa.larguraFolha / 2, m + 22, { tamanho: 9, alinhamento: 'centro', cor: '#43535d' });

    const area = {
      x: m + 16, y: m + 34,
      largura: caixa.larguraFolha - 2 * (m + 16),
      altura: caixa.alturaFolha - 2 * (m + 16) - 34 - (e.alturaRodape || 22),
    };
    doc.retangulo(pagina, area.x, area.y, area.largura, area.altura, { borda: cor, espessura: 0.6 });

    const bbox = articulacao.bbox;
    for (const folha of articulacao.folhas) {
      const p1 = projetarNaCaixa(folha.bbox[0], folha.bbox[3], bbox, area);
      const p2 = projetarNaCaixa(folha.bbox[2], folha.bbox[1], bbox, area);
      doc.retangulo(pagina, p1[0], p1[1], p2[0] - p1[0], p2[1] - p1[1], { borda: cor, espessura: 0.35 });
      doc.texto(pagina, folha.numero, (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2 + 2,
        { tamanho: 8, negrito: true, alinhamento: 'centro' });
    }
    if (e.destacar) {
      const f = articulacao.folhas.find((x) => x.numero === e.destacar);
      if (f) {
        const p1 = projetarNaCaixa(f.bbox[0], f.bbox[3], bbox, area);
        const p2 = projetarNaCaixa(f.bbox[2], f.bbox[1], bbox, area);
        doc.retangulo(pagina, p1[0], p1[1], p2[0] - p1[0], p2[1] - p1[1], { borda: '#c0392b', espessura: 1.4 });
      }
    }
    doc.texto(pagina, 'As folhas são numeradas de oeste para leste e de norte para sul.',
      area.x, area.y + area.altura + 8, { tamanho: 8, cor: '#43535d' });
    return pagina;
  }

  /**
   * Gera o PDF da folha (ou de todas) com o mapa já rasterizado.
   * @param {object} e  { folha, orientacao, escala, bbox, projeto, titulo, ..., imagensPorFolha: {numero: {jpeg bytes, nome}} }
   */
  function gerarPdf(e) {
    const doc = pdf.criarDocumento({ titulo: e.titulo || 'Mapa EIA/RIMA', autor: e.responsavel || '' });
    const imagens = e.imagens || []; // [{ folhaNumero|'unico', bytes }]
    const nomePorChave = new Map();
    for (const img of imagens) {
      const nome = doc.adicionarImagem(img.bytes);
      nomePorChave.set(img.chave, nome);
    }

    if (e.articulacao && e.articulacao.total > 1) {
      if (e.incluirIndice !== false) {
        desenharIndice(doc, e.articulacao, e);
      }
      for (const folha of e.articulacao.folhas) {
        desenharFolha(doc, Object.assign({}, e, {
          bbox: folha.bbox,
          nomeImagemMapa: nomePorChave.get(folha.numero),
          numeroFolha: folha.nome,
        }));
      }
    } else {
      const unica = e.articulacao ? e.articulacao.folhas[0] : null;
      desenharFolha(doc, Object.assign({}, e, {
        bbox: unica ? unica.bbox : e.bbox,
        nomeImagemMapa: nomePorChave.get('unico'),
      }));
    }
    return doc.construir();
  }

  /** Layout em SVG, para a pré-visualização na tela (mesma geometria do PDF). */
  function previaSvg(especificacao, opcoes) {
    const e = especificacao;
    const o = opcoes || {};
    const caixa = pdf.caixaDoMapa(e.folha || 'A1', e.orientacao || 'paisagem', e.layout);
    const escalaTela = o.escalaTela || 0.9;
    const L = caixa.larguraFolha * escalaTela;
    const A = caixa.alturaFolha * escalaTela;
    const p = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + L.toFixed(0) + '" height="' + A.toFixed(0)
      + '" viewBox="0 0 ' + caixa.larguraFolha + ' ' + caixa.alturaFolha + '" font-family="Segoe UI, Arial, sans-serif">'];
    p.push('<rect width="' + caixa.larguraFolha + '" height="' + caixa.alturaFolha + '" fill="#ffffff"/>');
    p.push('<rect x="' + caixa.margem + '" y="' + caixa.margem + '" width="' + (caixa.larguraFolha - 2 * caixa.margem)
      + '" height="' + (caixa.alturaFolha - 2 * caixa.margem) + '" fill="none" stroke="#1f2d36" stroke-width="1.1"/>');
    const cab = caixa.cabecalho;
    p.push('<line x1="' + cab.x + '" y1="' + (cab.y + cab.altura) + '" x2="' + (cab.x + cab.largura)
      + '" y2="' + (cab.y + cab.altura) + '" stroke="#1f2d36" stroke-width="0.6"/>');
    p.push('<text x="' + (cab.x + cab.largura / 2) + '" y="' + (cab.y + 12) + '" text-anchor="middle" font-size="9" font-weight="700" fill="#1f2d36">'
      + svg.escapar(e.titulo || 'MAPA DE CARACTERIZAÇÃO') + '</text>');
    if (e.projeto) {
      p.push('<text x="' + (cab.x + cab.largura / 2) + '" y="' + (cab.y + 22) + '" text-anchor="middle" font-size="6.5" fill="#43535d">'
        + svg.escapar(e.projeto) + '</text>');
    }
    const mapa = caixa.mapa;
    p.push('<rect x="' + mapa.x + '" y="' + mapa.y + '" width="' + mapa.largura + '" height="' + mapa.altura
      + '" fill="#eef2f4" stroke="#1f2d36" stroke-width="0.7"/>');
    p.push('<text x="' + (mapa.x + mapa.largura / 2) + '" y="' + (mapa.y + mapa.altura / 2)
      + '" text-anchor="middle" font-size="8" fill="#7d8b93">área do mapa</text>');
    const rod = caixa.rodape;
    p.push('<line x1="' + rod.x + '" y1="' + rod.y + '" x2="' + (rod.x + rod.largura)
      + '" y2="' + rod.y + '" stroke="#1f2d36" stroke-width="0.6"/>');
    p.push('<text x="' + (rod.x + 2) + '" y="' + (rod.y + rod.altura - 4) + '" font-size="6" fill="#43535d">Escala 1:'
      + math.num(e.escala || 50000, 0) + ' · ' + svg.escapar(e.datum || 'SIRGAS 2000') + '</text>');
    if (e.numeroFolha) {
      p.push('<text x="' + (rod.x + rod.largura - 2) + '" y="' + (rod.y + rod.altura - 4)
        + '" text-anchor="end" font-size="6.5" font-weight="700" fill="#1f2d36">' + svg.escapar(e.numeroFolha) + '</text>');
    }
    p.push('</svg>');
    return p.join('');
  }

  // ============================================================ ordem de desenho
  /*
   * POR QUE ISTO É CÁLCULO E NÃO ORDEM DE INSERÇÃO
   *
   * No Leaflet, quem desenha por cima é quem foi ADICIONADO por último — e isso é frágil:
   * `desenharCamadas()` limpa o grupo e adiciona tudo de novo quando alguém mexe em
   * transparência ou liga outra camada. A cada redesenho, as camadas de caracterização
   * pulavam para cima das áreas de influência do usuário, que "sumiam" sem ninguém ter
   * pedido. Ordem de desenho tem de ser ESTADO, não efeito colateral de quem foi
   * adicionado por último: aqui ela vira número, e o número vai para o z-index do painel.
   */

  /** z-index do painel das camadas de caracterização (o "overlayPane" do Leaflet é 400). */
  const Z_CAMADAS = 400;

  /** Ordem inicial: a mesma do catálogo. */
  function ordemInicial(ids) {
    return (ids || []).slice();
  }

  /**
   * Move uma camada uma posição na ordem (direcao -1 sobe, +1 desce).
   * A ordem vai do FUNDO para o TOPO — o último da lista é o que aparece por cima.
   * @returns {Array|null} nova ordem, ou null se não havia para onde mover
   */
  function moverNaOrdem(ordem, id, direcao) {
    const lista = (ordem || []).slice();
    const i = lista.indexOf(id);
    if (i < 0) return null;
    const j = i + (direcao < 0 ? -1 : 1);
    if (j < 0 || j >= lista.length) return null;
    lista[i] = lista[j];
    lista[j] = id;
    return lista;
  }

  /** z-index de uma camada de caracterização, conforme a posição na ordem. */
  function zIndexDaCamada(ordem, id, base) {
    const i = (ordem || []).indexOf(id);
    return (base === undefined ? Z_CAMADAS : base) + (i < 0 ? 0 : i);
  }

  /**
   * z-index do recorte (o resultado da análise).
   *
   * Fica logo acima de todas as camadas de caracterização — é a resposta que o usuário
   * pediu, então não pode ficar escondida atrás de nenhuma delas.
   *
   * As faixas são CALCULADAS a partir do número de camadas, para não colidir com os painéis
   * do próprio Leaflet: tilePane 200 (satélite), overlayPane 400 (vetores), shadowPane 500,
   * markerPane 600 (é onde ficam os rótulos), tooltipPane 650, popupPane 700. Tudo o que é
   * deste portal vive entre 400 e 400+n+2 — abaixo, portanto, dos rótulos.
   */
  function zIndexDoResultado(ordem, base) {
    const b = base === undefined ? Z_CAMADAS : base;
    return b + (ordem || []).length + 1;
  }

  /**
   * z-index do grupo das áreas de influência do usuário.
   *
   * `acima` verdadeiro põe as áreas por cima de TODAS as camadas (e por cima do recorte,
   * para a divisa tracejada da área continuar visível sobre o resultado); falso, por baixo
   * de todas. Nos dois casos o número sai da ordem, então continua certo quando o usuário
   * reordena ou liga uma camada nova.
   */
  function zIndexDasAreas(ordem, acima, base) {
    const b = base === undefined ? Z_CAMADAS : base;
    const n = (ordem || []).length;
    return acima ? b + n + 2 : b - 1;
  }

  return {
    ESCALAS: ESCALAS,
    Z_CAMADAS: Z_CAMADAS,
    ordemInicial: ordemInicial,
    moverNaOrdem: moverNaOrdem,
    zIndexDaCamada: zIndexDaCamada,
    zIndexDoResultado: zIndexDoResultado,
    zIndexDasAreas: zIndexDasAreas,
    cobertura: cobertura,
    escalaQueCabe: escalaQueCabe,
    grausDaFolha: grausDaFolha,
    articular: articular,
    projetarNaCaixa: projetarNaCaixa,
    metrosPorMilimetro: metrosPorMilimetro,
    desenharFolha: desenharFolha,
    desenharIndice: desenharIndice,
    gerarPdf: gerarPdf,
    previaSvg: previaSvg,
  };
});
