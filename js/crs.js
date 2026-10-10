'use strict';
/* ============================================================================
 * crs.js — sistema de referência: ler .prj, escolher UTM, transformar
 *
 * O erro mais caro num EIA é dado em SIRGAS 2000 / UTM 23S tratado como se fosse
 * grau: a área sai mil vezes menor e ninguém percebe até o parecer. Este módulo
 * existe para que a projeção seja decidida por código, com aviso explícito na tela,
 * e não por suposição.
 * ========================================================================== */

(function (raiz, fabrica) {
  const node = typeof module === 'object' && module.exports;
  const math = node ? require('./math.js') : (raiz && raiz.EIA ? raiz.EIA.math : null);
  const api = fabrica(math);
  if (node) module.exports = api;
  if (raiz) {
    raiz.EIA = raiz.EIA || {};
    raiz.EIA.crs = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (math) {

  /** Definições que aparecem em EIA no Brasil. */
  const DEFINICOES = {
    'EPSG:4326': { tipo: 'geografica', nome: 'WGS 84 (graus)', elipsoide: 'WGS84' },
    'EPSG:4674': { tipo: 'geografica', nome: 'SIRGAS 2000 (graus)', elipsoide: 'GRS80' },
    'EPSG:4618': { tipo: 'geografica', nome: 'SAD 69 (graus)', elipsoide: 'SAD69' },
    'EPSG:31983': { tipo: 'utm', fuso: 23, hemisferio: 'S', elipsoide: 'GRS80', nome: 'SIRGAS 2000 / UTM 23S' },
    'EPSG:31982': { tipo: 'utm', fuso: 22, hemisferio: 'S', elipsoide: 'GRS80', nome: 'SIRGAS 2000 / UTM 22S' },
    'EPSG:31981': { tipo: 'utm', fuso: 21, hemisferio: 'S', elipsoide: 'GRS80', nome: 'SIRGAS 2000 / UTM 21S' },
    'EPSG:31984': { tipo: 'utm', fuso: 24, hemisferio: 'S', elipsoide: 'GRS80', nome: 'SIRGAS 2000 / UTM 24S' },
    'EPSG:31980': { tipo: 'utm', fuso: 20, hemisferio: 'S', elipsoide: 'GRS80', nome: 'SIRGAS 2000 / UTM 20S' },
    'EPSG:29193': { tipo: 'utm', fuso: 23, hemisferio: 'S', elipsoide: 'SAD69', nome: 'SAD 69 / UTM 23S' },
    'EPSG:29192': { tipo: 'utm', fuso: 22, hemisferio: 'S', elipsoide: 'SAD69', nome: 'SAD 69 / UTM 22S' },
    'EPSG:29194': { tipo: 'utm', fuso: 24, hemisferio: 'S', elipsoide: 'SAD69', nome: 'SAD 69 / UTM 24S' },
    'EPSG:3857': { tipo: 'mercator', nome: 'Web Mercator', elipsoide: 'WGS84' },
    'EPSG:32723': { tipo: 'utm', fuso: 23, hemisferio: 'S', elipsoide: 'WGS84', nome: 'WGS 84 / UTM 23S' },
    'EPSG:32722': { tipo: 'utm', fuso: 22, hemisferio: 'S', elipsoide: 'WGS84', nome: 'WGS 84 / UTM 22S' },
  };

  function definicao(epsg) {
    const chave = normalizarEpsg(epsg);
    if (DEFINICOES[chave]) return DEFINICOES[chave];
    // UTM fora da tabela: deriva da faixa de códigos
    const n = Number(String(chave).replace('EPSG:', ''));
    if (n >= 31978 && n <= 31985) return { tipo: 'utm', fuso: n - 31960, hemisferio: 'S', elipsoide: 'GRS80', nome: 'SIRGAS 2000 / UTM ' + (n - 31960) + 'S' };
    if (n >= 31972 && n <= 31979) return { tipo: 'utm', fuso: n - 31954, hemisferio: 'N', elipsoide: 'GRS80', nome: 'SIRGAS 2000 / UTM ' + (n - 31954) + 'N' };
    if (n >= 29188 && n <= 29195) return { tipo: 'utm', fuso: n - 29170, hemisferio: 'S', elipsoide: 'SAD69', nome: 'SAD 69 / UTM ' + (n - 29170) + 'S' };
    if (n >= 29168 && n <= 29175) return { tipo: 'utm', fuso: n - 29150, hemisferio: 'N', elipsoide: 'SAD69', nome: 'SAD 69 / UTM ' + (n - 29150) + 'N' };
    if (n >= 32701 && n <= 32760) return { tipo: 'utm', fuso: n - 32700, hemisferio: 'S', elipsoide: 'WGS84', nome: 'WGS 84 / UTM ' + (n - 32700) + 'S' };
    if (n >= 32601 && n <= 32660) return { tipo: 'utm', fuso: n - 32600, hemisferio: 'N', elipsoide: 'WGS84', nome: 'WGS 84 / UTM ' + (n - 32600) + 'N' };
    return null;
  }

  function normalizarEpsg(epsg) {
    if (!epsg) return '';
    const s = String(epsg).trim().toUpperCase();
    if (/^\d+$/.test(s)) return 'EPSG:' + s;
    return s;
  }

  function eGeografica(epsg) {
    const d = definicao(epsg);
    return !!d && d.tipo === 'geografica';
  }

  /**
   * Lê o .prj (WKT do ESRI) e devolve o EPSG provável.
   * O .prj é a única pista confiável que vem junto do shapefile — e o motivo mais
   * comum de coordenada errada é ele faltar.
   */
  function epsgDoPrj(texto) {
    if (!texto) return null;
    const t = String(texto);
    const fuso = /UTM[_ ]?zone[_ ]?(\d{1,2})([NS])/i.exec(t) || /Zone[_ ]?(\d{1,2})([NS])/i.exec(t);
    const sad = /SAD[_ ]?69|South_American_Datum_1969|D_SAD_69/i.test(t);
    const wgs = /WGS[_ ]?(19)?84|D_WGS_1984/i.test(t);
    const sirgas = /SIRGAS|GRS_1980|GRS 1980/i.test(t);
    const geografica = /^GEOGCS/i.test(t.trim());

    if (geografica) {
      if (sad) return 'EPSG:4618';
      if (wgs) return 'EPSG:4326';
      if (sirgas) return 'EPSG:4674';
      return 'EPSG:4326';
    }
    if (fuso) {
      const z = Number(fuso[1]);
      const hemi = fuso[2].toUpperCase();
      const datum = sad ? 'SAD69' : (sirgas ? 'SIRGAS2000' : 'WGS84');
      if (datum === 'SAD69') return 'EPSG:' + (hemi === 'S' ? 29170 + z : 29160 + z);
      if (datum === 'SIRGAS2000') return 'EPSG:' + math.epsgUTM(hemi === 'S' ? -10 : 10, z * 6 - 183, 'SIRGAS2000');
      return 'EPSG:' + (hemi === 'S' ? 32700 + z : 32600 + z);
    }
    return null;
  }

  /**
   * Escolhe o EPSG UTM adequado para a extensão das feições (SIRGAS 2000 por padrão,
   * que é o que os órgãos ambientais de SP pedem hoje).
   */
  function epsgRecomendado(bbox, datum) {
    const lonCentro = (bbox[0] + bbox[2]) / 2;
    const latCentro = (bbox[1] + bbox[3]) / 2;
    const z = math.fusoUTM(lonCentro);
    return math.epsgUTM(latCentro, lonCentro, datum || 'SIRGAS2000');
  }

  /**
   * Transforma uma posição entre sistemas.
   * @returns {[number,number]}
   */
  function transformarPonto(p, de, para) {
    const a = normalizarEpsg(de);
    const b = normalizarEpsg(para);
    if (a === b) return [p[0], p[1]];
    const geo = paraGeografico(p, a);
    return deGeografico(geo, b);
  }

  function paraGeografico(p, epsg) {
    const e = normalizarEpsg(epsg);
    if (eGeografica(e)) return [p[0], p[1]];
    const d = definicao(e);
    if (!d) return [p[0], p[1]];
    if (d.tipo === 'mercator') {
      const g = math.mercatorParaGeo(p[0], p[1]);
      return [g.lon, g.lat];
    }
    if (d.tipo === 'utm') {
      const g = math.utmParaGeo(p[0], p[1], { fuso: d.fuso, hemisferio: d.hemisferio, elipsoide: d.elipsoide });
      return [g.lon, g.lat];
    }
    return [p[0], p[1]];
  }

  function deGeografico(g, epsg) {
    const e = normalizarEpsg(epsg);
    if (eGeografica(e)) return [g[0], g[1]];
    const d = definicao(e);
    if (!d) return [g[0], g[1]];
    if (d.tipo === 'mercator') {
      const m = math.geoParaMercator(g[0], g[1]);
      return [m.x, m.y];
    }
    if (d.tipo === 'utm') {
      const u = math.geoParaUTM(g[0], g[1], { fuso: d.fuso, hemisferio: d.hemisferio, elipsoide: d.elipsoide });
      return [u.x, u.y];
    }
    return [g[0], g[1]];
  }

  /** Transforma um GeoJSON inteiro (de -> para), preservando a estrutura. */
  function transformarGeoJson(geojson, de, para) {
    const a = normalizarEpsg(de);
    const b = normalizarEpsg(para);
    if (a === b) return geojson;
    const conv = (c) => {
      if (typeof c[0] === 'number') return transformarPonto(c, a, b);
      return c.map(conv);
    };
    const geometria = (g) => {
      if (!g) return g;
      return { type: g.type, coordinates: conv(g.coordinates) };
    };
    if (geojson.type === 'FeatureCollection') {
      return {
        type: 'FeatureCollection',
        features: geojson.features.map((f) => ({
          type: 'Feature', properties: f.properties, geometry: geometria(f.geometry),
        })),
      };
    }
    if (geojson.type === 'Feature') {
      return { type: 'Feature', properties: geojson.properties, geometry: geometria(geojson.geometry) };
    }
    return geometria(geojson);
  }

  /**
   * Aviso honesto para a tela quando o CRS não veio declarado.
   * A extensão serve de conferência: coordenada em grau cai entre -180..180;
   * coordenada UTM tem valores da ordem de 10^5..10^7.
   *
   * @param {object} geojson
   * @param {string} epsgDeclarado
   * @param {object} [opcoes] `{ declarado: true }` quando o EPSG veio de arquivo (.prj)
   *   e não de suposição — sem isso o aviso dizia "sem .prj declarado" mesmo com o
   *   .prj em mãos, o que faz o analista desconfiar do dado sem motivo.
   */
  function diagnosticar(geojson, epsgDeclarado, opcoes) {
    const o = opcoes || {};
    const bbox = math.bbox(geojson);
    if (!bbox) return { epsg: 'EPSG:4326', aviso: 'Não encontrei geometria para conferir o sistema de referência.' };
    const pareceGrau = Math.abs(bbox[0]) <= 180 && Math.abs(bbox[2]) <= 180
      && Math.abs(bbox[1]) <= 90 && Math.abs(bbox[3]) <= 90;

    if (epsgDeclarado) {
      const e = normalizarEpsg(epsgDeclarado);
      const d = definicao(e);
      const fuso = math.fusoUTM((bbox[0] + bbox[2]) / 2);
      const origem = o.declarado ? 'declarado no .prj' : 'assumido';
      if (d && eGeografica(e)) {
        return {
          epsg: e,
          aviso: 'Coordenadas em graus — ' + (d.nome || e) + ' (' + origem + '). '
            + 'Área e comprimento são calculados em UTM ' + fuso + 'S.',
        };
      }
      if (d) {
        return { epsg: e, aviso: 'Sistema ' + (d.nome || e) + ' (' + origem + '); reprojetado para WGS 84 no carregamento.' };
      }
      return { epsg: e, aviso: 'Sistema declarado: ' + e + ' (' + origem + '). Reprojetado para WGS 84.' };
    }

    if (pareceGrau) {
      return {
        epsg: 'EPSG:4326',
        aviso: 'Coordenadas em graus e nenhum .prj junto do arquivo. Assumi WGS 84 — '
          + 'confira no mapa antes de usar os números.',
      };
    }
    return {
      epsg: null,
      aviso: 'As coordenadas NÃO estão em graus (provavelmente UTM em metros) e não veio .prj. '
        + 'Escolha o sistema de referência na tela; sem isso, a área calculada não vale.',
    };
  }

  /* ------------------------------------------------------------------ GRADE EM UTM
   *
   * A prancha de referência do cliente escreve LESTE/NORTE em UTM nas bordas (449800, 7409900), não
   * graus. Estas duas funções fazem isso, e ficam AQUI — junto da conversão que já existia — para
   * serem testáveis sem navegador, como o resto do módulo.
   *
   * Detalhe que importa: o LESTE de um ponto depende também da LATITUDE (convergência de
   * meridianos), e o NORTE depende da LONGITUDE. Por isso o rótulo de cima é medido na borda de
   * CIMA e o da esquerda na borda ESQUERDA — medir no meio daria um número que não corresponde à
   * linha onde ele está escrito.
   */
  /* `deGeografico` recebe um PAR [lon, lat] — e não uma geometria, como eu supus ao escrever esta
   * função da primeira vez. A suposição deu NaN em toda a grade, e o defeito só apareceu porque eu
   * conferi o número: um UTM em São Paulo tem de cair em ~E 400.000 e ~N 7.400.000, e "NaN" não cai
   * em lugar nenhum. Quinta vez na sessão que eu adivinho uma assinatura em vez de ler. */
  function paraUtm(lon, lat, epsg) {
    const p = deGeografico([Number(lon), Number(lat)], epsg);
    if (!p || p.length < 2 || !isFinite(p[0]) || !isFinite(p[1])) return [NaN, NaN];
    return p;
  }

  /** Em UTM, 10 m já é precisão de sobra para um rótulo de borda de prancha. */
  function formatarUtm(valor, sufixo) {
    if (!isFinite(valor)) return '';
    const arredondado = Math.round(valor / 10) * 10;
    return String(arredondado).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' ' + sufixo;
  }

  function gradeUtm(extensao, epsg, passos) {
    const n = Number(passos) > 0 ? Number(passos) : 4;
    const topo = [];
    const esquerda = [];
    if (!extensao || extensao.length < 4) return { topo: topo, esquerda: esquerda };
    for (let i = 0; i <= n; i++) {
      const lon = extensao[0] + (extensao[2] - extensao[0]) * i / n;
      const lat = extensao[1] + (extensao[3] - extensao[1]) * i / n;
      const leste = paraUtm(lon, extensao[3], epsg)[0];
      const norte = paraUtm(extensao[0], lat, epsg)[1];
      topo.push({ pos: (i / n * 100).toFixed(1), texto: formatarUtm(leste, 'E') });
      esquerda.push({ pos: ((1 - i / n) * 100).toFixed(1), texto: formatarUtm(norte, 'N') });
    }
    return { topo: topo, esquerda: esquerda };
  }

  /** O fuso UTM a partir da longitude (1 a 60). */
  function fusoDe(lon) {
    return Math.floor((Number(lon) + 180) / 6) + 1;
  }

  return {
    DEFINICOES: DEFINICOES,
    definicao: definicao,
    normalizarEpsg: normalizarEpsg,
    eGeografica: eGeografica,
    epsgDoPrj: epsgDoPrj,
    epsgRecomendado: epsgRecomendado,
    transformarPonto: transformarPonto,
    transformarGeoJson: transformarGeoJson,
    paraGeografico: paraGeografico,
    deGeografico: deGeografico,
    diagnosticar: diagnosticar,
    paraUtm: paraUtm,
    formatarUtm: formatarUtm,
    gradeUtm: gradeUtm,
    fusoDe: fusoDe,
  };
});
