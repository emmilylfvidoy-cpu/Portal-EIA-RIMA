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
  const VERSAO = 'v2.0';
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
    grupoRotulos: null,
    rotulosPostos: 0,
    rotulosCortados: 0,
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

    estado.base = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Imagens: Esri, Maxar, Earthstar Geographics',
      crossOrigin: 'anonymous',
    }).addTo(mapa);
    estado.base.on('tileerror', () => {
      $('aviso-mapa').hidden = false;
      $('aviso-mapa').textContent = 'Sem acesso ao mapa de fundo (offline?). As camadas do projeto continuam funcionando.';
    });

    estado.grupoCamadas = L.layerGroup().addTo(mapa);
    estado.grupoAreas = L.layerGroup().addTo(mapa);
    estado.grupoResultado = L.layerGroup().addTo(mapa);
    // Rótulos por cima de tudo: são texto, e texto embaixo de polígono não se lê.
    estado.grupoRotulos = L.layerGroup().addTo(mapa);

    mapa.on('mousemove', (ev) => {
      $('coordenadas').textContent = 'WGS 84 · ' + EIA.math.dms(ev.latlng.lng, 'lon') + ' · ' + EIA.math.dms(ev.latlng.lat, 'lat');
    });
    mapa.on('zoomend', () => {
      if ($('articulado').checked) atualizarInfoArticulacao();
      atualizarRotulos();
    });
    // Ao mover o mapa, os rótulos são refeitos: rotula só o que está na tela, senão
    // 2.102 feições viram 2.102 elementos no DOM.
    mapa.on('moveend', () => atualizarRotulos());
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

    for (const meio of estado.catalogo.meios) {
      const titulo = document.createElement('div');
      titulo.className = 'meio ' + meio.id;
      titulo.textContent = meio.nome;
      alvo.appendChild(titulo);

      for (const camada of estado.catalogo.camadas.filter((c) => c.meio === meio.id)) {
        const linha = document.createElement('label');
        linha.className = 'camada-item';
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
        linha.appendChild(caixa);
        linha.appendChild(amostra);
        linha.appendChild(nome);
        linha.appendChild(estadoTxt);
        alvo.appendChild(linha);
        // Transparência e rótulo: controles da CAMADA, logo abaixo dela. Ficam fora do
        // <label> da linha porque um clique no controle não pode ligar/desligar a camada.
        alvo.appendChild(controlesDaCamada(camada));
      }
    }
  }

  /**
   * Controles de aparência da camada: transparência e coluna do rótulo.
   *
   * A transparência é o que permite ver a imagem de satélite (ou a camada de baixo) por
   * baixo de uma camada densa — sem ela, uma camada de 306 unidades cobre o mapa inteiro.
   * O rótulo é a coluna que o analista quer LER no mapa (sigla da unidade, nome, classe),
   * escolhida entre os campos da própria camada.
   */
  function controlesDaCamada(camada) {
    const bloco = document.createElement('div');
    bloco.className = 'camada-controles';

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
    bloco.appendChild(etiquetaOp);
    bloco.appendChild(faixa);
    bloco.appendChild(valor);

    // ---- rótulo
    const etiquetaRot = document.createElement('span');
    etiquetaRot.className = 'controle-rotulo';
    etiquetaRot.textContent = 'Rótulo';
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
    bloco.appendChild(etiquetaRot);
    bloco.appendChild(seletor);

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

      L.geoJSON(camada.geojson, {
        style: (f) => {
          const c = corDaFeicao(f);
          return {
            // com contorno do estilo, a divisa é fina (fio de cabelo) e na cor do estilo;
            // sem ele, o traço é a própria cor do preenchimento (evita emenda clara
            // entre polígonos vizinhos, que aparece quando não há traço nenhum).
            color: corDoContorno(f),
            weight: temContorno ? 0.5 : 0.9,
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
        const pos = EIA.vetorial.posicaoRotulo(f.geometry);
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
      const geo = await interpretarArquivos(arquivos);
      adicionarArea(geo.geojson, geo.nome, geo.crs, geo.aviso);
      status('Área "' + geo.nome + '" carregada com ' + geo.geojson.features.length + ' feição(ões).');
    } catch (e) {
      status('Falha ao ler o arquivo: ' + e.message, true);
      alert('Não consegui ler o arquivo.\n\n' + e.message);
    }
  }

  async function interpretarArquivos(arquivos) {
    const um = arquivos[0];
    const nome = um.name.replace(/\.[^.]+$/, '');
    const ext = (um.name.match(/\.([^.]+)$/) || [])[1].toLowerCase();

    if (ext === 'zip') {
      const buffer = await um.arrayBuffer();
      const entradas = await EIA.shapelib.abrirZip(buffer);
      const temShp = entradas.some((e) => /\.shp$/i.test(e.nome));
      if (temShp) {
        const lido = EIA.shapelib.abrirShapefile(entradas);
        return finalizarArea(lido, nome);
      }
      const kml = entradas.find((e) => /\.kml$/i.test(e.nome));
      if (kml) {
        const geojson = EIA.kml.interpretarKml(new TextDecoder('utf-8').decode(kml.bytes));
        return { nome: nome, geojson: geojson, crs: 'EPSG:4326', aviso: 'KMZ interpretado como WGS 84.' };
      }
      throw new Error('O ZIP não tem shapefile (.shp) nem KML dentro.');
    }

    if (ext === 'kmz') {
      const buffer = await um.arrayBuffer();
      const geojson = await EIA.kml.interpretarKmz(buffer);
      return { nome: nome, geojson: geojson, crs: 'EPSG:4326', aviso: 'KMZ interpretado como WGS 84 (padrão do formato).' };
    }

    if (ext === 'kml') {
      const texto = await um.text();
      const geojson = EIA.kml.interpretarKml(texto);
      return { nome: nome, geojson: geojson, crs: 'EPSG:4326', aviso: 'KML interpretado como WGS 84 (padrão do formato).' };
    }

    if (ext === 'geojson' || ext === 'json') {
      const texto = await um.text();
      const geojson = JSON.parse(texto);
      const epsg = (geojson.crs && geojson.crs.properties && /EPSG[:]{0,1}(\d+)/.exec(geojson.crs.properties.name) || [])[1];
      if (epsg && epsg !== '4326') {
        const convertido = EIA.crs.transformarGeoJson(geojson, 'EPSG:' + epsg, 'EPSG:4326');
        return {
          nome: nome, geojson: convertido, crs: 'EPSG:' + epsg,
          aviso: 'GeoJSON declarado em EPSG:' + epsg + '; reprojetado para WGS 84.',
        };
      }
      const diag = EIA.crs.diagnosticar(geojson, 'EPSG:4326');
      return { nome: nome, geojson: geojson, crs: 'EPSG:4326', aviso: diag.aviso };
    }

    throw new Error('Formato não reconhecido. Use shapefile (.shp com .dbf, ou .zip), KMZ, KML ou GeoJSON.');
  }

  function finalizarArea(lido, nome) {
    let geojson = lido.geojson;
    let crs = 'EPSG:4326';
    let aviso = lido.aviso || '';
    if (lido.prj) {
      const epsg = EIA.crs.epsgDoPrj(lido.prj);
      if (epsg && epsg !== 'EPSG:4326') {
        geojson = EIA.crs.transformarGeoJson(geojson, epsg, 'EPSG:4326');
        crs = epsg;
        const d = EIA.crs.definicao(epsg);
        aviso = 'Shapefile em ' + (d ? d.nome : epsg) + ' (.prj lido); reprojetado para WGS 84.';
      }
    } else {
      const diag = EIA.crs.diagnosticar(geojson, null);
      if (!diag.epsg) throw new Error(diag.aviso);
      crs = diag.epsg;
      aviso = diag.aviso;
    }
    return { nome: nome, geojson: geojson, crs: crs, aviso: aviso };
  }

  function adicionarArea(geojson, nome, crs, aviso) {
    const aneis = EIA.recorte.aneisDaGeometria(geojson.type === 'FeatureCollection' ? geojson.features[0].geometry : geojson);
    if (!aneis.length) throw new Error('Não encontrei polígono na área de influência.');
    const areaHa = EIA.recorte.areaHectares(geojson) / 10000;
    const area = {
      id: 'ai' + (++estado.vez),
      nome: nome,
      sigla: siglaDe(nome),
      geometry: geojson.type === 'FeatureCollection' ? unirGeometrias(geojson) : (geojson.geometry || geojson),
      cor: CORES_AREAS[estado.areas.length % CORES_AREAS.length],
      area_ha: areaHa,
      crs: crs || 'EPSG:4326',
      aviso: aviso || '',
    };
    estado.areas.push(area);
    desenharAreas();
    renderizarAreas();
    if (aviso) {
      const el = $('aviso-crs');
      el.hidden = false;
      el.className = 'aviso' + (/não estão em graus|sem \.prj/i.test(aviso) ? ' alerta' : '');
      el.textContent = aviso;
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

  function desenharAreas() {
    estado.grupoAreas.clearLayers();
    for (const area of estado.areas) {
      L.geoJSON(area.geometry, {
        style: () => ({ color: area.cor, weight: 2.4, fillColor: area.cor, fillOpacity: 0.06, dashArray: '6 4' }),
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
        + '<br><span class="meta">' + EIA.math.num(area.area_ha, 2) + ' ha · ' + EIA.math.num(area.area_ha / 100, 2) + ' km²</span>';
      const remover = document.createElement('button');
      remover.textContent = 'remover';
      remover.onclick = () => {
        estado.areas.splice(i, 1);
        desenharAreas();
        renderizarAreas();
      };
      li.appendChild(amostra);
      li.appendChild(nome);
      li.appendChild(remover);
      lista.appendChild(li);
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
    status('Recortando…');
    await new Promise((r) => setTimeout(r, 30));

    try {
      const r = EIA.recorte.recortarTudo(estado.areas, estado.camadas, opcoes);
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
    status('Montando o relatório…');
    try {
      const imagens = await imagensDosGraficos();
      const bytes = EIA.relatorio.gerarPdf(estado.relato, estado.resultados, { folha: 'A4', imagens: imagens, agrupamento: estado.agrupamento });
      baixar(new Blob([bytes], { type: 'application/pdf' }), 'relatorio-eia.pdf');
      status('Relatório gerado.');
    } catch (e) {
      status('Falha ao gerar o PDF: ' + e.message, true);
    }
  }

  function baixarTextoRelatorio() {
    if (!estado.relato) { alert('Faça o recorte primeiro.'); return; }
    baixar(new Blob([EIA.relatorio.textoSimples(estado.relato)], { type: 'text/plain;charset=utf-8' }), 'relatorio-eia.txt');
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

    const canvas = mapa.getPane('overlayPane').querySelector('canvas');
    const container = mapa.getContainer();
    const temporario = document.createElement('canvas');
    temporario.width = larguraPx;
    temporario.height = Math.round(larguraPx * 0.66);
    const ctx = temporario.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, temporario.width, temporario.height);
    // desenha o que estiver em canvas (camadas vetoriais)
    container.querySelectorAll('canvas').forEach((c) => {
      try {
        const r = c.getBoundingClientRect();
        const rc = container.getBoundingClientRect();
        ctx.drawImage(c, (r.left - rc.left) * (temporario.width / rc.width), (r.top - rc.top) * (temporario.height / rc.height),
          r.width * (temporario.width / rc.width), r.height * (temporario.height / rc.height));
      } catch (e) { /* canvas de origem protegida: ignora */ }
    });
    void canvas;
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

  /** ZIP com vários arquivos (usa o mesmo montador do KMZ, uma entrada por arquivo). */
  async function ziparArquivos(arquivos) {
    const entradas = [];
    for (const a of arquivos) {
      const bytes = a.bytes instanceof Uint8Array ? a.bytes : new Uint8Array(a.bytes);
      entradas.push({ nome: a.nome, bytes: bytes });
    }
    return montarZipMulti(entradas);
  }

  async function montarZipMulti(entradas) {
    const locais = [];
    const centrais = [];
    let deslocamento = 0;
    for (const e of entradas) {
      const dados = e.bytes;
      let corpo = dados, metodo = 0;
      if (typeof CompressionStream !== 'undefined') {
        const fluxo = new Blob([dados]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        corpo = new Uint8Array(await new Response(fluxo).arrayBuffer());
        metodo = 8;
      }
      const crc = EIA.kml.crc32(dados);
      const nomeBytes = new TextEncoder().encode(e.nome);
      const local = new ArrayBuffer(30 + nomeBytes.length);
      const lv = new DataView(local);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(8, metodo, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, corpo.length, true);
      lv.setUint32(22, dados.length, true);
      lv.setUint16(26, nomeBytes.length, true);
      new Uint8Array(local, 30).set(nomeBytes);
      locais.push(new Uint8Array(local), corpo);

      const central = new ArrayBuffer(46 + nomeBytes.length);
      const cv = new DataView(central);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(10, metodo, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, corpo.length, true);
      cv.setUint32(24, dados.length, true);
      cv.setUint16(28, nomeBytes.length, true);
      cv.setUint32(42, deslocamento, true);
      new Uint8Array(central, 46).set(nomeBytes);
      centrais.push(new Uint8Array(central));
      deslocamento += local.byteLength + corpo.length;
    }
    const tamCentral = centrais.reduce((s, c) => s + c.length, 0);
    const fim = new ArrayBuffer(22);
    const fv = new DataView(fim);
    fv.setUint32(0, 0x06054b50, true);
    fv.setUint16(8, entradas.length, true);
    fv.setUint16(10, entradas.length, true);
    fv.setUint32(12, tamCentral, true);
    fv.setUint32(16, deslocamento, true);
    const todas = locais.concat(centrais, [new Uint8Array(fim)]);
    const total = todas.reduce((s, p) => s + p.length, 0);
    const saida = new Uint8Array(total);
    let p = 0;
    for (const parte of todas) { saida.set(parte, p); p += parte.length; }
    return saida;
  }

  // =========================================================== projeto
  function salvarProjeto() {
    const projeto = {
      formato: 'eiaproj', versao: 1, gerado_em: new Date().toISOString(),
      projeto: dadosProjeto(),
      areas: estado.areas.map((a) => ({ id: a.id, nome: a.nome, sigla: a.sigla, cor: a.cor, geometry: a.geometry })),
      camadas_ligadas: Array.from(estado.camadasLigadas),
      // Aparência escolhida na tela: transparência e coluna de rótulo por camada. Sem
      // isso, reabrir o projeto perderia o ajuste de leitura do mapa — que é trabalho.
      aparencia: {
        transparencia: Object.assign({}, estado.transparencia),
        rotulos: Object.assign({}, estado.rotulos),
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
        }
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
