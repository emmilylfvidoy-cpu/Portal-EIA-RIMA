'use strict';
/* ============================================================================
 * pdf.js — gerador de PDF (folhas A4…A0), com imagem JPEG e elementos vetoriais
 *
 * Escrito à mão porque o layout articulado precisa de folha em tamanho exato (mm),
 * texto vetorial nítido e várias páginas num arquivo — e porque a alternativa é
 * arrastar uma biblioteca de 300 KB para dentro de um portal estático.
 *
 * O que suporta: páginas de qualquer tamanho em milímetros, texto com acentuação
 * (WinAnsi), retângulos, linhas, círculos e imagens JPEG (o mapa é rasterizado em
 * JPEG e embutido sem recompressão).
 * ========================================================================== */

(function (raiz, fabrica) {
  const node = typeof module === 'object' && module.exports;
  const api = fabrica();
  if (node) module.exports = api;
  if (raiz) {
    raiz.EIA = raiz.EIA || {};
    raiz.EIA.pdf = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const MM_PARA_PT = 72 / 25.4;

  /** Escapa texto e converte acentos para o conjunto WinAnsi (Latin-1). */
  function textoWinAnsi(s) {
    let saida = '';
    const t = String(s === null || s === undefined ? '' : s);
    for (const ch of t) {
      const c = ch.codePointAt(0);
      if (ch === '\\') { saida += '\\\\'; continue; }
      if (ch === '(') { saida += '\\('; continue; }
      if (ch === ')') { saida += '\\)'; continue; }
      if (c < 32) { saida += ' '; continue; }
      if (c <= 255) { saida += ch; continue; }
      // fora do Latin-1: substituições comuns
      const mapa = { '\u2013': '-', '\u2014': '-', '\u2018': "'", '\u2019': "'", '\u201C': '"', '\u201D': '"', '\u2026': '...', '\u00A0': ' ' };
      saida += mapa[ch] !== undefined ? mapa[ch] : '?';
    }
    return saida;
  }

  function medirTexto(texto, tamanho, negrito) {
    // larguras aproximadas do Helvetica (suficiente para alinhar layout)
    const larguraMedia = negrito ? 0.56 : 0.52;
    return String(texto || '').length * tamanho * larguraMedia;
  }

  /** Lê largura/altura de um JPEG direto dos marcadores SOF. */
  function dimensoesJpeg(bytes) {
    let p = 2;
    while (p + 9 < bytes.length) {
      if (bytes[p] !== 0xFF) { p++; continue; }
      const marcador = bytes[p + 1];
      if (marcador >= 0xC0 && marcador <= 0xCF && marcador !== 0xC4 && marcador !== 0xC8 && marcador !== 0xCC) {
        const altura = (bytes[p + 5] << 8) | bytes[p + 6];
        const largura = (bytes[p + 7] << 8) | bytes[p + 8];
        return { largura: largura, altura: altura, componentes: bytes[p + 9] };
      }
      const tam = (bytes[p + 2] << 8) | bytes[p + 3];
      if (tam <= 0) break;
      p += 2 + tam;
    }
    return null;
  }

  function criarDocumento(opcoes) {
    const o = opcoes || {};
    const paginas = [];
    const imagens = []; // { nome, bytes, largura, altura, componentes, id }
    const fontes = [
      { id: null, nome: 'F1', base: 'Helvetica' },
      { id: null, nome: 'F2', base: 'Helvetica-Bold' },
    ];
    let metadados = {
      titulo: o.titulo || 'Portal EIA/RIMA',
      autor: o.autor || 'Portal EIA/RIMA',
      assunto: o.assunto || '',
      criador: 'Portal EIA/RIMA',
    };

    function novaPagina(larguraMm, alturaMm) {
      const pagina = {
        larguraMm: larguraMm || 210,
        alturaMm: alturaMm || 297,
        conteudo: [],
        imagens: [],
      };
      paginas.push(pagina);
      return pagina;
    }

    /** Acrescenta um JPEG; devolve o nome do recurso para usar em desenharImagem. */
    function adicionarImagem(bytesJpeg) {
      const dim = dimensoesJpeg(bytesJpeg);
      if (!dim) throw new Error('A imagem do mapa não é um JPEG válido.');
      const nome = 'Im' + (imagens.length + 1);
      imagens.push({ nome: nome, bytes: bytesJpeg, largura: dim.largura, altura: dim.altura, componentes: dim.componentes });
      return nome;
    }

    function mm(v) { return (v * MM_PARA_PT).toFixed(3); }

    // ------------------------------------------------------- primitivas
    function retangulo(pagina, x, y, w, h, opcoes2) {
      const e = opcoes2 || {};
      const partes = [];
      if (e.preenchimento) partes.push(hexParaRgb(e.preenchimento) + ' rg');
      if (e.borda) partes.push(hexParaRgb(e.borda) + ' RG', (e.espessura || 0.4) + ' w');
      // PDF usa y de baixo para cima: converte de mm com origem no topo
      const xp = mm(x), yp = mm(pagina.alturaMm - y - h), wp = mm(w), hp = mm(h);
      partes.push(xp + ' ' + yp + ' ' + wp + ' ' + hp + ' re');
      if (e.preenchimento && e.borda) partes.push('B');
      else if (e.preenchimento) partes.push('f');
      else partes.push('S');
      pagina.conteudo.push(partes.join('\n'));
    }

    function linha(pagina, x1, y1, x2, y2, opcoes2) {
      const e = opcoes2 || {};
      const partes = [
        hexParaRgb(e.cor || '#000000') + ' RG',
        (e.espessura || 0.4) + ' w',
        mm(x1) + ' ' + mm(pagina.alturaMm - y1) + ' m ' + mm(x2) + ' ' + mm(pagina.alturaMm - y2) + ' l S',
      ];
      pagina.conteudo.push(partes.join('\n'));
    }

    function circulo(pagina, x, y, raio, opcoes2) {
      const e = opcoes2 || {};
      const k = 0.5523 * raio;
      const cx = x * MM_PARA_PT;
      const cy = (pagina.alturaMm - y) * MM_PARA_PT;
      const r = raio * MM_PARA_PT;
      const partes = [];
      if (e.preenchimento) partes.push(hexParaRgb(e.preenchimento) + ' rg');
      if (e.borda) partes.push(hexParaRgb(e.borda) + ' RG', (e.espessura || 0.4) + ' w');
      partes.push(
        (xx(cx, -r) + ' ' + yy(cy, 0) + ' m'),
        (xx(cx, -r) + ' ' + yy(cy, k) + ' ' + xx(cx, -k) + ' ' + yy(cy, r) + ' ' + xx(cx, 0) + ' ' + yy(cy, r) + ' c'),
        (xx(cx, k) + ' ' + yy(cy, r) + ' ' + xx(cx, r) + ' ' + yy(cy, k) + ' ' + xx(cx, r) + ' ' + yy(cy, 0) + ' c'),
        (xx(cx, r) + ' ' + yy(cy, -k) + ' ' + xx(cx, k) + ' ' + yy(cy, -r) + ' ' + xx(cx, 0) + ' ' + yy(cy, -r) + ' c'),
        (xx(cx, -k) + ' ' + yy(cy, -r) + ' ' + xx(cx, -r) + ' ' + yy(cy, -k) + ' ' + xx(cx, -r) + ' ' + yy(cy, 0) + ' c'),
        (e.preenchimento && e.borda) ? 'B' : (e.preenchimento ? 'f' : 'S')
      );
      pagina.conteudo.push(partes.join('\n'));
    }

    function xx(base, delta) { return (Number(base) + Number(delta)).toFixed(3); }
    function yy(base, delta) { return (Number(base) + Number(delta)).toFixed(3); }

    // ------------------------------------------------------- texto
    /**
     * Escreve texto. Alinhamento: esquerda, centro, direita.
     * y é a linha de base medida do TOPO da folha (mais intuitivo para layout).
     * Devolve a largura ocupada em MILÍMETROS.
     */
    function texto(pagina, s, x, y, opcoes2) {
      const e = opcoes2 || {};
      const tamanho = e.tamanho || 9;
      const negrito = !!e.negrito;
      const fonte = negrito ? '/F2' : '/F1';
      const larguraPt = medirTexto(s, tamanho, negrito);
      const larguraMm2 = larguraPt / MM_PARA_PT;
      let xp = x;
      if (e.alinhamento === 'centro') xp = x - larguraMm2 / 2;
      else if (e.alinhamento === 'direita') xp = x - larguraMm2;

      const yBase = pagina.alturaMm - y;
      pagina.conteudo.push([
        'BT',
        hexParaRgb(e.cor || '#1f2d36') + ' rg',
        fonte + ' ' + tamanho + ' Tf',
        mm(Math.max(0, xp)) + ' ' + mm(yBase) + ' Td',
        '(' + textoWinAnsi(s) + ') Tj',
        'ET',
      ].join('\n'));
      return larguraMm2;
    }

    function textoMultilinha(pagina, s, x, y, larguraMm, opcoes2) {
      const e = opcoes2 || {};
      const tamanho = e.tamanho || 9;
      const alturaLinha = e.alturaLinha || tamanho * 1.35;
      const maxCaracteres = Math.max(8, Math.floor(larguraMm / (tamanho * 0.52)));
      const linhas = quebrar(String(s || ''), maxCaracteres);
      let yy2 = y;
      for (const linha of linhas) {
        texto(pagina, linha, x, yy2, e);
        yy2 += alturaLinha;
      }
      return yy2 - y;
    }

    function quebrar(t, max) {
      const linhas = [];
      for (const paragrafo of String(t).split('\n')) {
        if (!paragrafo.trim()) { linhas.push(''); continue; }
        let linha = '';
        for (const palavra of paragrafo.split(/\s+/)) {
          if ((linha + ' ' + palavra).trim().length > max) { linhas.push(linha.trim()); linha = palavra; }
          else linha = (linha + ' ' + palavra).trim();
        }
        if (linha) linhas.push(linha.trim());
      }
      return linhas;
    }

    // ------------------------------------------------------- imagem
    function desenharImagem(pagina, nomeImagem, x, y, w, h) {
      const img = imagens.find((i) => i.nome === nomeImagem);
      if (!img) return;
      pagina.conteudo.push([
        'q',
        mm(w) + ' 0 0 ' + mm(h) + ' ' + mm(x) + ' ' + mm(pagina.alturaMm - y - h) + ' cm',
        '/' + nomeImagem + ' Do',
        'Q',
      ].join('\n'));
      if (pagina.imagens.indexOf(nomeImagem) < 0) pagina.imagens.push(nomeImagem);
    }

    // ------------------------------------------------------- saida
    function construir() {
      const objetos = []; // 1-based
      const conteudos = [];
      const idFonte1 = 1, idFonte2 = 2;
      objetos[idFonte1] = objFonte('Helvetica');
      objetos[idFonte2] = objFonte('Helvetica-Bold');

      const idsImagens = {};
      for (const img of imagens) {
        const id = objetos.length;
        objetos[id] = objImagem(img);
        idsImagens[img.nome] = id;
      }

      const idsPaginas = [];
      for (const pagina of paginas) {
        const stream = pagina.conteudo.join('\n');
        const idConteudo = objetos.length;
        objetos[idConteudo] = objStream(stream);

        const recursos = [];
        recursos.push('/Font << /F1 ' + idFonte1 + ' 0 R /F2 ' + idFonte2 + ' 0 R >>');
        if (pagina.imagens.length) {
          const xobj = pagina.imagens.map((nome) => '/' + nome + ' ' + idsImagens[nome] + ' 0 R').join(' ');
          recursos.push('/XObject << ' + xobj + ' >>');
        }
        const idPagina = objetos.length;
        // O /Parent é preenchido depois (a árvore /Pages só existe no fim); deixar um
        // marcador é mais honesto que escrever "0 0 R", que gera PDF inválido.
        objetos[idPagina] = objPagina(pagina, idConteudo, recursos.join(' '));
        idsPaginas.push(idPagina);
      }

      const idPaginas = objetos.length;
      objetos[idPaginas] = objSimples('<< /Type /Pages /Count ' + idsPaginas.length
        + ' /Kids [' + idsPaginas.map((i) => i + ' 0 R').join(' ') + '] >>');

      const idCatalogo = objetos.length;
      objetos[idCatalogo] = objSimples('<< /Type /Catalog /Pages ' + idPaginas + ' 0 R >>');

      const idInfo = objetos.length;
      objetos[idInfo] = objSimples('<< /Title (' + textoWinAnsi(metadados.titulo) + ') /Author ('
        + textoWinAnsi(metadados.autor) + ') /Subject (' + textoWinAnsi(metadados.assunto)
        + ') /Creator (' + textoWinAnsi(metadados.criador) + ') /Producer (Portal EIA/RIMA) >>');
      void conteudos;

      // serializa (com o /Parent já resolvido)
      let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
      const offsets = [];
      for (let i = 1; i < objetos.length; i++) {
        if (!objetos[i]) continue;
        offsets[i] = pdf.length;
        const corpo = String(objetos[i]).replace(/\/Parent 0 0 R/g, '/Parent ' + idPaginas + ' 0 R');
        pdf += i + ' 0 obj\n' + corpo + '\nendobj\n';
      }
      const inicioXref = pdf.length;
      const n = objetos.length;
      pdf += 'xref\n0 ' + n + '\n0000000000 65535 f \n';
      for (let i = 1; i < n; i++) {
        const off = offsets[i] || 0;
        pdf += String(off).padStart(10, '0') + ' 00000 n \n';
      }
      pdf += 'trailer\n<< /Size ' + n + ' /Root ' + idCatalogo + ' 0 R /Info ' + idInfo + ' 0 R >>\n';
      pdf += 'startxref\n' + inicioXref + '\n%%EOF\n';

      // converte para bytes preservando Latin-1
      const bytes = new Uint8Array(pdf.length);
      for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xFF;
      return bytes;
    }

    function objSimples(corpo) { return corpo; }

    function objFonte(base) {
      return '<< /Type /Font /Subtype /Type1 /BaseFont /' + base + ' /Encoding /WinAnsiEncoding >>';
    }

    function objStream(conteudo) {
      const bytes = [];
      for (let i = 0; i < conteudo.length; i++) bytes.push(conteudo.charCodeAt(i) & 0xFF);
      return '<< /Length ' + bytes.length + ' >>\nstream\n' + conteudo + '\nendstream';
    }

    function objPagina(pagina, idConteudo, recursos) {
      return '<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ' + mm(pagina.larguraMm) + ' ' + mm(pagina.alturaMm)
        + '] /Resources << ' + recursos + ' >> /Contents ' + idConteudo + ' 0 R >>';
    }

    function objImagem(img) {
      const filtro = img.componentes === 1 ? '/DCTDecode' : '/DCTDecode';
      const espaco = img.componentes === 1 ? '/DeviceGray' : '/DeviceRGB';
      const bytes = [];
      for (let i = 0; i < img.bytes.length; i++) bytes.push(img.bytes[i]);
      let bin = '';
      const pedaco = 8192;
      for (let i = 0; i < bytes.length; i += pedaco) {
        bin += String.fromCharCode.apply(null, bytes.slice(i, i + pedaco));
      }
      return '<< /Type /XObject /Subtype /Image /Width ' + img.largura + ' /Height ' + img.altura
        + ' /ColorSpace ' + espaco + ' /BitsPerComponent 8 /Filter ' + filtro
        + ' /Length ' + bytes.length + ' >>\nstream\n' + bin + '\nendstream';
    }

    function hexParaRgb(hex) {
      const h = String(hex || '#000000').replace('#', '');
      const n = h.length === 3
        ? [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]
        : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
      return n.map((v) => (v / 255).toFixed(4)).join(' ');
    }

    return {
      novaPagina: novaPagina,
      retangulo: retangulo,
      linha: linha,
      circulo: circulo,
      texto: texto,
      textoMultilinha: textoMultilinha,
      adicionarImagem: adicionarImagem,
      desenharImagem: desenharImagem,
      construir: construir,
      paginas: paginas,
      definirMetadados: (m) => { metadados = Object.assign(metadados, m || {}); },
      _medirTexto: medirTexto,
      _dimensoesJpeg: dimensoesJpeg,
    };
  }

  // ------------------------------------------------------------ tamanhos de folha
  /** Dimensões em milímetros (retrato) e área útil do mapa. */
  const FOLHAS = {
    A4: { largura: 210, altura: 297 },
    A3: { largura: 297, altura: 420 },
    A2: { largura: 420, altura: 594 },
    A1: { largura: 594, altura: 841 },
    A0: { largura: 841, altura: 1189 },
  };

  /**
   * Caixa do mapa dentro da folha, em mm, considerando moldura, cabeçalho e rodapé.
   * O layout é fixo de propósito: mapa de EIA segue padrão, e padrão que muda de
   * folha para folha não serve para articular.
   */
  function caixaDoMapa(folha, orientacao, opcoes) {
    const o = opcoes || {};
    const escolhida = FOLHAS[folha] || FOLHAS.A1;
    const largura = orientacao === 'retrato' ? escolhida.largura : escolhida.altura;
    const altura = orientacao === 'retrato' ? escolhida.altura : escolhida.largura;

    /* COMO NUM SIG: O LAYOUT É MONTADO NUMA PÁGINA E OS ELEMENTOS SÃO PROPORCIONAIS A ELA.
     *
     * Antes as medidas eram NÚMEROS POR FOLHA — rodapé de 50 mm em A4, 74 em A3, 122 em A1 — e cada
     * acerto numa folha desmanchava a outra. O cliente viu o resultado e resumiu: "assim tá muito
     * feio, quero que fique proporcional, como se fosse um SIG".
     *
     * Aqui é igual a um SIG: o desenho é SEMPRE feito nas medidas da PRANCHA DE REFERÊNCIA (A1, a
     * que ele mandou) e a folha escolhida recebe tudo multiplicado por UM fator. Como a série A tem
     * sempre a mesma proporção (A3 é A1 dividido por 2, A4 por 2,83), um fator só resolve A4, A3,
     * A2, A1 e A0 — e a folha tem a MESMA CARA em qualquer papel.
     *
     * Os números abaixo, portanto, estão em milímetros de A1 — e não mudam com a folha. Quem os
     * leva para o papel é o `docEscalado`, em mapa.js. */
    const ref = FOLHAS.A1;
    const larguraRef = orientacao === 'retrato' ? ref.largura : ref.altura;
    const alturaRef = orientacao === 'retrato' ? ref.altura : ref.largura;
    const base = largura / larguraRef;   // A3 dá 0,5;  A4 dá 0,3536;  A1 dá 1
    // medidas da prancha de referência (A1), em milímetros
    const margem = o.margem !== undefined ? o.margem : 10;
    const moldura = o.moldura !== undefined ? o.moldura : 6;
    const alturaCabecalho = o.alturaCabecalho !== undefined ? o.alturaCabecalho : 40;
    /* O RODAPÉ é a faixa dos blocos de identificação: legenda, articulação, fonte e chapa. Nas
     * folhas de referência ela ocupa cerca de um quinto da altura, que é o que dá espaço para
     * legenda longa (unidade litológica tem dezenas de entradas) e para os blocos da chapa. */
    const alturaRodape = o.alturaRodape !== undefined ? o.alturaRodape : 122;
    /* A FAIXA DOS RÓTULOS DE COORDENADA: a grade escreve a longitude ACIMA do mapa e a latitude À
     * ESQUERDA. Sem faixa reservada, os rótulos caíam fora da moldura, invadindo a margem — o
     * cliente viu e disse "os grids estão extrapolando a página". Em cima cabe uma linha de 6 pt
     * mais a marca; à esquerda, um rótulo de "23°35'15,6\"S", que é largo e escrito à direita. */
    const faixaRotulos = { topo: 8, esquerda: 24 };
    const xMapa = margem + moldura + faixaRotulos.esquerda;
    const yMapa = margem + moldura + alturaCabecalho + faixaRotulos.topo;
    return {
      folha: folha,
      orientacao: orientacao || 'paisagem',
      // a PÁGINA é a folha de verdade; as CAIXAS estão em milímetros de A1 (o docEscalado converte)
      larguraFolha: largura,
      alturaFolha: altura,
      base: base,
      larguraDesenho: larguraRef,
      alturaDesenho: alturaRef,
      margem: margem,
      faixaRotulos: faixaRotulos,
      mapa: {
        x: xMapa,
        y: yMapa,
        largura: larguraRef - 2 * (margem + moldura) - faixaRotulos.esquerda,
        altura: alturaRef - 2 * (margem + moldura) - alturaCabecalho - alturaRodape - faixaRotulos.topo,
      },
      cabecalho: { x: margem + moldura, y: margem + moldura, largura: larguraRef - 2 * (margem + moldura), altura: alturaCabecalho },
      rodape: {
        x: margem + moldura,
        y: alturaRef - margem - moldura - alturaRodape,
        largura: larguraRef - 2 * (margem + moldura),
        altura: alturaRodape,
      },
    };
  }

  return {
    criarDocumento: criarDocumento,
    FOLHAS: FOLHAS,
    caixaDoMapa: caixaDoMapa,
    MM_PARA_PT: MM_PARA_PT,
    _dimensoesJpeg: dimensoesJpeg,
    _textoWinAnsi: textoWinAnsi,
  };
});
