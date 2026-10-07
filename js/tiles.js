'use strict';
/* ============================================================================
 * tiles.js — formato binário de geometria, quantizado e delta
 *
 * POR QUE EXISTE: o cliente exige que a FEIÇÃO NÃO SEJA ALTERADA, e a Pedologia tem 10,83
 * milhões de pontos. Sem simplificar, o GeoJSON dela tem ~431 MB — não carrega num navegador.
 * Simplificar resolve o peso e destrói a feição (tolerância de 100 m deixa o contorno
 * serrilhado e abre fenda entre manchas vizinhas, porque a simplificação não é topológica).
 *
 * Aqui não há simplificação nenhuma: cada vértice do shapefile entra, e sai igual. O que muda
 * é a CODIFICAÇÃO:
 *   - quantização: a coordenada vira inteiro na precisão de 11 cm (6 casas decimais), que é a
 *     mesma precisão com que o portal já publica GeoJSON. Nada de novo é perdido;
 *   - delta + varint: guarda-se a diferença entre vértices vizinhos, que é pequena, em vez da
 *     coordenada absoluta de cada um. É onde está o ganho: 8 bytes por número viram 1 a 3.
 *
 * Resultado medido: ~10× menor que o GeoJSON equivalente, com a geometria preservada.
 *
 * O formato (little-endian, varints em LEB128 com zigzag para os sinais):
 *   'EIAT' | versão u8 | casas u8 | nFeições u32 | bbox 4×f64 | nCampos u16 | campos
 *   por feição: tipo u8 | nPartes u32 | ( por parte: nAnéis u32 | ( nPontos u32 | pontos ) )
 *               atributos: por campo, flag u8 (0 nulo) + len u16 + utf8
 * ========================================================================== */

