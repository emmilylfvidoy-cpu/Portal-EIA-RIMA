'use strict';
/* ============================================================================
 * app.js — interface do Portal EIA/RIMA
 *
 * Amarra a tela ao motor verificado em js/: catálogo de camadas, upload de áreas
 * de influência (shp/kmz/geojson), recorte, tabela, gráficos, relatório e o
 * compositor de mapa com articulação.
 *
 * Regra de ouro deste arquivo: nenhum cálculo ambiental acontece aqui. Área,
 * recorte e escala vêm de js/recorte.js, js/vetorial.js e js/mapa.js — a interface
 * só coleta dados e mostra resultado.
 * ========================================================================== */

(function () {
  const EIA = window.EIA;

  /* Versão do portal — aparece no rodapé do mapa.
   * Existe por um motivo prático: sem ela, não há como saber se o site publicado é o
   * atual ou uma versão antiga em cache. Toda alteração publicada incrementa este
   * número, e a lista completa fica no README. */
  const VERSAO = 'v3.11';
  const VERSAO_DATA = '2026-10-07';

  const estado = {
    catalogo: null,
    areas: [],
    camadas: [],           // camadas carregadas (com geojson)
    camadasLigadas: new Set(),
    resultados: [],
    resumo: null,
    relato: null,
    // Agrupamento escolhido pelo usuário: { idDaCamada: [colunas] }. Vazio = usa o
    // campo de classe de cada camada, que é o padrão.
    agrupamento: {},
    // Aparência escolhida pelo usuário, por camada: transparência (0..1) e coluna do rótulo.
    transparencia: {},
    rotulos: {},
    // Linha escolhida por camada: { cor, estilo (linear/tracejado/pontilhado/traco-ponto),
    // grossura }. Vazio = o desenho do arquivo de estilo da camada.
    linhas: {},
    grupoRotulos: null,
    rotulosPostos: 0,
    rotulosCortados: 0,
    // Ordem de desenho das camadas, do FUNDO para o TOPO (o último desenha por cima).
    // É estado, não a ordem em que o Leaflet recebeu as camadas: ver js/mapa.js.
    ordemCamadas: [],
    // As áreas de influência do usuário desenham por cima das camadas de caracterização
    // por padrão — é o que ele acabou de inserir e quer conferir sobre o mapa.
    areasAcima: true,
    // Quilometragem: a camada que o usuário subiu (marcos de km ou o traçado da rodovia),
    // a coluna do km e o marcador da última busca. Camada de km NÃO entra no recorte: ela
    // serve para localizar, não é caracterização do meio.
    // Camadas publicadas em tiles binários: índice, tiles já carregados e o que está em voo.
    indices: {},
    tilesCarregados: {},
    // Nível em memória por camada ('exato' ou 'visao'): trocar de nível descarta o que estava
    // carregado, senão as duas versões da mesma camada ficariam desenhadas juntas.
    nivelCarregado: {},
    kmCamada: null,
    kmCampo: null,
    grupoKm: null,
    marcadorKm: null,
    logos: [],
    desenhando: false,
    desenho: null,
    pontosDesenho: [],
    mapa: null,
    grupoAreas: null,
    grupoCamadas: null,
    grupoResultado: null,
    base: null,
    vez: 0,
  };

  const CORES_AREAS = ['#d94f3d', '#e08a2f', '#8a5fd9', '#2f8ad9', '#d92f8a', '#4f8a2f'];
  const CORES_MEIO = { fisico: '#8a6d3b', biotico: '#2f6b3a', socioeconomico: '#2f5b8a' };

  const $ = (id) => document.getElementById(id);
  const status = (texto, erro) => {
    const el = $('status-topo');
    el.textContent = texto || '';
    el.style.color = erro ? '#ffc9c0' : '#cfe0e6';
  };

  // =========================================================== inicialização
  function iniciar() {
    montarMapa();
    ligarEventos();
    carregarCatalogo();
    atualizarPreviaMapa();
    // Versão no rodapé + no console: é a primeira coisa a conferir quando alguém
    // pergunta "o site já está com a atualização?".
    const elVersao = $('versao');
    if (elVersao) elVersao.textContent = VERSAO + ' · ' + VERSAO_DATA;
    console.info('Portal EIA/RIMA ' + VERSAO + ' (' + VERSAO_DATA + ')');
  }

  /* Área de cobertura padrão: Estado de São Paulo. O catálogo pode sobrescrever
   * (`extensao_inicial`), que é como o portal vai ser replicado para outros estados
   * sem mexer no código. */
  const COBERTURA_PADRAO = [-53.2, -25.4, -44.1, -19.7];

  /** Enquadra o mapa na área de cobertura declarada. */
  function aplicarCobertura(bbox) {
    if (!estado.mapa || !bbox || bbox.length !== 4) return;
    const valido = bbox.every((x) => typeof x === 'number' && isFinite(x));
    if (!valido) return;
    estado.mapa.__cobertura = bbox;
    estado.mapa.fitBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]], { padding: [14, 14] });
  }

  function montarMapa() {
    /* O enquadramento vem do CATÁLOGO, não de uma constante de cidade. A constante
     * antiga (Piracicaba, zoom 10) fazia a camada estadual de Geologia parecer
     * CORTADA: o mapa abria mostrando ~40 km de um estado de 920 km. */
    const centro = [(COBERTURA_PADRAO[1] + COBERTURA_PADRAO[3]) / 2,
      (COBERTURA_PADRAO[0] + COBERTURA_PADRAO[2]) / 2];
    const mapa = L.map('mapa', {
      center: centro,
      zoom: 6,
      zoomControl: false,
      preferCanvas: true,
      renderer: L.canvas({ padding: 0.4, preserveDrawingBuffer: true }),
    });
    estado.mapa = mapa;
    mapa.__cobertura = COBERTURA_PADRAO;

    /* ------------------------------------------------------------------ FERRAMENTA "i"
     * Clicar na camada e ver os ATRIBUTOS da feição.
     *
     * A consulta roda sobre as camadas LIGADAS — consultar camada desligada seria mentir sobre o
     * que está no mapa. A conta (ponto dentro do polígono respeitando FURO, tolerância para linha
     * e ponto) está em js/consulta.js, que é verificada sem navegador; aqui fica só o balão.
     *
     * LIMITE HONESTO: nas camadas em tiles só existem em memória as feições da área que o mapa
     * carregou. Se a camada ainda não desenhou aquele ponto, não há o que consultar — e o balão
     * diz isso, em vez de dizer que não há nada.
     */
    estado.identificar = false;
    const botaoIdentificar = $('identificar');
    function marcarIdentificar(ligado) {
      estado.identificar = ligado;
      if (botaoIdentificar) {
        botaoIdentificar.classList.toggle('ativa', ligado);
        botaoIdentificar.setAttribute('aria-pressed', ligado ? 'true' : 'false');
      }
      const alvo = $('mapa');
      if (alvo) alvo.classList.toggle('identificando', ligado);
    }
    if (botaoIdentificar) botaoIdentificar.addEventListener('click', () => marcarIdentificar(!estado.identificar));

    /* Os valores vêm de arquivo de terceiro: entram no HTML como TEXTO, nunca como marcação. */
    function escapar(v) {
      return String(v === null || v === undefined ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    mapa.on('click', function (ev) {
      if (!estado.identificar) return;
      const achados = EIA.consulta.encontrar(estado.camadas, [ev.latlng.lng, ev.latlng.lat]);
      mapa.closePopup();
      if (!achados.length) {
        L.popup({ maxWidth: 300 }).setLatLng(ev.latlng).setContent(
          '<div class="balao-consulta"><b>Nada neste ponto</b>'
          + '<p class="balao-nota">Confira se a camada está ligada e se ela já desenhou esta parte do '
          + 'mapa: as camadas em tiles carregam por área, então uma parte ainda não vista não tem o '
          + 'que consultar.</p></div>').openOn(mapa);
        return;
      }
      const partes = achados.map(function (x) {
        const cor = (x.camada.estilo && x.camada.estilo.cor) || x.camada.cor || '#888';
        const feicoes = x.feicoes.map(function (f) {
          const props = f.properties || {};
          const linhas = Object.keys(props).slice(0, 20).map(function (k) {
            return '<tr><th>' + escapar(k) + '</th><td>' + escapar(EIA.consulta.formatarValor(props[k])) + '</td></tr>';
          }).join('');
          return '<div class="balao-feicao"><div class="balao-rotulo">'
            + escapar(EIA.consulta.rotulo(f, x.camada)) + '</div><table>' + linhas + '</table></div>';
        }).join('');
        const mais = x.total > x.feicoes.length
          ? '<p class="balao-nota">+ ' + (x.total - x.feicoes.length) + ' feição(ões) desta camada neste ponto.</p>'
          : '';
        return '<div class="balao-titulo"><span class="balao-cor" style="background:' + escapar(cor) + '"></span>'
          + escapar(x.camada.nome) + (x.total > 1 ? ' <span class="balao-conta">' + x.total + '</span>' : '')
          + '</div>' + feicoes + mais;
      }).join('');
      L.popup({ maxWidth: 360, maxHeight: 340 }).setLatLng(ev.latlng)
        .setContent('<div class="balao-consulta">' + partes + '</div>').openOn(mapa);
    });

    estado.base = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Imagens: Esri, Maxar, Earthstar Geographics',
      crossOrigin: 'anonymous',
    }).addTo(mapa);
    estado.base.on('tileerror', () => {
      $('aviso-mapa').hidden = false;
      $('aviso-mapa').textContent = 'Sem acesso ao mapa de fundo (offline?). As camadas do projeto continuam funcionando.';
    });

    /* PAINÉIS COM z-index EXPLÍCITO.
     *
     * O Leaflet desenha por cima quem foi adicionado por último, e `desenharCamadas()` limpa e
     * readiciona as camadas a cada ajuste de transparência ou ao ligar outra camada. Com isso
     * as camadas de caracterização subiam por cima das áreas de influência do usuário, e as
     * áreas "sumiam" sem ninguém pedir. Painel próprio com número resolve: a ordem passa a ser
     * ESTADO, não efeito de quem foi adicionado por último. */
    mapa.createPane('pane-areas');
    mapa.createPane('pane-resultado');
    // A camada de km fica acima das camadas de caracterização (é referência de localização,
    // precisa ser vista) e abaixo dos rótulos e do marcador da busca.
    mapa.createPane('pane-km');
    mapa.getPane('pane-km').style.zIndex = EIA.mapa.Z_CAMADAS + 60;
    /* ---------------------------------------------------- PAINÉIS LATERAIS: RETRAIR E ESTICAR
     *
     * A largura das colunas vive em variáveis CSS (--largura-esq / --largura-dir), então esticar
     * é trocar o valor — o grid faz o resto. O ponto que NÃO pode ser esquecido: a cada mudança o
     * Leaflet precisa saber que o tamanho dele mudou (`invalidateSize`), senão ele continua
     * desenhando na largura antiga e o mapa aparece torto e cortado.
     *
     * A alça de arrasto é presa ao documento durante o movimento (e não à alça), para o arrasto
     * não parar quando o ponteiro sai do fio de 6 px — que é o que acontece em todo arrasto real.
     */
    function prepararPaineis() {
      const layout = document.querySelector('.layout');
      const esquerda = document.querySelector('.coluna.esquerda');
      const direita = document.querySelector('.coluna.direita');
      const area = document.querySelector('.mapa-area');
      if (!layout || !esquerda || !direita || !area) return;

      const LIMITE = { esq: [190, 640], dir: [240, 780] };
      let guardado = {};
      try { guardado = JSON.parse(localStorage.getItem('eia-paineis') || '{}') || {}; } catch (e) { guardado = {}; }
      const painel = {
        esq: Number(guardado.esq) || 330,
        dir: Number(guardado.dir) || 400,
        recolhidaEsq: !!guardado.recolhidaEsq,
        recolhidaDir: !!guardado.recolhidaDir,
      };
      function salvar() {
        try { localStorage.setItem('eia-paineis', JSON.stringify(painel)); } catch (e) { /* sem armazenamento: segue sem lembrar */ }
      }
      const abas = {};
      function aplicar(revalidar) {
        layout.style.setProperty('--largura-esq', (painel.recolhidaEsq ? 0 : painel.esq) + 'px');
        layout.style.setProperty('--largura-dir', (painel.recolhidaDir ? 0 : painel.dir) + 'px');
        esquerda.classList.toggle('recolhida', painel.recolhidaEsq);
        direita.classList.toggle('recolhida', painel.recolhidaDir);
        if (abas.esq) {
          abas.esq.textContent = painel.recolhidaEsq ? '›' : '‹';
          abas.esq.title = (painel.recolhidaEsq ? 'Mostrar' : 'Retrair') + ' o painel de camadas';
        }
        if (abas.dir) {
          abas.dir.textContent = painel.recolhidaDir ? '‹' : '›';
          abas.dir.title = (painel.recolhidaDir ? 'Mostrar' : 'Retrair') + ' o painel de resultados';
        }
        if (revalidar) mapa.invalidateSize();
      }
      function criarAba(lado) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'aba-painel ' + lado;
        b.addEventListener('click', function () {
          if (lado === 'esq') painel.recolhidaEsq = !painel.recolhidaEsq;
          else painel.recolhidaDir = !painel.recolhidaDir;
          aplicar(true);
          salvar();
        });
        area.appendChild(b);
        abas[lado] = b;
      }
      function criarAlca(coluna, lado) {
        const h = document.createElement('div');
        h.className = 'coluna-alca ' + lado;
        h.title = 'Arraste para esticar';
        coluna.appendChild(h);
        h.addEventListener('mousedown', function (ev) {
          ev.preventDefault();
          const x0 = ev.clientX;
          const largura0 = lado === 'esq' ? painel.esq : painel.dir;
          document.body.classList.add('esticando');
          function mover(e2) {
            const delta = lado === 'esq' ? (e2.clientX - x0) : (x0 - e2.clientX);
            const lim = lado === 'esq' ? LIMITE.esq : LIMITE.dir;
            const v = Math.max(lim[0], Math.min(lim[1], Math.round(largura0 + delta)));
            if (lado === 'esq') { painel.esq = v; painel.recolhidaEsq = false; } else { painel.dir = v; painel.recolhidaDir = false; }
            aplicar(false);   // durante o arrasto não revalida: é caro e não muda nada na tela
          }
          function soltar() {
            document.removeEventListener('mousemove', mover);
            document.removeEventListener('mouseup', soltar);
            document.body.classList.remove('esticando');
            aplicar(true);
            salvar();
          }
          document.addEventListener('mousemove', mover);
          document.addEventListener('mouseup', soltar);
        });
      }
      criarAlca(esquerda, 'esq');
      criarAlca(direita, 'dir');
      criarAba('esq');
      criarAba('dir');
      // no arranque REVALIDA: se houver painel recolhido guardado, o mapa já nasce no tamanho certo
      aplicar(true);
    }
    prepararPaineis();

    estado.grupoCamadas = L.layerGroup().addTo(mapa);
    estado.grupoAreas = L.layerGroup().addTo(mapa);
    estado.grupoResultado = L.layerGroup().addTo(mapa);
    // Rótulos por cima de tudo: são texto, e texto embaixo de polígono não se lê.
    estado.grupoRotulos = L.layerGroup().addTo(mapa);
    estado.grupoKm = L.layerGroup().addTo(mapa);
    estado.ordemCamadas = EIA.mapa.ordemInicial([]);
    aplicarOrdemDasCamadas();

    mapa.on('mousemove', (ev) => {
      $('coordenadas').textContent = 'WGS 84 · ' + EIA.math.dms(ev.latlng.lng, 'lon') + ' · ' + EIA.math.dms(ev.latlng.lat, 'lat');
    });
    mapa.on('zoomend', () => {
      if ($('articulado').checked) atualizarInfoArticulacao();
      atualizarRotulos();
    });
    // Ao mover o mapa, os rótulos são refeitos: rotula só o que está na tela, senão
    // 2.102 feições viram 2.102 elementos no DOM.
    mapa.on('moveend', () => {
      atualizarRotulos();
      // As camadas em tile buscam o que entrou na tela (com uma espera, para não disparar uma
      // busca a cada arrastão do mouse).
      clearTimeout(estado.esperaTiles);
      estado.esperaTiles = setTimeout(() => atualizarTilesLigados(), 350);
    });
    mapa.on('click', aoClicarNoMapa);

    $('zoom-mais').onclick = () => mapa.zoomIn();
    $('zoom-menos').onclick = () => mapa.zoomOut();
    $('enquadrar').onclick = enquadrarTudo;
    $('tela-cheia').onclick = () => {
      const el = document.querySelector('.mapa-area');
      if (!document.fullscreenElement) el.requestFullscreen().then(() => mapa.invalidateSize());
      else document.exitFullscreen().then(() => mapa.invalidateSize());
    };
  }

  function ligarEventos() {
    $('upload-areas').onchange = (ev) => carregarArquivos(Array.from(ev.target.files || []));
    $('upload-km').onchange = (ev) => carregarKm(Array.from(ev.target.files || []));
    $('btn-localizar-km').onclick = localizarKm;
    // Enter no campo de km localiza — é o gesto de quem está digitando o km e olhando o mapa
    $('busca-km').onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); localizarKm(); } };
    $('campo-km').onchange = () => {
      estado.kmCampo = $('campo-km').value;
      desenharKm();
      if ($('busca-km').value) localizarKm();
    };
    $('areas-acima').onchange = (ev) => alternarAreasAcima(ev.target.checked);
    $('btn-desenhar').onclick = alternarDesenho;
    $('btn-recortar').onclick = executarRecorte;
    $('btn-export-geojson').onclick = () => exportar('geojson');
    $('btn-export-shp').onclick = () => exportar('shp');
    $('btn-export-kmz').onclick = () => exportar('kmz');
    $('btn-xlsx').onclick = () => exportarTabela('xlsx');
    $('btn-csv').onclick = () => exportarTabela('csv');
    $('btn-grafico-png').onclick = baixarGraficoPng;
    $('btn-grafico-svg').onclick = baixarGraficoSvg;
    $('btn-relatorio-pdf').onclick = gerarPdfRelatorio;
    $('btn-relatorio-docx').onclick = baixarDocx;
    $('btn-relatorio-txt').onclick = baixarTextoRelatorio;
    $('btn-mapa-previa').onclick = atualizarPreviaMapa;
    $('btn-mapa-png').onclick = baixarFolhaPng;
    $('btn-mapa-pdf').onclick = gerarPdfMapa;
    $('btn-escala-auto').onclick = sugerirEscala;
    $('visao-tabela').onchange = renderizarTabela;
    $('filtro-meio').onchange = () => { renderizarTabela(); renderizarGraficos(); };
    $('grafico-tipo').onchange = renderizarGraficos;
    $('btn-agrupamento-padrao').onclick = limparAgrupamento;
    $('logos').onchange = (ev) => carregarLogos(Array.from(ev.target.files || []));
    $('articulado').onchange = () => { atualizarInfoArticulacao(); atualizarPreviaMapa(); };
    $('escala').onchange = () => { atualizarInfoArticulacao(); atualizarPreviaMapa(); };
    $('folha').onchange = () => { atualizarInfoArticulacao(); atualizarPreviaMapa(); };
    $('orientacao').onchange = () => { atualizarInfoArticulacao(); atualizarPreviaMapa(); };

    document.querySelectorAll('.aba').forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll('.aba').forEach((x) => x.classList.remove('ativa'));
        document.querySelectorAll('.painel').forEach((x) => x.classList.remove('ativo'));
        b.classList.add('ativa');
        $('painel-' + b.dataset.aba).classList.add('ativo');
        if (b.dataset.aba === 'graficos') renderizarGraficos();
        if (b.dataset.aba === 'mapa') { atualizarPreviaMapa(); estado.mapa.invalidateSize(); }
      };
    });

    $('btn-ajuda').onclick = () => $('dialogo-ajuda').showModal();
    $('dialogo-ajuda').querySelector('[data-fechar]').onclick = () => $('dialogo-ajuda').close();
    $('btn-salvar').onclick = salvarProjeto;
    $('btn-abrir').onclick = () => $('arquivo-projeto').click();
    $('arquivo-projeto').onchange = (ev) => {
      const f = (ev.target.files || [])[0];
      if (f) abrirProjeto(f);
    };
    window.addEventListener('beforeunload', (ev) => {
      if (estado.resultados.length && !estado.salvo) {
        ev.preventDefault();
        ev.returnValue = '';
      }
    });
  }

  // =========================================================== catálogo
  async function carregarCatalogo() {
    try {
      const resposta = await fetch('data/catalogo.json', { cache: 'no-cache' });
      if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
      estado.catalogo = await resposta.json();
      renderizarCatalogo();
      // A cobertura vem do catálogo: é o que permite o mesmo código servir São Paulo
      // hoje e outro estado depois, sem alteração no programa.
      aplicarCobertura(estado.catalogo.extensao_inicial || COBERTURA_PADRAO);
      status('Catálogo com ' + estado.catalogo.camadas.length + ' camadas.');
    } catch (e) {
      $('vazio-camadas').textContent = 'Não consegui ler data/catalogo.json. Verifique se a pasta data/ foi publicada junto.';
      status('Catálogo indisponível: ' + e.message, true);
    }
  }

  function renderizarCatalogo() {
    const alvo = $('lista-camadas');
    alvo.innerHTML = '';
    if (!estado.catalogo) return;
    $('vazio-camadas').hidden = true;

    // A ordem de desenho segue a lista. Camada nova entra no TOPO (é o que a pessoa espera
    // ao ligar algo: ver o que acabou de ligar), e camada que saiu do catálogo sai da ordem.
    const ids = estado.catalogo.camadas.map((c) => c.id);
    estado.ordemCamadas = (estado.ordemCamadas || []).filter((id) => ids.indexOf(id) >= 0);
    for (const id of ids) if (estado.ordemCamadas.indexOf(id) < 0) estado.ordemCamadas.push(id);

    for (const meio of estado.catalogo.meios) {
      const titulo = document.createElement('div');
      titulo.className = 'meio ' + meio.id;
      titulo.textContent = meio.nome;
      alvo.appendChild(titulo);

      /* Lista do meio, ACHATADA: camada-pai (grupo, como o Inventário Florestal por UGRHI) entra
       * como uma linha com SETA, e as filhas entram logo abaixo, recolhidas. A filha é uma camada
       * comum: liga, desliga, entra no recorte e no relatório como qualquer outra — o grupo é só
       * organização da lista, para não encher a página com 22 UGRHIs abertas. */
      const itens = [];
      for (const c of estado.catalogo.camadas.filter((x) => x.meio === meio.id)) {
        if (c.grupo) {
          itens.push({ grupo: c });
          for (const f of (c.filhos || [])) itens.push({ camada: f, pai: c.id });
        } else {
          itens.push({ camada: c });
        }
      }

      for (const item of itens) {
        if (item.grupo) {
          const gc = item.grupo;
          estado.gruposAbertos = estado.gruposAbertos || {};
          const aberto = !!estado.gruposAbertos[gc.id];
          const cabeca = document.createElement('div');
          cabeca.className = 'camada-grupo' + (aberto ? ' aberto' : '');
          const seta = document.createElement('button');
          seta.type = 'button';
          seta.className = 'seta-grupo';
          seta.textContent = aberto ? '▾' : '▸';
          seta.title = 'Abrir a lista para escolher a unidade';
          seta.setAttribute('aria-expanded', aberto ? 'true' : 'false');
          seta.onclick = () => {
            estado.gruposAbertos[gc.id] = !estado.gruposAbertos[gc.id];
            renderizarCatalogo();
          };
          const tituloGrupo = document.createElement('span');
          tituloGrupo.className = 'nome-grupo';
          tituloGrupo.textContent = gc.nome;
          const quantos = document.createElement('span');
          quantos.className = 'estado';
          quantos.textContent = (gc.filhos || []).length + ' unidade(s)';
          cabeca.appendChild(seta);
          cabeca.appendChild(tituloGrupo);
          cabeca.appendChild(quantos);
          if (gc.fonte) cabeca.title = gc.fonte;
          alvo.appendChild(cabeca);
          continue;
        }

        const camada = item.camada;
        const linha = document.createElement('label');
        linha.className = 'camada-item' + (item.pai ? ' camada-filha' : '');
        if (item.pai) {
          linha.dataset.pai = item.pai;
          linha.hidden = !(estado.gruposAbertos && estado.gruposAbertos[item.pai]);
        }
        const caixa = document.createElement('input');
        caixa.type = 'checkbox';
        caixa.checked = estado.camadasLigadas.has(camada.id);
        caixa.onchange = () => alternarCamada(camada, caixa.checked);
        const amostra = document.createElement('i');
        amostra.className = 'amostra';
        amostra.style.background = (camada.estilo && camada.estilo.cor) || CORES_MEIO[meio.id] || '#7d8b93';
        const nome = document.createElement('span');
        nome.textContent = camada.nome;
        const estadoTxt = document.createElement('span');
        estadoTxt.className = 'estado';
        estadoTxt.dataset.camada = camada.id;
        estadoTxt.textContent = camada.presente === false ? 'sem arquivo' : '';
        // Camada de referência generalizada: quem for medir precisa saber que a feição não é
        // a do shapefile original.
        if (camada.alerta) {
          // aviso que muda decisão: nesta camada a coordenada de parte das feições é aleatória
          const al = document.createElement('span');
          al.className = 'tag-alerta';
          al.textContent = '⚠ localização não confiável';
          al.title = camada.fonte || camada.obs || '';
          linha.appendChild(al);
        }
        if (camada.geometria === 'generalizada') {
          const aviso = document.createElement('span');
          aviso.className = 'tag-generalizada';
          aviso.textContent = 'generalizada';
          aviso.title = 'A geometria desta camada de referência foi simplificada para caber no '
            + 'navegador — não é a feição exata do shapefile. Para medir, use o dado do projeto.';
          linha.appendChild(aviso);
        }
        linha.appendChild(caixa);
        linha.appendChild(amostra);
        linha.appendChild(nome);
        linha.appendChild(estadoTxt);

        // Setas de ordem, DENTRO da linha mas fora do <label>: subir/descer camada é ação
        // frequente no mapa, então fica à vista. Os ajustes (transparência e rótulo) ficam
        // recolhidos no botão de lapis, porque abertos os dois em cada camada poluíam
        // a página inteira.
        const setas = document.createElement('span');
        setas.className = 'ordem-setas';
        const cima = document.createElement('button');
        cima.type = 'button';
        cima.className = 'seta';
        cima.textContent = '▲';
        cima.title = 'Subir a camada (desenhar por cima das de baixo)';
        cima.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); moverCamada(camada.id, -1); };
        const baixo = document.createElement('button');
        baixo.type = 'button';
        baixo.className = 'seta';
        baixo.textContent = '▼';
        baixo.title = 'Descer a camada (desenhar por baixo das de cima)';
        baixo.onclick = (ev) => { ev.preventDefault(); ev.stopPropagation(); moverCamada(camada.id, +1); };
        setas.appendChild(cima);
        setas.appendChild(baixo);
        linha.appendChild(setas);

        const lapis = document.createElement('button');   // lápis: abre os ajustes de aparência
        lapis.type = 'button';
        lapis.className = 'lapis';
        lapis.textContent = '✏\uFE0E';
        lapis.title = 'Editar transparência, rótulo e linha desta camada';
        lapis.setAttribute('aria-expanded', 'false');
        linha.appendChild(lapis);

        alvo.appendChild(linha);

        const ajustes = controlesDaCamada(camada);
        ajustes.hidden = true;
        lapis.onclick = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          ajustes.hidden = !ajustes.hidden;
          lapis.setAttribute('aria-expanded', ajustes.hidden ? 'false' : 'true');
          lapis.classList.toggle('aberta', !ajustes.hidden);
        };
        alvo.appendChild(ajustes);
      }
    }
  }

  /**
   * Ajustes da camada, recolhidos numa abinha: transparência e rótulo.
   *
   * A transparência é o que permite ver a imagem de satélite (ou a camada de baixo) por
   * baixo de uma camada densa — sem ela, uma camada de 306 unidades cobre o mapa inteiro.
   * O rótulo é a coluna que o analista quer LER no mapa (sigla da unidade, nome, classe),
   * escolhida entre os campos da própria camada.
   *
   * Ficam DENTRO de uma aba fechada porque, abertos em cada uma das 9 camadas, viravam 18
   * controles empilhados na lateral e escondiam a própria lista de camadas. Aqui a lista
   * fica legível e o ajuste aparece quando é pedido.
   */
  function controlesDaCamada(camada) {
    const bloco = document.createElement('div');
    bloco.className = 'camada-controles';

    // Duas abinhas: cada assunto no seu lugar, sem empilhar rótulo e controle na mesma linha.
    const abas = document.createElement('div');
    abas.className = 'abas-camada';
    const paineis = {};
    const nomes = [['transparencia', 'Transparência'], ['rotulo', 'Rótulo'], ['linha', 'Linha']];
    for (const [chave, texto] of nomes) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'aba-camada' + (chave === 'transparencia' ? ' ativa' : '');
      b.textContent = texto;
      const painel = document.createElement('div');
      painel.className = 'painel-camada';
      painel.hidden = chave !== 'transparencia';
      b.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        for (const [k, botao] of Object.entries(abas.botoes || {})) {
          botao.classList.toggle('ativa', k === chave);
          paineis[k].hidden = k !== chave;
        }
      };
      abas.botoes = abas.botoes || {};
      abas.botoes[chave] = b;
      paineis[chave] = painel;
      abas.appendChild(b);
    }
    bloco.appendChild(abas);
    bloco.appendChild(paineis.transparencia);
    bloco.appendChild(paineis.rotulo);

    // ---- transparência
    const etiquetaOp = document.createElement('span');
    etiquetaOp.className = 'controle-rotulo';
    etiquetaOp.textContent = 'Transparência';
    const atual = opacidadeEfetiva(camada);
    const faixa = document.createElement('input');
    faixa.type = 'range';
    faixa.min = '0';
    faixa.max = '100';
    faixa.step = '5';
    faixa.value = String(Math.round((1 - atual) * 100));
    faixa.title = '0% = opaca · 100% = transparente';
    const valor = document.createElement('span');
    valor.className = 'controle-valor';
    valor.textContent = faixa.value + '%';
    faixa.oninput = () => {
      valor.textContent = faixa.value + '%';
      estado.transparencia[camada.id] = 1 - Number(faixa.value) / 100;
      desenharCamadas();
    };
    paineis.transparencia.appendChild(faixa);
    paineis.transparencia.appendChild(valor);
    paineis.transparencia.appendChild(etiquetaOp);

    // ---- rótulo
    const etiquetaRot = document.createElement('span');
    etiquetaRot.className = 'controle-rotulo';
    etiquetaRot.textContent = 'Coluna a escrever no mapa';
    const seletor = document.createElement('select');
    seletor.className = 'seletor-rotulo';
    const nenhum = document.createElement('option');
    nenhum.value = '';
    nenhum.textContent = '(sem rótulo)';
    seletor.appendChild(nenhum);
    for (const campo of camposParaRotulo(camada)) {
      const op = document.createElement('option');
      op.value = campo;
      op.textContent = campo + (campo === camada.campo_classe ? '  (classe do mapa)' : '');
      seletor.appendChild(op);
    }
    seletor.value = estado.rotulos[camada.id] || '';
    seletor.onchange = () => {
      if (seletor.value) estado.rotulos[camada.id] = seletor.value;
      else delete estado.rotulos[camada.id];
      desenharCamadas();
      atualizarRotulos();
    };
    paineis.rotulo.appendChild(etiquetaRot);
    paineis.rotulo.appendChild(seletor);

    // ---- linha: cor, tipo de traço e grossura do CONTORNO da camada
    // A divisa que se lê bem na tela some num mapa 1:5.000 impresso; e cor única ajuda
    // quando o arquivo de estilo traz uma cor por classe e se quer tudo igual.
    const padraoLinha = {
      cor: (camada.estilo && camada.estilo.contorno_cor) || '#000000',
      estilo: 'linear',
      grossura: (camada.estilo && (camada.estilo.contorno_cor || camada.estilo.contornos)) ? 0.5 : 0.9,
    };
    const caixa = document.createElement('div');
    caixa.className = 'linha-bloco';
    const redesenharLinha = () => {
      caixa.innerHTML = '';
      caixa.appendChild(controlesDeLinha(estado.linhas[camada.id], padraoLinha, (nova) => {
        estado.linhas[camada.id] = nova;
        desenharCamadas();
      }));
      const voltar = document.createElement('button');
      voltar.type = 'button';
      voltar.className = 'botao-mini';
      voltar.textContent = 'Voltar ao desenho do arquivo';
      voltar.title = 'Descarta a cor, o traço e a grossura escolhidos aqui';
      voltar.onclick = (ev) => {
        ev.preventDefault();
        delete estado.linhas[camada.id];
        redesenharLinha();
        desenharCamadas();
        status('A linha de ' + camada.nome + ' voltou ao desenho do arquivo de estilo.');
      };
      caixa.appendChild(voltar);
    };
    redesenharLinha();
    paineis.linha.appendChild(caixa);

    return bloco;
  }

  /**
   * Controles de linha: cor, tipo de traço e grossura.
   *
   * UM componente para os dois lugares que têm linha — o contorno das camadas de
   * caracterização e o traço das áreas de influência do usuário. São o mesmo problema
   * (aparência de contorno, pensada para impressão) e uma implementação só evita que as
   * duas telas divirjam.
   *
   * @param {object} escolha  { cor, estilo, grossura } atual (pode estar vazio)
   * @param {object} padrao   o que o portal desenha quando o usuário não mexeu
   * @param {function} aoMudar recebe o novo { cor, estilo, grossura }
   */
  function controlesDeLinha(escolha, padrao, aoMudar) {
    const atual = EIA.mapa.estiloDeLinha(escolha, padrao);
    const bloco = document.createElement('div');
    bloco.className = 'linha-controles';

    const estadoAtual = {
      cor: atual.color,
      estilo: (escolha && escolha.estilo) || (padrao && padrao.estilo) || 'linear',
      grossura: atual.weight,
    };
    const avisar = () => {
      const pronto = EIA.mapa.estiloDeLinha(estadoAtual, padrao);
      aoMudar({ cor: pronto.color, estilo: estadoAtual.estilo, grossura: pronto.weight });
    };

    // ---- cor
    const cor = document.createElement('input');
    cor.type = 'color';
    cor.className = 'linha-cor';
    cor.value = atual.color;
    cor.title = 'Cor da linha';
    cor.oninput = () => { estadoAtual.cor = cor.value; avisar(); };
    const etiquetaCor = document.createElement('span');
    etiquetaCor.className = 'controle-rotulo';
    etiquetaCor.textContent = 'Cor';

    // ---- tipo de traço
    const etiquetaEstilo = document.createElement('span');
    etiquetaEstilo.className = 'controle-rotulo';
    etiquetaEstilo.textContent = 'Traço';
    const seletor = document.createElement('select');
    seletor.className = 'linha-estilo';
    for (const e of EIA.mapa.ESTILOS_LINHA) {
      const op = document.createElement('option');
      op.value = e.id;
      op.textContent = e.nome;
      seletor.appendChild(op);
    }
    seletor.value = estadoAtual.estilo;
    // desenha o próprio traço na opção, para escolher pelo olho e não pelo nome
    seletor.onchange = () => { estadoAtual.estilo = seletor.value; avisar(); };

    // ---- grossura
    const faixa = document.createElement('input');
    faixa.type = 'range';
    faixa.className = 'linha-grossura';
    faixa.min = String(EIA.mapa.GROSSURA_MIN);
    faixa.max = String(EIA.mapa.GROSSURA_MAX);
    faixa.step = '0.1';
    faixa.value = String(atual.weight);
    faixa.title = 'Grossura da linha (pixels na tela)';
    const valor = document.createElement('span');
    valor.className = 'controle-valor';
    valor.textContent = atual.weight.toFixed(1);
    faixa.oninput = () => {
      estadoAtual.grossura = Number(faixa.value);
      valor.textContent = estadoAtual.grossura.toFixed(1);
      avisar();
    };

    // ---- amostra: o traço desenhado como vai sair
    const amostra = document.createElement('span');
    amostra.className = 'linha-amostra';
    const pintarAmostra = () => {
      const l = EIA.mapa.estiloDeLinha(estadoAtual, padrao);
      amostra.style.borderTopColor = l.color;
      amostra.style.borderTopWidth = Math.max(1, Math.min(4, l.weight)) + 'px';
      amostra.style.borderTopStyle = l.dashArray ? 'dashed' : 'solid';
    };
    pintarAmostra();
    const avisarComAmostra = () => { pintarAmostra(); avisar(); };
    cor.oninput = () => { estadoAtual.cor = cor.value; avisarComAmostra(); };
    seletor.onchange = () => { estadoAtual.estilo = seletor.value; avisarComAmostra(); };

    bloco.appendChild(etiquetaCor);
    bloco.appendChild(cor);
    bloco.appendChild(etiquetaEstilo);
    bloco.appendChild(seletor);
    bloco.appendChild(amostra);
    bloco.appendChild(faixa);
    bloco.appendChild(valor);
    return bloco;
  }

  /** Campos que podem virar rótulo: os atributos da camada, sem as colunas de resultado. */
  function camposParaRotulo(camada) {
    const campos = (camada.campos || []).map((c) => c.nome).filter((n) => n && !/^eia_/.test(n));
    if (campos.length) {
      // a coluna de classe primeiro: é a que o analista quer ler no mapa
      return campos.slice().sort((a, b) => (a === camada.campo_classe ? -1 : b === camada.campo_classe ? 1 : 0));
    }
    // camada vinda do catálogo sem lista de campos: descobre pelas feições já carregadas
    const carregada = estado.camadas.find((c) => c.id === camada.id);
    if (!carregada || !carregada.geojson) return [];
    const vistos = new Set();
    for (const f of carregada.geojson.features.slice(0, 50)) {
      for (const k of Object.keys(f.properties || {})) if (!/^eia_/.test(k)) vistos.add(k);
    }
    return Array.from(vistos).sort();
  }

  /** Opacidade de preenchimento em uso: o que o usuário escolheu, ou o padrão do catálogo. */
  function opacidadeEfetiva(camada) {
    if (estado.transparencia[camada.id] !== undefined) return estado.transparencia[camada.id];
    const e = camada.estilo || {};
    return e.opacidade === undefined ? 0.35 : e.opacidade;
  }

  async function alternarCamada(camada, ligar) {
    if (!ligar) {
      estado.camadasLigadas.delete(camada.id);
      estado.camadas = estado.camadas.filter((c) => c.id !== camada.id);
      desenharCamadas();
      return;
    }
    estado.camadasLigadas.add(camada.id);
    const jaTem = estado.camadas.find((c) => c.id === camada.id);
    if (!jaTem) {
      /* Camada AO VIVO (serviço da CETESB): consulta por caixa, só o que a tela mostra. */
      if (camada.servico) {
        const elS = document.querySelector('.estado[data-camada="' + camada.id + '"]');
        if (elS) elS.textContent = 'consultando o serviço…';
        estado.camadas.push(Object.assign({}, camada, { geojson: { type: 'FeatureCollection', features: [] } }));
        try {
          await carregarServicoNaJanela(camada);
        } catch (e) {
          estado.camadasLigadas.delete(camada.id);
          estado.camadas = estado.camadas.filter((c) => c.id !== camada.id);
          if (elS) elS.textContent = 'falhou';
          status(mensagemDoServico(camada, e), true);
          return;
        }
        const q = estado.camadas.find((c) => c.id === camada.id);
        status(camada.nome + ' — ' + (q ? q.geojson.features.length.toLocaleString('pt-BR') : 0)
          + ' feições carregadas do serviço (ao vivo, conforme a tela).');
        return;
      }

      /* Camada em TILES: cria a feição vazia, busca o índice e carrega o que a janela mostra.
       * O desenho e o recorte seguem iguais ao resto do portal — a diferença é só de onde os
       * dados vêm e de quanto se busca de cada vez. */
      if (camada.tiles) {
        const elT = document.querySelector('.estado[data-camada="' + camada.id + '"]');
        if (elT) elT.textContent = 'carregando…';
        try {
          estado.camadas.push(Object.assign({}, camada, { geojson: { type: 'FeatureCollection', features: [] } }));
          await carregarTilesDaJanela(camada);
        } catch (e) {
          estado.camadasLigadas.delete(camada.id);
          estado.camadas = estado.camadas.filter((c) => c.id !== camada.id);
          if (elT) elT.textContent = 'falhou';
          status('Não carreguei ' + camada.nome + ': ' + e.message, true);
          return;
        }
        const carregada = estado.camadas.find((c) => c.id === camada.id);
        desenharCamadas();
        status(camada.nome + ' — ' + (carregada ? carregada.geojson.features.length.toLocaleString('pt-BR') : 0)
          + ' feições carregadas (as partes que a tela mostra; aproxime para carregar mais).');
        return;
      }
      const el = document.querySelector('.estado[data-camada="' + camada.id + '"]');
      if (el) el.textContent = 'carregando…';
      try {
        /* `cache: 'no-cache'` — REVALIDA sempre. Não é "não guardar": o navegador guarda
         * e pergunta ao servidor se mudou; se não mudou, a resposta é 304 sem corpo, ou
         * seja, barata mesmo para os 5,7 MB da camada de Geologia.
         *
         * Aqui já esteve `cache: 'force-cache'`, e o defeito foi grave: `force-cache` usa
         * o que estiver guardado SEM NUNCA revalidar. Quando a base é reimportada (a
         * Geologia trocou de exemplo para o mapa real de SP, com outros nomes de campo),
         * quem já tinha aberto o portal continuava recebendo o geojson ANTIGO — e como as
         * classes novas não existem nos atributos antigos, o mapa pintava tudo com a cor
         * única de reserva. Parecia "o site não publicou as cores", quando o problema era
         * o navegador servindo geometria velha para sempre. */
        const resposta = await fetch(camada.arquivo, { cache: 'no-cache' });
        if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
        const geojson = await resposta.json();
        estado.camadas.push(Object.assign({}, camada, { geojson: geojson }));
        if (el) {
          const nClasses = (camada.classes && camada.classes.length) || 0;
          el.textContent = geojson.features.length + ' feições' + (nClasses > 1 ? ' · ' + nClasses + ' classes' : '');
        }
      } catch (e) {
        estado.camadasLigadas.delete(camada.id);
        if (el) el.textContent = 'falhou';
        status('Não carreguei ' + camada.nome + ': ' + e.message, true);
        return;
      }
    }
    desenharCamadas();
  }

  function desenharCamadas() {
    estado.grupoCamadas.clearLayers();
    for (const camada of estado.camadas) {
      const estilo = camada.estilo || {};
      const cor = estilo.cor || CORES_MEIO[camada.meio] || '#7d8b93';

      // Chave de classe da feição: o valor do campo de classe do catálogo.
      const chaveDaFeicao = (f) => {
        if (!camada.campo_classe || !f || !f.properties) return null;
        const bruto = f.properties[camada.campo_classe];
        return (bruto === undefined || bruto === null || bruto === '') ? 'Sem classe' : String(bruto);
      };

      // Cor por classe: o importador grava `estilo.cores` (classe -> cor) para as
      // camadas de uso do solo, geologia, solos... Sem isso, uma camada de 12 classes
      // apareceria de uma cor só — e a base perde justamente o que a torna legível.
      const corDaFeicao = (f) => {
        const chave = chaveDaFeicao(f);
        if (chave && estilo.cores && estilo.cores[chave]) return estilo.cores[chave];
        return cor;
      };

      // Contorno: é o que separa as unidades. O mapa do cliente desenha divisa preta em
      // fio de cabelo entre as unidades — sem ela, 306 manchas de cor viram uma aquarela
      // e as divisas somem. `estilo.contornos` traz a cor por classe; `contorno_cor` é a
      // reserva (o contorno mais comum da camada).
      const temContorno = !!(estilo.contorno_cor || estilo.contornos);
      const corDoContorno = (f) => {
        const chave = chaveDaFeicao(f);
        if (chave && estilo.contornos && estilo.contornos[chave]) return estilo.contornos[chave];
        if (estilo.contorno_cor) return estilo.contorno_cor;
        return corDaFeicao(f);
      };
      // Escolha do usuário para a LINHA desta camada (cor, traço e grossura). Vazia = o
      // desenho do arquivo de estilo, que é o padrão. O ajuste é para impressão: a divisa
      // que se lê bem na tela some num mapa 1:5.000, e a área de influência costuma ir
      // tracejada para não competir com o dado do mapa.
      const linhaEscolhida = (estado.linhas || {})[camada.id];
      const padraoDaLinha = {
        cor: estilo.contorno_cor || '#000000',
        estilo: 'linear',
        grossura: temContorno ? 0.5 : 0.9,
      };

      L.geoJSON(camada.geojson, {
        pane: painelDaCamada(camada.id),
        style: (f) => {
          const c = corDaFeicao(f);
          // Sem escolha do usuário, vale o desenho do arquivo de estilo — inclusive a cor
          // POR CLASSE. Com escolha, a cor dele manda em todas as classes.
          const linha = EIA.mapa.estiloDeLinha(
            linhaEscolhida,
            Object.assign({}, padraoDaLinha, { cor: corDoContorno(f) })
          );
          return {
            // com contorno do estilo, a divisa é fina (fio de cabelo) e na cor do estilo;
            // sem ele, o traço é a própria cor do preenchimento (evita emenda clara
            // entre polígonos vizinhos, que aparece quando não há traço nenhum).
            color: linha.color,
            weight: linha.weight,
            dashArray: linha.dashArray,
            opacity: 0.9,
            fillColor: c,
            fillOpacity: opacidadeEfetiva(camada),
          };
        },
        pointToLayer: (f, latlng) => {
          const c = corDaFeicao(f);
          return L.circleMarker(latlng, { radius: 4, color: c, fillColor: c, fillOpacity: 0.8 });
        },
        onEachFeature: (f, layer) => {
          layer.bindPopup(popupAtributos(camada.nome, f.properties));
        },
      }).addTo(estado.grupoCamadas);
    }
    atualizarRotulos();
  }

  /**
   * Desenha os rótulos das camadas que têm coluna escolhida.
   *
   * Duas decisões que vêm do tamanho do dado real (a Geologia tem 2.102 feições):
   *
   * 1. Só rotula o que está NA TELA. Rotular 2.102 feições criaria 2.102 elementos no DOM
   *    e travaria o navegador — e seria ilegível de qualquer forma, porque num estado
   *    inteiro os polígonos têm poucos pixels. A legenda de um mapa não escreve 306 nomes
   *    num mapa de 900 km.
   * 2. Teto de 220 rótulos por vez, com aviso do que ficou de fora, para o mapa nunca
   *    ficar mais lento do que útil.
   *
   * A posição sai de `posicaoRotulo`, que garante ponto DENTRO da feição — média de
   * vértice cai fora em forma côncava e escreveria a sigla sobre a unidade vizinha.
   */
  const TETO_ROTULOS = 220;

  /**
   * Posição do rótulo, com degradação honesta.
   *
   * `EIA.vetorial.posicaoRotulo` chegou na v2.0. Se o navegador ainda tiver um
   * `js/vetorial.js` ANTIGO em cache, a função não existe — e a chamada direta lançava
   * exceção no meio do laço, deixando o mapa SEM RÓTULO NENHUM e sem dizer por quê. Foi
   * exatamente o que aconteceu: o `app.js` revalidava (controles novos na tela) e o
   * `vetorial.js` vinha do cache imutável de 1 ano (função ausente).
   *
   * Agora, sem a função, cai no centro da caixa envolvente e AVISA uma vez. Rótulo um
   * pouco deslocado é melhor que rótulo nenhum com erro escondido no console.
   */
  let avisouRotuloSemFuncao = false;
  function posicaoDoRotulo(geometria) {
    if (EIA.vetorial && typeof EIA.vetorial.posicaoRotulo === 'function') {
      return EIA.vetorial.posicaoRotulo(geometria);
    }
    if (!avisouRotuloSemFuncao) {
      avisouRotuloSemFuncao = true;
      status('Rótulos no centro da caixa: recarregue com Ctrl+Shift+R para o portal usar o cálculo preciso.', true);
    }
    const b = EIA.math.bbox({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: geometria, properties: {} }] });
    return b ? [(b.xmin + b.xmax) / 2, (b.ymin + b.ymax) / 2] : null;
  }

  function atualizarRotulos() {
    if (!estado.grupoRotulos || !estado.mapa) return;
    estado.grupoRotulos.clearLayers();
    if (!Object.keys(estado.rotulos).length) return;
    const bb = estado.mapa.getBounds();
    const caixa = [bb.getWest(), bb.getSouth(), bb.getEast(), bb.getNorth()];
    let postos = 0, cortados = 0;

    for (const camada of estado.camadas) {
      const coluna = estado.rotulos[camada.id];
      if (!coluna || !camada.geojson) continue;
      for (const f of camada.geojson.features) {
        if (postos >= TETO_ROTULOS) { cortados++; continue; }
        const bruto = (f.properties || {})[coluna];
        if (bruto === null || bruto === undefined || String(bruto).trim() === '') continue;
        const pos = posicaoDoRotulo(f.geometry);
        if (!pos) continue;
        if (pos[0] < caixa[0] || pos[0] > caixa[2] || pos[1] < caixa[1] || pos[1] > caixa[3]) continue;
        L.marker([pos[1], pos[0]], {
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: 'rotulo-mapa',
            html: '<span>' + escapar(String(bruto)) + '</span>',
            iconSize: null,
          }),
        }).addTo(estado.grupoRotulos);
        postos++;
      }
    }
    estado.rotulosPostos = postos;
    estado.rotulosCortados = cortados;
    if (cortados) {
      status(postos + ' rótulos no mapa · ' + cortados + ' fora do teto ou da tela. Aproxime o zoom para ver os outros.');
    }
  }

  function popupAtributos(titulo, props) {
    const linhas = Object.keys(props || {}).slice(0, 25)
      .map((k) => '<tr><th>' + escapar(k) + '</th><td>' + escapar(props[k]) + '</td></tr>').join('');
    return '<div class="popup"><b>' + escapar(titulo) + '</b><table>' + linhas + '</table></div>';
  }

  // =========================================================== upload de áreas
  async function carregarArquivos(arquivos) {
    if (!arquivos.length) return;
    status('Lendo ' + arquivos.length + ' arquivo(s)…');
    try {
      const geo = await EIA.entrada.interpretar(arquivos);
      adicionarArea(geo.geojson, geo.nome, geo.crs, geo.aviso);
      status('Área "' + geo.nome + '" carregada com ' + geo.geojson.features.length + ' feição(ões).');
    } catch (e) {
      status('Falha ao ler o arquivo: ' + e.message, true);
      alert('Não consegui ler o arquivo.\n\n' + e.message);
    }
  }


  function adicionarArea(geojson, nome, crs, aviso) {
    const listaDeFeicoes = geojson.type === 'FeatureCollection' ? (geojson.features || []) : null;
    const aneis = EIA.recorte.aneisDaGeometria(geojson);
    if (!aneis.length) throw new Error('Não encontrei polígono na área de influência.');
    // A geometria é montada ANTES da área, e a área sai DELA: é a mesma geometria que é
    // desenhada e recortada, então o número na tela e o número no relatório são o mesmo.
    const geometria = geojson.type === 'FeatureCollection'
      ? unirGeometrias(geojson) : (geojson.geometry || geojson);
    const areaHa = EIA.recorte.areaHectares(geometria) / 10000;
    const area = {
      id: 'ai' + (++estado.vez),
      nome: nome,
      sigla: siglaDe(nome),
      geometry: geometria,
      cor: CORES_AREAS[estado.areas.length % CORES_AREAS.length],
      area_ha: areaHa,
      partes: listaDeFeicoes ? listaDeFeicoes.length : 1,
      crs: crs || 'EPSG:4326',
      aviso: aviso || '',
    };
    // Arquivo com vários polígonos: a área é a SOMA das partes. Se uma contiver a outra
    // (ADA dentro de AID dentro de AII, comum em EIA), a parte interna conta duas vezes —
    // e é melhor dizer isso do que entregar um número que ninguém sabe de onde veio.
    if (area.partes > 1) {
      area.aviso = (area.aviso ? area.aviso + ' ' : '')
        + 'O arquivo tem ' + area.partes + ' polígonos: a área mostrada é a SOMA deles. '
        + 'Se um estiver dentro do outro, a parte interna entra duas vezes na conta.';
    }
    if (areaHa <= 0) {
      area.aviso = (area.aviso ? area.aviso + ' ' : '')
        + 'A área calculada deu zero: confira se o polígono tem vértices suficientes e se o '
        + 'sistema de referência foi reconhecido.';
    }
    estado.areas.push(area);
    desenharAreas();
    renderizarAreas();
    if (area.aviso) {
      const el = $('aviso-crs');
      el.hidden = false;
      el.className = 'aviso' + (/não estão em graus|sem \.prj|deu zero|SOMA/i.test(area.aviso) ? ' alerta' : '');
      el.textContent = area.aviso;
    }
    const bbox = EIA.math.bbox(area.geometry);
    if (bbox) estado.mapa.fitBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]], { padding: [30, 30] });
  }

  function unirGeometrias(geojson) {
    const features = (geojson.features || []).filter((f) => f.geometry);
    if (features.length === 1) return features[0].geometry;
    return { type: 'GeometryCollection', geometries: features.map((f) => f.geometry) };
  }

  function siglaDe(nome) {
    const n = nome.toUpperCase();
    if (/ADA|DIRETAMENTE/.test(n)) return 'ADA';
    if (/AID|INFLU[ÊE]NCIA DIRETA/.test(n)) return 'AID';
    if (/AII|INDIRETA/.test(n)) return 'AII';
    if (/SERVID[ÃA]O|FAIXA/.test(n)) return 'FS';
    if (/BACIA|CONTRIBUI/.test(n)) return 'BC';
    return nome.slice(0, 8).toUpperCase().replace(/\s+/g, '_');
  }

  /** O que o portal desenha numa área quando o usuário não mexeu na linha. */
  function linhaPadraoDaArea(area) {
    // Linha CONTÍNUA por padrão: a área chega do arquivo e o usuário espera ver o limite
    // como ele é, não já estilizado pelo portal. O tracejado continua a um clique de
    // distância, para quem quer diferenciar o limite do dado do mapa por baixo.
    return { cor: area.cor, estilo: 'linear', grossura: 2.4 };
  }

  /** Opacidade do preenchimento da área. Quase transparente por padrão (0,06). */
  const OPACIDADE_AREA_PADRAO = 0.06;
  function opacidadeDaArea(area) {
    const v = Number(area && area.opacidade);
    // Valor estranho (ou ausente) volta ao padrão em vez de deixar a área invisível.
    return isFinite(v) && v >= 0 && v <= 1 ? v : OPACIDADE_AREA_PADRAO;
  }

  function desenharAreas() {
    estado.grupoAreas.clearLayers();
    for (const area of estado.areas) {
      const linha = EIA.mapa.estiloDeLinha(area.linha, linhaPadraoDaArea(area));
      L.geoJSON(area.geometry, {
        // painel próprio: é o que permite pôr as áreas por cima (ou por baixo) das camadas
        // de caracterização, de forma estável, sem depender da ordem de inserção
        pane: 'pane-areas',
        style: () => ({
          // O traço da área de influência é escolha do usuário: cor, linear ou tracejado,
          // e grossura. O padrão é CONTÍNUO e o preenchimento quase transparente: a área é
          // um LIMITE do estudo e não pode competir com o dado do mapa embaixo.
          color: linha.color,
          weight: linha.weight,
          dashArray: linha.dashArray,
          fillColor: area.cor,
          fillOpacity: opacidadeDaArea(area),
        }),
        onEachFeature: (f, layer) => {
          layer.bindTooltip(area.sigla + ' — ' + area.nome, { sticky: true });
        },
      }).addTo(estado.grupoAreas);
    }
  }

  function renderizarAreas() {
    const lista = $('lista-areas');
    lista.innerHTML = '';
    $('vazio-areas').hidden = estado.areas.length > 0;
    estado.areas.forEach((area, i) => {
      const li = document.createElement('li');
      const amostra = document.createElement('i');
      amostra.className = 'amostra';
      amostra.style.background = area.cor;
      const nome = document.createElement('span');
      nome.className = 'nome';
      nome.innerHTML = '<b>' + escapar(area.sigla) + '</b> ' + escapar(area.nome)
        + '<br><span class="meta">' + EIA.math.num(area.area_ha, 2) + ' ha · '
        + EIA.math.num(area.area_ha / 100, 2) + ' km²'
        + (area.partes > 1 ? ' · ' + area.partes + ' polígonos' : '') + '</span>';

      // Ajustes da área numa abinha, igual às camadas: o mesmo problema, o mesmo lugar.
      const lapis = document.createElement('button');   // lápis: abre os ajustes de aparência
      lapis.type = 'button';
      lapis.className = 'lapis';
      lapis.textContent = '✏\uFE0E';
      lapis.title = 'Editar transparência, cor, traço e grossura desta área';

      const remover = document.createElement('button');
      remover.textContent = 'remover';
      remover.onclick = () => {
        estado.areas.splice(i, 1);
        desenharAreas();
        renderizarAreas();
      };

      li.appendChild(amostra);
      li.appendChild(nome);
      li.appendChild(lapis);
      li.appendChild(remover);
      lista.appendChild(li);

      const ajustes = document.createElement('div');
      ajustes.className = 'camada-controles';
      ajustes.hidden = true;
      const pintar = () => {
        ajustes.innerHTML = '';

        // Transparência do PREENCHIMENTO. O preenchimento da área era fixo em 6%: dava para
        // ver o mapa por baixo, mas não dava para realçar a área quando ela é o assunto do
        // mapa — nem para sumir com ela quando atrapalha a leitura das camadas.
        const blocoOp = document.createElement('div');
        blocoOp.className = 'linha-controles';
        const etiquetaOp = document.createElement('span');
        etiquetaOp.className = 'controle-rotulo';
        etiquetaOp.textContent = 'Transparência';
        const faixaOp = document.createElement('input');
        faixaOp.type = 'range';
        faixaOp.className = 'linha-grossura';
        faixaOp.min = '0';
        faixaOp.max = '100';
        faixaOp.step = '5';
        faixaOp.value = String(Math.round((1 - opacidadeDaArea(area)) * 100));
        faixaOp.title = '0% = preenchimento sólido · 100% = só o contorno';
        const valorOp = document.createElement('span');
        valorOp.className = 'controle-valor';
        valorOp.textContent = faixaOp.value + '%';
        faixaOp.oninput = () => {
          valorOp.textContent = faixaOp.value + '%';
          area.opacidade = 1 - Number(faixaOp.value) / 100;
          desenharAreas();
        };
        blocoOp.appendChild(etiquetaOp);
        blocoOp.appendChild(faixaOp);
        blocoOp.appendChild(valorOp);
        ajustes.appendChild(blocoOp);

        // Linha: cor, tipo de traço e grossura.
        ajustes.appendChild(controlesDeLinha(area.linha, linhaPadraoDaArea(area), (nova) => {
          area.linha = nova;
          desenharAreas();
          amostra.style.background = nova.cor;
        }));

        const voltar = document.createElement('button');
        voltar.type = 'button';
        voltar.className = 'botao-mini';
        voltar.textContent = 'Voltar ao padrão (linha contínua, 6% de preenchimento)';
        voltar.onclick = () => {
          delete area.linha;
          delete area.opacidade;
          pintar();
          desenharAreas();
          amostra.style.background = area.cor;
        };
        ajustes.appendChild(voltar);
      };
      pintar();
      lapis.onclick = () => {
        ajustes.hidden = !ajustes.hidden;
        lapis.classList.toggle('aberta', !ajustes.hidden);
      };
      lista.appendChild(ajustes);
    });
  }

  // =========================================================== desenho no mapa
  function alternarDesenho() {
    estado.desenhando = !estado.desenhando;
    estado.pontosDesenho = [];
    $('btn-desenhar').textContent = estado.desenhando ? 'Concluir desenho' : 'Desenhar no mapa';
    $('btn-desenhar').classList.toggle('primario', estado.desenhando);
    if (estado.desenho) {
      estado.mapa.removeLayer(estado.desenho);
      estado.desenho = null;
    }
    if (estado.desenhando) {
      status('Clique no mapa para marcar os vértices da área. Clique em "Concluir desenho" para fechar.');
      estado.desenho = L.polygon([], { color: '#d94f3d', weight: 2, fillOpacity: 0.12 }).addTo(estado.mapa);
    } else {
      finalizarDesenho();
    }
  }

  function aoClicarNoMapa(ev) {
    if (!estado.desenhando) return;
    estado.pontosDesenho.push([ev.latlng.lng, ev.latlng.lat]);
    estado.desenho.setLatLngs(estado.pontosDesenho.map((p) => [p[1], p[0]]));
  }

  function finalizarDesenho() {
    if (estado.pontosDesenho.length < 3) {
      if (estado.desenho) { estado.mapa.removeLayer(estado.desenho); estado.desenho = null; }
      return;
    }
    const anel = estado.pontosDesenho.concat([estado.pontosDesenho[0]]);
    adicionarArea({ type: 'Polygon', coordinates: [anel] }, 'Área desenhada ' + new Date().toLocaleTimeString('pt-BR'),
      'EPSG:4326', 'Área desenhada na tela, em WGS 84.');
    estado.pontosDesenho = [];
    if (estado.desenho) { estado.mapa.removeLayer(estado.desenho); estado.desenho = null; }
  }

  // =========================================================== recorte
  async function executarRecorte() {
    if (!estado.areas.length) { alert('Carregue ou desenhe pelo menos uma área de influência.'); return; }
    if (!estado.camadas.length) { alert('Ligue pelo menos uma camada de caracterização.'); return; }
    const operacao = $('operacao').value;
    const opcoes = {
      operacao: operacao,
      areaMinimaHa: Number($('area-minima').value) || 0,
      simplificar: Number($('simplificar').value) || 0,
      progresso: (feito, total, area, camada) => {
        $('barra-progresso').style.width = (feito / total * 100).toFixed(1) + '%';
        $('texto-progresso').textContent = 'Recortando ' + camada.nome + ' por ' + (area.sigla || area.nome) + '… (' + feito + '/' + total + ')';
      },
    };
    $('progresso').hidden = false;
    document.body.classList.add('carregando');
    /* ANTES DE RECORTAR: monta a camada do recorte com SÓ OS TILES QUE CRUZAM AS ÁREAS.
     * Carregar a camada inteira era o gargalo (medido: 186 MB contra 5,65 MB necessários), e
     * ainda trocava, no mapa, o que a tela mostrava por tudo. Agora é uma cópia à parte. */
    const camadasDoRecorte = [];
    try {
      for (const camada of estado.camadas) {
        // camada AO VIVO: busca no serviço tudo que cruza as áreas (a consulta da tela não serve)
        if (camada.servico) {
          status('Buscando ' + camada.nome + ' no serviço, para as áreas de influência…');
          await garantirServicoCompleto(camada);
          const atual = estado.camadas.find((c) => c.id === camada.id);
          camadasDoRecorte.push(Object.assign({}, camada, { geojson: atual ? atual.geojson : { type: 'FeatureCollection', features: [] } }));
          continue;
        }
        camadasDoRecorte.push(await camadaParaRecorte(camada));
      }
      status('Dados completos. Recortando…');
    } catch (e) {
      $('progresso').hidden = true;
      document.body.classList.remove('carregando');
      alert('Não consegui carregar a camada para o recorte: ' + e.message
        + '\n\nO recorte NÃO foi feito — com dados parciais a área sairia menor que a real.');
      return;
    }
    status('Recortando…');
    await new Promise((r) => setTimeout(r, 30));

    try {
      const r = EIA.recorte.recortarTudo(estado.areas, camadasDoRecorte, opcoes);
      estado.resultados = r.resultados;
      estado.resumo = r.resumo;
      estado.salvo = false;
      desenharResultado();
      // O seletor de agrupamento é montado a partir das camadas que ENTRARAM no
      // resultado — antes disso não há coluna para oferecer. Agrupamento antigo de
      // camada que saiu do resultado é descartado, para não ficar escolha órfã.
      const idsNoResultado = new Set(estado.resultados.map((x) => x.camada.id));
      for (const id of Object.keys(estado.agrupamento)) {
        if (!idsNoResultado.has(id)) delete estado.agrupamento[id];
      }
      renderizarAgrupamento();
      renderizarTabela();
      renderizarGraficos();
      montarRelato();
      const el = $('resumo-recorte');
      el.hidden = false;
      el.className = 'aviso' + (r.erros.length ? ' alerta' : '');
      el.innerHTML = '<b>' + r.resumo.combinacoes + '</b> combinações processadas · <b>'
        + r.resumo.feicoes_resultado + '</b> feições no resultado · <b>'
        + EIA.math.num(r.resumo.area_total_ha, 2) + ' ha</b> somados em '
        + (r.resumo.ms / 1000).toFixed(1) + ' s'
        + (r.erros.length ? '<br>' + r.erros.length + ' combinação(ões) falharam: '
          + r.erros.map((e) => escapar(e.camada + ' × ' + e.area)).join(', ') : '');
      status('Recorte concluído: ' + r.resumo.feicoes_resultado + ' feições.');
      atualizarInfoArticulacao();

      const avisos = EIA.tabela.conferirFechamento(r.resultados);
      const alvo = $('avisos-conferencia');
      alvo.innerHTML = avisos.map((a) => '<div class="aviso alerta">' + escapar(a.mensagem) + '</div>').join('');
    } catch (e) {
      status('Falha no recorte: ' + e.message, true);
      alert('Não foi possível concluir o recorte.\n\n' + e.message);
    } finally {
      $('progresso').hidden = true;
      document.body.classList.remove('carregando');
    }
  }

  function desenharResultado() {
    estado.grupoResultado.clearLayers();
    const cores = {};
    let i = 0;
    for (const r of estado.resultados) {
      const chave = r.camada.id;
      if (!cores[chave]) cores[chave] = EIA.svg.cor(i++);
      if (!r.features.length) continue;
      L.geoJSON({ type: 'FeatureCollection', features: r.features }, {
        style: () => ({
          color: '#1f2d36', weight: 0.8, opacity: 0.55,
          fillColor: cores[chave], fillOpacity: 0.45,
        }),
        pointToLayer: (f, latlng) => L.circleMarker(latlng, { radius: 4, color: '#1f2d36', fillColor: cores[chave], fillOpacity: 0.8 }),
        onEachFeature: (f, layer) => {
          const p = f.properties;
          layer.bindPopup('<b>' + escapar(r.camada.nome) + '</b> — ' + escapar(p.eia_classe)
            + '<br>' + escapar(p.eia_ai) + '<br>' + EIA.math.num(p.eia_area_ha, 4) + ' ha ('
            + EIA.math.num(p.eia_pct_ai, 2) + '% da AI)');
        },
      }).addTo(estado.grupoResultado);
    }
  }


  // =========================================================== quilometragem
  /**
   * Carrega a camada de km que o usuário subiu (marcos de km ou o traçado da rodovia).
   *
   * A mesma entrada do resto do portal (EIA.entrada.interpretar) — o usuário não precisa
   * saber que o portal trata km de forma diferente; ele só diz que aquilo é km.
   */
  async function carregarKm(arquivos) {
    if (!arquivos.length) return;
    try {
      status('Lendo a camada de km…');
      const lido = await EIA.entrada.interpretar(arquivos);
      const geojson = lido.geojson;
      const nFeicoes = (geojson.features || []).length;
      if (!nFeicoes) throw new Error('A camada não tem nenhuma feição.');

      // Campos disponíveis para a coluna de km (o usuário pode trocar)
      const campos = {};
      for (const f of geojson.features) {
        for (const k of Object.keys(f.properties || {})) if (!(k in campos)) campos[k] = true;
      }
      const nomesCampos = Object.keys(campos);
      const temLinhas = EIA.km.temLinha(geojson);
      const detectado = EIA.km.campoDeKm(nomesCampos);

      estado.kmCamada = {
        nome: (arquivos[0].name || 'camada de km').replace(/\.[^.]+$/, ''),
        geojson: geojson, campos: nomesCampos, crs: lido.crs, aviso: lido.aviso || '',
      };
      estado.kmCampo = detectado;
      estado.kmLink = null;   // nome que dá link com as áreas, quando der

      // O select da coluna só aparece quando faz sentido: numa camada de traçado o km não
      // está em coluna nenhuma, ele é a distância percorrida.
      $('linha-campo-km').hidden = !nomesCampos.length || (temLinhas && !detectado);
      const seletor = $('campo-km');
      seletor.innerHTML = '';
      for (const nome of nomesCampos) {
        const op = document.createElement('option');
        op.value = nome;
        op.textContent = nome + (nome === detectado ? '  (parece o km)' : '');
        seletor.appendChild(op);
      }
      if (estado.kmCampo) seletor.value = estado.kmCampo;

      const modo = temLinhas ? 'traçado' : 'marcos';
      $('estado-km').textContent = estado.kmCamada.nome + ' · ' + nFeicoes
        + (nFeicoes === 1 ? ' feição' : ' feições') + ' · ' + modo
        + (detectado ? ' · coluna ' + detectado : '');
      $('estado-km').className = 'vazio';
      desenharKm();
      $('resultado-km').hidden = true;

      let msg = 'Camada de km carregada (' + modo + ').';
      if (!temLinhas && !detectado) {
        msg += ' Não achei a coluna do km: escolha ela em "Coluna do km".';
        status(msg, true);
      } else {
        if (lido.aviso) msg += ' ' + lido.aviso;
        status(msg);
      }
    } catch (e) {
      status('Não carreguei a camada de km: ' + e.message, true);
      $('estado-km').textContent = 'Falhou: ' + e.message;
      $('estado-km').className = 'vazio alerta';
    }
  }

  /** Desenha a camada de km: marcos como pontos, traçado como linha destacada. */
  function desenharKm() {
    if (!estado.grupoKm) return;
    estado.grupoKm.clearLayers();
    const camada = estado.kmCamada;
    if (!camada) return;
    const campo = estado.kmCampo;
    const rotulo = (props) => {
      const v = EIA.km.valorDoRegistro(props, campo);
      return v === null ? '' : 'km ' + EIA.km.formatar(v);
    };

    for (const f of camada.geojson.features) {
      const g = f.geometry;
      if (!g) continue;
      if (g.type === 'LineString' || g.type === 'MultiLineString') {
        // o traçado: linha forte, para se ver sobre o mapa de unidades
        L.geoJSON(f, {
          pane: 'pane-km',
          style: () => ({ color: '#d94f3d', weight: 3, opacity: 0.9 }),
          onEachFeature: (ff, layer) => layer.bindTooltip('Traçado', { sticky: true }),
        }).addTo(estado.grupoKm);
      } else {
        const texto = rotulo(f.properties || {});
        L.geoJSON(f, {
          pane: 'pane-km',
          pointToLayer: (ff, latlng) => L.circleMarker(latlng, {
            pane: 'pane-km', radius: 5, color: '#ffffff', weight: 1.5,
            fillColor: '#d94f3d', fillOpacity: 0.95,
          }),
          onEachFeature: (ff, layer) => {
            layer.bindTooltip(texto || camada.nome, { sticky: true });
          },
        }).addTo(estado.grupoKm);
      }
    }
  }

  /**
   * Localiza o km digitado e leva o mapa até lá.
   *
   * O texto passa por EIA.km.interpretar, que entende 70, 70,5, 70,500, 70+500 e
   * KM 70+500. A INTERPRETAÇÃO É MOSTRADA na tela antes do resultado: se o usuário digitou
   * algo ambíguo, ele vê o que o portal entendeu e corrige — em vez de o mapa ir para um
   * lugar e ele não saber por quê.
   */
  function localizarKm() {
    const caixa = $('resultado-km');
    const texto = $('busca-km').value;
    const mostrar = (html, alerta) => {
      caixa.hidden = false;
      caixa.className = 'resultado-km' + (alerta ? ' alerta' : '');
      caixa.innerHTML = html;
    };

    if (!estado.kmCamada) {
      mostrar('Carregue a camada de km primeiro (SHP, KMZ, KML ou GeoJSON) — é ela que diz onde cada km fica.', true);
      return;
    }
    const lido = EIA.km.interpretar(texto);
    if (!lido) {
      mostrar('Não entendi <b>' + escapar(texto) + '</b> como um km. Escreva como no projeto: '
        + '<b>70</b>, <b>70,5</b>, <b>70,500</b> ou <b>70+500</b>.', true);
      return;
    }

    const achado = EIA.km.localizar(estado.kmCamada.geojson, estado.kmCampo, lido.km);
    const interpretado = 'Entendi: <b>km ' + EIA.km.formatar(lido.km) + '</b> ('
      + EIA.km.formatarCurto(lido.km) + ').';
    if (!achado) {
      mostrar(interpretado + ' Mas não consegui localizar: esta camada '
        + (estado.kmCampo ? '' : 'não tem uma coluna de km escolhida, e ')
        + 'não tem linha de traçado para medir. Confira a camada.', true);
      return;
    }

    // marcador da busca: fica no mapa até a próxima
    if (estado.marcadorKm) estado.mapa.removeLayer(estado.marcadorKm);
    estado.marcadorKm = L.marker([achado.pos[1], achado.pos[0]], {
      icon: L.divIcon({
        className: 'marcador-km',
        html: '<span>' + escapar(achado.rotulo) + '</span>',
        iconSize: null,
      }),
    }).addTo(estado.mapa);

    // zoom: aproxima o suficiente para ver o entorno, sem perder a referência da rodovia
    const zoom = Math.max(estado.mapa.getZoom(), 15);
    estado.mapa.setView([achado.pos[1], achado.pos[0]], zoom);

    const coords = EIA.math.dms(achado.pos[0], 'lon') + ' · ' + EIA.math.dms(achado.pos[1], 'lat');
    let linhas = interpretado + ' Localizado em <b>' + escapar(achado.rotulo) + '</b> ('
      + (achado.modo === 'tracado' ? 'medido ao longo do traçado' : 'marco da camada') + ').<br>'
      + '<span class="meta-km">' + coords + '</span>';
    if (achado.nome) linhas += '<br><span class="meta-km">' + escapar(achado.nome) + '</span>';
    if (achado.comprimentoKm) {
      linhas += '<br><span class="meta-km">traçado com '
        + EIA.km.formatarCurto(achado.comprimentoKm, 1) + '</span>';
    }
    mostrar(linhas + (achado.aviso ? '<div class="aviso-km">' + escapar(achado.aviso) + '</div>' : ''),
      !!achado.aviso);
    status(achado.rotulo + ' · ' + coords);
  }


  // =========================================================== camadas em tiles
  /*
   * Pedologia (10,83 milhões de pontos) e Unidades de Conservação (3,22 milhões) não cabem
   * exatas em GeoJSON: 431 MB e 74 MB. Em tile binário quantizado elas ficam em 34 MB e 11 MB,
   * com TODOS os vértices (verificado: mesmos vértices, mesma área, 0,0000% de diferença).
   *
   * Duas leituras diferentes, e a diferença importa:
   *  - para DESENHAR, carrega só os tiles que aparecem na janela (1 a 3 tiles, ~1,5 MB cada);
   *  - para RECORTAR, carrega TODOS os tiles que cruzam a área de influência. Sem isso o
   *    recorte sairia incompleto e o relatório mentiria — erro muito pior que uma camada
   *    generalizada e avisada.
   */
  function bboxDaJanela(margem) {
    const bb = estado.mapa.getBounds();
    const m = margem === undefined ? 0.02 : margem;
    return [bb.getWest() - m, bb.getSouth() - m, bb.getEast() + m, bb.getNorth() + m];
  }

  /**
   * Descomprime o tile quando ele vem em gzip.
   *
   * A checagem e pelo MAGIC do gzip (1f 8b), nao pela extensao: se o servidor entregar o
   * conteudo ja descomprimido (por cabecalho de codificacao), os bytes chegam crus e
   * descomprimir de novo daria erro. Olhar os dois primeiros bytes resolve os dois casos,
   * sem tentativa e erro.
   */
  async function descomprimirSePreciso(buffer) {
    const u8 = new Uint8Array(buffer);
    if (u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b) {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('este navegador nao descomprime os dados da camada');
      }
      const fluxo = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
      return new Uint8Array(await new Response(fluxo).arrayBuffer());
    }
    return u8;
  }

  function tileCruza(tile, caixa) {
    const b = tile.bbox;
    return !(b[2] < caixa[0] || b[0] > caixa[2] || b[3] < caixa[1] || b[1] > caixa[3]);
  }

  /**
   * Qual versão da camada serve para o zoom atual.
   *
   * De LONGE vale a visão generalizada: numa tela de estado cada mancha de solo tem poucos
   * pixels, e desenhar 350 mil vértices para isso é o que deixava a camada lenta. De PERTO
   * vale o dado exato, que é o que se mede e se confere.
   */
  function nivelParaZoom(camada) {
    const z = estado.mapa.getZoom();
    /* As faixas vêm do catálogo (niveis: [{nivel, indice, zoom_max}]). De longe vale o desenho
     * generalizado, de perto vale o dado exato — cada nível é carregado só na sua faixa, e é
     * isso que mantém o download pequeno em qualquer zoom. */
    for (const n of (camada.niveis || [])) if (z <= n.zoom_max) return n.nivel;
    return 'exato';
  }

  function urlDoNivel(camada, nivel) {
    if (nivel === 'exato') return camada.tiles;
    const n = (camada.niveis || []).find((x) => x.nivel === nivel);
    return n ? n.indice : camada.tiles;
  }

  /** Índice de tiles do nível pedido, buscado uma vez e guardado. */
  async function indiceDaCamada(camada, nivel) {
    const n = nivel || 'exato';
    const chave = camada.id + ':' + n;
    if (!estado.indices[chave]) {
      const resposta = await fetch(urlDoNivel(camada, n), { cache: 'no-cache' });
      if (!resposta.ok) throw new Error('HTTP ' + resposta.status + ' no índice de tiles');
      estado.indices[chave] = await resposta.json();
    }
    return estado.indices[chave];
  }

  /** Troca de nível: descarta o que estava carregado, para não desenhar as duas versões. */
  function trocarNivel(camada, nivel) {
    if (estado.nivelCarregado[camada.id] === nivel) return false;
    estado.nivelCarregado[camada.id] = nivel;
    estado.tilesCarregados[camada.id] = new Set();
    const alvo = estado.camadas.find((c) => c.id === camada.id);
    if (alvo) alvo.geojson.features = [];
    return true;
  }

  /** Busca os tiles pedidos (os que ainda não estão na memória) e junta nas feições. */
  async function buscarTiles(camada, tiles, avisar) {
    const nivel = estado.nivelCarregado[camada.id] || 'exato';
    if (!estado.tilesCarregados[camada.id]) estado.tilesCarregados[camada.id] = new Set();
    const jaTem = estado.tilesCarregados[camada.id];
    const faltam = tiles.filter((x) => !jaTem.has(x.arquivo));
    if (!faltam.length) return 0;
    let feicoes = 0;
    for (let i = 0; i < faltam.length; i++) {
      const x = faltam[i];
      if (avisar) {
        status('Carregando ' + camada.nome + '… (' + (i + 1) + '/' + faltam.length + ' partes)');
      }
      const resposta = await fetch(x.arquivo, { cache: 'no-cache' });
      if (!resposta.ok) throw new Error('HTTP ' + resposta.status + ' em ' + x.arquivo);
      const bytes = await descomprimirSePreciso(await resposta.arrayBuffer());
      const fc = EIA.tiles.decodificar(bytes);
      const alvo = estado.camadas.find((c) => c.id === camada.id);
      if (!alvo) return feicoes;              // desligaram a camada no meio do carregamento
      for (const f of fc.features) {
        alvo.geojson.features.push(f);
        feicoes++;
      }
      jaTem.add(x.arquivo);
    }
    return feicoes;
  }

  /** Carrega o que a janela atual mostra e redesenha. */
  async function carregarTilesDaJanela(camada) {
    const nivel = nivelParaZoom(camada);
    trocarNivel(camada, nivel);
    const indice = await indiceDaCamada(camada, nivel);
    if (!estado.tilesCarregados[camada.id]) estado.tilesCarregados[camada.id] = new Set();
    const caixa = bboxDaJanela(0.02);
    const visiveis = indice.tiles.filter((x) => tileCruza(x, caixa));
    const carregados = await buscarTiles(camada, visiveis, false);
    if (carregados) {
      desenharCamadas();
      atualizarRotulos();
      const total = estado.camadas.find((c) => c.id === camada.id);
      const el = document.querySelector('.estado[data-camada="' + camada.id + '"]');
      if (el && total) el.textContent = total.geojson.features.length.toLocaleString('pt-BR')
        + ' feições' + (camada.classes && camada.classes.length > 1 ? ' · ' + camada.classes.length + ' classes' : '')
        + ' · ' + estado.tilesCarregados[camada.id].size + '/' + indice.tiles.length + ' partes'
        + (nivel === 'exato' ? '' : ' · ' + nivel + ' (aproxime para o dado exato)');
    }
  }

  /** Para RECORTAR: garante a camada inteira em memória (todos os tiles). */
  /** Para RECORTAR uma camada ao vivo: consulta TODAS as feições que cruzam as áreas de
   *  influência. A consulta da tela não serve — daria área menor que a real. */
  async function garantirServicoCompleto(camada) {
    const manifesto = estado.camadas.find((c) => c.id === camada.id);
    if (!manifesto) return;
    const feicoes = await consultarServico(camada, caixaDasAreas(), true);
    manifesto.geojson = { type: 'FeatureCollection', features: feicoes };
    deduzirColunasEClasses(manifesto, feicoes);
    desenharCamadas();
  }

  /**
   * Cópia da camada SÓ COM OS TILES QUE CRUZAM AS ÁREAS DE INFLUÊNCIA — é o que o recorte usa.
   *
   * Antes o recorte carregava TODOS os tiles da camada, e isso era o gargalo: medido com a área
   * de exemplo, o portal baixava e decodificava 1.533 tiles / 186 MB quando bastavam 52 tiles /
   * 5,65 MB (33x menos). Na Pedologia era 227 tiles / 23,3 MB contra 4 tiles / 0,49 MB. Nas 22
   * UGRHIs do Inventário, 21 delas não têm NENHUM tile naquela área — e eram carregadas inteiras.
   *
   * A cópia é SEPARADA de propósito: o mapa continua mostrando o que estava na tela, e o recorte
   * recebe a camada recortada pela caixa. Assim o recorte não mexe mais no que o usuário vê.
   */
  async function camadaParaRecorte(camada) {
    const copia = Object.assign({}, camada, { geojson: { type: 'FeatureCollection', features: [] } });
    if (!camada.tiles) {
      // camada de arquivo: já está inteira em memória
      const atual = estado.camadas.find((c) => c.id === camada.id);
      if (atual && atual.geojson) copia.geojson = atual.geojson;
      return copia;
    }
    const indice = await indiceDaCamada(camada, 'exato');
    const caixa = caixaDasAreas();
    const precisam = indice.tiles.filter((t) => tileCruza(t, caixa));
    for (let i = 0; i < precisam.length; i++) {
      status('Buscando ' + camada.nome + ' para o recorte… (' + (i + 1) + '/' + precisam.length + ' partes)');
      const resposta = await fetch(precisam[i].arquivo, { cache: 'no-cache' });
      if (!resposta.ok) throw new Error('HTTP ' + resposta.status + ' em ' + precisam[i].arquivo);
      const bytes = await descomprimirSePreciso(await resposta.arrayBuffer());
      const fc = EIA.tiles.decodificar(bytes);
      for (const f of fc.features) copia.geojson.features.push(f);
    }
    return copia;
  }

  async function garantirCamadaCompleta(camada) {
    if (!camada.tiles) return;
    /* O RECORTE usa SEMPRE o nível exato, independente do zoom: recortar sobre a visão
     * generalizada daria área errada. Se a visão estava carregada, ela é descartada. */
    trocarNivel(camada, 'exato');
    const indice = await indiceDaCamada(camada, 'exato');
    const antes = (estado.tilesCarregados[camada.id] || new Set()).size;
    if (antes >= indice.tiles.length) return;
    await buscarTiles(camada, indice.tiles, true);
    desenharCamadas();
  }

  /** Redesenha as camadas em tile que estão ligadas (ao mover o mapa). */
  async function atualizarTilesLigados() {
    for (const camada of estado.camadas.filter((c) => c.tiles)) {
      try { await carregarTilesDaJanela(camada); }
      catch (e) { status('Não carreguei uma parte de ' + camada.nome + ': ' + e.message, true); }
    }
    // as camadas ao vivo são reconsultadas a cada parada do mapa: o serviço responde pelo que
    // está na tela, e a chamada é leve (só a caixa visível)
    for (const camada of estado.camadas.filter((c) => c.servico)) {
      try { await carregarServicoNaJanela(camada); }
      catch (e) { status(mensagemDoServico(camada, e), true); }
    }
  }


  // =========================================================== camadas ao vivo
  /*
   * Escolha do cliente: as camadas da CETESB (áreas contaminadas, restrição de uso das águas
   * subterrâneas, Jurubatuba, Portaria DAEE 2653) NÃO entram na base fixa — o portal consulta
   * o serviço público da SEMIL/CETESB a cada uso. A contrapartida está dita na tela: depende do
   * servidor deles estar no ar, e o que aparece é o que ele responde agora.
   *
   * A consulta é sempre por CAIXA (o que está na tela, ou a área de influência no recorte),
   * com paginação — o serviço limita 1000 feições por resposta.
   */
  /* A montagem da URL e a decisão de paginar moram em js/servicos.js: são as duas coisas que
   * quebram em silêncio (caixa trocada no WFS, página que nunca termina) e lá podem ser
   * verificadas sem navegador. Aqui ficam só como ponte. */
  function urlDaConsulta(camada, caixa, offset) {
    return EIA.servicos.urlDaPagina(camada, caixa, offset);
  }

  /** Data em milissegundos (como o serviço devolve) vira data legível na tabela. */
  function comoData(v) {
    if (typeof v !== 'number' || v < 1e11 || v > 4e12) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }

  function arrumarAtributos(f) {
    for (const k of Object.keys(f.properties || {})) {
      const d = comoData(f.properties[k]);
      if (d) f.properties[k] = d;
    }
    return f;
  }

  /**
   * Colunas e classes saem do PRÓPRIO DADO: a camada é ao vivo, não há catálogo pronto. As
   * cores vêm do estilo do serviço; classe sem cor declarada cai na paleta do portal.
   */
  function deduzirColunasEClasses(camada, feicoes) {
    const chaves = [];
    const vistas = new Set();
    for (const f of feicoes) {
      for (const k of Object.keys(f.properties || {})) {
        if (vistas.has(k) || /^(objectid|shape)/i.test(k) || /ST(Area|Length)/i.test(k)) continue;
        vistas.add(k);
        chaves.push(k);
      }
    }
    if (chaves.length) camada.campos = chaves.map((k) => ({ nome: k, tipo: 'C', rotulo: k }));
    const campo = camada.campo_classe;
    if (!campo) return;
    const contagem = new Map();
    for (const f of feicoes) {
      let v = f.properties[campo];
      if (v === null || v === undefined || v === '') continue;
      v = String(v).trim();
      contagem.set(v, (contagem.get(v) || 0) + 1);
    }
    camada.classes = Array.from(contagem.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([classe, n]) => ({ classe: classe, feicoes: n }));
  }

  async function consultarServico(camada, caixa, avisar) {
    const feicoes = [];
    let offset = 0;
    for (let volta = 0; volta < 40; volta++) {
      const resposta = await fetch(urlDaConsulta(camada, caixa, offset), { cache: 'no-cache' });
      if (!resposta.ok) throw new Error('HTTP ' + resposta.status);
      const dados = await resposta.json();
      const vieram = EIA.servicos.feicoesDe(dados);   // lança se o serviço devolver erro
      for (const f of vieram) feicoes.push(arrumarAtributos(f));
      if (avisar) status('Carregando ' + camada.nome + '… ' + feicoes.length.toLocaleString('pt-BR') + ' feições');
      if (!EIA.servicos.temMais(EIA.servicos.tipoDe(camada), dados, vieram.length)) break;
      offset += vieram.length;
    }
    return feicoes;
  }

  function mensagemDoServico(camada, e) {
    return EIA.servicos.explicarFalha(camada, e.message);
  }

  /** Carrega o que a janela mostra (consulta por caixa: substitui, não acumula). */
  async function carregarServicoNaJanela(camada) {
    const dentro = estado.camadas.find((c) => c.id === camada.id);
    if (!dentro) return 0;
    const feicoes = await consultarServico(camada, bboxDaJanela(0), false);
    dentro.geojson = { type: 'FeatureCollection', features: feicoes };
    deduzirColunasEClasses(dentro, feicoes);
    desenharCamadas();
    atualizarRotulos();
    const el = document.querySelector('.estado[data-camada="' + camada.id + '"]');
    if (el) el.textContent = feicoes.length.toLocaleString('pt-BR') + ' feições na tela'
      + (dentro.classes && dentro.classes.length ? ' · ' + dentro.classes.length + ' classes' : '')
      + ' · ao vivo';
    return feicoes.length;
  }

  /** Caixa que cobre TODAS as áreas de influência (para o recorte da camada ao vivo). */
  function caixaDasAreas() {
    const fc = {
      type: 'FeatureCollection',
      features: estado.areas.map((a) => ({ type: 'Feature', properties: {}, geometry: a.geometry })),
    };
    return EIA.math.bbox(fc);
  }

  // =========================================================== ordem das camadas
  /**
   * Aplica a ordem escolhida, criando um painel por camada.
   *
   * Cada camada de caracterização ganha o SEU painel (`pane-cam-<id>`), com z-index vindo da
   * posição na lista. Assim a ordem não depende de quem foi desenhado por último — e o
   * usuário pode subir e descer camadas com as setas, que é o que a lista mostra.
   * O grupo das áreas recebe um número calculado: acima de todas ou abaixo de todas.
   */
  function aplicarOrdemDasCamadas() {
    if (!estado.mapa) return;
    const ordem = estado.ordemCamadas || [];
    for (const id of ordem) {
      const nome = 'pane-cam-' + id;
      if (!estado.mapa.getPane(nome)) estado.mapa.createPane(nome);
      estado.mapa.getPane(nome).style.zIndex = EIA.mapa.zIndexDaCamada(ordem, id);
    }
    if (estado.mapa.getPane('pane-areas')) {
      estado.mapa.getPane('pane-areas').style.zIndex = EIA.mapa.zIndexDasAreas(ordem, estado.areasAcima !== false);
    }
    if (estado.mapa.getPane('pane-resultado')) {
      estado.mapa.getPane('pane-resultado').style.zIndex = EIA.mapa.zIndexDoResultado(ordem);
    }
  }

  /** Painel onde desenhar a camada (cria na hora se a lista mudou depois do mapa). */
  function painelDaCamada(id) {
    const nome = 'pane-cam-' + id;
    if (!estado.mapa.getPane(nome)) {
      estado.mapa.createPane(nome);
      estado.mapa.getPane(nome).style.zIndex = EIA.mapa.zIndexDaCamada(estado.ordemCamadas || [], id);
    }
    return nome;
  }

  /** Sobe (-1) ou desce (+1) a camada na ordem de desenho. */
  function moverCamada(id, direcao) {
    const nova = EIA.mapa.moverNaOrdem(estado.ordemCamadas || [], id, direcao);
    if (!nova) {
      status(direcao < 0 ? 'Esta camada já é a de baixo.' : 'Esta camada já é a de cima.');
      return;
    }
    estado.ordemCamadas = nova;
    aplicarOrdemDasCamadas();
    renderizarCatalogo();
    const camada = (estado.catalogo ? estado.catalogo.camadas.find((c) => c.id === id) : null);
    status('Ordem: ' + (camada ? camada.nome : id) + (direcao < 0 ? ' subiu' : ' desceu') + '.');
  }

  /** Liga/desliga "minhas áreas por cima das camadas". */
  function alternarAreasAcima(acima) {
    estado.areasAcima = !!acima;
    aplicarOrdemDasCamadas();
    status(estado.areasAcima
      ? 'Suas áreas ficam por cima das camadas de caracterização.'
      : 'Suas áreas ficam por baixo das camadas de caracterização.');
  }

  // =========================================================== agrupamento
  /**
   * Monta os seletores de coluna, UM POR CAMADA do resultado.
   *
   * Por camada, e não uma lista única: a geologia tem SIGLA_UNID e LITOTIPO1, o uso do
   * solo tem CLASSE. Uma lista com a união das duas ofereceria coluna que não existe no
   * dado que a pessoa está olhando — e a tabela sairia cheia de "(vazio)" sem motivo.
   */
  function renderizarAgrupamento() {
    const bloco = $('bloco-agrupamento');
    const alvo = $('agrupamento-camadas');
    if (!bloco || !alvo) return;
    const disponiveis = EIA.tabela.colunasDisponiveis(estado.resultados);
    if (!disponiveis.length) {
      bloco.hidden = true;
      alvo.innerHTML = '';
      return;
    }
    bloco.hidden = false;
    alvo.innerHTML = '';
    for (const c of disponiveis) {
      const linha = document.createElement('div');
      linha.className = 'agrupamento-linha';

      const rotulo = document.createElement('label');
      rotulo.className = 'agrupamento-nome';
      rotulo.textContent = c.nome;
      rotulo.title = c.meio ? 'Meio: ' + c.meio : '';
      linha.appendChild(rotulo);

      const sel = document.createElement('select');
      sel.multiple = true;
      sel.size = Math.min(5, Math.max(3, c.colunas.length));
      sel.dataset.camada = c.id;
      const escolhidas = estado.agrupamento[c.id] || [];
      for (const col of c.colunas) {
        const op = document.createElement('option');
        op.value = col;
        op.textContent = col + (col === c.campo_padrao ? '  (classe do mapa)' : '');
        op.selected = escolhidas.indexOf(col) >= 0;
        sel.appendChild(op);
      }
      sel.addEventListener('change', () => {
        const valores = Array.from(sel.selectedOptions).map((o) => o.value);
        if (valores.length) estado.agrupamento[c.id] = valores;
        else delete estado.agrupamento[c.id];
        // a área da tabela também tem de acompanhar na hora: é o ponto da funcionalidade
        renderizarTabela();
        renderizarGraficos();
      });
      linha.appendChild(sel);

      const dica = document.createElement('span');
      dica.className = 'agrupamento-atual';
      dica.textContent = (estado.agrupamento[c.id] || []).length
        ? 'agrupando por ' + estado.agrupamento[c.id].join(' + ')
        : 'padrão: ' + (c.campo_padrao || '(sem classe)');
      linha.appendChild(dica);

      alvo.appendChild(linha);
    }
  }

  function limparAgrupamento() {
    estado.agrupamento = {};
    renderizarAgrupamento();
    renderizarTabela();
    renderizarGraficos();
    status('Agrupamento de volta ao campo de classe de cada camada.');
  }

  // =========================================================== tabela
  function linhasDaVisao() {
    const meio = $('filtro-meio').value;
    const resultados = estado.resultados.filter((r) => !meio || r.camada.meio === meio);
    const visao = $('visao-tabela').value;
    if (visao === 'classe') {
      const l = EIA.tabela.porClasse(resultados, { agrupamento: estado.agrupamento });
      return { colunas: colunasDe(l), linhas: l };
    }
    if (visao === 'areacamada') {
      const l = EIA.tabela.porAreaCamada(resultados);
      return { colunas: colunasDe(l), linhas: l };
    }
    const a = EIA.tabela.atributos(resultados);
    return { colunas: a.colunas, linhas: a.linhas.map((linha) => {
      const obj = {};
      a.colunas.forEach((c, i) => { obj[c.campo] = linha[i]; });
      return obj;
    }) };
  }

  // Campos internos do cálculo: aparecem no objeto da linha, mas não são coluna da
  // tabela. `classe_base` existe só para dar cor à barra do gráfico; `grupo_por` é
  // repetido em toda linha (o agrupamento já está escrito acima da tabela).
  const CAMPOS_INTERNOS = ['classe_base', 'grupo_por'];

  function colunasDe(linhas) {
    if (!linhas.length) return [];
    return Object.keys(linhas[0])
      .filter((k) => CAMPOS_INTERNOS.indexOf(k) < 0)
      .map((k) => ({ campo: k, rotulo: EIA.tabela.ROTULOS[k] || k }));
  }

  function renderizarTabela() {
    const { colunas, linhas } = linhasDaVisao();
    const thead = $('tabela-resultado').querySelector('thead');
    const tbody = $('tabela-resultado').querySelector('tbody');
    thead.innerHTML = '';
    tbody.innerHTML = '';
    if (!linhas.length) {
      thead.innerHTML = '<tr><th>Sem resultado</th></tr>';
      tbody.innerHTML = '<tr><td>Faça o recorte para ver a tabela.</td></tr>';
      return;
    }
    const numericas = new Set(['area_ha', 'pct_ai', 'pct_camada', 'comprimento_km', 'area_ai_ha', 'feicoes',
      'eia_area_ha', 'eia_pct_ai', 'eia_pct_feicao', 'eia_area_orig_ha', 'eia_compr_km']);

    const tr = document.createElement('tr');
    for (const c of colunas) {
      const th = document.createElement('th');
      th.textContent = c.rotulo;
      if (numericas.has(c.campo)) th.className = 'numero';
      tr.appendChild(th);
    }
    thead.appendChild(tr);

    const limite = $('visao-tabela').value === 'atributos' ? 500 : 400;
    linhas.slice(0, limite).forEach((linha) => {
      const tr2 = document.createElement('tr');
      for (const c of colunas) {
        const td = document.createElement('td');
        const v = linha[c.campo];
        if (typeof v === 'number') {
          td.className = 'numero';
          td.textContent = EIA.math.num(v, Math.abs(v) < 1 ? 4 : 2);
        } else {
          td.textContent = v === undefined || v === null ? '' : String(v);
        }
        tr2.appendChild(td);
      }
      tbody.appendChild(tr2);
    });
    if (linhas.length > limite) {
      const tr3 = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = colunas.length;
      td.textContent = 'Mostrando as primeiras ' + limite + ' de ' + linhas.length + ' linhas. O arquivo exportado traz todas.';
      tr3.appendChild(td);
      tbody.appendChild(tr3);
    }
  }

  function exportarTabela(formato) {
    if (!estado.resultados.length) { alert('Faça o recorte primeiro.'); return; }
    const { colunas, linhas } = linhasDaVisao();
    const matriz = linhas.map((l) => colunas.map((c) => l[c.campo]));
    if (formato === 'csv') {
      baixar(new Blob([EIA.xlsx.gerarCsv(colunas, matriz)], { type: 'text/csv;charset=utf-8' }), 'tabela-eia.csv');
      return;
    }
    EIA.xlsx.gerar([
      { nome: 'Tabela', colunas: colunas, linhas: matriz },
      { nome: 'Relatório de recorte', colunas: [{ rotulo: 'AI' }, { rotulo: 'Camada' }, { rotulo: 'Feições' }, { rotulo: 'Área (ha)' }, { rotulo: 'Método' }],
        linhas: estado.resultados.map((r) => [r.relatorio.ai_nome, r.camada.nome, r.relatorio.feicoes_resultado, r.relatorio.area_total_ha, r.relatorio.operacao]) },
      { nome: 'Colunas', colunas: [{ rotulo: 'Campo' }, { rotulo: 'Significado' }],
        linhas: EIA.recorte.COLUNAS.map((c) => [c.campo, c.rotulo]) },
    ]).then((bytes) => baixar(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'tabela-eia.xlsx'));
  }

  // =========================================================== gráficos
  let ultimoSvg = null;
  function renderizarGraficos() {
    const alvo = $('graficos');
    if (!estado.resultados.length) { alvo.innerHTML = '<p class="vazio">Faça o recorte para ver os gráficos.</p>'; return; }
    const meio = $('filtro-meio').value;
    const graficos = EIA.tabela.dadosParaGraficos(estado.resultados, { apenasMeio: meio, agrupamento: estado.agrupamento });
    const tipo = $('grafico-tipo').value;
    const partes = [];
    if (tipo === 'comparativo') {
      const classes = new Set();
      graficos.forEach((g) => g.classes.forEach((c) => classes.add(c.rotulo)));
      const principais = Array.from(classes).slice(0, 8);
      const areas = Array.from(new Set(graficos.map((g) => g.ai)));
      const series = areas.map((ai, k) => ({
        nome: ai,
        cor: EIA.svg.cor(k),
        valores: principais.map((classe) => {
          let soma = 0;
          graficos.filter((g) => g.ai === ai).forEach((g) => {
            const c = g.classes.find((x) => x.rotulo === classe);
            if (c) soma += c.valor;
          });
          return EIA.tabela.arredondar(soma, 2);
        }),
      }));
      ultimoSvg = EIA.svg.barrasAgrupadas(principais, series, { titulo: 'Área por classe e área de influência (ha)', largura: 720 });
      partes.push(ultimoSvg);
    } else {
      for (const g of graficos) {
        if (!g.classes.length) continue;
        // A barra recebe a cor do MAPA: usa a classe do catálogo dominante no grupo. É o
        // que faz o gráfico e o mapa lerem na mesma cor, mesmo quando o agrupamento da
        // tabela é outro (por exemplo NOME_UNIDA + LITOTIPO1 sobre a cor de SIGLA_UNID).
        const camada = estado.camadas.find((c) => c.id === g.camada_id) || {};
        const cores = (camada.estilo && camada.estilo.cores) || {};
        const dados = g.classes.slice(0, 10).map((c) => ({
          rotulo: c.rotulo,
          valor: c.valor,
          cor: cores[c.base] || undefined,
        }));
        const titulo = g.camada + ' — ' + g.ai + ' (' + EIA.math.num(g.total_ha, 2) + ' ha)'
          + (g.grupo_por ? '  ·  por ' + g.grupo_por : '');
        partes.push(tipo === 'pizza'
          ? EIA.svg.pizza(dados, { titulo: titulo, largura: 560, altura: 300 })
          : EIA.svg.barras(dados, { titulo: titulo, largura: 560, altura: 300, rotuloY: 'hectares' }));
      }
      ultimoSvg = partes[partes.length - 1] || null;
    }
    alvo.innerHTML = partes.join('<div style="height:10px"></div>') || '<p class="vazio">Sem dados para gráfico nesta seleção.</p>';
  }

  function baixarGraficoSvg() {
    if (!ultimoSvg) { alert('Gere um gráfico primeiro.'); return; }
    baixar(new Blob([ultimoSvg], { type: 'image/svg+xml' }), 'grafico-eia.svg');
  }

  async function baixarGraficoPng() {
    if (!ultimoSvg) { alert('Gere um gráfico primeiro.'); return; }
    try {
      const dataUrl = await EIA.svg.paraPngDataUrl(ultimoSvg, 3);
      if (!dataUrl) { alert('Este navegador não permitiu gerar o PNG.'); return; }
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'grafico-eia.png';
      a.click();
    } catch (e) {
      alert('Não foi possível gerar o PNG: ' + e.message);
    }
  }

  // =========================================================== relatório
  function montarRelato() {
    // O relatório também segue o agrupamento escolhido: o texto tem de falar dos mesmos
    // grupos que aparecem na tabela, senão o número do texto não fecha com o da tabela.
    estado.relato = EIA.relatorio.redigir(estado.resultados, dadosProjeto(), { agrupamento: estado.agrupamento });
    const alvo = $('relatorio-texto');
    alvo.innerHTML = estado.relato.secoes.map((s) =>
      '<h3>' + escapar(s.titulo) + '</h3>' + s.paragrafos.map((p) => '<p>' + escapar(p) + '</p>').join('')).join('');
  }

  function dadosProjeto() {
    return {
      nome: $('projeto-nome').value,
      cliente: $('projeto-cliente').value,
      responsavel: $('responsavel').value,
      crea: $('crea').value,
    };
  }

  async function gerarPdfRelatorio() {
    if (!estado.resultados.length) { alert('Faça o recorte primeiro.'); return; }
    if (!estado.relato) montarRelato();
    status('Montando o relatório…');
    try {
      const imagens = await imagensDosGraficos();
      const bytes = EIA.relatorio.gerarPdf(estado.relato, estado.resultados, { folha: 'A4', imagens: imagens, agrupamento: estado.agrupamento });
      baixar(new Blob([bytes], { type: 'application/pdf' }), 'relatorio-eia.pdf');
      status('Relatório gerado.');
    } catch (e) {
      /* AVISA EM JANELA, não só na linha de status: a linha passa despercebida, e o cliente ficou
       * sem o relatório sem saber por quê. Com a janela, a mensagem chega — e ela diz o motivo. */
      status('Falha ao gerar o PDF: ' + e.message, true);
      alert('Não consegui gerar o PDF do relatório.\n\n' + e.message
        + '\n\nO texto do relatório está na aba Relatório — ele pode ser copiado de lá, e o '
        + '"Baixar texto" salva em .txt enquanto isso.');
    }
  }

  function baixarTextoRelatorio() {
    if (!estado.relato) { alert('Faça o recorte primeiro.'); return; }
    baixar(new Blob([EIA.relatorio.textoSimples(estado.relato)], { type: 'text/plain;charset=utf-8' }), 'relatorio-eia.txt');
  }

  /** O relatório em .docx — o texto e as tabelas de área e percentual, editáveis no Word. */
  async function baixarDocx() {
    if (!estado.resultados.length) { alert('Faça o recorte primeiro.'); return; }
    if (!estado.relato) montarRelato();
    status('Montando o documento (.docx)…');
    try {
      const bytes = await EIA.docx.gerarDocx(estado.relato, estado.resultados, {
        titulo: 'Relatório de caracterização ambiental',
        projeto: dadosProjeto(),
        data: new Date().toLocaleDateString('pt-BR'),
      });
      baixar(new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }), 'relatorio-eia.docx');
      status('Documento .docx gerado.');
    } catch (e) {
      status('Falha ao gerar o .docx: ' + e.message, true);
      alert('Não consegui gerar o .docx.\n\n' + e.message
        + '\n\nEnquanto isso, o texto continua na aba Relatório e o PDF também está disponível.');
    }
  }

  async function imagensDosGraficos() {
    const graficos = EIA.tabela.dadosParaGraficos(estado.resultados, {});
    const saida = [];
    for (const g of graficos.slice(0, 6)) {
      const svg = EIA.svg.barras(g.classes.slice(0, 8).map((c) => ({ rotulo: c.rotulo, valor: c.valor })),
        { titulo: g.camada + ' — ' + g.ai, largura: 560, altura: 300 });
      const dataUrl = await EIA.svg.paraPngDataUrl(svg, 2);
      void dataUrl;
      const svgBase64 = await svgParaJpegBase64(svg);
      if (svgBase64) {
        saida.push({ bytes: svgBase64, titulo: 'Gráfico — ' + g.camada + ' · ' + g.ai, alturaMm: 62, larguraMm: 150 });
      }
    }
    return saida;
  }

  /** SVG -> JPEG (o PDF embute JPEG direto, sem recompressão). */
  async function svgParaJpegBase64(svg) {
    try {
      const dataUrl = await EIA.svg.paraPngDataUrl(svg, 2);
      if (!dataUrl) return null;
      const img = await carregarImagem(dataUrl);
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      const jpegUrl = canvas.toDataURL('image/jpeg', 0.85);
      return base64ParaBytes(jpegUrl.split(',')[1]);
    } catch (e) {
      return null;
    }
  }

  function carregarImagem(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('imagem'));
      img.src = url;
    });
  }

  function base64ParaBytes(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // =========================================================== mapa / articulação
  function extensaoAtual() {
    const comResultado = estado.resultados.filter((r) => r.features.length);
    if (comResultado.length) {
      let bbox = null;
      for (const r of comResultado) {
        const b = EIA.math.bbox({ type: 'FeatureCollection', features: r.features });
        bbox = EIA.math.unirBbox(bbox, b);
      }
      if (bbox) return bbox;
    }
    if (estado.areas.length) {
      let bbox = null;
      for (const a of estado.areas) bbox = EIA.math.unirBbox(bbox, EIA.math.bbox(a.geometry));
      return bbox;
    }
    return null;
  }

  function especificacaoMapa() {
    const bbox = extensaoAtual();
    const escala = Number($('escala').value);
    const folha = $('folha').value;
    const orientacao = $('orientacao').value;
    const articulado = $('articulado').checked;
    const art = articulado && bbox ? EIA.mapa.articular(bbox, folha, orientacao, escala, { sobreposicao: 0.1 }) : null;
    return {
      folha: folha, orientacao: orientacao, escala: escala, bbox: bbox,
      projeto: $('projeto-nome').value, cliente: $('projeto-cliente').value,
      titulo: $('titulo-mapa').value, responsavel: $('responsavel').value, crea: $('crea').value,
      // a chapa da folha usa o TÍTULO que o usuário escreveu, e os nomes de quem desenhou e verificou
      tituloChapa: $('titulo-mapa') ? $('titulo-mapa').value : '',
      desenhista: $('desenhista') ? $('desenhista').value : '',
      verificador: $('verificador') ? $('verificador').value : '',
      datum: 'SIRGAS 2000 / UTM 23S · WGS 84',
      fonte: estado.camadas.map((c) => c.fonte).filter(Boolean).slice(0, 4).join(' · '),
      legenda: legendaAtual(),
      articulacao: art,
      logos: estado.logos,
      data: new Date().toLocaleDateString('pt-BR'),
    };
  }

  /** Teto de segurança da legenda. O PDF calcula a capacidade real da folha. */
  const TETO_LEGENDA = 60;

  /** bbox de uma geometria solta (math.bbox espera Feature/FeatureCollection). */
  function bboxDaGeometria(geometria) {
    let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity, n = 0;
    EIA.math.percorrerCoords(geometria, (p) => {
      n++;
      if (p[0] < xmin) xmin = p[0];
      if (p[0] > xmax) xmax = p[0];
      if (p[1] < ymin) ymin = p[1];
      if (p[1] > ymax) ymax = p[1];
    });
    return n ? [xmin, ymin, xmax, ymax] : null;
  }

  /**
   * Itens da legenda: o que APARECE no mapa, não o catálogo inteiro.
   *
   * Numa folha de 1:5.000 cabem uns 2 km²: aparecem 3 a 8 unidades geológicas, não as
   * 306 do Estado de São Paulo. Legenda que lista o catálogo inteiro não serve para a
   * folha — e era o que acontecia antes (a camada entrava como UM item, ou estourava o
   * rodapé com 306). A ordem é por área decrescente, que é a convenção cartográfica:
   * a unidade que domina a folha aparece primeiro.
   *
   * A fonte da legenda, em ordem de preferência:
   *   1. o RESULTADO do recorte, quando já houve recorte (é o mapa do estudo);
   *   2. as classes das feições que caem na extensão atual do mapa;
   *   3. uma cor por camada, quando a camada não tem classe.
   */
  function legendaAtual() {
    const itens = [];
    for (const a of estado.areas) itens.push({ rotulo: a.sigla + ' — ' + a.nome, cor: a.cor, forma: 'poligono' });

    const bbox = extensaoAtual();

    // 1) o que saiu do recorte, por camada
    const doResultado = new Map();
    for (const r of (estado.resultados || [])) {
      if (!r || !r.features || !r.camada) continue;
      const mapa = doResultado.get(r.camada.id) || new Map();
      for (const f of r.features) {
        const p = f.properties || {};
        if (p.eia_classe === undefined || p.eia_classe === null) continue;
        const chave = String(p.eia_classe);
        mapa.set(chave, (mapa.get(chave) || 0) + (p.eia_area_ha || 0));
      }
      doResultado.set(r.camada.id, mapa);
    }

    const ordenados = estado.camadas.slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    for (const c of ordenados) {
      const estilo = c.estilo || {};
      const cores = estilo.cores || {};
      let pares = [];

      if (doResultado.has(c.id)) {
        pares = Array.from(doResultado.get(c.id).entries()).map(([classe, area]) => ({ classe: classe, peso: area }));
      } else if (c.geojson && c.geojson.features && bbox) {
        const contagem = new Map();
        for (const f of c.geojson.features) {
          const b = bboxDaGeometria(f.geometry);
          if (!b) continue;
          if (b[2] < bbox[0] || b[0] > bbox[2] || b[3] < bbox[1] || b[1] > bbox[3]) continue;
          const bruto = c.campo_classe ? (f.properties || {})[c.campo_classe] : null;
          const chave = (bruto === undefined || bruto === null || bruto === '') ? 'Sem classe' : String(bruto);
          contagem.set(chave, (contagem.get(chave) || 0) + 1);
        }
        pares = Array.from(contagem.entries()).map(([classe, n]) => ({ classe: classe, peso: n }));
      }

      pares.sort((a, b) => b.peso - a.peso);
      if (pares.length > 1) {
        for (const p of pares) {
          itens.push({
            rotulo: c.nome + ': ' + p.classe,
            cor: cores[p.classe] || estilo.cor || CORES_MEIO[c.meio] || '#7d8b93',
            forma: 'poligono',
          });
        }
      } else {
        itens.push({ rotulo: c.nome, cor: estilo.cor || CORES_MEIO[c.meio] || '#7d8b93', forma: 'poligono' });
      }
    }

    if (itens.length <= TETO_LEGENDA) return itens;
    const resto = itens.length - TETO_LEGENDA + 1;
    return itens.slice(0, TETO_LEGENDA - 1).concat([{
      rotulo: 'e mais ' + resto + ' classes — ver tabela de áreas',
      cor: '#c8ced3',
      forma: 'poligono',
    }]);
  }

  function atualizarInfoArticulacao() {
    const el = $('info-articulacao');
    const bbox = extensaoAtual();
    if (!bbox) { el.hidden = true; return; }
    const escala = Number($('escala').value);
    const cob = EIA.mapa.cobertura($('folha').value, $('orientacao').value, escala);
    const partes = ['Cada folha cobre ' + EIA.math.num(cob.larguraKm, 2) + ' × ' + EIA.math.num(cob.alturaKm, 2)
      + ' km (' + EIA.math.num(cob.areaKm2, 1) + ' km²) em 1:' + EIA.math.num(escala, 0) + '.'];
    if ($('articulado').checked) {
      const art = EIA.mapa.articular(bbox, $('folha').value, $('orientacao').value, escala, { sobreposicao: 0.1 });
      partes.push('Articulação: <b>' + art.total + ' folhas</b> em ' + art.linhas + '×' + art.colunas
        + ', sobreposição de 10%. O PDF sai com o mapa-índice.');
      if (escala <= 5000 && (($('folha').value === 'A4') || ($('folha').value === 'A3'))) {
        partes.push('<b>Atenção:</b> em 1:' + EIA.math.num(escala, 0) + ' a folha ' + $('folha').value
          + ' fica com legenda apertada — prefira A1 ou A0.');
      }
    } else {
      const esc = EIA.mapa.escalaQueCabe(bbox, $('folha').value, $('orientacao').value);
      partes.push('Sem articulação, a maior escala que cabe a extensão atual é 1:' + EIA.math.num(esc, 0) + '.');
    }
    el.hidden = false;
    el.innerHTML = partes.join('<br>');
  }

  function atualizarPreviaMapa() {
    const e = especificacaoMapa();
    if (!e.bbox) {
      $('previa-mapa').innerHTML = '<p class="vazio">Carregue uma área de influência ou faça o recorte para montar o mapa.</p>';
      return;
    }
    const escala = e.escala;
    const folha = e.folha;
    // enquadramento do mapa: quando articulado, mostra a primeira folha
    const bboxFolha = e.articulacao ? e.articulacao.folhas[0].bbox : enquadrarPorEscala(e.bbox, folha, e.orientacao, escala);
    const previa = EIA.mapa.previaSvg(Object.assign({}, e, {
      bbox: bboxFolha,
      numeroFolha: e.articulacao ? e.articulacao.folhas[0].nome : ('1:' + EIA.math.num(escala, 0)),
      escala: escala,
    }), { escalaTela: Math.min(1.1, 620 / (EIA.pdf.caixaDoMapa(folha, e.orientacao, {}).larguraFolha)) });
    $('previa-mapa').innerHTML = previa;
    atualizarInfoArticulacao();
  }

  function enquadrarPorEscala(bbox, folha, orientacao, escala) {
    const caixa = EIA.pdf.caixaDoMapa(folha, orientacao, {});
    const lat = (bbox[1] + bbox[3]) / 2;
    const g = EIA.mapa.grausDaFolha(folha, orientacao, escala, lat, {});
    const centroLon = (bbox[0] + bbox[2]) / 2;
    const centroLat = (bbox[1] + bbox[3]) / 2;
    return [centroLon - g.dLon / 2, centroLat - g.dLat / 2, centroLon + g.dLon / 2, centroLat + g.dLat / 2];
  }

  function sugerirEscala() {
    const bbox = extensaoAtual();
    if (!bbox) { alert('Carregue uma área de influência ou faça o recorte primeiro.'); return; }
    const esc = EIA.mapa.escalaQueCabe(bbox, $('folha').value, $('orientacao').value);
    const opcao = Array.from($('escala').options).find((o) => Number(o.value) === esc);
    if (opcao) $('escala').value = opcao.value;
    else {
      const nova = document.createElement('option');
      nova.value = String(esc);
      nova.textContent = '1:' + EIA.math.num(esc, 0);
      $('escala').appendChild(nova);
      $('escala').value = String(esc);
    }
    atualizarInfoArticulacao();
    atualizarPreviaMapa();
  }

  /** Rasteriza o mapa atual no enquadramento pedido (para entrar no PDF). */
  async function rasterizarMapa(bbox, larguraMm, escala) {
    const mapa = estado.mapa;
    const configuracoes = { animate: false };
    const larguraPx = Math.max(600, Math.min(2200, Math.round(larguraMm * 8)));
    // pixels por grau necessários para a escala pedida
    const mPorMm = escala / 1000;
    const metrosLargura = larguraMm * mPorMm;
    const lat = (bbox[1] + bbox[3]) / 2;
    const grausLargura = metrosLargura / (111320 * Math.cos(lat * Math.PI / 180));
    void grausLargura;

    const zoom = mapa.getBoundsZoom([[bbox[1], bbox[0]], [bbox[3], bbox[2]]], false, [larguraPx, Math.round(larguraPx * 0.66)]);
    const centro = [(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2];
    mapa.setView(centro, zoom, configuracoes);
    await esperar(420);

    const container = mapa.getContainer();
    const temporario = document.createElement('canvas');
    temporario.width = larguraPx;
    temporario.height = Math.round(larguraPx * 0.66);
    const ctx = temporario.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, temporario.width, temporario.height);

    /* AS IMAGENS DE FUNDO SÃO <img>, NÃO CANVAS.
     *
     * A versão anterior copiava só os canvas do container — e o mapa de satélite do Leaflet é
     * feito de elementos <img> (as peças do tile). Ou seja: o fundo NUNCA entrava na captura.
     * Pior: qualquer erro de cópia era engolido por um `catch` vazio, então a exportação podia
     * terminar com uma FOLHA EM BRANCO e sem um único aviso — que foi o que o cliente viu.
     *
     * Agora: fundo primeiro, vetores por cima, e as FALHAS SÃO CONTADAS. Se o canvas vetorial (que
     * é o conteúdo do mapa) não puder ser copiado, a exportação FALHA COM MENSAGEM, em vez de
     * entregar uma folha em branco. Se falharem só peças do fundo, o PDF sai e o portal avisa. */
    const rc = container.getBoundingClientRect();
    const fatorX = temporario.width / rc.width, fatorY = temporario.height / rc.height;
    const falhas = [];
    function copiar(el, rotulo) {
      try {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        ctx.drawImage(el, (r.left - rc.left) * fatorX, (r.top - rc.top) * fatorY,
          r.width * fatorX, r.height * fatorY);
      } catch (e) {
        // guarda o MOTIVO: nome do erro diz se foi taint de canvas (SecurityError) ou outra coisa
        falhas.push(rotulo + ': ' + ((e && e.name) || 'erro'));
      }
    }
    container.querySelectorAll('img.leaflet-tile').forEach((img) => copiar(img, 'imagem de fundo'));
    container.querySelectorAll('canvas').forEach((c) => copiar(c, 'camada vetorial'));
    if (falhas.length) {
      const vetorialFalhou = falhas.some((f) => f.indexOf('camada vetorial') >= 0);
      if (vetorialFalhou) {
        throw new Error('não consegui copiar as camadas do mapa para a imagem (' + falhas[0] + '). '
          + 'Isso costuma ser o mapa de fundo bloqueando a captura: desligue a camada de fundo e tente de novo.');
      }
      status('Aviso: ' + falhas.length + ' peça(s) do mapa de fundo não entraram na imagem (' + falhas[0] + ').', true);
    }
    return base64ParaBytes(temporario.toDataURL('image/jpeg', 0.9).split(',')[1]);
  }

  function esperar(ms) { return new Promise((r) => setTimeout(r, ms)); }

  async function baixarFolhaPng() {
    const e = especificacaoMapa();
    if (!e.bbox) { alert('Carregue uma área de influência ou faça o recorte primeiro.'); return; }
    status('Rasterizando o mapa…');
    try {
      const bboxFolha = e.articulacao ? e.articulacao.folhas[0].bbox : enquadrarPorEscala(e.bbox, e.folha, e.orientacao, e.escala);
      const jpeg = await rasterizarMapa(bboxFolha, EIA.pdf.caixaDoMapa(e.folha, e.orientacao, {}).mapa.largura, e.escala);
      baixar(new Blob([jpeg], { type: 'image/jpeg' }), 'mapa-folha-01.jpg');
      status('Folha rasterizada salva como imagem.');
    } catch (err) {
      status('Falha ao rasterizar: ' + err.message, true);
    }
  }

  async function gerarPdfMapa() {
    const e = especificacaoMapa();
    if (!e.bbox) { alert('Carregue uma área de influência ou faça o recorte primeiro.'); return; }
    status('Montando o mapa…');
    document.body.classList.add('carregando');
    try {
      const caixa = EIA.pdf.caixaDoMapa(e.folha, e.orientacao, {});
      const imagens = [];
      if (e.articulacao && e.articulacao.total > 1) {
        for (const folha of e.articulacao.folhas) {
          const jpeg = await rasterizarMapa(folha.bbox, caixa.mapa.largura, e.escala);
          imagens.push({ chave: folha.numero, bytes: jpeg });
        }
      } else {
        const bboxFolha = enquadrarPorEscala(e.bbox, e.folha, e.orientacao, e.escala);
        const jpeg = await rasterizarMapa(bboxFolha, caixa.mapa.largura, e.escala);
        imagens.push({ chave: 'unico', bytes: jpeg });
      }

      const logos = [];
      for (const logo of estado.logos) {
        logos.push({ nomeImagem: logo.nomeImagem, larguraMm: logo.larguraMm, alturaMm: logo.alturaMm });
      }
      const doc = EIA.pdf.criarDocumento({ titulo: e.titulo });
      const nomes = new Map();
      for (const img of imagens) nomes.set(img.chave, doc.adicionarImagem(img.bytes));
      const nomesLogos = [];
      for (const logo of estado.logos) {
        nomesLogos.push({ nomeImagem: doc.adicionarImagem(logo.bytes), larguraMm: logo.larguraMm, alturaMm: logo.alturaMm });
      }
      void nomes;

      const bytes = montarPdfComDocumento(doc, e, nomes, nomesLogos);
      baixar(new Blob([bytes], { type: 'application/pdf' }), (e.articulacao ? 'mapa-articulado' : 'mapa') + '.pdf');
      status('PDF do mapa gerado' + (e.articulacao ? ' com ' + e.articulacao.total + ' folhas' : '') + '.');
    } catch (err) {
      status('Falha ao gerar o mapa: ' + err.message, true);
      alert('Não consegui gerar o PDF do mapa.\n\n' + err.message
        + '\n\nDica: se o mapa de fundo (imagens de satélite) bloquear a exportação por segurança do navegador, '
        + 'desligue a camada de fundo e tente de novo — as camadas do projeto são desenhadas localmente.');
    } finally {
      document.body.classList.remove('carregando');
    }
  }

  function montarPdfComDocumento(doc, e, nomes, logos) {
    const folhas = e.articulacao && e.articulacao.total > 1 ? e.articulacao.folhas : [{ numero: 'unico', nome: null, bbox: null }];
    if (e.articulacao && e.articulacao.total > 1 && $('incluir-indice').checked) {
      EIA.mapa.desenharIndice(doc, e.articulacao, { folha: e.folha, orientacao: e.orientacao, projeto: e.projeto, titulo: 'MAPA-ÍNDICE DE ARTICULAÇÃO' });
    }
    for (const folha of folhas) {
      EIA.mapa.desenharFolha(doc, Object.assign({}, e, {
        bbox: folha.bbox || enquadrarPorEscala(e.bbox, e.folha, e.orientacao, e.escala),
        nomeImagemMapa: nomes.get(folha.numero),
        numeroFolha: folha.nome || ('Escala 1:' + EIA.math.num(e.escala, 0)),
        logos: logos,
      }));
    }
    return doc.construir();
  }

  // =========================================================== logos
  function carregarLogos(arquivos) {
    const alvo = $('lista-logos');
    for (const f of arquivos) {
      const leitor = new FileReader();
      leitor.onload = () => {
        const dataUrl = leitor.result;
        const img = new Image();
        img.onload = () => {
          const bytes = base64ParaBytes(dataUrl.split(',')[1]);
          const larguraMm = 22;
          const alturaMm = Math.max(6, Math.min(18, larguraMm * img.height / img.width));
          estado.logos.push({ nome: f.name, bytes: bytes, larguraMm: larguraMm, alturaMm: alturaMm, dataUrl: dataUrl });
          const item = document.createElement('span');
          item.className = 'item';
          const miniatura = document.createElement('img');
          miniatura.src = dataUrl;
          const remover = document.createElement('button');
          remover.textContent = '×';
          remover.title = 'Remover logo';
          remover.onclick = () => {
            estado.logos = estado.logos.filter((x) => x.dataUrl !== dataUrl);
            item.remove();
          };
          item.appendChild(miniatura);
          item.appendChild(remover);
          alvo.appendChild(item);
        };
        img.src = dataUrl;
      };
      leitor.readAsDataURL(f);
    }
  }

  // =========================================================== exportação do dado
  async function exportar(tipo) {
    if (!estado.resultados.length) { alert('Faça o recorte primeiro.'); return; }
    status('Preparando ' + tipo.toUpperCase() + '…');
    try {
      if (tipo === 'geojson') {
        if (estado.resultados.length === 1) {
          baixar(new Blob([JSON.stringify(estado.resultados[0].geojson, null, 1)], { type: 'application/geo+json' }),
            nomeArquivo(estado.resultados[0]) + '.geojson');
        } else {
          const fc = {
            type: 'FeatureCollection',
            metadados: {
              gerado_por: 'Portal EIA/RIMA', gerado_em: new Date().toISOString(),
              operacao: $('operacao').value,
              colunas: EIA.recorte.COLUNAS,
            },
            features: estado.resultados.reduce((s, r) => s.concat(r.features), []),
          };
          baixar(new Blob([JSON.stringify(fc, null, 1)], { type: 'application/geo+json' }), 'recorte-eia.geojson');
        }
      } else if (tipo === 'kmz') {
        const fc = { type: 'FeatureCollection', features: estado.resultados.reduce((s, r) => s.concat(r.features), []) };
        const texto = EIA.kml.gerarKml(fc, { nome: 'Recorte EIA/RIMA' });
        const bytes = await EIA.kml.gerarKmzComprimido(texto, 'recorte-eia.kml');
        baixar(new Blob([bytes], { type: 'application/vnd.google-earth.kmz' }), 'recorte-eia.kmz');
      } else if (tipo === 'shp') {
        // Um shapefile por par área × camada, todos num ZIP, porque shapefile não
        // guarda mais de uma camada por arquivo.
        const arquivos = [];
        for (const r of estado.resultados) {
          if (!r.features.length) continue;
          const parte = EIA.shapelib.escreverShapefile(r.features, {});
          arquivos.push({ nome: nomeArquivo(r) + '.shp', bytes: parte.shp });
          arquivos.push({ nome: nomeArquivo(r) + '.dbf', bytes: parte.dbf });
          arquivos.push({ nome: nomeArquivo(r) + '.prj', bytes: parte.prj });
          arquivos.push({ nome: nomeArquivo(r) + '.cpg', bytes: parte.cpg });
        }
        if (!arquivos.length) { alert('Nenhuma feição no resultado para exportar.'); return; }
        const zip = await ziparArquivos(arquivos);
        baixar(new Blob([zip], { type: 'application/zip' }), 'shapefiles-recorte-eia.zip');
      }
      status('Arquivo gerado.');
    } catch (e) {
      status('Falha ao exportar: ' + e.message, true);
      alert('Não consegui gerar o arquivo.\n\n' + e.message);
    }
  }

  function nomeArquivo(r) {
    return ((r.relatorio.ai || 'AI') + '_' + (r.camada.id || 'camada')).replace(/[^\w\-]+/g, '_');
  }

  /* O escritor de ZIP mora em js/xlsx.js e aceita texto (planilha) e binário (shapefile).
   * Aqui havia uma CÓPIA dele, com a diferença de aceitar binário — duas implementações do
   * mesmo formato, e a do módulo corrompia binário em silêncio. */
  async function ziparArquivos(arquivos) {
    return EIA.xlsx.zipar(arquivos);
  }

  // =========================================================== projeto
  function salvarProjeto() {
    const projeto = {
      formato: 'eiaproj', versao: 1, gerado_em: new Date().toISOString(),
      projeto: dadosProjeto(),
      areas: estado.areas.map((a) => ({
        id: a.id, nome: a.nome, sigla: a.sigla, cor: a.cor, geometry: a.geometry,
        // o traço escolhido para a área vai junto: é trabalho de preparação do mapa
        linha: a.linha || null,
        opacidade: a.opacidade === undefined ? null : a.opacidade,
      })),
      camadas_ligadas: Array.from(estado.camadasLigadas),
      // Ordem de desenho e posição das áreas: é trabalho do usuário (subir a geologia,
      // pôr a área por cima) e se perderia ao reabrir o projeto se não fosse salvo.
      ordem_camadas: (estado.ordemCamadas || []).slice(),
      areas_acima: estado.areasAcima !== false,
      // Aparência escolhida na tela: transparência, coluna de rótulo e linha por camada.
      // Sem isso, reabrir o projeto perderia o ajuste de leitura do mapa — que é trabalho.
      aparencia: {
        transparencia: Object.assign({}, estado.transparencia),
        rotulos: Object.assign({}, estado.rotulos),
        linhas: Object.assign({}, estado.linhas),
      },
      recortes: estado.resultados.map((r) => ({
        ai: r.relatorio.ai, camada: r.camada.id,
        relatorio: r.relatorio,
        geojson: r.geojson,
      })),
      layout: {
        folha: $('folha').value, orientacao: $('orientacao').value, escala: Number($('escala').value),
        articulado: $('articulado').checked, titulo: $('titulo-mapa').value,
        logos: estado.logos.map((l) => ({ nome: l.nome, dataUrl: l.dataUrl, larguraMm: l.larguraMm, alturaMm: l.alturaMm })),
      },
    };
    baixar(new Blob([JSON.stringify(projeto)], { type: 'application/json' }), 'projeto-eia.eiaproj.json');
    estado.salvo = true;
    status('Projeto salvo.');
  }

  function abrirProjeto(arquivo) {
    const leitor = new FileReader();
    leitor.onload = () => {
      try {
        const p = JSON.parse(leitor.result);
        if (p.formato !== 'eiaproj') throw new Error('O arquivo não é um projeto do portal.');
        estado.areas = (p.areas || []).map((a) => Object.assign({}, a, {
          area_ha: EIA.recorte.areaHectares(a.geometry) / 10000,
        }));
        estado.camadasLigadas = new Set(p.camadas_ligadas || []);
        if (p.aparencia) {
          estado.transparencia = p.aparencia.transparencia || {};
          estado.rotulos = p.aparencia.rotulos || {};
          estado.linhas = p.aparencia.linhas || {};
        }
        if (p.ordem_camadas && p.ordem_camadas.length) estado.ordemCamadas = p.ordem_camadas.slice();
        estado.areasAcima = p.areas_acima !== false;
        $('areas-acima').checked = estado.areasAcima;
        aplicarOrdemDasCamadas();
        estado.resultados = (p.recortes || []).map((r) => {
          const camada = (estado.catalogo ? estado.catalogo.camadas.find((c) => c.id === r.camada) : null)
            || { id: r.camada, nome: r.camada, meio: '' };
          return { area: null, camada: camada, geojson: r.geojson, features: r.geojson.features, relatorio: r.relatorio };
        });
        if (p.layout) {
          if (p.layout.folha) $('folha').value = p.layout.folha;
          if (p.layout.orientacao) $('orientacao').value = p.layout.orientacao;
          if (p.layout.escala) $('escala').value = String(p.layout.escala);
          $('articulado').checked = !!p.layout.articulado;
          if (p.layout.titulo) $('titulo-mapa').value = p.layout.titulo;
          estado.logos = (p.layout.logos || []).map((l) => Object.assign({}, l, { bytes: base64ParaBytes(l.dataUrl.split(',')[1]) }));
          $('lista-logos').innerHTML = estado.logos.map((l) => '<span class="item"><img src="' + l.dataUrl + '"></span>').join('');
        }
        renderizarAreas();
        desenharAreas();
        renderizarCatalogo();
        desenharCamadas();
        desenharResultado();
        renderizarTabela();
        renderizarGraficos();
        if (estado.resultados.length) montarRelato();
        enquadrarTudo();
        estado.salvo = true;
        status('Projeto aberto: ' + estado.areas.length + ' área(s) e ' + estado.resultados.length + ' recorte(s).');
      } catch (e) {
        status('Não abri o projeto: ' + e.message, true);
      }
    };
    leitor.readAsText(arquivo);
  }

  // =========================================================== utilidades
  function enquadrarTudo() {
    let bbox = null;
    for (const a of estado.areas) bbox = EIA.math.unirBbox(bbox, EIA.math.bbox(a.geometry));
    for (const c of estado.camadas) bbox = EIA.math.unirBbox(bbox, EIA.math.bbox(c.geojson));
    if (!bbox) return;
    estado.mapa.fitBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]], { padding: [30, 30] });
  }

  function baixar(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function escapar(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }


  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
