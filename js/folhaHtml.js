'use strict';
/* ============================================================================
 * folhaHtml.js — A PRANCHA EM HTML/CSS (plano B)
 *
 * POR QUE TROCAR O DESENHO À MÃO PELO HTML:
 *
 * O gerador de PDF escrito à mão não mede texto — ele ESTIMA a largura e corta com "…". Com isso a
 * legenda nunca fica uniforme, os blocos nunca alinham de verdade, e nenhum ajuste resolve: é
 * limite de ferramenta, não de esforço. Depois de dez tentativas de "deixar bonito" no motor
 * antigo, a decisão foi desenhar a prancha em HTML/CSS e deixar o MOTOR DO NAVEGADOR fazer o
 * layout — ele tem métricas reais de fonte, alinhamento, colunas, e imprime em PDF VETORIAL.
 *
 * O QUE ESTE MÓDULO FAZ, e o que ele NÃO faz:
 *  - monta o MODELO da folha (cabeçalho, mapa, legenda por meio, articulação, chapa, fonte);
 *  - o modelo é DADO, testável sem navegador — como servicos.js e consulta.js;
 *  - a SIMBOLOGIA VEM DAS CAMADAS: cada item usa a cor da própria camada/classe (`estilo.cores`),
 *    que é a cor que o mapa desenha. Nada de paleta inventada aqui;
 *  - ele NÃO desenha: quem desenha é o CSS.
 * ========================================================================== */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (raiz) { raiz.EIA = raiz.EIA || {}; raiz.EIA.folhaHtml = api; }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : null), function () {
  'use strict';

  const MEIOS = [
    { id: 'fisico', nome: 'Meio Físico' },
    { id: 'biotico', nome: 'Meio Biótico' },
    { id: 'socioeconomico', nome: 'Meio Socioeconômico' },
  ];

  function escapar(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * A LEGENDA, AGRUPADA POR MEIO — e com a cor de cada camada e de cada classe.
   *
   * `camadas` são as camadas LIGADAS, na ordem do catálogo, cada uma com `estilo.cores` (a paleta
   * que veio da fonte) e `cor`. `classes` (opcional) traz o que apareceu no recorte, para a legenda
   * mostrar só o que está no mapa — mas a COR continua sendo a da camada.
   */
  function legendaPorMeio(camadas, classesPorCamada) {
    const porMeio = new Map();
    for (const m of MEIOS) porMeio.set(m.id, { id: m.id, nome: m.nome, camadas: [] });
    for (const c of (camadas || [])) {
      const meio = porMeio.get(c.meio) || porMeio.get('socioeconomico');
      if (!meio) continue;
      const estilo = c.estilo || {};
      const cores = estilo.cores || {};
      const aparencia = estilo.forma || (c.tipo === 'ponto' ? 'ponto' : (c.tipo === 'linha' ? 'linha' : 'poligono'));
      const itens = [];
      const doRecorte = (classesPorCamada && classesPorCamada[c.id]) || null;
      for (const classe of (doRecorte || c.classes || [])) {
        const nome = typeof classe === 'string' ? classe : classe.classe;
        if (!nome) continue;
        itens.push({
          rotulo: nome,
          // A COR DA CLASSE VEM DA CAMADA. Sem cor própria declarada, a cor da camada.
          cor: cores[nome] || c.cor || estilo.cor || '#9aa7b0',
          forma: aparencia,
        });
      }
      if (!itens.length) {
        itens.push({ rotulo: c.nome || c.id, cor: c.cor || estilo.cor || '#9aa7b0', forma: aparencia });
      }
      meio.camadas.push({ id: c.id, nome: c.nome || c.id, aparencia: aparencia, itens: itens });
    }
    return MEIOS.map((m) => porMeio.get(m.id)).filter((m) => m.camadas.length);
  }

  /** O modelo da folha: tudo o que o CSS precisa desenhar, e nada mais. */
  function montarFolha(espec, opcoes) {
    const e = espec || {};
    const o = opcoes || {};
    const folha = e.folha || 'A1';
    const orientacao = e.orientacao || 'paisagem';
    const MEDIDAS = { A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420], A4: [210, 297] };
    const par = MEDIDAS[folha] || MEDIDAS.A1;
    const largura = orientacao === 'retrato' ? par[0] : par[1];
    const altura = orientacao === 'retrato' ? par[1] : par[0];
    return {
      folha: folha,
      orientacao: orientacao,
      larguraMm: largura,
      alturaMm: altura,
      // cabeçalho e chapa saem como o usuário escreveu — nada de texto padrão (ele pediu em branco)
      titulo: e.titulo || '',
      projeto: e.projeto || '',
      data: e.data || '',
      desenhista: e.deshista === undefined ? (e.desenho || '') : e.deshista,
      verificador: e.verificador || '',
      responsavel: e.responsavel || '',
      crea: e.crea || '',
      tituloChapa: e.tituloChapa || '',
      fonte: e.fonte || '',
      datum: e.datum || 'SIRGAS 2000 / UTM 23S · WGS 84',
      escala: Number(e.escala) || 0,
      extensao: e.extensao || null,
      cobertura: e.cobertura || [-53.2, -25.4, -44.1, -19.7],
      rotulos: e.rotulos || { topo: [], esquerda: [] },
      mapaHref: e.mapaHref || null,
      logos: (e.logos || []).filter((l) => l && l.href),
      legenda: e.legenda || [],
      legendaVazia: !(e.legenda || []).length,
      numeroFolha: e.numeroFolha || '',
      aviso: o.aviso || null,
    };
  }

  /** O modelo -> HTML. Sem estilo embutido: quem estiliza é o CSS da prancha. */
  function paraHtml(m) {
    const p = [];
    p.push('<div class="folha folha-' + escapar(m.folha) + ' folha-' + escapar(m.orientacao) + '"'
      + ' style="--folha-largura:' + m.larguraMm + 'mm;--folha-altura:' + m.alturaMm + 'mm">');
    p.push('<div class="folha-moldura">');

    // ---- cabeçalho
    p.push('<header class="folha-cabecalho">');
    if (m.titulo) p.push('<h1 class="titulo">' + escapar(m.titulo) + '</h1>');
    if (m.projeto) p.push('<p class="projeto">' + escapar(m.projeto) + '</p>');
    p.push('</header>');

    // ---- mapa, com os rótulos de coordenada nas canaletas
    p.push('<div class="folha-corpo">');
    p.push('<div class="canaleta-topo">' + (m.rotulos.topo || []).map((r) => '<span style="left:' + r.pos + '%">' + escapar(r.texto) + '</span>').join('') + '</div>');
    p.push('<div class="canaleta-esquerda">' + (m.rotulos.esquerda || []).map((r) => '<span style="top:' + r.pos + '%">' + escapar(r.texto) + '</span>').join('') + '</div>');
    p.push('<figure class="folha-mapa">');
    if (m.mapaHref) p.push('<img alt="mapa" src="' + m.mapaHref + '">');
    else p.push('<div class="mapa-vazio">o mapa aparece aqui</div>');
    p.push('<span class="norte" title="norte">N</span>');
    p.push('</figure>');
    p.push('</div>');

    // ---- rodapé: legenda | articulação | chapa
    p.push('<footer class="folha-rodape">');

    p.push('<section class="bloco bloco-legenda"><h2>Legenda</h2>');
    if (m.legendaVazia) {
      p.push('<p class="vazio">Ligue as camadas de caracterização para a legenda aparecer.</p>');
    } else {
      for (const meio of m.legenda) {
        p.push('<div class="legenda-meio"><h3>' + escapar(meio.nome) + '</h3>');
        for (const camada of meio.camadas) {
          p.push('<div class="legenda-camada">');
          p.push('<h4>' + escapar(camada.nome) + '</h4>');
          p.push('<ul class="legenda-itens">');
          for (const item of camada.itens) {
            p.push('<li class="forma-' + escapar(item.forma) + '">'
              + '<i class="amostra" style="--cor:' + escapar(item.cor) + '"></i>'
              + '<span class="rotulo">' + escapar(item.rotulo) + '</span></li>');
          }
          p.push('</ul></div>');
        }
        p.push('</div>');
      }
    }
    p.push('</section>');

    // articulação: caixa do estado e o retângulo da folha
    p.push('<section class="bloco bloco-articulacao"><h2>Articulação</h2>');
    p.push('<div class="articulacao-caixa">');
    if (m.extensao) {
      const cob = m.cobertura;
      const lx = (m.extensao[0] - cob[0]) / Math.max(1e-6, cob[2] - cob[0]);
      const ly = (cob[3] - m.extensao[3]) / Math.max(1e-6, cob[3] - cob[1]);
      const ll = (m.extensao[2] - m.extensao[0]) / Math.max(1e-6, cob[2] - cob[0]);
      const la = (m.extensao[3] - m.extensao[1]) / Math.max(1e-6, cob[3] - cob[1]);
      p.push('<span class="folha-marca" style="left:' + (lx * 100).toFixed(2) + '%;top:' + (ly * 100).toFixed(2)
        + '%;width:' + Math.max(1.2, ll * 100).toFixed(2) + '%;height:' + Math.max(1, la * 100).toFixed(2) + '%"></span>');
    }
    p.push('</div><p class="nota">a folha, no estado</p></section>');

    // chapa
    p.push('<section class="bloco bloco-chapa">');
    if (m.tituloChapa) p.push('<h2 class="chapa-titulo">' + escapar(m.tituloChapa) + '</h2>');
    p.push('<p class="chapa-projeto">' + escapar(m.projeto || '') + '</p>');
    p.push('<table class="chapa-tabela"><thead><tr>'
      + '<th>DATA</th><th>ESCALA</th><th>DESENHO</th><th>VERIFICADO</th></tr></thead><tbody><tr>'
      + '<td>' + escapar(m.data) + '</td>'
      + '<td>' + (m.escala > 0 ? '1:' + escapar(m.escala.toLocaleString('pt-BR')) : '') + '</td>'
      + '<td>' + escapar(m.desenhista) + '</td>'
      + '<td>' + escapar(m.verificador) + '</td>'
      + '</tr></tbody></table>');
    p.push('<div class="chapa-logos">'
      + (m.logos.length ? m.logos.map((l) => '<img alt="" src="' + l.href + '">').join('')
        : '<span class="vazio">logos: nenhum enviado</span>')
      + '</div>');
    p.push('<p class="chapa-fonte"><b>FONTE</b> ' + escapar(m.fonte || '—') + '</p>');
    p.push('<p class="chapa-datum">' + escapar(m.datum) + '</p>');
    if (m.responsavel || m.crea) {
      p.push('<p class="chapa-resp">Resp. técnico: ' + escapar(m.responsavel)
        + (m.crea ? ' — CREA ' + escapar(m.crea) : '') + '</p>');
    }
    p.push('<span class="chapa-folha">' + escapar(m.numeroFolha) + '</span>');
    p.push('</section>');

    p.push('</footer>');
    p.push('</div></div>');
    return p.join('');
  }

  return {
    MEIOS: MEIOS,
    escapar: escapar,
    legendaPorMeio: legendaPorMeio,
    montarFolha: montarFolha,
    paraHtml: paraHtml,
  };
}));
