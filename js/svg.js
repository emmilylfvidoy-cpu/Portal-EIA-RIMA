'use strict';
/* ============================================================================
 * svg.js — gráficos e escala gráfica em SVG, gerados por código
 *
 * Sem biblioteca de gráficos: o que o EIA precisa é barra, pizza e escala gráfica
 * em vetor, para entrar no PDF e no relatório com nitidez. Gerar o SVG à mão também
 * permite usar exatamente as cores e os rótulos do projeto.
 * ========================================================================== */

(function (raiz, fabrica) {
  const node = typeof module === 'object' && module.exports;
  const math = node ? require('./math.js') : raiz.EIA.math;
  const api = fabrica(math);
  if (node) module.exports = api;
  if (raiz) {
    raiz.EIA = raiz.EIA || {};
    raiz.EIA.svg = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (math) {

  const PALETA = ['#2f6b3a', '#8a6d3b', '#2f5b8a', '#b98645', '#7a4f8a', '#a33f3f',
    '#3f8a8a', '#6b8a2f', '#8a2f6b', '#4f5f8a', '#8a7a2f', '#2f8a6b'];

  function cor(i) { return PALETA[i % PALETA.length]; }

  function escapar(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function abre(largura, altura, titulo) {
    const partes = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + largura + '" height="' + altura
        + '" viewBox="0 0 ' + largura + ' ' + altura + '" font-family="Segoe UI, Arial, sans-serif">',
      '<rect width="' + largura + '" height="' + altura + '" fill="#ffffff"/>',
    ];
    if (titulo) {
      partes.push('<text x="' + (largura / 2) + '" y="22" text-anchor="middle" font-size="15" font-weight="600" fill="#1f2d36">'
        + escapar(titulo) + '</text>');
    }
    return partes;
  }

  /**
   * Gráfico de barras verticais.
   * @param {{rotulo:string, valor:number, cor?:string}[]} dados
   */
  function barras(dados, opcoes) {
    const o = opcoes || {};
    const largura = o.largura || 640;
    const altura = o.altura || 320;
    const margem = { top: o.titulo ? 44 : 18, right: 18, bottom: 78, left: 76 };
    const baseY = altura - margem.bottom;
    const larguraUtil = largura - margem.left - margem.right;
    const alturaUtil = baseY - margem.top;
    const max = Math.max.apply(null, dados.map((d) => Math.abs(d.valor)).concat([1e-9]));
    const passo = larguraUtil / Math.max(1, dados.length);
    const larguraBarra = Math.min(o.larguraBarra || 64, passo * 0.68);

    const p = abre(largura, altura, o.titulo);
    // eixos
    p.push('<line x1="' + margem.left + '" y1="' + baseY + '" x2="' + (largura - margem.right) + '" y2="' + baseY + '" stroke="#9aa7b0"/>');
    p.push('<line x1="' + margem.left + '" y1="' + margem.top + '" x2="' + margem.left + '" y2="' + baseY + '" stroke="#9aa7b0"/>');

    // linhas de grade + rótulo do eixo
    const nGrade = 4;
    for (let g = 0; g <= nGrade; g++) {
      const y = baseY - alturaUtil * g / nGrade;
      const v = max * g / nGrade;
      p.push('<line x1="' + margem.left + '" y1="' + y + '" x2="' + (largura - margem.right) + '" y2="' + y + '" stroke="#e6ebee"/>');
      p.push('<text x="' + (margem.left - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#5b6b75">'
        + math.num(v, v >= 100 ? 0 : 2) + '</text>');
    }
    if (o.rotuloY) {
      p.push('<text x="16" y="' + (margem.top + alturaUtil / 2) + '" font-size="11" fill="#5b6b75" transform="rotate(-90 16 '
        + (margem.top + alturaUtil / 2) + ')" text-anchor="middle">' + escapar(o.rotuloY) + '</text>');
    }

    dados.forEach((d, i) => {
      const cx = margem.left + passo * (i + 0.5);
      const h = alturaUtil * Math.abs(d.valor) / max;
      const corBarra = d.cor || cor(i);
      p.push('<rect x="' + (cx - larguraBarra / 2) + '" y="' + (baseY - h) + '" width="' + larguraBarra
        + '" height="' + h + '" fill="' + corBarra + '" rx="2"/>');
      p.push('<text x="' + cx + '" y="' + (baseY - h - 6) + '" text-anchor="middle" font-size="11" fill="#1f2d36">'
        + math.num(d.valor, d.valor >= 100 ? 1 : 3) + '</text>');
      // rótulo quebrado em até 2 linhas
      const linhas = quebrar(d.rotulo, 14);
      linhas.slice(0, 2).forEach((linha, k) => {
        p.push('<text x="' + cx + '" y="' + (baseY + 16 + k * 13) + '" text-anchor="middle" font-size="11" fill="#43535d">'
          + escapar(linha) + '</text>');
      });
    });

    p.push('</svg>');
    return p.join('');
  }

  /** Gráfico de pizza (participação). */
  function pizza(dados, opcoes) {
    const o = opcoes || {};
    const largura = o.largura || 560;
    const altura = o.altura || 320;
    const cx = o.titulo ? 150 : 130;
    const cy = altura / 2 + (o.titulo ? 10 : 0);
    const raio = Math.min(altura * 0.34, 110);
    const total = dados.reduce((s, d) => s + Math.abs(d.valor), 0) || 1;

    const p = abre(largura, altura, o.titulo);
    let angulo = -Math.PI / 2;
    dados.forEach((d, i) => {
      const fracao = Math.abs(d.valor) / total;
      if (fracao <= 0) return;
      const fim = angulo + fracao * 2 * Math.PI;
      const corFatia = d.cor || cor(i);
      if (fracao >= 0.9999) {
        p.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + raio + '" fill="' + corFatia + '"/>');
      } else {
        const x1 = cx + raio * Math.cos(angulo), y1 = cy + raio * Math.sin(angulo);
        const x2 = cx + raio * Math.cos(fim), y2 = cy + raio * Math.sin(fim);
        const grande = fracao > 0.5 ? 1 : 0;
        p.push('<path d="M ' + cx + ' ' + cy + ' L ' + x1.toFixed(2) + ' ' + y1.toFixed(2)
          + ' A ' + raio + ' ' + raio + ' 0 ' + grande + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' Z" fill="' + corFatia + '"/>');
      }
      angulo = fim;
    });

    // legenda
    const xLegenda = cx + raio + 28;
    let y = cy - Math.min(dados.length, 12) * 9;
    dados.slice(0, 12).forEach((d, i) => {
      p.push('<rect x="' + xLegenda + '" y="' + (y - 8) + '" width="11" height="11" fill="' + (d.cor || cor(i)) + '" rx="2"/>');
      p.push('<text x="' + (xLegenda + 17) + '" y="' + y + '" font-size="11" fill="#1f2d36">'
        + escapar(quebrar(d.rotulo, 26)[0]) + ' — ' + math.num(Math.abs(d.valor) / total * 100, 2) + '%</text>');
      y += 18;
    });
    if (dados.length > 12) {
      p.push('<text x="' + xLegenda + '" y="' + (y + 2) + '" font-size="11" fill="#5b6b75">+ ' + (dados.length - 12) + ' classes</text>');
    }
    p.push('</svg>');
    return p.join('');
  }

  /** Barras agrupadas: mesma classe em várias áreas de influência. */
  function barrasAgrupadas(categorias, series, opcoes) {
    const o = opcoes || {};
    const largura = o.largura || 720;
    const altura = o.altura || 340;
    const margem = { top: o.titulo ? 46 : 18, right: 18, bottom: 92, left: 76 };
    const baseY = altura - margem.bottom;
    const larguraUtil = largura - margem.left - margem.right;
    const alturaUtil = baseY - margem.top;
    let max = 1e-9;
    for (const s of series) for (const v of s.valores) max = Math.max(max, Math.abs(v));
    const passo = larguraUtil / Math.max(1, categorias.length);
    const larguraGrupo = Math.min(o.larguraGrupo || 84, passo * 0.76);
    const larguraBarra = larguraGrupo / Math.max(1, series.length);

    const p = abre(largura, altura, o.titulo);
    p.push('<line x1="' + margem.left + '" y1="' + baseY + '" x2="' + (largura - margem.right) + '" y2="' + baseY + '" stroke="#9aa7b0"/>');
    for (let g = 0; g <= 4; g++) {
      const y = baseY - alturaUtil * g / 4;
      p.push('<line x1="' + margem.left + '" y1="' + y + '" x2="' + (largura - margem.right) + '" y2="' + y + '" stroke="#e6ebee"/>');
      p.push('<text x="' + (margem.left - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" fill="#5b6b75">'
        + math.num(max * g / 4, 0) + '</text>');
    }
    categorias.forEach((cat, i) => {
      const cx = margem.left + passo * (i + 0.5);
      series.forEach((s, k) => {
        const h = alturaUtil * Math.abs(s.valores[i] || 0) / max;
        const x = cx - larguraGrupo / 2 + k * larguraBarra;
        p.push('<rect x="' + x + '" y="' + (baseY - h) + '" width="' + (larguraBarra - 2) + '" height="' + h
          + '" fill="' + (s.cor || cor(k)) + '" rx="1"/>');
      });
      quebrar(cat, 12).slice(0, 2).forEach((linha, k) => {
        p.push('<text x="' + cx + '" y="' + (baseY + 16 + k * 13) + '" text-anchor="middle" font-size="11" fill="#43535d">'
          + escapar(linha) + '</text>');
      });
    });
    // legenda das séries
    let xLeg = margem.left;
    series.forEach((s, k) => {
      p.push('<rect x="' + xLeg + '" y="' + (altura - 26) + '" width="11" height="11" fill="' + (s.cor || cor(k)) + '" rx="2"/>');
      p.push('<text x="' + (xLeg + 16) + '" y="' + (altura - 17) + '" font-size="11" fill="#1f2d36">' + escapar(s.nome) + '</text>');
      xLeg += 22 + String(s.nome).length * 6.6;
    });
    p.push('</svg>');
    return p.join('');
  }

  /**
   * Escala gráfica em barra (1:50.000 -> trechos de 1 km).
   * Devolve SVG para o compositor de mapa colar no layout.
   */
  function escalaGrafica(metrosPorPixel, opcoes) {
    const o = opcoes || {};
    const larguraAlvo = o.largura || 260;
    const escala = o.escala || 50000;
    // escolhe um passo "redondo" em km que caiba na largura pedida
    const passos = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000, 100000];
    let passo = passos[passos.length - 1];
    for (const p of passos) {
      const px = p / metrosPorPixel;
      if (px * 4 <= larguraAlvo) { passo = p; break; }
    }
    const pxPasso = passo / metrosPorPixel;
    const nTrechos = Math.max(2, Math.min(6, Math.floor(larguraAlvo / pxPasso)));
    const largura = pxPasso * nTrechos;
    const altura = 26;
    const y = 8;
    const partes = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.ceil(largura + 24)
      + '" height="' + altura + '" font-family="Segoe UI, Arial, sans-serif">'];
    for (let i = 0; i < nTrechos; i++) {
      const corTrecho = i % 2 === 0 ? '#1f2d36' : '#ffffff';
      partes.push('<rect x="' + (12 + i * pxPasso) + '" y="' + y + '" width="' + pxPasso + '" height="7" fill="'
        + corTrecho + '" stroke="#1f2d36" stroke-width="0.6"/>');
    }
    for (let i = 0; i <= nTrechos; i++) {
      const x = 12 + i * pxPasso;
      partes.push('<line x1="' + x + '" y1="' + y + '" x2="' + x + '" y2="' + (y + 7) + '" stroke="#1f2d36" stroke-width="0.6"/>');
      const km = (i * passo) / 1000;
      partes.push('<text x="' + x + '" y="' + (y + 20) + '" text-anchor="middle" font-size="9" fill="#1f2d36">'
        + (km >= 1 ? math.num(km, km % 1 === 0 ? 0 : 1) : math.num(km * 1000, 0)) + (km >= 1 ? ' km' : ' m') + '</text>');
    }
    partes.push('<text x="12" y="' + (altura - 1) + '" font-size="9" fill="#5b6b75">Escala 1:'
      + math.num(escala, 0) + ' · sistema SIRGAS 2000</text>');
    partes.push('</svg>');
    return partes.join('');
  }

  /** Seta de norte. */
  function norte(tamanho) {
    const t = tamanho || 44;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + t + '" height="' + (t + 14) + '" font-family="Segoe UI, Arial, sans-serif">'
      + '<polygon points="' + (t / 2) + ',2 ' + (t - 6) + ',' + (t - 4) + ' ' + (t / 2) + ',' + (t * 0.72) + ' 6,' + (t - 4)
      + '" fill="#1f2d36"/>'
      + '<text x="' + (t / 2) + '" y="' + (t + 11) + '" text-anchor="middle" font-size="10" fill="#1f2d36">N</text>'
      + '</svg>';
  }

  /** Quadro de legenda em SVG a partir de itens { rotulo, cor, forma }. */
  function legenda(itens, opcoes) {
    const o = opcoes || {};
    const largura = o.largura || 240;
    const alturaLinha = 18;
    const altura = 14 + itens.length * alturaLinha;
    const p = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + largura + '" height="' + altura
      + '" font-family="Segoe UI, Arial, sans-serif">'];
    if (o.titulo) p.push('<text x="4" y="12" font-size="12" font-weight="600" fill="#1f2d36">' + escapar(o.titulo) + '</text>');
    itens.forEach((it, i) => {
      const y = 14 + i * alturaLinha;
      if (it.forma === 'linha') {
        p.push('<line x1="6" y1="' + (y + 4) + '" x2="28" y2="' + (y + 4) + '" stroke="' + (it.cor || '#333')
          + '" stroke-width="' + (it.espessura || 2.4) + '"/>');
      } else if (it.forma === 'ponto') {
        p.push('<circle cx="17" cy="' + (y + 4) + '" r="4.2" fill="' + (it.cor || '#333') + '" stroke="#fff" stroke-width="1"/>');
      } else {
        p.push('<rect x="6" y="' + y + '" width="22" height="10" fill="' + (it.cor || '#ccc') + '" stroke="#7d8b93" stroke-width="0.5"/>');
      }
      p.push('<text x="36" y="' + (y + 9) + '" font-size="11" fill="#1f2d36">' + escapar(quebrar(it.rotulo, 30)[0]) + '</text>');
    });
    p.push('</svg>');
    return p.join('');
  }

  function quebrar(texto, max) {
    const t = String(texto === null || texto === undefined ? '' : texto);
    if (t.length <= max) return [t];
    const palavras = t.split(/\s+/);
    const linhas = [];
    let linha = '';
    for (const palavra of palavras) {
      if ((linha + ' ' + palavra).trim().length > max) {
        if (linha) linhas.push(linha);
        linha = palavra;
      } else {
        linha = (linha + ' ' + palavra).trim();
      }
    }
    if (linha) linhas.push(linha);
    return linhas;
  }

  /**
   * Converte um SVG em PNG (navegador): desenha num canvas e devolve data URL.
   * Em Node devolve null — não há canvas, e o teste não deve depender de tela.
   */
  async function paraPngDataUrl(svg, escala) {
    if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
    const e = escala || 2;
    const largura = Number((/<svg[^>]*width="(\d+(?:\.\d+)?)"/.exec(svg) || [])[1] || 640);
    const altura = Number((/<svg[^>]*height="(\d+(?:\.\d+)?)"/.exec(svg) || [])[1] || 320);
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const img = await carregarImagem(url);
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(largura * e);
      canvas.height = Math.ceil(altura * e);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function carregarImagem(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Não foi possível renderizar o gráfico.'));
      img.src = url;
    });
  }

  return {
    PALETA: PALETA,
    cor: cor,
    barras: barras,
    pizza: pizza,
    barrasAgrupadas: barrasAgrupadas,
    escalaGrafica: escalaGrafica,
    norte: norte,
    legenda: legenda,
    quebrar: quebrar,
    paraPngDataUrl: paraPngDataUrl,
    escapar: escapar,
  };
});