(function (raiz, fabrica) {
  const node = typeof module === 'object' && module.exports;
  const api = fabrica();
  if (node) module.exports = api;
  if (raiz) {
    raiz.EIA = raiz.EIA || {};
    raiz.EIA.tiles = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const MAGIC = 'EIAT';
  const VERSAO = 1;
  const CASAS = 6;                       // 11 cm — a mesma precisão do GeoJSON publicado

  const TIPO = {
    Point: 1, MultiPoint: 2, LineString: 3, MultiLineString: 4, Polygon: 5, MultiPolygon: 6,
  };
  const TIPO_INVERSO = Object.keys(TIPO).reduce(function (s, k) { s[TIPO[k]] = k; return s; }, {});

  // ---------------------------------------------------------------- varint
  function escreverVarint(saida, valor) {
    let v = Math.floor(valor);
    if (v < 0) v = -v * 2 - 1; else v = v * 2;        // zigzag
    while (v >= 0x80) { saida.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
    saida.push(v & 0x7f);
  }

  function lerVarint(visao, pos) {
    let resultado = 0, deslocamento = 0, b = 0;
    do {
      if (pos.i >= visao.byteLength) throw new Error('TILE truncado');
      b = visao.getUint8(pos.i++);
      resultado += (b & 0x7f) * Math.pow(2, deslocamento);
      deslocamento += 7;
    } while (b & 0x80);
    return (resultado % 2 === 0) ? resultado / 2 : -(resultado + 1) / 2;
  }

  // ---------------------------------------------------------------- geometria
  function aneisDe(geometria) {
    if (!geometria) return [];
    if (geometria.type === 'Polygon') return [geometria.coordinates];
    if (geometria.type === 'MultiPolygon') return geometria.coordinates;
    if (geometria.type === 'LineString') return [[geometria.coordinates]];
    if (geometria.type === 'MultiLineString') return geometria.coordinates.map(function (l) { return [l]; });
    if (geometria.type === 'Point') return [[[geometria.coordinates]]];
    if (geometria.type === 'MultiPoint') return [geometria.coordinates.map(function (p) { return [p]; })];
    if (geometria.type === 'GeometryCollection') {
      const saida = [];
      for (const g of geometria.geometries) for (const p of aneisDe(g)) saida.push(p);
      return saida;
    }
    return [];
  }

  function bboxDe(feicoes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const f of feicoes) {
      for (const parte of aneisDe(f.geometry)) {
        for (const anel of parte) {
          for (const p of anel) {
            if (p[0] < x0) x0 = p[0];
            if (p[1] < y0) y0 = p[1];
            if (p[0] > x1) x1 = p[0];
            if (p[1] > y1) y1 = p[1];
          }
        }
      }
    }
    return x0 === Infinity ? [0, 0, 0, 0] : [x0, y0, x1, y1];
  }

  /**
   * Codifica feições num tile binário.
   * @param {Array} feicoes features GeoJSON
   * @param {object} opcoes { casas }
   * @returns {Uint8Array}
   */
  function codificar(feicoes, opcoes) {
    const o = opcoes || {};
    const casas = o.casas === undefined ? CASAS : o.casas;
    const fator = Math.pow(10, casas);
    const bytes = [];

    for (const c of MAGIC) bytes.push(c.charCodeAt(0));
    bytes.push(VERSAO);
    bytes.push(casas);

    // cabeçalho fixo: nFeições + bbox
    const bb = bboxDe(feicoes);
    const cabecalho = new DataView(new ArrayBuffer(4 + 32));
    cabecalho.setUint32(0, feicoes.length, true);
    for (let i = 0; i < 4; i++) cabecalho.setFloat64(4 + i * 8, bb[i], true);
    for (let i = 0; i < cabecalho.byteLength; i++) bytes.push(cabecalho.getUint8(i));

    // campos (nomes, uma vez só para o tile inteiro)
    const campos = [];
    for (const f of feicoes) {
      for (const k of Object.keys(f.properties || {})) if (campos.indexOf(k) < 0) campos.push(k);
    }
    bytes.push(campos.length & 0xff, (campos.length >> 8) & 0xff);
    const codificador = new TextEncoder();
    for (const nome of campos) {
      const b = codificador.encode(nome);
      bytes.push(b.length & 0xff);
      for (const x of b) bytes.push(x);
    }

    // feições
    for (const f of feicoes) {
      const tipo = TIPO[f.geometry.type] || 0;
      bytes.push(tipo);
      const partes = aneisDe(f.geometry);
      escreverVarint(bytes, partes.length);
      for (const parte of partes) {
        escreverVarint(bytes, parte.length);
        for (const anel of parte) {
          escreverVarint(bytes, anel.length);
          let ax = 0, ay = 0;
          for (const p of anel) {
            const x = Math.round(p[0] * fator);
            const y = Math.round(p[1] * fator);
            escreverVarint(bytes, x - ax);
            escreverVarint(bytes, y - ay);
            ax = x; ay = y;
          }
        }
      }
      const props = f.properties || {};
      for (const nome of campos) {
        const v = props[nome];
        if (v === null || v === undefined) { bytes.push(0); continue; }
        const b = codificador.encode(String(v));
        bytes.push(1);
        bytes.push(b.length & 0xff, (b.length >> 8) & 0xff);
        for (const x of b) bytes.push(x);
      }
    }
    return new Uint8Array(bytes);
  }

  /**
   * Decodifica um tile binário de volta para GeoJSON.
   * A coordenada volta com a MESMA precisão com que foi publicada (11 cm por padrão).
   */
  function decodificar(bytes) {
    try {
      return decodificarInterno(bytes);
    } catch (e) {
      /* Arquivo cortado no meio do download (ou corrompido) estoura um RangeError cru do
       * DataView — "Offset is outside the bounds of the DataView" não diz nada a quem está
       * usando o portal. Aqui vira uma mensagem que diz o que aconteceu. */
      if (/outside the bounds|out of range|RangeError/i.test(e.message || '') || e instanceof RangeError) {
        throw new Error('TILE truncado ou corrompido: o arquivo chegou incompleto.');
      }
      throw e;
    }
  }

  function decodificarInterno(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const visao = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== MAGIC) throw new Error('não é um tile do portal');
    const versao = visao.getUint8(4);
    if (versao !== VERSAO) throw new Error('versão de tile não suportada: ' + versao);
    const casas = visao.getUint8(5);
    const fator = Math.pow(10, casas);
    const nFeicoes = visao.getUint32(6, true);
    let pos = 6 + 4 + 32;

    const nCampos = visao.getUint16(pos, true); pos += 2;
    const decodificador = new TextDecoder('utf-8');
    const campos = [];
    for (let i = 0; i < nCampos; i++) {
      const n = visao.getUint8(pos++);
      campos.push(decodificador.decode(new Uint8Array(u8.buffer, u8.byteOffset + pos, n)));
      pos += n;
    }

    const feicoes = [];
    const p = { i: pos };
    for (let i = 0; i < nFeicoes; i++) {
      const tipo = TIPO_INVERSO[visao.getUint8(p.i++)];
      const nPartes = lerVarint(visao, p);
      const partes = [];
      for (let k = 0; k < nPartes; k++) {
        const nAneis = lerVarint(visao, p);
        const aneis = [];
        for (let a = 0; a < nAneis; a++) {
          const nPontos = lerVarint(visao, p);
          const anel = [];
          let x = 0, y = 0;
          for (let q = 0; q < nPontos; q++) {
            x += lerVarint(visao, p);
            y += lerVarint(visao, p);
            anel.push([x / fator, y / fator]);
          }
          aneis.push(anel);
        }
        partes.push(aneis);
      }
      const props = {};
      for (let c = 0; c < nCampos; c++) {
        const tem = visao.getUint8(p.i++);
        if (!tem) { props[campos[c]] = null; continue; }
        const n = visao.getUint16(p.i, true); p.i += 2;
        props[campos[c]] = decodificador.decode(new Uint8Array(u8.buffer, u8.byteOffset + p.i, n));
        p.i += n;
      }
      feicoes.push({ type: 'Feature', properties: props, geometry: juntar(tipo, partes) });
    }
    return { type: 'FeatureCollection', features: feicoes };
  }

  /** Remonta a geometria GeoJSON a partir das partes decodificadas. */
  function juntar(tipo, partes) {
    if (tipo === 'Point') return { type: tipo, coordinates: partes[0][0][0] };
    if (tipo === 'MultiPoint') return { type: tipo, coordinates: partes[0].map(function (a) { return a[0]; }) };
    if (tipo === 'LineString') return { type: tipo, coordinates: partes[0][0] };
    if (tipo === 'MultiLineString') return { type: tipo, coordinates: partes.map(function (a) { return a[0]; }) };
    if (tipo === 'Polygon') return { type: tipo, coordinates: partes[0] };
    return { type: tipo, coordinates: partes };
  }

  return {
    MAGIC: MAGIC,
    VERSAO: VERSAO,
    CASAS: CASAS,
    TIPO: TIPO,
    codificar: codificar,
    decodificar: decodificar,
    aneisDe: aneisDe,
    bboxDe: bboxDe,
    escreverVarint: escreverVarint,
    lerVarint: lerVarint,
  };
});
