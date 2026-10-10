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
      /* TETO POR CAMADA, com o resto declarado.
       *
       * A Pedologia sozinha traz 27 classes e a Geologia, dezenas: uma legenda assim toma a prancha
       * inteira e não se lê. Aqui a camada mostra as mais representativas e DIZ quantas ficaram de
       * fora — cortar em silêncio seria mentir sobre o que está no mapa. A lista completa sai na
       * tabela de áreas e no XLSX. */
      const TETO_POR_CAMADA = 14;
      if (itens.length > TETO_POR_CAMADA) {
        const sobra = itens.length - (TETO_POR_CAMADA - 1);
        itens.length = TETO_POR_CAMADA - 1;
        itens.push({ rotulo: 'e mais ' + sobra + ' classes — ver tabela de áreas', cor: '#c8ced3', forma: 'poligono' });
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
      /* O NOME DO DESENHO NÃO APARECIA, e era erro meu de nome de campo: eu lia `e.deshista` (com o
       * "i" trocado) e o app manda `desenhista`. O campo estava preenchido na tela e a chapa saía
       * vazia. É o quarto defeito desta família na sessão — nome de campo escrito de memória. */
      desenhista: e.desenhista || e.desenho || '',
      verificador: e.verificador || '',
      responsavel: e.responsavel || '',
      crea: e.crea || '',
      tituloChapa: e.tituloChapa || '',
      fonte: e.fonte || '',
      datum: e.datum || 'SIRGAS 2000 / UTM 23S · WGS 84',
      escala: Number(e.escala) || 0,
      extensao: e.extensao || null,
      /* O CONTORNO DO ESTADO, para a articulação. Vem de js/uf-sp.js, extraído do shapefile de
       * Unidades da Federação do cliente (SIRGAS 2000 / UTM 23S, convertido para graus) e
       * generalizado SÓ PARA ESTE DESENHO — as camadas de caracterização não passam por aqui.
       * A caixa do contorno é a régua do quadrado vermelho: sem ela, o quadrado seria posicionado
       * contra uma caixa aproximada e cairia fora de lugar. */
      uf: e.uf || null,
      cobertura: (e.uf && e.uf.bbox) ? e.uf.bbox : (e.cobertura || [-53.2, -25.4, -44.1, -19.7]),
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

    /* SEM CABEÇALHO. O cliente pediu para tirar o nome de cima: o título da folha vive na CHAPA,
     * que é onde ele identifica o documento — e a faixa que sobra vai toda para o mapa. O elemento
     * não é emitido, e não apenas escondido, para não deixar espaço vazio na prancha. */

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
          /* O SUBTÍTULO DA CAMADA SÓ SAI QUANDO EXISTE.
           * O cliente reclamou de "Áreas do usuário" escrito na legenda: era o nome TÉCNICO do
           * grupo, e não o que ele subiu. Sem nome, não há subtítulo — o grupo já identifica. */
          if (camada.nome) p.push('<h4>' + escapar(camada.nome) + '</h4>');
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

    /* ARTICULAÇÃO — o contorno do estado e o quadrado da folha dentro dele.
     *
     * O contorno vem de js/uf-sp.js (extraído do shapefile de Unidades da Federação do cliente), e o
     * quadrado é posicionado pela CAIXA DO PRÓPRIO CONTORNO — a mesma régua que desenhou o estado.
     * Antes a base era um retângulo e a caixa era aproximada: o quadrado podia cair fora de lugar.
     * Com a mesma régua nos dois, não há como divergir. */
    p.push('<section class="bloco bloco-articulacao"><h2>Articulação</h2>');
    if (m.uf && m.uf.caminho) {
      const cob = m.uf.bbox;
      p.push('<div class="articulacao-mapa">');
      p.push('<svg viewBox="0 0 ' + m.uf.largura + ' ' + m.uf.altura
        + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="contorno do estado">');
      p.push('<path class="uf" d="' + m.uf.caminho + '"/>');
      if (m.extensao) {
        const dl = Math.max(1e-9, cob[2] - cob[0]);
        const da = Math.max(1e-9, cob[3] - cob[1]);
        const x = (m.extensao[0] - cob[0]) / dl * m.uf.largura;
        const y = (cob[3] - m.extensao[3]) / da * m.uf.altura;
        const w = Math.max(1.5, (m.extensao[2] - m.extensao[0]) / dl * m.uf.largura);
        const h = Math.max(1.5, (m.extensao[3] - m.extensao[1]) / da * m.uf.altura);
        p.push('<rect class="folha-marca" x="' + x.toFixed(1) + '" y="' + y.toFixed(1)
          + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '"/>');
      }
      p.push('</svg></div>');
    } else {
      // sem o contorno carregado, o quadrinho fica vazio em vez de mentir uma forma
      p.push('<div class="articulacao-caixa"></div>');
    }
    p.push('<p class="nota">a folha, no estado</p></section>');

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
