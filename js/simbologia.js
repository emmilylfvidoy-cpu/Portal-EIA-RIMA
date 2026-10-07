'use strict';
/* ============================================================================
 * simbologia.js — lê a simbologia do arquivo de estilo que acompanha o shapefile
 *
 * POR QUE ISSO EXISTE: as cores e a legenda de uma camada NÃO ficam dentro do
 * shapefile. O SIG grava um arquivo ao lado:
 *
 *   QGIS            <camada>.qml    (XML)  -> lido por completo
 *   OGC / GeoServer <camada>.sld    (XML)  -> lido
 *   ArcGIS Pro      <camada>.lyrx   (JSON) -> lido
 *   ArcGIS Desktop  <camada>.lyr    (BINÁRIO) -> NÃO tem as cores legíveis
 *
 * O `.lyr` do ArcGIS Desktop é formato binário fechado: as cores ficam em bytes, não
 * em texto. Este módulo extrai dele o que É texto — o sistema de referência e o nome
 * da rampa de cor — e diz na cara que as cores não foram aproveitadas. Inventar RGB
 * a partir de binário não verificado pintaria o mapa do cliente com cor errada, o que
 * é pior que não pintar.
 *
 * O que sai daqui alimenta o `data/catalogo.json`: campo de classe (que o arquivo de
 * estilo conhece melhor que qualquer heurística) e a cor de cada classe.
 * ========================================================================== */

