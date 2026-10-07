'use strict';
/* ============================================================================
 * shapelib.js â€” leitura e escrita de shapefile (.shp/.dbf/.prj/.cpg) e ZIP
 *
 * Escrito Ã  mÃ£o de propÃ³sito: Ã© o formato que os Ã³rgÃ£os ambientais pedem, e uma
 * dependÃªncia a menos Ã© uma quebra a menos no meio de um licenciamento. Cobre o
 * que aparece em camada de EIA: Point, MultiPoint, PolyLine, Polygon, PolyLineZ
 * e PolygonZ (o Z Ã© lido e preservado como atributo, nÃ£o como geometria 3D).
 *
 * TambÃ©m lÃª ZIP porque shapefile chega zipado, e KMZ Ã© ZIP: um leitor resolve os
 * dois casos. `DecompressionStream('deflate-raw')` Ã© nativo do navegador â€” nÃ£o hÃ¡
 * biblioteca de compressÃ£o aqui.
 * ========================================================================== */

(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (raiz) {
    raiz.EIA = raiz.EIA || {};
    raiz.EIA.shapelib = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // ---------------------------------------------------------------- ZIP
  function lerU16(v, p) { return v.getUint16(p, true); }
  function lerU32(v, p) { return v.getUint32(p, true); }

  /**
   * Lista as entradas do ZIP pelo diretÃ³rio central (mais confiÃ¡vel que varrer os
   * cabeÃ§alhos locais, que podem repetir nome e usar descritor de dados).
   */
  function listarZip(buffer) {
    const v = new DataView(buffer);
    const tam = v.byteLength;
    const limite = Math.min(tam, 70000);
    const entradas = [];
    for (let p = tam - 22; p >= tam - limite && p >= 0; p--) {
      if (lerU32(v, p) !== 0x02014b50) continue;
      const metodo = lerU16(v, p + 10);
      const tamComp = lerU32(v, p + 20);
      const tamDescomp = lerU32(v, p + 24);
      const nomeLen = lerU16(v, p + 28);
      const extraLen = lerU16(v, p + 30);
      const comentLen = lerU16(v, p + 32);
      const desloc = lerU32(v, p + 42);
      const nome = new TextDecoder('utf-8').decode(new Uint8Array(buffer, v.byteOffset + p + 46, nomeLen));
      entradas.push({ nome: nome, metodo: metodo, tamComp: tamComp, tamDescomp: tamDescomp, desloc: desloc });
      p -= (extraLen + comentLen);
    }
    return entradas.reverse();
  }

  async function inflar(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Este navegador nÃ£o descomprime ZIP (DecompressionStream indisponÃ­vel). Descompacte o arquivo e envie os .shp/.dbf.');
    }
    const fluxo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(fluxo).arrayBuffer());
  }

  /** Extrai uma entrada do ZIP e devolve Uint8Array. */
  async function extrairDoZip(buffer, entrada) {
    const v = new DataView(buffer);
    const p = entrada.desloc;
    if (lerU32(v, p) !== 0x04034b50) throw new Error('ZIP corrompido (cabeÃ§alho local invÃ¡lido).');
    const nomeLen = lerU16(v, p + 26);
    const extraLen = lerU16(v, p + 28);
    const inicio = p + 30 + nomeLen + extraLen;
    const dados = new Uint8Array(buffer, inicio, entrada.tamComp);
    if (entrada.metodo === 0) return dados;
    if (entrada.metodo !== 8) throw new Error('CompressÃ£o do ZIP nÃ£o suportada (mÃ©todo ' + entrada.metodo + ').');
    return inflar(dados);
  }

  /** Todos os arquivos do ZIP como { nome, bytes }. */
  async function abrirZip(buffer) {
    const entradas = listarZip(buffer);
    const saida = [];
    for (const e of entradas) {
      if (/\/$/.test(e.nome)) continue;
      saida.push({ nome: e.nome, bytes: await extrairDoZip(buffer, e) });
    }
    return saida;
  }

  // ---------------------------------------------------------------- SHP
  const TIPOS = {
    0: 'nulo', 1: 'ponto', 3: 'linha', 5: 'poligono',
    8: 'multiponto', 11: 'pontoz', 13: 'linhaz', 15: 'poligonoz',
    18: 'multipontoz', 21: 'pontom', 23: 'linham', 25: 'poligonom',
    28: 'multipontom', 31: 'multipatch',
  };

  function lerCabecalhoShp(buffer) {
    const v = new DataView(buffer);
    const codigo = v.getInt32(0, false);
    if (codigo !== 9994) throw new Error('NÃ£o Ã© um shapefile (.shp): assinatura invÃ¡lida.');
    const tamPalavras = v.getInt32(24, false); // em palavras de 16 bits
    return {
      tamanho: tamPalavras * 2,
      versao: v.getInt32(28, true),
      tipo: v.getInt32(32, true),
      tipoNome: TIPOS[v.getInt32(32, true)] || ('tipo ' + v.getInt32(32, true)),
      bbox: {
        xmin: v.getFloat64(36, true), ymin: v.getFloat64(44, true),
        xmax: v.getFloat64(52, true), ymax: v.getFloat64(60, true),
      },
    };
  }

  /** LÃª os registros do .shp como anÃ©is/pontos em coordenadas do arquivo. */
  function lerShp(buffer) {
    const v = new DataView(buffer);
    const cab = lerCabecalhoShp(buffer);
    const registros = [];
    let p = 100;
    const fim = Math.min(cab.tamanho || buffer.byteLength, buffer.byteLength);
    let guarda = 0;
    while (p + 8 <= fim && guarda++ < 5e6) {
      const numero = v.getInt32(p, false);
      const tamConteudo = v.getInt32(p + 4, false) * 2;
      if (tamConteudo <= 0) break;
      const tipoReg = v.getInt32(p + 8, true);
      // O conteÃºdo do registro comeÃ§a no PRÃ“PRIO campo de tipo (p+8), nÃ£o depois
      // dele: o cabeÃ§alho de registro sÃ£o os 8 bytes de nÃºmero + tamanho.
      const base = p + 8;
      try {
        // A chave Ã© `geometry` (e nÃ£o `geometria`) porque este objeto vira Feature
        // GeoJSON direto em montarGeoJson â€” com o nome errado a feiÃ§Ã£o chegava sem
        // geometria e o arquivo lido parecia vazio.
        registros.push({ numero: numero, tipo: tipoReg, geometry: lerGeometriaShp(v, base, tipoReg) });
      } catch (e) {
        registros.push({ numero: numero, tipo: tipoReg, geometry: null, erro: e.message });
      }
      p += 8 + tamConteudo;
    }
    return { cabecalho: cab, registros: registros };
  }

  /**
   * Conteúdo de um registro, com o tipo em `base` (o cabeçalho de 8 bytes de número +
   * tamanho fica ANTES). Deslocamentos da especificação ESRI:
   *
   *   Point:      +0 tipo · +4 X · +12 Y   (registro de 20 bytes, sem bbox)
   *   multi-parte:+0 tipo · +4 bbox (4 doubles, até +36) · +36 NumParts · +40 NumPoints
   *               +44 índices das partes · +44+4·NumParts pontos (16 bytes cada)
   *
   * Estes deslocamentos estiveram ERRADOS EM 4 BYTES (lia-se NumParts em +32, que cai
   * dentro do double do Ymax). Consequência: toda camada de polígono vinda do ArcGIS
   * chegava VAZIA — o leitor pegava lixo em NumParts, não montava anel nenhum e
   * devolvia MultiPolygon sem coordenada. Camada de ponto escapava, porque o registro
   * de ponto não tem bbox nem contadores.
   */
  function lerGeometriaShp(v, base, tipo) {
    // O tipo é checado ANTES de ler o bbox: registro de Point tem 20 bytes e não tem bbox.
    if (tipo === 1) {
      return { type: 'Point', coordinates: [v.getFloat64(base + 4, true), v.getFloat64(base + 12, true)] };
    }

    const nParts = v.getInt32(base + 36, true);
    const nPontos = v.getInt32(base + 40, true);
    const partesEm = base + 44;
    const pontosEm = partesEm + nParts * 4;

    // Guarda de sanidade: valor absurdo aqui significa arquivo truncado ou layout
    // diferente do esperado — melhor falhar alto do que devolver camada vazia em
    // silêncio (foi assim que o defeito passou despercebido).
    if (nParts < 0 || nPontos < 0 || nParts > 1e6 || nPontos > 5e7) {
      throw new Error('Registro inconsistente (NumParts=' + nParts + ', NumPoints=' + nPontos + ').');
    }

    const lerPonto = (i) => [v.getFloat64(pontosEm + i * 16, true), v.getFloat64(pontosEm + i * 16 + 8, true)];

    if (tipo === 8 || tipo === 18 || tipo === 28) {
      const pts = [];
      for (let i = 0; i < nPontos; i++) pts.push(lerPonto(i));
      return { type: 'MultiPoint', coordinates: pts };
    }

    const indices = [];
    for (let i = 0; i < nParts; i++) indices.push(v.getInt32(partesEm + i * 4, true));
    indices.push(nPontos);

    const aneis = [];
    for (let i = 0; i < nParts; i++) {
      const de = indices[i], ate = indices[i + 1];
      if (ate - de < 2) continue;
      const parte = [];
      for (let k = de; k < ate; k++) parte.push(lerPonto(k));
      aneis.push(parte);
    }

    const poligonal = tipo === 5 || tipo === 15 || tipo === 25;
    if (poligonal) return montarPoligono(aneis);
    if (aneis.length === 1) return { type: 'LineString', coordinates: aneis[0] };
    return { type: 'MultiLineString', coordinates: aneis };
  }

  /**
   * Monta Polygon/MultiPolygon a partir dos anÃ©is do shapefile usando a convenÃ§Ã£o
   * do formato: anel em sentido HORÃRIO Ã© externo, anti-horÃ¡rio Ã© furo.
   */
  function montarPoligono(aneis) {
    const externos = [];
    const furos = [];
    for (const anel of aneis) {
      if (areaAssinada(anel) < 0) externos.push(anel); else furos.push(anel);
    }
    if (!externos.length) {
      // sem externo identificado (arquivo fora da convenÃ§Ã£o): trata o maior como externo
      aneis.slice().sort((a, b) => Math.abs(areaAssinada(b)) - Math.abs(areaAssinada(a)))
        .forEach((a, i) => (i === 0 ? externos.push(a) : furos.push(a)));
    }
    const partes = externos.map((e) => [fechar(e)]);
    // Distribui cada furo no externo que o contÃ©m
    for (const f of furos) {
      const dentro = partes.find((parte) => pontoEmAnel(f[0], parte[0]));
      if (dentro) dentro.push(fechar(f)); else partes.push([fechar(f)]);
    }
    if (partes.length === 1) return { type: 'Polygon', coordinates: partes[0] };
    return { type: 'MultiPolygon', coordinates: partes };
  }

  function areaAssinada(anel) {
    let s = 0;
    for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
      s += anel[j][0] * anel[i][1] - anel[i][0] * anel[j][1];
    }
    return s / 2;
  }

  function fechar(anel) {
    const c = anel.map((p) => [p[0], p[1]]);
    if (c.length && (c[0][0] !== c[c.length - 1][0] || c[0][1] !== c[c.length - 1][1])) c.push([c[0][0], c[0][1]]);
    return c;
  }

  function pontoEmAnel(p, anel) {
    let dentro = false;
    for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
      const yi = anel[i][1], yj = anel[j][1];
      if (((yi > p[1]) !== (yj > p[1]))
        && (p[0] < (anel[j][0] - anel[i][0]) * (p[1] - yi) / (yj - yi) + anel[i][0])) dentro = !dentro;
    }
    return dentro;
  }

  // ---------------------------------------------------------------- DBF
  /**
   * LÃª o .dbf. CodificaÃ§Ã£o: usa o .cpg quando existe; sem ele, tenta UTF-8 e cai
   * para Latin-1 (Windows-1252), que Ã© o que aparece em shapefile antigo de Ã³rgÃ£o
   * pÃºblico â€” e Ã© a origem clÃ¡ssica de "JoÃƒÂ£o" nas tabelas.
   */
  function lerDbf(buffer, codificacao) {
    const v = new DataView(buffer);
    const nReg = v.getUint32(4, true);
    const tamCab = v.getUint16(8, true);
    const tamReg = v.getUint16(10, true);
    const campos = [];
    let p = 32;
    while (p < tamCab - 1 && v.getUint8(p) !== 0x0D) {
      const nome = lerTexto(new Uint8Array(buffer, p, 11)).replace(/\0.*$/, '').trim();
      const tipo = String.fromCharCode(v.getUint8(p + 11));
      const tamanho = v.getUint8(p + 16);
      const decimais = v.getUint8(p + 17);
      campos.push({ nome: nome, tipo: tipo, tamanho: tamanho, decimais: decimais });
      p += 32;
    }

    const registros = [];
    for (let i = 0; i < nReg; i++) {
      const inicio = tamCab + i * tamReg;
      if (inicio + tamReg > buffer.byteLength) break;
      if (v.getUint8(inicio) === 0x2A) { registros.push(null); continue; } // registro apagado
      const obj = {};
      let q = inicio + 1;
      for (const c of campos) {
        const bruto = new Uint8Array(buffer, q, c.tamanho);
        obj[c.nome] = converterValor(bruto, c, codificacao);
        q += c.tamanho;
      }
      registros.push(obj);
    }
    return { campos: campos, registros: registros, codificacao: codificacao || 'utf-8' };
  }

  function converterValor(bytes, campo, codificacao) {
    const texto = lerTexto(bytes, codificacao).trim();
    if (texto === '' || texto === '*') return null;
    if (campo.tipo === 'N' || campo.tipo === 'F') {
      const n = Number(texto.replace(',', '.'));
      return Number.isFinite(n) ? n : texto;
    }
    if (campo.tipo === 'L') return /^[TYt1]$/.test(texto);
    if (campo.tipo === 'D') {
      if (/^\d{8}$/.test(texto)) return texto.slice(0, 4) + '-' + texto.slice(4, 6) + '-' + texto.slice(6, 8);
      return texto;
    }
    return texto;
  }

  function lerTexto(bytes, codificacao) {
    const cod = codificacao || 'utf-8';
    try {
      return new TextDecoder(cod).decode(bytes);
    } catch (e) {
      return new TextDecoder('windows-1252').decode(bytes);
    }
  }

  /** Junta .shp + .dbf num FeatureCollection GeoJSON. */
  function montarGeoJson(shp, dbf) {
    const features = [];
    const registros = dbf ? dbf.registros : [];
    shp.registros.forEach((reg, i) => {
      if (!reg.geometry) return;
      const props = registros[i] ? Object.assign({}, registros[i]) : {};
      features.push({ type: 'Feature', properties: props, geometry: reg.geometry });
    });
    return { type: 'FeatureCollection', features: features, cabecalho: shp.cabecalho, campos: dbf ? dbf.campos : [] };
  }

  /**
   * Abre shapefile a partir de vÃ¡rios arquivos (soltos ou dentro de um ZIP).
   * @param {{nome:string, bytes:Uint8Array}[]} arquivos
   */
  function abrirShapefile(arquivos) {
    let shp = null, dbf = null, prj = null, cpg = null;
    for (const a of arquivos) {
      const n = a.nome.toLowerCase();
      if (/\.shp$/.test(n)) shp = a.bytes;
      else if (/\.dbf$/.test(n)) dbf = a.bytes;
      else if (/\.prj$/.test(n)) prj = lerTexto(a.bytes, 'utf-8');
      else if (/\.cpg$/.test(n)) cpg = lerTexto(a.bytes, 'utf-8').trim();
    }
    if (!shp) throw new Error('NÃ£o encontrei o arquivo .shp (envie .shp, .dbf e, se houver, .prj).');
    const shpLido = lerShp(paraArrayBuffer(shp));
    let dbfLido = null;
    if (dbf) {
      try {
        dbfLido = lerDbf(paraArrayBuffer(dbf), normalizarCodificacao(cpg));
      } catch (e) {
        dbfLido = null; // segue sÃ³ com a geometria, avisando quem chamou
      }
    }
    const geo = montarGeoJson(shpLido, dbfLido);
    return {
      geojson: geo,
      prj: prj,
      codificacao: dbfLido ? dbfLido.codificacao : null,
      aviso: dbf && !dbfLido ? 'O .dbf nÃ£o pÃ´de ser lido; a tabela de atributos veio vazia.' : null,
      tipo: shpLido.cabecalho.tipoNome,
      bbox: shpLido.cabecalho.bbox,
    };
  }

  function normalizarCodificacao(cpg) {
    if (!cpg) return null;
    const t = cpg.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (t === 'UTF8' || t === 'UTF-8' || t === '65001') return 'utf-8';
    if (t === '1252' || t === 'ANSI' || t === 'ISO88591' || t === 'LATIN1' || t === '88591') return 'windows-1252';
    return cpg.trim();
  }

  function paraArrayBuffer(bytes) {
    if (bytes instanceof ArrayBuffer) return bytes;
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  // ---------------------------------------------------------------- escrita
  /**
   * Escreve shapefile (shp + dbf + prj + cpg).
   * @returns {{shp:Uint8Array, dbf:Uint8Array, prj:Uint8Array, cpg:Uint8Array}}
   */
  function escreverShapefile(features, opcoes) {
    const o = opcoes || {};
    const tipoShp = o.tipo || detectarTipo(features);
    const campos = o.campos || inferirCampos(features);
    const shp = escreverShp(features, tipoShp);
    const dbf = escreverDbf(features, campos);
    const prj = new TextEncoder().encode(o.prj || WKT_WGS84);
    const cpg = new TextEncoder().encode('UTF-8');
    return { shp: shp, dbf: dbf, prj: prj, cpg: cpg, tipo: tipoShp, campos: campos };
  }

  function detectarTipo(features) {
    let temPoligono = false, temLinha = false, temPonto = false;
    for (const f of features) {
      const t = f.geometry && f.geometry.type;
      if (!t) continue;
      if (/Polygon/.test(t)) temPoligono = true;
      else if (/LineString/.test(t)) temLinha = true;
      else if (/Point/.test(t)) temPonto = true;
    }
    if (temPoligono) return 5;
    if (temLinha) return 3;
    if (temPonto) return 1;
    return 5;
  }

  /**
   * Infere os campos do .dbf a partir das propriedades: texto, nÃºmero com casas e
   * data. Nome acima de 10 caracteres Ã© truncado (limite do formato) preservando a
   * unicidade â€” sem isso o .dbf sai com campos repetidos e o SIG recusa.
   */
  function inferirCampos(features) {
    const mapa = new Map();
    for (const f of features) {
      const p = f.properties || {};
      for (const chave of Object.keys(p)) {
        const valor = p[chave];
        let info = mapa.get(chave);
        if (!info) { info = { nome: chave, tipo: 'C', tamanho: 1, decimais: 0, exemplo: valor }; mapa.set(chave, info); }
        if (info.exemplo === null || info.exemplo === undefined) info.exemplo = valor;
        if (typeof valor === 'number' && Number.isFinite(valor)) {
          if (info.tipo !== 'N') { info.tipo = 'N'; info.tamanho = 18; info.decimais = casasDecimais(valor); }
          info.decimais = Math.max(info.decimais, casasDecimais(valor));
        } else if (typeof valor === 'boolean') {
          info.tipo = 'L'; info.tamanho = 1; info.decimais = 0;
        } else if (info.tipo === 'C') {
          const t = String(valor === null || valor === undefined ? '' : valor);
          // O tamanho do campo no .dbf é em BYTES, não em caracteres: "Área A" tem 6
          // caracteres e 7 bytes, e dimensionar por caractere truncava o texto.
          info.tamanho = Math.max(info.tamanho, Math.min(254, bytesUtf8(t)));
        }
        void info.exemplo;
      }
    }
    const usados = new Set();
    const campos = [];
    for (const info of mapa.values()) {
      let nome = info.nome.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 10) || 'campo';
      let base = nome, n = 1;
      while (usados.has(nome.toUpperCase())) {
        const sufixo = String(n++);
        nome = base.slice(0, 10 - sufixo.length) + sufixo;
      }
      usados.add(nome.toUpperCase());
      const campo = { nome: nome, original: info.nome, tipo: info.tipo, tamanho: info.tamanho, decimais: info.decimais };
      // NÃºmeros inteiros que couberem viram N sem decimais (evita "1.000000")
      if (campo.tipo === 'N' && campo.decimais === 0) { campo.tamanho = 18; campo.decimais = 0; }
      campos.push(campo);
    }
    if (!campos.length) campos.push({ nome: 'id', original: 'id', tipo: 'N', tamanho: 18, decimais: 0 });
    return campos;
  }

  function casasDecimais(v) {
    if (Number.isInteger(v)) return 0;
    const s = String(v);
    const i = s.indexOf('.');
    return i < 0 ? 0 : Math.min(15, s.length - i - 1);
  }

  /** Bytes que o texto ocupa em UTF-8 (sem depender de TextEncoder fora do navegador). */
  function bytesUtf8(t) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(t).length;
    let n = 0;
    for (const ch of String(t)) {
      const c = ch.codePointAt(0);
      n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    }
    return n;
  }

  function escreverShp(features, tipo) {
    const registros = [];
    for (const f of features) {
      const g = f.geometry;
      if (!g) continue;
      registros.push(montarRegistroShp(g, tipo));
    }
    const totalConteudo = registros.reduce((s, r) => s + r.byteLength + 8, 0);
    const buffer = new ArrayBuffer(100 + totalConteudo);
    const v = new DataView(buffer);
    const bbox = calcularBboxGeometrias(features);

    v.setInt32(0, 9994, false);
    v.setInt32(24, (100 + totalConteudo) / 2, false);
    v.setInt32(28, 1000, true);
    v.setInt32(32, tipo, true);
    v.setFloat64(36, bbox[0], true); v.setFloat64(44, bbox[1], true);
    v.setFloat64(52, bbox[2], true); v.setFloat64(60, bbox[3], true);
    v.setFloat64(68, 0, true); v.setFloat64(76, 0, true);
    v.setFloat64(84, 0, true); v.setFloat64(92, 0, true);

    let p = 100;
    registros.forEach((reg, i) => {
      v.setInt32(p, i + 1, false);
      v.setInt32(p + 4, reg.byteLength / 2, false);
      new Uint8Array(buffer, p + 8, reg.byteLength).set(new Uint8Array(reg));
      p += 8 + reg.byteLength;
    });
    return new Uint8Array(buffer);
  }

  /** Monta o conteÃºdo (sem o cabeÃ§alho de registro) de uma feiÃ§Ã£o. */
  function montarRegistroShp(geometria, tipo) {
    const t = geometria.type;
    if (tipo === 1) {
      const b = new ArrayBuffer(20);
      const v = new DataView(b);
      v.setInt32(0, 1, true);
      v.setFloat64(4, geometria.coordinates[0], true);
      v.setFloat64(12, geometria.coordinates[1], true);
      return b;
    }
    if (tipo === 3) {
      const linhas = t === 'LineString' ? [geometria.coordinates] : (t === 'MultiLineString' ? geometria.coordinates : []);
      return montarRegistroMulti(3, linhas);
    }
    // polÃ­gono
    const aneis = [];
    const partes = t === 'Polygon' ? [geometria.coordinates] : (t === 'MultiPolygon' ? geometria.coordinates : []);
    for (const parte of partes) {
      for (let i = 0; i < parte.length; i++) {
        const anel = fechar(parte[i]);
        // shapefile: externo HORÃRIO, furo ANTI-HORÃRIO (inverso do GeoJSON)
        const a = areaAssinada(anel);
        const ehExterno = i === 0;
        if (ehExterno ? a > 0 : a < 0) aneis.push(anel.slice().reverse());
        else aneis.push(anel);
      }
    }
    return montarRegistroMulti(5, aneis);
  }

  /**
   * Conteúdo de um registro multi-parte (linha ou polígono) — LAYOUT DA ESPECIFICAÇÃO ESRI:
   *
   *   +0   tipo                     (4)
   *   +4   Xmin, Ymin, Xmax, Ymax   (4 doubles = 32 bytes, até +36)
   *   +36  NumParts                 (4)
   *   +40  NumPoints                (4)
   *   +44  Parts                    (4 · NumParts)
   *   +44+4·NumParts  Points        (16 bytes cada)
   *
   * ATENÇÃO — esta função JÁ ESTEVE ERRADA em 4 bytes: escrevia NumParts em +32, que
   * cai DENTRO do double do Ymax. O resultado era shapefile com caixa envolvente
   * corrompida, lido errado pelo QGIS e pelo ArcGIS. Passou desapercebido porque o
   * LEITOR do portal tinha o mesmo erro: o teste de ida e volta fechava, e o defeito
   * só apareceu ao ler um shapefile de verdade, gerado pelo ArcGIS. Por isso o teste
   * de formatos agora confere os deslocamentos contra a especificação, com código
   * escrito à parte — teste que só conversa com o próprio código não prova o formato.
   */
  function montarRegistroMulti(tipo, partes) {
    const nParts = partes.length;
    const nPontos = partes.reduce((s, p) => s + p.length, 0);
    const b = new ArrayBuffer(44 + nParts * 4 + nPontos * 16);
    const v = new DataView(b);
    const todos = [];
    partes.forEach((p) => p.forEach((pt) => todos.push(pt)));
    const bb = bboxDePontos(todos);
    v.setInt32(0, tipo, true);
    v.setFloat64(4, bb[0], true); v.setFloat64(12, bb[1], true);
    v.setFloat64(20, bb[2], true); v.setFloat64(28, bb[3], true);
    v.setInt32(36, nParts, true);
    v.setInt32(40, nPontos, true);
    let p = 44, acumulado = 0;
    for (const parte of partes) {
      v.setInt32(p, acumulado, true);
      p += 4;
      acumulado += parte.length;
    }
    for (const pt of todos) {
      v.setFloat64(p, pt[0], true);
      v.setFloat64(p + 8, pt[1], true);
      p += 16;
    }
    return b;
  }

  function escreverDbf(features, campos) {
    const nReg = features.length;
    const tamReg = 1 + campos.reduce((s, c) => s + c.tamanho, 0);
    const tamCab = 32 + campos.length * 32 + 1;
    const buffer = new ArrayBuffer(tamCab + nReg * tamReg + 1);
    const v = new DataView(buffer);
    const hoje = new Date();

    v.setUint8(0, 0x03);
    v.setUint8(1, hoje.getFullYear() - 1900);
    v.setUint8(2, hoje.getMonth() + 1);
    v.setUint8(3, hoje.getDate());
    v.setUint32(4, nReg, true);
    v.setUint16(8, tamCab, true);
    v.setUint16(10, tamReg, true);

    let p = 32;
    for (const c of campos) {
      escreverTexto(bytesDe(buffer, p, 11), c.nome.slice(0, 10));
      v.setUint8(p + 11, c.tipo.charCodeAt(0));
      v.setUint8(p + 16, c.tamanho);
      v.setUint8(p + 17, c.decimais);
      p += 32;
    }
    v.setUint8(p, 0x0D);
    p += 1;

    for (const f of features) {
      const props = f.properties || {};
      v.setUint8(p, 0x20);
      p += 1;
      for (const c of campos) {
        const alvo = bytesDe(buffer, p, c.tamanho);
        const valor = props[c.original !== undefined ? c.original : c.nome];
        preencherCampo(alvo, c, valor);
        p += c.tamanho;
      }
    }
    v.setUint8(p, 0x1A);
    return new Uint8Array(buffer);
  }

  function preencherCampo(alvo, campo, valor) {
    const txt = formatarCampo(campo, valor);
    escreverTexto(alvo, txt);
  }

  function formatarCampo(campo, valor) {
    if (campo.tipo === 'N' || campo.tipo === 'F') {
      if (valor === null || valor === undefined || valor === '' || !Number.isFinite(Number(valor))) {
        return ''.padStart(campo.tamanho, ' ');
      }
      const n = Number(valor);
      let s = campo.decimais > 0 ? n.toFixed(campo.decimais) : String(Math.round(n));
      if (s.length > campo.tamanho) s = n.toExponential(Math.max(0, campo.tamanho - 7));
      return s.padStart(campo.tamanho, ' ');
    }
    if (campo.tipo === 'L') {
      return valor ? 'T' : 'F';
    }
    let s = valor === null || valor === undefined ? '' : String(valor);
    if (s.length > campo.tamanho) s = s.slice(0, campo.tamanho);
    return s.padEnd(campo.tamanho, ' ');
  }

  function bytesDe(buffer, inicio, tamanho) {
    return new Uint8Array(buffer, inicio, tamanho);
  }

  /** Escreve texto em UTF-8 limitado ao tamanho do campo (preenche com espaÃ§o). */
  function escreverTexto(alvo, texto) {
    const bytes = new TextEncoder().encode(texto);
    const n = Math.min(bytes.length, alvo.length);
    alvo.fill(0x20);
    alvo.set(bytes.subarray(0, n));
  }

  function calcularBboxGeometrias(features) {
    let bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (const f of features) {
      percorrer(f.geometry, (pt) => {
        bb[0] = Math.min(bb[0], pt[0]); bb[1] = Math.min(bb[1], pt[1]);
        bb[2] = Math.max(bb[2], pt[0]); bb[3] = Math.max(bb[3], pt[1]);
      });
    }
    if (bb[0] === Infinity) bb = [0, 0, 0, 0];
    return bb;
  }

  function bboxDePontos(pontos) {
    let bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of pontos) {
      bb[0] = Math.min(bb[0], p[0]); bb[1] = Math.min(bb[1], p[1]);
      bb[2] = Math.max(bb[2], p[0]); bb[3] = Math.max(bb[3], p[1]);
    }
    if (bb[0] === Infinity) bb = [0, 0, 0, 0];
    return bb;
  }

  function percorrer(geometria, fn) {
    if (!geometria) return;
    const t = geometria.type;
    if (t === 'Point') fn(geometria.coordinates);
    else if (t === 'MultiPoint' || t === 'LineString') geometria.coordinates.forEach(fn);
    else if (t === 'MultiLineString' || t === 'Polygon') geometria.coordinates.forEach((a) => a.forEach(fn));
    else if (t === 'MultiPolygon') geometria.coordinates.forEach((p) => p.forEach((a) => a.forEach(fn)));
  }

  const WKT_WGS84 = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],'
    + 'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

  return {
    listarZip: listarZip,
    abrirZip: abrirZip,
    extrairDoZip: extrairDoZip,
    lerShp: lerShp,
    lerDbf: lerDbf,
    montarGeoJson: montarGeoJson,
    abrirShapefile: abrirShapefile,
    escreverShapefile: escreverShapefile,
    inferirCampos: inferirCampos,
    detectarTipo: detectarTipo,
    lerTexto: lerTexto,
    normalizarCodificacao: normalizarCodificacao,
    WKT_WGS84: WKT_WGS84,
  };
});
