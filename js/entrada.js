'use strict';
/* ============================================================================
 * entrada.js — o que a pessoa envia vira uma área de influência
 *
 * POR QUE ESTE MÓDULO EXISTE: este despacho morava dentro do `app.js`, que depende do DOM
 * e do Leaflet para carregar — e por isso não podia ser exercitado por teste nenhum. Foi
 * exatamente onde nasceu um defeito que passou por todas as verificações: a função olhava
 * só `arquivos[0]`, então quem selecionava o `.shp` JUNTO com o `.dbf` e o `.prj` (o gesto
 * natural) tinha o `.shp` recusado como "formato não reconhecido" — o portal recusava o
 * formato que ele mesmo aceita.
 *
 * Aqui não há DOM, não há mapa, não há Leaflet: entra arquivo, sai GeoJSON. É a única
 * responsabilidade do módulo, e é o que o torna testável.
 *
 * Um shapefile é um CONJUNTO (.shp + .dbf + .prj + .cpg), não um arquivo. Por isso o
 * módulo trabalha com a lista inteira do que foi escolhido, e o mesmo conjunto pode chegar
 * solto ou dentro de um `.zip`.
 * ========================================================================== */

(function (raiz, fabrica) {
  const node = typeof module === 'object' && module.exports;
  const deps = node
    ? {
      shapelib: require('./shapelib.js'),
      kml: require('./kml.js'),
      crs: require('./crs.js'),
    }
    : { shapelib: raiz.EIA.shapelib, kml: raiz.EIA.kml, crs: raiz.EIA.crs };
  const api = fabrica(deps);
  if (node) module.exports = api;
  if (raiz) {
    raiz.EIA = raiz.EIA || {};
    raiz.EIA.entrada = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (EIA) {

  /** Extensão em minúsculas, sem o ponto. */
  function extensao(nome) {
    return (String(nome).match(/\.([^.]+)$/) || ['', ''])[1].toLowerCase();
  }

  /** GeoJSON em texto: confere o CRS declarado e reprojeta se não for WGS 84. */
  function lerGeoJson(texto, nome) {
    const geojson = JSON.parse(texto);
    const m = geojson.crs && geojson.crs.properties && /EPSG[:]{0,1}(\d+)/.exec(geojson.crs.properties.name);
    const epsg = m ? m[1] : null;
    if (epsg && epsg !== '4326') {
      return {
        nome: nome, geojson: EIA.crs.transformarGeoJson(geojson, 'EPSG:' + epsg, 'EPSG:4326'),
        crs: 'EPSG:' + epsg,
        aviso: 'GeoJSON declarado em EPSG:' + epsg + '; reprojetado para WGS 84.',
      };
    }
    const diag = EIA.crs.diagnosticar(geojson, 'EPSG:4326');
    return { nome: nome, geojson: geojson, crs: 'EPSG:4326', aviso: diag.aviso };
  }

  /**
   * Shapefile já lido: resolve o sistema de referência e junta os avisos.
   * Sem `.prj` o CRS tem de ser DEDUZIDO das coordenadas — e isso é dito, não escondido.
   */
  function finalizarArea(lido, nome, faltando) {
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
    const extras = (faltando || []).filter(Boolean);
    if (extras.length) aviso = (aviso ? aviso + ' ' : '') + extras.join(' ');
    return { nome: nome, geojson: geojson, crs: crs, aviso: aviso };
  }

  /**
   * Interpreta o que foi enviado e devolve UMA área.
   * @param {Array} arquivos objetos do navegador (`.name`, `.arrayBuffer()`, `.text()`)
   */
  async function interpretar(arquivos) {
    if (!arquivos || !arquivos.length) throw new Error('Nenhum arquivo recebido.');
    const escolhidos = Array.from(arquivos).map((f) => ({ arquivo: f, nome: f.name, ext: extensao(f.name) }));
    const nome = String(arquivos[0].name).replace(/\.[^.]+$/, '');
    const temExt = (e) => escolhidos.some((l) => l.ext === e);
    const lerBytes = async (l) => new Uint8Array(await l.arquivo.arrayBuffer());

    // ---------------------------------------------------------------- ZIP
    const zip = escolhidos.find((l) => l.ext === 'zip');
    if (zip) {
      const entradas = await EIA.shapelib.abrirZip((await lerBytes(zip)).buffer);
      // o ZIP pode ter os arquivos dentro de uma pasta — o leitor casa por extensão
      if (entradas.some((e) => /\.shp$/i.test(e.nome))) {
        const faltando = [];
        if (!entradas.some((e) => /\.dbf$/i.test(e.nome))) faltando.push('sem o .dbf, a área vem só com a geometria');
        if (!entradas.some((e) => /\.prj$/i.test(e.nome))) faltando.push('sem o .prj, o sistema de referência teve de ser deduzido');
        return finalizarArea(EIA.shapelib.abrirShapefile(entradas), nome, faltando);
      }
      const kml = entradas.find((e) => /\.kml$/i.test(e.nome));
      if (kml) {
        return {
          nome: nome, geojson: EIA.kml.interpretarKml(new TextDecoder('utf-8').decode(kml.bytes)),
          crs: 'EPSG:4326', aviso: 'KML (dentro do ZIP) interpretado como WGS 84.',
        };
      }
      const gj = entradas.find((e) => /\.(geojson|json)$/i.test(e.nome));
      if (gj) return lerGeoJson(new TextDecoder('utf-8').decode(gj.bytes), nome);
      throw new Error('O ZIP não tem shapefile (.shp), KML nem GeoJSON dentro. '
        + 'Ele precisa conter o .shp e o .dbf juntos.');
    }

    // ------------------------------------------------- shapefile em vários arquivos
    if (temExt('shp')) {
      const partes = ['shp', 'dbf', 'prj', 'cpg', 'shx'];
      const lidos = [];
      for (const l of escolhidos) {
        if (partes.indexOf(l.ext) < 0) continue;    // lê só o que o shapefile usa
        lidos.push({ nome: l.nome, bytes: await lerBytes(l) });
      }
      const faltando = [];
      if (!temExt('dbf')) {
        faltando.push('Você enviou só o .shp: a geometria veio, mas os ATRIBUTOS não (a tabela fica vazia). '
          + 'Selecione também o .dbf — ou mande o conjunto todo num .zip.');
      }
      if (!temExt('prj')) faltando.push('Falta o .prj, então o sistema de referência não estava declarado.');
      return finalizarArea(EIA.shapelib.abrirShapefile(lidos), nome, faltando);
    }

    // ---------------------------------------------------------------- arquivo único
    const um = arquivos[0];
    if (escolhidos[0].ext === 'kmz') {
      return {
        nome: nome, geojson: await EIA.kml.interpretarKmz(await um.arrayBuffer()),
        crs: 'EPSG:4326', aviso: 'KMZ interpretado como WGS 84 (padrão do formato).',
      };
    }
    if (escolhidos[0].ext === 'kml') {
      return {
        nome: nome, geojson: EIA.kml.interpretarKml(await um.text()),
        crs: 'EPSG:4326', aviso: 'KML interpretado como WGS 84 (padrão do formato).',
      };
    }
    if (escolhidos[0].ext === 'geojson' || escolhidos[0].ext === 'json') {
      return lerGeoJson(await um.text(), nome);
    }

    throw new Error('Não reconheci o formato de: ' + escolhidos.map((l) => l.nome).join(', ')
      + '. Para shapefile, selecione o .shp JUNTO com o .dbf (e o .prj, se houver) — ou compacte '
      + 'os arquivos num .zip. Também aceito KMZ, KML e GeoJSON.');
  }

  return {
    extensao: extensao,
    interpretar: interpretar,
    finalizarArea: finalizarArea,
    lerGeoJson: lerGeoJson,
  };
});
