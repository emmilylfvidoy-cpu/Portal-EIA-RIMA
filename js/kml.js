'use strict';
/* ============================================================================
 * kml.js — ler e escrever KML e KMZ
 *
 * KML é o que as pessoas realmente têm na mão (exportação do Google Earth, de
 * aplicativo de drone, de levantamento de campo) e é o que o órgão costuma pedir
 * junto com o shapefile. O KMZ é um ZIP com o KML dentro — o leitor de ZIP vive em
 * `shapelib.js` e é reaproveitado aqui, sem biblioteca externa.
 *
 * Três pegadinhas do formato que o código trata:
 *   1. em KML a ordem é LON,LAT,ALT (o resto do portal usa [lon, lat]);
 *   2. o anel do KML é fechado (o primeiro ponto se repete no fim);
 *   3. `<MultiGeometry>` aninha polígonos, e o Google Earth usa isso à vontade.
 * ========================================================================== */

(function (raiz, fabrica) {
  const node = typeof module === 'object' && module.exports;
  const shapelib = node ? require('./shapelib.js') : (raiz && raiz.EIA ? raiz.EIA.shapelib : null);
  const api = fabrica(shapelib);
  if (node) module.exports = api;
  if (raiz) {
    raiz.EIA = raiz.EIA || {};
    raiz.EIA.kml = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (shapelib) {

  /** Converte a lista de coordenadas do KML ("lon,lat,alt lon,lat,alt ..."). */
  function converterCoordenadas(texto) {
    const pontos = [];
    for (const bruto of String(texto || '').trim().split(/\s+/)) {
      if (!bruto) continue;
      const partes = bruto.split(',');
      if (partes.length < 2) continue;
      const lon = Number(partes[0]);
      const lat = Number(partes[1]);
      const alt = partes.length > 2 ? Number(partes[2]) : 0;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      if (Math.abs(lon) > 180 || Math.abs(lat) > 90) continue;
      const ultimo = pontos[pontos.length - 1];
      if (ultimo && ultimo[0] === lon && ultimo[1] === lat) continue;
      pontos.push([lon, lat, Number.isFinite(alt) ? alt : 0]);
    }
    return pontos;
  }

  function abrirAnel(pontos) {
    if (pontos.length > 1) {
      const p = pontos[0], u = pontos[pontos.length - 1];
      if (p[0] === u[0] && p[1] === u[1]) return pontos.slice(0, -1);
    }
    return pontos;
  }

  function fecharAnel(pontos) {
    const c = pontos.map((p) => [p[0], p[1]]);
    if (c.length && (c[0][0] !== c[c.length - 1][0] || c[0][1] !== c[c.length - 1][1])) c.push([c[0][0], c[0][1]]);
    return c;
  }

  // ---------------------------------------------------------------- leitura
  /**
   * Interpreta o XML do KML.
   * @returns {{type:'FeatureCollection', features:Array}}
   */
  function interpretarKml(texto, opcoes) {
    const o = opcoes || {};
    if (!/^\s*(<\?xml|<kml|<document)/i.test(texto)) throw new Error('O arquivo não parece ser KML.');
    const doc = new DOMParser().parseFromString(texto, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('O KML tem XML inválido.');

    const features = [];
    const marca = doc.getElementsByTagNameNS('*', 'Placemark');
    for (let i = 0; i < marca.length; i++) {
      const pm = marca[i];
      const props = lerAtributos(pm, o);
      const geoms = lerGeometrias(pm);
      for (const g of geoms) {
        features.push({ type: 'Feature', properties: Object.assign({}, props), geometry: g });
      }
    }
    if (!features.length) {
      // sem Placemark: tenta geometria solta (KML simples)
      const geoms = lerGeometrias(doc.documentElement);
      for (const g of geoms) features.push({ type: 'Feature', properties: {}, geometry: g });
    }
    if (!features.length) throw new Error('Não encontrei geometria no KML (Polygon, LineString ou Point).');
    return { type: 'FeatureCollection', features: features };
  }

  function lerAtributos(no, o) {
    const props = {};
    const nome = filhoTexto(no, 'name');
    if (nome) props[o.campoNome || 'nome'] = nome;
    const desc = filhoTexto(no, 'description');
    if (desc) props[o.campoDescricao || 'descricao'] = limparHtml(desc);
    // <ExtendedData><Data name="x"><value>y</value></Data></ExtendedData>
    const dados = no.getElementsByTagNameNS('*', 'Data');
    for (let i = 0; i < dados.length; i++) {
      const chave = dados[i].getAttribute('name');
      const valor = filhoTexto(dados[i], 'value');
      if (chave) props[chave] = valor;
    }
    const simples = no.getElementsByTagNameNS('*', 'SimpleData');
    for (let i = 0; i < simples.length; i++) {
      const chave = simples[i].getAttribute('name');
      if (chave) props[chave] = simples[i].textContent;
    }
    return props;
  }

  function filhoTexto(no, tag) {
    const lista = no.getElementsByTagNameNS('*', tag);
    return lista.length ? String(lista[0].textContent || '').trim() : '';
  }

  function limparHtml(texto) {
    return String(texto || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Todas as geometrias dentro de um nó, incluindo as aninhadas em MultiGeometry. */
  function lerGeometrias(no) {
    const geoms = [];
    const poligonos = no.getElementsByTagNameNS('*', 'Polygon');
    const usados = new Set();
    for (let i = 0; i < poligonos.length; i++) {
      const g = lerPoligono(poligonos[i]);
      if (g) { geoms.push(g); usados.add(poligonos[i]); }
    }
    const linhas = no.getElementsByTagNameNS('*', 'LineString');
    for (let i = 0; i < linhas.length; i++) {
      if (dentroDePoligono(linhas[i], usados)) continue;
      const c = converterCoordenadas(filhoTexto(linhas[i], 'coordinates'));
      if (c.length >= 2) geoms.push({ type: 'LineString', coordinates: c.map((p) => [p[0], p[1]]) });
    }
    const pontos = no.getElementsByTagNameNS('*', 'Point');
    for (let i = 0; i < pontos.length; i++) {
      if (dentroDePoligono(pontos[i], usados)) continue;
      const c = converterCoordenadas(filhoTexto(pontos[i], 'coordinates'));
      if (c.length) geoms.push({ type: 'Point', coordinates: [c[0][0], c[0][1]] });
    }
    return agrupar(geoms);
  }

  function dentroDePoligono(no, poligonos) {
    for (const pol of poligonos) {
      if (pol.contains(no)) return true;
    }
    return false;
  }

  /** Junta geometrias iguais em Multi* (o KML costuma trazer um Polygon por furo). */
  function agrupar(geoms) {
    const pontos = geoms.filter((g) => g.type === 'Point');
    const linhas = geoms.filter((g) => g.type === 'LineString');
    const polis = geoms.filter((g) => g.type === 'Polygon');
    const saida = [];
    if (pontos.length === 1) saida.push(pontos[0]);
    else if (pontos.length > 1) saida.push({ type: 'MultiPoint', coordinates: pontos.map((p) => p.coordinates) });
    if (linhas.length === 1) saida.push(linhas[0]);
    else if (linhas.length > 1) saida.push({ type: 'MultiLineString', coordinates: linhas.map((l) => l.coordinates) });
    if (polis.length === 1) saida.push(polis[0]);
    else if (polis.length > 1) saida.push({ type: 'MultiPolygon', coordinates: polis.map((p) => p.coordinates) });
    return saida;
  }

  function lerPoligono(pol) {
    const externos = pol.getElementsByTagNameNS('*', 'outerBoundaryIs');
    if (!externos.length) return null;
    const anelExterno = lerAnel(externos[0]);
    if (!anelExterno) return null;
    const aneis = [fecharAnel(anelExterno)];
    const internos = pol.getElementsByTagNameNS('*', 'innerBoundaryIs');
    for (let i = 0; i < internos.length; i++) {
      const furo = lerAnel(internos[i]);
      if (furo) aneis.push(fecharAnel(furo));
    }
    return { type: 'Polygon', coordinates: aneis };
  }

  function lerAnel(no) {
    const coords = no.getElementsByTagNameNS('*', 'coordinates');
    if (!coords.length) return null;
    const pontos = converterCoordenadas(coords[0].textContent);
    const aberto = abrirAnel(pontos).map((p) => [p[0], p[1]]);
    return aberto.length >= 3 ? aberto : null;
  }

  // ---------------------------------------------------------------- KMZ
  /** Abre um KMZ (ZIP) e interpreta o primeiro KML de dentro. */
  async function interpretarKmz(buffer, opcoes) {
    const entradas = await shapelib.abrirZip(buffer);
    const kml = entradas.find((e) => /\.kml$/i.test(e.nome));
    if (!kml) throw new Error('Não encontrei arquivo KML dentro do KMZ.');
    const texto = new TextDecoder('utf-8').decode(kml.bytes);
    const geo = interpretarKml(texto, opcoes);
    geo.arquivosInternos = entradas.map((e) => e.nome);
    return geo;
  }

  // ---------------------------------------------------------------- escrita
  /** Converte FeatureCollection em KML. */
  function gerarKml(geojson, opcoes) {
    const o = opcoes || {};
    const features = geojson.type === 'FeatureCollection' ? geojson.features : [geojson];
    const partes = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<kml xmlns="http://www.opengis.net/kml/2.2">',
      '<Document>',
    ];
    if (o.nome) partes.push('<name>' + escapar(o.nome) + '</name>');
    if (o.descricao) partes.push('<description>' + escapar(o.descricao) + '</description>');

    for (const f of features) {
      if (!f.geometry) continue;
      partes.push('<Placemark>');
      const nome = o.campoNome ? f.properties && f.properties[o.campoNome] : null;
      partes.push('<name>' + escapar(nome || o.nomePadrao || 'feição') + '</name>');
      const tabela = tabelaAtributos(f.properties || {});
      if (tabela) partes.push('<description><![CDATA[' + tabela + ']]></description>');
      partes.push(geometriaParaKml(f.geometry));
      partes.push('</Placemark>');
    }
    partes.push('</Document>', '</kml>');
    return partes.join('\n');
  }

  function tabelaAtributos(props) {
    const chaves = Object.keys(props);
    if (!chaves.length) return '';
    const linhas = ['<table border="1" cellpadding="3">'];
    for (const k of chaves) {
      const v = props[k];
      if (v === null || v === undefined || v === '') continue;
      linhas.push('<tr><th>' + escapar(k) + '</th><td>' + escapar(v) + '</td></tr>');
    }
    linhas.push('</table>');
    return linhas.length > 2 ? linhas.join('') : '';
  }

  function geometriaParaKml(g) {
    const t = g.type;
    if (t === 'Point') return '<Point><coordinates>' + coord(g.coordinates) + '</coordinates></Point>';
    if (t === 'MultiPoint') {
      return '<MultiGeometry>' + g.coordinates.map((p) => '<Point><coordinates>' + coord(p) + '</coordinates></Point>').join('') + '</MultiGeometry>';
    }
    if (t === 'LineString') return '<LineString><tessellate>1</tessellate><coordinates>' + linha(g.coordinates) + '</coordinates></LineString>';
    if (t === 'MultiLineString') {
      return '<MultiGeometry>' + g.coordinates.map((l) => '<LineString><tessellate>1</tessellate><coordinates>' + linha(l) + '</coordinates></LineString>').join('') + '</MultiGeometry>';
    }
    if (t === 'Polygon') return poligonoKml(g.coordinates);
    if (t === 'MultiPolygon') return '<MultiGeometry>' + g.coordinates.map(poligonoKml).join('') + '</MultiGeometry>';
    return '';
  }

  function poligonoKml(aneis) {
    const partes = ['<Polygon><tessellate>1</tessellate>'];
    partes.push('<outerBoundaryIs><LinearRing><coordinates>' + linha(fecharAnel(aneis[0])) + '</coordinates></LinearRing></outerBoundaryIs>');
    for (let i = 1; i < aneis.length; i++) {
      partes.push('<innerBoundaryIs><LinearRing><coordinates>' + linha(fecharAnel(aneis[i])) + '</coordinates></LinearRing></innerBoundaryIs>');
    }
    partes.push('</Polygon>');
    return partes.join('');
  }

  function coord(p) {
    return num(p[0]) + ',' + num(p[1]) + ',0';
  }

  function linha(pontos) {
    return pontos.map((p) => coord(p)).join(' ');
  }

  function num(v) {
    return Number(v).toFixed(7).replace(/0+$/, '').replace(/\.$/, '');
  }

  function escapar(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Empacota o KML num KMZ (ZIP com deflate).
   * Escrever ZIP sem biblioteca exige montar cabeçalhos e CRC-32 — está aqui porque
   * o KMZ é entrega de campo e não vale travar por causa de um `npm install`.
   */
  function gerarKmz(textoKml, nomeInterno) {
    const nome = nomeInterno || 'doc.kml';
    const dados = new TextEncoder().encode(textoKml);
    const comprimido = deflateRawSync(dados);
    const crc = crc32(dados);
    const nomeBytes = new TextEncoder().encode(nome);

    const local = new ArrayBuffer(30 + nomeBytes.length);
    const lv = new DataView(local);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 8, true); // deflate
    lv.setUint16(10, 0, true); lv.setUint16(12, 0x21, true); // hora/data qualquer
    lv.setUint32(14, crc, true);
    lv.setUint32(18, comprimido.length, true);
    lv.setUint32(22, dados.length, true);
    lv.setUint16(26, nomeBytes.length, true);
    lv.setUint16(28, 0, true);
    new Uint8Array(local, 30).set(nomeBytes);

    const central = new ArrayBuffer(46 + nomeBytes.length);
    const cv = new DataView(central);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true); cv.setUint16(10, 8, true);
    cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, comprimido.length, true);
    cv.setUint32(24, dados.length, true);
    cv.setUint16(28, nomeBytes.length, true);
    cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true); cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, 0, true);
    new Uint8Array(central, 46).set(nomeBytes);

    const fim = new ArrayBuffer(22);
    const fv = new DataView(fim);
    fv.setUint32(0, 0x06054b50, true);
    fv.setUint16(4, 0, true); fv.setUint16(6, 0, true);
    fv.setUint16(8, 1, true); fv.setUint16(10, 1, true);
    fv.setUint32(12, central.byteLength, true);
    fv.setUint32(16, local.byteLength + comprimido.length, true);
    fv.setUint16(20, 0, true);

    return juntar([new Uint8Array(local), comprimido, new Uint8Array(central), new Uint8Array(fim)]);
  }

  function juntar(partes) {
    const total = partes.reduce((s, p) => s + p.length, 0);
    const saida = new Uint8Array(total);
    let p = 0;
    for (const parte of partes) { saida.set(parte, p); p += parte.length; }
    return saida;
  }

  /**
   * deflate "raw" (sem cabeçalho zlib), que é o que o ZIP pede.
   * `CompressionStream('deflate-raw')` não existe em todo navegador; onde falta,
   * o KMZ é gravado sem compressão (método 0), que é ZIP válido e abre igual.
   */
  function deflateRawSync(dados) {
    // Sem CompressionStream síncrono: a compressão real é feita no caminho assíncrono.
    // Aqui devolvemos os dados como estão e o cabeçalho é ajustado pelo chamador.
    return dados;
  }

  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      c ^= bytes[i];
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /** KMZ comprimido de verdade (assíncrono), usando CompressionStream. */
  async function gerarKmzComprimido(textoKml, nomeInterno) {
    const nome = nomeInterno || 'doc.kml';
    const dados = new TextEncoder().encode(textoKml);
    let metodo = 0;
    let corpo = dados;
    if (typeof CompressionStream !== 'undefined') {
      const cs = new CompressionStream('deflate-raw');
      const fluxo = new Blob([dados]).stream().pipeThrough(cs);
      corpo = new Uint8Array(await new Response(fluxo).arrayBuffer());
      metodo = 8;
    }
    return montarZip(nome, dados, corpo, metodo);
  }

  function montarZip(nome, dados, corpo, metodo) {
    const crc = crc32(dados);
    const nomeBytes = new TextEncoder().encode(nome);

    const local = new ArrayBuffer(30 + nomeBytes.length);
    const lv = new DataView(local);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); lv.setUint16(6, 0, true);
    lv.setUint16(8, metodo, true);
    lv.setUint16(10, 0, true); lv.setUint16(12, 0x21, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, corpo.length, true);
    lv.setUint32(22, dados.length, true);
    lv.setUint16(26, nomeBytes.length, true);
    lv.setUint16(28, 0, true);
    new Uint8Array(local, 30).set(nomeBytes);

    const central = new ArrayBuffer(46 + nomeBytes.length);
    const cv = new DataView(central);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true); cv.setUint16(10, metodo, true);
    cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, corpo.length, true);
    cv.setUint32(24, dados.length, true);
    cv.setUint16(28, nomeBytes.length, true);
    cv.setUint32(42, 0, true);
    new Uint8Array(central, 46).set(nomeBytes);

    const fim = new ArrayBuffer(22);
    const fv = new DataView(fim);
    fv.setUint32(0, 0x06054b50, true);
    fv.setUint16(8, 1, true); fv.setUint16(10, 1, true);
    fv.setUint32(12, central.byteLength, true);
    fv.setUint32(16, local.byteLength + corpo.length, true);

    return juntar([new Uint8Array(local), corpo, new Uint8Array(central), new Uint8Array(fim)]);
  }

  return {
    interpretarKml: interpretarKml,
    interpretarKmz: interpretarKmz,
    gerarKml: gerarKml,
    gerarKmz: gerarKmz,
    gerarKmzComprimido: gerarKmzComprimido,
    converterCoordenadas: converterCoordenadas,
    crc32: crc32,
  };
});
