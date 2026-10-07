'use strict';
/* ============================================================================
 * xml.js — leitor de XML mínimo, sem dependência
 *
 * Existe por um motivo específico: `DOMParser` só existe no navegador, e o
 * importador roda no Node para ler arquivos de estilo (`.qml` do QGIS, `.sld` do
 * OGC). Em vez de trocar de linguagem ou arrastar uma biblioteca de 200 KB para ler
 * um arquivo de configuração, aqui está o mínimo que resolve: elementos, atributos,
 * texto, CDATA, comentário e entidades.
 *
 * O que NÃO faz (de propósito): namespaces, validação de esquema, DTD externo.
 * Para ler simbologia, não é preciso — e o que não é preciso não entra.
 * ========================================================================== */

(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (raiz) {
    raiz.EIA = raiz.EIA || {};
    raiz.EIA.xml = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  function decodificarEntidades(texto) {
    return String(texto || '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-fA-F]+);/g, (m, n) => String.fromCharCode(parseInt(n, 16)))
      .replace(/&amp;/g, '&');   // por último: senão "&amp;lt;" viraria "<"
  }

  const RE_ATRIBUTO = /([\w:.\-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

  function lerTag(bruto) {
    const corte = bruto.search(/\s/);
    const nome = corte < 0 ? bruto : bruto.slice(0, corte);
    const atributos = {};
    let m;
    RE_ATRIBUTO.lastIndex = 0;
    while ((m = RE_ATRIBUTO.exec(bruto)) !== null) {
      if (m[1] === nome && corte < 0) continue;
      atributos[m[1]] = decodificarEntidades(m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4]));
    }
    return { nome: nome, atributos: atributos };
  }

  /**
   * Analisa o XML e devolve uma árvore de nós.
   * @returns {{nome:string, atributos:object, filhos:Array, texto:string, pai:object|null}}
   */
  function analisar(texto) {
    const raiz = { nome: '#documento', atributos: {}, filhos: [], texto: '', pai: null };
    let atual = raiz;
    let i = 0;
    const n = texto.length;
    let guarda = 0;

    while (i < n && guarda++ < 5e6) {
      const abre = texto.indexOf('<', i);
      if (abre < 0) { atual.texto += decodificarEntidades(texto.slice(i)); break; }
      if (abre > i) atual.texto += decodificarEntidades(texto.slice(i, abre));

      if (texto.startsWith('<!--', abre)) {
        const f = texto.indexOf('-->', abre);
        i = f < 0 ? n : f + 3;
        continue;
      }
      if (texto.startsWith('<![CDATA[', abre)) {
        const f = texto.indexOf(']]>', abre);
        atual.texto += texto.slice(abre + 9, f < 0 ? n : f);
        i = f < 0 ? n : f + 3;
        continue;
      }
      if (texto.startsWith('<?', abre)) { const f = texto.indexOf('?>', abre); i = f < 0 ? n : f + 2; continue; }
      if (texto.startsWith('<!', abre)) { const f = texto.indexOf('>', abre); i = f < 0 ? n : f + 1; continue; }

      const fecha = texto.indexOf('>', abre);
      if (fecha < 0) break;
      let bruto = texto.slice(abre + 1, fecha);
      i = fecha + 1;

      if (bruto.charAt(0) === '/') {
        // fecha elemento: sobe um nível (ignora fechamento órfão)
        if (atual.pai) atual = atual.pai;
        continue;
      }

      const autoFecha = bruto.charAt(bruto.length - 1) === '/';
      if (autoFecha) bruto = bruto.slice(0, -1);
      const { nome, atributos } = lerTag(bruto);
      const no = { nome: nome, atributos: atributos, filhos: [], texto: '', pai: atual };
      atual.filhos.push(no);
      if (!autoFecha) atual = no;
    }
    return raiz;
  }

  // ---------------------------------------------------------------- consultas
  function ehNo(v) { return v && typeof v === 'object' && Array.isArray(v.filhos); }

  /** Filhos diretos com esse nome (sem namespace: compara o nome local). */
  function filhos(no, nome) {
    const saida = [];
    if (!ehNo(no)) return saida;
    for (const f of no.filhos) if (nomeLocal(f.nome) === nome) saida.push(f);
    return saida;
  }

  function primeiroFilho(no, nome) {
    const lista = filhos(no, nome);
    return lista.length ? lista[0] : null;
  }

  /** Todos os descendentes com esse nome, em ordem de documento. */
  function descendentes(no, nome) {
    const saida = [];
    const pilha = ehNo(no) ? no.filhos.slice() : [];
    while (pilha.length) {
      const atual = pilha.shift();
      if (nomeLocal(atual.nome) === nome) saida.push(atual);
      for (const f of atual.filhos) pilha.push(f);
    }
    return saida;
  }

  function nomeLocal(nome) {
    const i = String(nome || '').indexOf(':');
    return i < 0 ? nome : nome.slice(i + 1);
  }

  function atributo(no, nome, padrao) {
    if (!ehNo(no)) return padrao;
    const v = no.atributos[nome];
    return v === undefined ? padrao : v;
  }

  /** Texto do nó e de todos os descendentes (equivalente ao textContent). */
  function texto(no) {
    if (!ehNo(no)) return '';
    let s = no.texto;
    for (const f of no.filhos) s += texto(f);
    return s;
  }

  return {
    analisar: analisar,
    filhos: filhos,
    primeiroFilho: primeiroFilho,
    descendentes: descendentes,
    atributo: atributo,
    texto: texto,
    nomeLocal: nomeLocal,
    decodificarEntidades: decodificarEntidades,
  };
});