(function (raiz, fabrica) {
  const node = typeof module === 'object' && module.exports;
  const xml = node ? require('./xml.js') : (raiz && raiz.EIA ? raiz.EIA.xml : null);
  const svg = node ? require('./svg.js') : (raiz && raiz.EIA ? raiz.EIA.svg : null);
  const api = fabrica(xml, svg);
  if (node) module.exports = api;
  if (raiz) {
    raiz.EIA = raiz.EIA || {};
    raiz.EIA.simbologia = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (xml, svg) {

  const ORDEM_SIDECAR = ['qml', 'sld', 'lyrx', 'lyr', 'xml'];

  /** Nomes das opções de cor em QML, na ordem de preferência (preenchimento antes de contorno). */
  const OPCOES_COR = ['color', 'fillColor', 'line_color', 'fill', 'outline_color', 'stroke', 'strokeColor', 'color2'];

  // ---------------------------------------------------------------- cor
  function rgbParaHex(r, g, b) {
    const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
  }

  /** Aceita "#rrggbb", "#rgb", "r,g,b", "r,g,b,a" e devolve "#rrggbb" (ou null). */
  function normalizarCor(valor) {
    if (valor === null || valor === undefined) return null;
    const s = String(valor).trim();
    if (!s) return null;
    const hex6 = /^#?([0-9a-f]{6})$/i.exec(s);
    if (hex6) return '#' + hex6[1].toLowerCase();
    const hex3 = /^#?([0-9a-f]{3})$/i.exec(s);
    if (hex3) return '#' + hex3[1].split('').map((c) => c + c).join('').toLowerCase();
    const partes = s.split(',').map((x) => Number(String(x).trim()));
    if (partes.length >= 3 && partes.slice(0, 3).every((n) => Number.isFinite(n))
      && partes.slice(0, 3).every((n) => n >= 0 && n <= 255)) {
      return rgbParaHex(partes[0], partes[1], partes[2]);
    }
    return null;
  }

  /** Alfa 0..1 a partir de "r,g,b,a" ou de uma opacidade já em 0..1. */
  function alfaDe(valor) {
    if (valor === null || valor === undefined) return null;
    const s = String(valor).trim();
    const partes = s.split(',').map((x) => Number(String(x).trim()));
    if (partes.length >= 4 && Number.isFinite(partes[3])) {
      const a = partes[3];
      return a > 1 ? a / 255 : a;
    }
    const n = Number(s);
    if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
    return null;
  }

  // ---------------------------------------------------------------- QGIS (.qml)
  /** Cor do primeiro `<Option>` de cor dentro do símbolo. */
  function corDoSimboloQml(simbolo) {
    if (!simbolo) return { cor: null, opacidade: null };
    const opcoes = xml.descendentes(simbolo, 'Option');
    let cor = null;
    let alfaDaCor = null;
    for (const nome of OPCOES_COR) {
      for (const o of opcoes) {
        if (xml.atributo(o, 'name') !== nome) continue;
        const c = normalizarCor(xml.atributo(o, 'value'));
        if (c) { cor = c; alfaDaCor = alfaDe(xml.atributo(o, 'value')); break; }
      }
      if (cor) break;
    }
    if (!cor) {
      for (const p of xml.descendentes(simbolo, 'prop')) {
        const c = normalizarCor(xml.atributo(p, 'v'));
        if (c) { cor = c; break; }
      }
    }

    // A opacidade do QGIS é o atributo `alpha` do <symbol> (0 a 1), NÃO o quarto
    // componente da cor — esse costuma vir 255 e não representa transparência.
    let opacidade = null;
    const alfaSimbolo = Number(xml.atributo(simbolo, 'alpha'));
    if (Number.isFinite(alfaSimbolo)) opacidade = alfaSimbolo;
    if (opacidade === null) {
      const alfaOp = opcoes.find((o) => xml.atributo(o, 'name') === 'alpha');
      if (alfaOp) {
        const v = Number(xml.atributo(alfaOp, 'value'));
        if (Number.isFinite(v)) opacidade = v > 1 ? v / 100 : v;
      }
    }
    if (opacidade === null && alfaDaCor !== null && alfaDaCor < 1) opacidade = alfaDaCor;
    return { cor: cor, opacidade: opacidade };
  }

  function mapaDeSimbolosQml(renderer) {
    const mapa = {};
    const cont = xml.primeiroFilho(renderer, 'symbols');
    if (!cont) return mapa;
    for (const s of xml.filhos(cont, 'symbol')) {
      const nome = xml.atributo(s, 'name');
      if (nome !== undefined) mapa[nome] = corDoSimboloQml(s);
    }
    return mapa;
  }

  function lerQml(texto) {
    const saida = { formato: 'qml', tipo: 'desconhecido', campo: null, cor: null, cores: {}, ordem: [], opacidade: null, avisos: [] };
    const doc = xml.analisar(texto);
    const raiz = doc.filhos.length ? doc.filhos[0] : doc;

    let renderer = xml.descendentes(raiz, 'renderer-v2')[0] || null;
    if (!renderer) renderer = xml.descendentes(raiz, 'renderer')[0] || null;

    if (!renderer) {
      /* BIBLIOTECA DE SÍMBOLOS: <qgis_style><symbols><symbol name="CLASSE">.
       *
       * É o formato que sai do gerenciador de estilos do QGIS (e o que o complemento SLYR
       * produz ao converter um .lyr do ArcMap): cada símbolo é NOMEADO com o valor da
       * classe e carrega a cor no Option "color". Não há renderer — o pareamento
       * classe/cor está no nome do símbolo. Foi assim que as cores do mapa do cliente
       * chegaram ao portal, depois de o .lyr binário não permitir a leitura. */
      const cont = xml.descendentes(raiz, 'symbols')[0];
      if (cont) {
        for (const s of xml.filhos(cont, 'symbol')) {
          const nome = xml.atributo(s, 'name');
          if (nome === undefined || nome === '') continue;
          const info = corDoSimboloQml(s);
          if (!info.cor) continue;
          saida.ordem.push(nome);
          saida.cores[nome] = info.cor;
          if (saida.opacidade === null && info.opacidade !== null) saida.opacidade = info.opacidade;
        }
      }
      if (saida.ordem.length) {
        saida.tipo = 'categorizado';
        saida.biblioteca_simbolos = true;
        return saida;
      }
      saida.avisos.push('O arquivo de estilo não tem renderizador nem símbolos nomeados por classe.');
      return saida;
    }

    const tipo = (xml.atributo(renderer, 'type') || '').toLowerCase();
    const simbolos = mapaDeSimbolosQml(renderer);

    if (tipo.indexOf('categorized') >= 0 || xml.primeiroFilho(renderer, 'categories')) {
      saida.tipo = 'categorizado';
      saida.campo = xml.atributo(renderer, 'attr', null);
      const cats = xml.primeiroFilho(renderer, 'categories');
      if (cats) {
        for (const c of xml.filhos(cats, 'category')) {
          if (xml.atributo(c, 'render') === 'false') continue;
          const valor = xml.atributo(c, 'value');
          if (valor === undefined) continue;
          const info = simbolos[xml.atributo(c, 'symbol')] || { cor: null, opacidade: null };
          const rotulo = xml.atributo(c, 'label', valor);
          saida.ordem.push(valor);
          if (rotulo !== valor) saida.rotulos = saida.rotulos || {};
          if (rotulo !== valor) saida.rotulos[valor] = rotulo;
          if (info.cor) saida.cores[valor] = info.cor;
          if (saida.opacidade === null && info.opacidade !== null) saida.opacidade = info.opacidade;
        }
      }
      if (!saida.ordem.length) saida.avisos.push('O .qml é categorizado mas não tem categorias legíveis.');
      return saida;
    }

    if (tipo.indexOf('graduated') >= 0 || xml.primeiroFilho(renderer, 'ranges')) {
      saida.tipo = 'graduado';
      saida.campo = xml.atributo(renderer, 'attr', null);
      const ranges = xml.primeiroFilho(renderer, 'ranges');
      if (ranges) {
        for (const r of xml.filhos(ranges, 'range')) {
          const info = simbolos[xml.atributo(r, 'symbol')] || { cor: null, opacidade: null };
          const rotulo = xml.atributo(r, 'label', '');
          const chave = rotulo || (xml.atributo(r, 'lower', '') + ' – ' + xml.atributo(r, 'upper', ''));
          saida.ordem.push(chave);
          if (info.cor) saida.cores[chave] = info.cor;
          if (saida.opacidade === null && info.opacidade !== null) saida.opacidade = info.opacidade;
        }
      }
      saida.avisos.push('A simbologia do QGIS é GRADUADA (faixas numéricas). O portal agrupa por classe '
        + 'categórica, então estas faixas não foram aplicadas automaticamente — veja a observação no README.');
      return saida;
    }

    // símbolo único
    saida.tipo = 'unico';
    const primeiro = Object.keys(simbolos)[0];
    if (primeiro !== undefined && simbolos[primeiro].cor) {
      saida.cor = simbolos[primeiro].cor;
      saida.opacidade = simbolos[primeiro].opacidade;
    }
    if (!saida.cor) saida.avisos.push('Não encontrei a cor no .qml (símbolo não reconhecido).');
    return saida;
  }

  // ---------------------------------------------------------------- OGC (.sld)
  function lerSld(texto) {
    const saida = { formato: 'sld', tipo: 'desconhecido', campo: null, cor: null, cores: {}, ordem: [], opacidade: null, avisos: [] };
    const doc = xml.analisar(texto);
    const raiz = doc.filhos.length ? doc.filhos[0] : doc;
    const regras = xml.descendentes(raiz, 'Rule');
    if (!regras.length) { saida.avisos.push('O .sld não tem nenhuma <Rule>.'); return saida; }

    for (const regra of regras) {
      const nome = xml.texto(xml.primeiroFilho(regra, 'Name') || { filhos: [], texto: '' }).trim();
      // valor da classe: <ogc:Literal> dentro do filtro
      const literais = xml.descendentes(regra, 'Literal');
      const valor = literais.length ? xml.texto(literais[0]).trim() : '';
      const campos = xml.descendentes(regra, 'PropertyName');
      if (!saida.campo && campos.length) saida.campo = xml.texto(campos[0]).trim();

      const params = xml.descendentes(regra, 'CssParameter');
      let cor = null;
      let alfa = null;
      for (const nome2 of ['fill', 'stroke', 'fill-opacity']) {
        for (const p of params) {
          if (xml.atributo(p, 'name') !== nome2) continue;
          const v = xml.texto(p).trim();
          if (nome2 === 'fill-opacity') { alfa = Number(v); continue; }
          const c = normalizarCor(v);
          if (c && !cor) cor = c;
        }
      }
      const chave = valor || nome;
      if (!chave) continue;
      saida.ordem.push(chave);
      if (cor) saida.cores[chave] = cor;
      if (saida.opacidade === null && Number.isFinite(alfa)) saida.opacidade = alfa;
    }

    if (saida.ordem.length === 1 && !saida.campo) {
      saida.tipo = 'unico';
      saida.cor = saida.cores[saida.ordem[0]] || null;
    } else {
      saida.tipo = saida.ordem.length ? 'categorizado' : 'desconhecido';
    }
    return saida;
  }

  // ---------------------------------------------------------------- ArcGIS Pro (.lyrx)
  /**
   * Coleta TODAS as cores de um objeto, anotando o tipo do objeto que as contém.
   *
   * Guardar o contexto é o que evita o erro clássico: num símbolo de polígono do
   * ArcGIS Pro a PRIMEIRA cor que aparece é a do contorno (CIMSolidStroke), quase
   * sempre cinza escuro. Pegar a primeira cor pintaria todas as classes de cinza.
   */
  function coresEmLyrx(no, profundidade, saida, tipoPai) {
    if (!no || typeof no !== 'object' || (profundidade || 0) > 14) return;
    if (Array.isArray(no)) {
      for (const item of no) coresEmLyrx(item, (profundidade || 0) + 1, saida, tipoPai);
      return;
    }
    const tipo = String(no.type || '');
    if (Array.isArray(no.values) && no.values.length >= 3
      && no.values.slice(0, 3).every((v) => typeof v === 'number' && v >= 0 && v <= 255)
      && /color/i.test(tipo)) {
      saida.push({
        cor: rgbParaHex(no.values[0], no.values[1], no.values[2]),
        opacidade: no.values.length > 3 ? no.values[3] / 100 : null,
        contexto: tipoPai || '',
      });
    }
    for (const chave of Object.keys(no)) {
      if (chave === 'values') continue;
      coresEmLyrx(no[chave], (profundidade || 0) + 1, saida, tipo || tipoPai);
    }
  }

  /** Escolhe a cor de PREENCHIMENTO entre as coletadas; sem ela, a primeira. */
  function escolherCorLyrx(no) {
    const todas = [];
    coresEmLyrx(no, 0, todas, '');
    if (!todas.length) return null;
    const preenchimento = todas.find((c) => /Fill/i.test(c.contexto) && !/Stroke/i.test(c.contexto));
    return preenchimento || todas.find((c) => !/Stroke/i.test(c.contexto)) || todas[0];
  }

  function acharRenderizador(no, profundidade) {
    if (!no || typeof no !== 'object' || (profundidade || 0) > 8) return null;
    if (Array.isArray(no)) {
      for (const item of no) {
        const r = acharRenderizador(item, (profundidade || 0) + 1);
        if (r) return r;
      }
      return null;
    }
    const tipo = String(no.type || '');
    if (/Renderer$/.test(tipo)) return no;
    for (const chave of Object.keys(no)) {
      const r = acharRenderizador(no[chave], (profundidade || 0) + 1);
      if (r) return r;
    }
    return null;
  }

  function lerLyrx(texto) {
    const saida = { formato: 'lyrx', tipo: 'desconhecido', campo: null, cor: null, cores: {}, ordem: [], opacidade: null, avisos: [] };
    let doc;
    try { doc = JSON.parse(texto); } catch (e) { saida.avisos.push('O .lyrx não é JSON válido.'); return saida; }
    const renderer = acharRenderizador(doc, 0);
    if (!renderer) { saida.avisos.push('Não achei o renderizador no .lyrx.'); return saida; }

    const tipo = String(renderer.type || '');
    if (Array.isArray(renderer.fields) && renderer.fields.length) {
      saida.campo = renderer.fields[0];
      // o ArcGIS Pro às vezes grava o campo entre colchetes: "[UNIDADE]"
      if (/^\[.*\]$/.test(saida.campo)) saida.campo = saida.campo.slice(1, -1);
    }

    const classes = [];
    const grupos = Array.isArray(renderer.groups) ? renderer.groups : [];
    for (const g of grupos) {
      if (Array.isArray(g.classes)) for (const c of g.classes) classes.push(c);
    }
    if (Array.isArray(renderer.classes)) for (const c of renderer.classes) classes.push(c);

    if (classes.length) {
      saida.tipo = 'categorizado';
      for (const c of classes) {
        const rotulo = c.label || (Array.isArray(c.values) && c.values[0] ? c.values[0].fieldValue : '') || '';
        const cor = escolherCorLyrx(c.symbol || c);
        const chave = (Array.isArray(c.values) && c.values[0] && c.values[0].fieldValue !== undefined)
          ? String(c.values[0].fieldValue) : String(rotulo);
        if (!chave) continue;
        saida.ordem.push(chave);
        if (cor) {
          saida.cores[chave] = cor.cor;
          if (saida.opacidade === null && cor.opacidade !== null) saida.opacidade = cor.opacidade;
        }
      }
      return saida;
    }

    const cor = escolherCorLyrx(renderer.symbol || renderer);
    if (cor) {
      saida.tipo = 'unico';
      saida.cor = cor.cor;
      saida.opacidade = cor.opacidade;
    } else {
      saida.avisos.push('Não encontrei cor no .lyrx.');
    }
    return saida;
  }

  // ---------------------------------------------------------------- ArcGIS Desktop (.lyr)
  /** Extrai texto legível (ASCII e UTF-16LE) de um binário. */
  function textosDeBinario(bytes, minimo) {
    const min = minimo || 5;
    const saida = [];
    // ASCII
    let atual = '';
    for (let i = 0; i < bytes.length; i++) {
      const c = bytes[i];
      if (c >= 32 && c <= 126) { atual += String.fromCharCode(c); continue; }
      if (atual.length >= min) saida.push(atual);
      atual = '';
    }
    if (atual.length >= min) saida.push(atual);
    // UTF-16LE (letra + 0x00) — é como o ArcGIS grava nomes de campo e valores
    atual = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const c = bytes[i];
      const alto = bytes[i + 1];
      if (alto === 0 && c >= 32 && c <= 126) { atual += String.fromCharCode(c); continue; }
      if (atual.length >= min) saida.push(atual);
      atual = '';
    }
    if (atual.length >= min) saida.push(atual);
    return Array.from(new Set(saida));
  }

  function lerLyr(bytes) {
    const saida = {
      formato: 'lyr', tipo: 'binario', campo: null, cor: null, cores: {}, ordem: [],
      opacidade: null, avisos: [], crs: null, rampa: null,
    };
    const textos = textosDeBinario(bytes, 6);

    // Sistema de referência: o .lyr guarda o WKT completo como texto
    for (const t of textos) {
      const m = /(GEOGCS|PROJCS)\s*\[[\s\S]{20,4000}?AUTHORITY\s*\[\s*"[^"]*"\s*,\s*"?(\d+)"?\s*\]/.exec(t);
      if (m) { saida.crs = 'EPSG:' + m[2]; break; }
    }
    // Nome da rampa de cor (dá uma pista de QUAIS cores, não os valores).
    // A busca é por trecho, não por igualdade: num binário de verdade os textos saem
    // colados uns nos outros ("...AUTHORITY["EPSG",4674]]PastelsRandom Color Random"),
    // então exigir a string inteira nunca casaria.
    const RAMPS = ['Pastels', 'Random Color Random', 'Blue Red', 'Green Brown', 'Yellow to Red',
      'Elevation', 'Spectrum', 'Spectral', 'Red to Green', 'Brown to Blue Green', 'Cold to Hot Diverging'];
    const juntos = textos.join('\u0000');
    for (const rampa of RAMPS) {
      if (juntos.indexOf(rampa) >= 0) { saida.rampa = rampa; break; }
    }

    saida.avisos.push('O .lyr do ArcGIS Desktop é binário: as cores não estão em texto e não foram lidas. '
      + 'O que aproveitei dele: ' + (saida.crs ? 'o sistema de referência (' + saida.crs + ')' : 'nada de cor')
      + '. Para levar as cores, salve a camada como .lyrx (ArcGIS Pro) ou refaça a simbologia no QGIS e salve o .qml.');
    return saida;
  }

  // ---------------------------------------------------------------- entrada
  /** Lê o arquivo de estilo pelo conteúdo (não pela extensão, que às vezes mente). */
  function ler(texto, formato) {
    const f = String(formato || '').toLowerCase().replace(/^\./, '');
    if (f === 'qml' || f === 'xml') return lerQml(texto);
    if (f === 'sld') return lerSld(texto);
    if (f === 'lyrx') return lerLyrx(texto);
    if (f === 'lyr') return null;   // binário: quem trata é lerLyr, com os bytes
    // sem extensão confiável: decide pelo conteúdo
    const t = String(texto || '').trim();
    if (/^\{/.test(t)) return lerLyrx(t);
    if (/<qgis/i.test(t)) return lerQml(t);
    if (/StyledLayerDescriptor|<sld/i.test(t)) return lerSld(t);
    return { formato: 'desconhecido', tipo: 'desconhecido', campo: null, cor: null, cores: {}, ordem: [], opacidade: null, avisos: ['Formato de estilo não reconhecido.'] };
  }

  /**
   * Procura o arquivo de estilo que acompanha o shapefile.
   * A ordem de preferência é a de riqueza: .qml e .lyrx têm as cores por classe.
   */
  function sidecars(caminhoShp, fsModulo, pathModulo) {
    const fs = fsModulo || require('fs');
    const path = pathModulo || require('path');
    const base = caminhoShp.replace(/\.shp$/i, '');
    const achados = [];
    for (const ext of ORDEM_SIDECAR) {
      for (const variante of [ext, ext.toUpperCase()]) {
        const p = base + '.' + variante;
        if (fs.existsSync(p)) { achados.push({ extensao: ext, caminho: p }); break; }
      }
    }
    // .shp.xml é metadado (fonte, resumo), não simbologia — vai separado
    let metadado = null;
    for (const variante of ['shp.xml', 'shp.XML']) {
      const p = base + '.' + variante;
      if (fs.existsSync(p)) { metadado = p; break; }
    }
    void path;
    return { estilos: achados, metadado: metadado };
  }

  /** Lê o primeiro arquivo de estilo disponível. */
  function lerSidecar(caminho, bytesOpcoes) {
    const fsModulo = require('fs');
    const ext = String(caminho).split('.').pop().toLowerCase();
    if (ext === 'lyr') return lerLyr(bytesOpcoes && bytesOpcoes.bytes ? bytesOpcoes.bytes : fsModulo.readFileSync(caminho));
    return ler(fsModulo.readFileSync(caminho, 'utf8'), ext);
  }

  // ---------------------------------------------------------------- entidades do .shp.xml
  /**
   * Extrai o que interessa dos metadados ESRI (.shp.xml): resumo, fonte e data.
   * É o que permite preencher `fonte` e `data_ref` do catálogo sem digitar.
   */
  function lerMetadadosShpXml(texto) {
    const doc = xml.analisar(texto);
    const saida = { titulo: null, resumo: null, proposito: null, fonte: null, data: null, contato: null };

    const pegar = (nomes) => {
      for (const nome of nomes) {
        const no = xml.descendentes(doc, nome)[0];
        if (no) {
          const t = xml.texto(no).replace(/\s+/g, ' ').trim();
          if (t) return t;
        }
      }
      return null;
    };

    saida.titulo = pegar(['title', 'Title']);
    saida.resumo = pegar(['abstract', 'Abstract', 'purpose']);
    saida.proposito = pegar(['purpose', 'Purpose']);
    saida.fonte = pegar(['srccite', 'origin', 'srcinfo', 'edom', 'citeinfo']);
    const data = pegar(['caldate', 'pubdate', 'begdate', 'asofdate']);
    // O metadado ESRI grava a data como AAAAMMDD; o portal mostra AAAA-MM-DD.
    if (data) {
      const d = String(data).trim();
      saida.data = /^\d{8}$/.test(d) ? (d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8)) : d.slice(0, 10);
    }
    const contato = pegar(['cntper', 'cntorg']);
    if (contato) saida.contato = contato;

    // Fallback: o ArcGIS costuma gravar também em <EnviroDesc> / <DataIdInfo> (ISO)
    if (!saida.titulo) saida.titulo = pegar(['resTitle', 'citation']);
    if (!saida.resumo) saida.resumo = pegar(['abstract', 'idAbs']);
    return saida;
  }

  return {
    ORDEM_SIDECAR: ORDEM_SIDECAR,
    normalizarCor: normalizarCor,
    alfaDe: alfaDe,
    rgbParaHex: rgbParaHex,
    ler: ler,
    lerQml: lerQml,
    lerSld: lerSld,
    lerLyrx: lerLyrx,
    lerLyr: lerLyr,
    lerSidecar: lerSidecar,
    sidecars: sidecars,
    textosDeBinario: textosDeBinario,
    lerMetadadosShpXml: lerMetadadosShpXml,
  };
});
