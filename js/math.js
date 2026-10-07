'use strict';
/* ============================================================================
 * math.js — projeção, área e comprimento
 *
 * Por que este arquivo existe: área de polígono calculada em GRAUS não tem
 * significado físico. Todo número de hectare que sai do portal é calculado em
 * projeção (UTM / SIRGAS 2000, EPSG:31983 na maior parte de SP) ou em geodésica
 * sobre o elipsoide — nunca em graus.
 *
 * Implementação própria, sem proj4: série de Krüger (Transversa de Mercator de
 * 6ª ordem, precisão sub-milimétrica dentro do fuso) e fórmula de Karney para a
 * área geodésica de um anel. As duas rotas são independentes de propósito, para
 * que uma sirva de conferência da outra (ver `conferirArea`).
 *
 * Roda no navegador (`window.EIA.math`) e no Node (`require`), para permitir
 * teste automatizado sem abrir página.
 * ========================================================================== */

(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (raiz) {
    raiz.EIA = raiz.EIA || {};
    raiz.EIA.math = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // ------------------------------------------------------------- elipsoides
  const ELIPSOIDES = {
    'WGS84': { a: 6378137.0, f: 1 / 298.257223563, nome: 'WGS 84' },
    'GRS80': { a: 6378137.0, f: 1 / 298.257222101, nome: 'GRS 1980' },
    'SAD69': { a: 6378160.0, f: 1 / 298.25, nome: 'SAD 69' },
    'INT24': { a: 6378388.0, f: 1 / 297.0, nome: 'Internacional 1924' },
  };
  const GEOGRAFICAS = ['EPSG:4326', 'EPSG:4618', 'EPSG:4674', 'WGS84', 'SIRGAS2000', 'SAD69'];

  function elipsoide(codigo) {
    const e = ELIPSOIDES[String(codigo || 'WGS84').toUpperCase()];
    return e || ELIPSOIDES['WGS84'];
  }

  // ------------------------------------------------------------- UTM
  /** Fuso UTM (1..60) que contém a longitude. */
  function fusoUTM(lon) {
    return Math.floor((normalizarLon(lon) + 180) / 6) + 1;
  }

  function hemisferio(lat) { return lat >= 0 ? 'N' : 'S'; }

  /**
   * EPSG do UTM correspondente.
   * Tabela completa de propósito: estimar o código por aritmética erra o fuso e o
   * erro é silencioso (a coordenada sai, só que do lugar errado). Em São Paulo o
   * fuso 23S é o EPSG:31983 — não 31959, que é o mesmo fuso no hemisfério N.
   */
  const EPSG_UTM = {
    SIRGAS2000: {
      S: { 18: 31978, 19: 31979, 20: 31980, 21: 31981, 22: 31982, 23: 31983, 24: 31984, 25: 31985 },
      N: { 18: 31972, 19: 31973, 20: 31974, 21: 31975, 22: 31976, 23: 31977, 24: 31978, 25: 31979 },
    },
    SAD69: {
      S: { 18: 29188, 19: 29189, 20: 29190, 21: 29191, 22: 29192, 23: 29193, 24: 29194, 25: 29195 },
      N: { 18: 29168, 19: 29169, 20: 29170, 21: 29171, 22: 29172, 23: 29173, 24: 29174, 25: 29175 },
    },
  };

  function epsgUTM(lat, lon, datum) {
    const z = fusoUTM(lon);
    const hemi = lat < 0 ? 'S' : 'N';
    const nome = String(datum || 'SIRGAS2000').toUpperCase().indexOf('SAD') === 0 ? 'SAD69' : 'SIRGAS2000';
    const tabela = EPSG_UTM[nome][hemi];
    if (tabela[z] !== undefined) return tabela[z];
    // Fora das faixas tabeladas (Brasil usa 18..25): devolve o UTM do mesmo datum
    // por derivação da âncora, deixando claro que é aproximação.
    return nome === 'SAD69'
      ? (hemi === 'S' ? 29170 + z : 29150 + z)
      : (hemi === 'S' ? 31960 + z : 31954 + z);
  }

  function normalizarLon(lon) {
    let x = Number(lon);
    while (x > 180) x -= 360;
    while (x < -180) x += 360;
    return x;
  }

  /**
   * Geográfico -> UTM. Série de Krüger (Snyder/Redfearn), 6ª ordem.
   * @returns {{x:number,y:number,fuso:number,hemisferio:string}}
   */
  function geoParaUTM(lon, lat, opcoes) {
    const o = opcoes || {};
    const el = elipsoide(o.elipsoide || 'WGS84');
    const a = el.a;
    const f = el.f;
    const e2 = f * (2 - f);
    const ep2 = e2 / (1 - e2);
    const k0 = o.k0 || 0.9996;
    const z = o.fuso || fusoUTM(lon);
    const lon0 = (o.lon0 !== undefined) ? o.lon0 : (z * 6 - 183);
    const lat0 = o.lat0 || 0;

    const rad = Math.PI / 180;
    const phi = lat * rad;
    const dlon = normalizarLon(lon - lon0) * rad;

    const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
    const T = Math.tan(phi) ** 2;
    const C = ep2 * Math.cos(phi) ** 2;
    const A = Math.cos(phi) * dlon;

    const e4 = e2 * e2, e6 = e4 * e2;
    const M = a * (
      (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
      - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
      + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi)
      - (35 * e6 / 3072) * Math.sin(6 * phi)
    );

    const A2 = A * A, A3 = A2 * A, A4 = A3 * A, A5 = A4 * A, A6 = A5 * A;

    const x = k0 * N * (
      A + (1 - T + C) * A3 / 6
      + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A5 / 120
    ) + 500000.0;

    let y = k0 * (M + N * Math.tan(phi) * (
      A2 / 2
      + (5 - T + 9 * C + 4 * C * C) * A4 / 24
      + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A6 / 720
    ));
    // Falsa origem do hemisfério sul. O hemisfério vem da opção quando informado
    // (é o que o código EPSG significa), senão do sinal da latitude.
    const sul = (o.hemisferio !== undefined) ? (o.hemisferio === 'S') : (lat < 0);
    if (sul) y += 10000000.0;

    return { x: x, y: y, fuso: z, hemisferio: sul ? 'S' : 'N', lon0: lon0, lat0: lat0, k0: k0 };
  }

  /** UTM -> geográfico (série inversa). */
  function utmParaGeo(x, y, opcoes) {
    const o = opcoes || {};
    const el = elipsoide(o.elipsoide || 'WGS84');
    const a = el.a, f = el.f;
    const e2 = f * (2 - f);
    const ep2 = e2 / (1 - e2);
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    const k0 = o.k0 || 0.9996;
    // Hemisfério: a opção manda (é o que o EPSG significa). Sem ela, a falsa
    // origem de 10.000.000 m é o critério — não 5.000.000, que classificaria
    // como norte um ponto a 1.100 km ao sul do equador.
    const sul = (o.hemisferio !== undefined) ? (o.hemisferio === 'S') : (y >= 5000000);
    const z = o.fuso || 23;
    const lon0 = (o.lon0 !== undefined) ? o.lon0 : (z * 6 - 183);

    const xx = x - 500000.0;
    const yy = sul ? (y - 10000000.0) : y;

    const e4 = e2 * e2, e6 = e4 * e2;
    const M = yy / k0;
    const mu = M / (a * (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256));
    const mu2 = 2 * mu, mu4 = 4 * mu, mu6 = 6 * mu, mu8 = 8 * mu;

    const phi1 = mu
      + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(mu2)
      + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(mu4)
      + (151 * e1 ** 3 / 96) * Math.sin(mu6)
      + (1097 * e1 ** 4 / 512) * Math.sin(mu8);

    const sin1 = Math.sin(phi1), cos1 = Math.cos(phi1), tan1 = Math.tan(phi1);
    const N1 = a / Math.sqrt(1 - e2 * sin1 * sin1);
    const T1 = tan1 * tan1;
    const C1 = ep2 * cos1 * cos1;
    const R1 = a * (1 - e2) / Math.pow(1 - e2 * sin1 * sin1, 1.5);
    const D = xx / (N1 * k0);
    const D2 = D * D, D3 = D2 * D, D4 = D3 * D, D5 = D4 * D, D6 = D5 * D;

    const lat = phi1 - (N1 * tan1 / R1) * (
      D2 / 2
      - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D4 / 24
      + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D6 / 720
    );

    const lon = (
      D
      - (1 + 2 * T1 + C1) * D3 / 6
      + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D5 / 120
    ) / cos1;

    return {
      lon: lon0 + lon * 180 / Math.PI,
      lat: lat * 180 / Math.PI,
      fuso: z,
      hemisferio: sul ? 'S' : 'N',
      lon0: lon0,
      k0: k0,
    };
  }

  // ------------------------------------------------------------- Web Mercator
  /** EPSG:3857 a partir de WGS 84 (usado pelo Leaflet para tiles/escala). */
  function geoParaMercator(lon, lat) {
    const R = 6378137.0;
    const x = R * normalizarLon(lon) * Math.PI / 180;
    const limite = 85.05112878;
    const phi = Math.max(-limite, Math.min(limite, lat)) * Math.PI / 180;
    const y = R * Math.log(Math.tan(Math.PI / 4 + phi / 2));
    return { x: x, y: y };
  }

  function mercatorParaGeo(x, y) {
    const R = 6378137.0;
    const lon = (x / R) * 180 / Math.PI;
    const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI;
    return { lon: lon, lat: lat };
  }

  // ------------------------------------------------------------- geometria
  /** Área de anel em unidades do plano (shoelace). Sempre absoluta. */
  function areaAnel(anel) {
    const n = anel.length;
    if (n < 3) return 0;
    let s = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      s += anel[j][0] * anel[i][1] - anel[i][0] * anel[j][1];
    }
    return Math.abs(s) / 2;
  }

  /** Área com sinal (positivo = sentido anti-horário). */
  function areaAnelAssinada(anel) {
    const n = anel.length;
    if (n < 3) return 0;
    let s = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      s += anel[j][0] * anel[i][1] - anel[i][0] * anel[j][1];
    }
    return s / 2;
  }

  function anelFechado(anel) {
    if (anel.length < 2) return false;
    const p = anel[0], u = anel[anel.length - 1];
    return p[0] === u[0] && p[1] === u[1];
  }

  /** Garante anel fechado (repetindo o primeiro ponto). */
  function fecharAnel(anel) {
    const c = anel.map(function (p) { return [p[0], p[1]]; });
    if (c.length && !anelFechado(c)) c.push([c[0][0], c[0][1]]);
    return c;
  }

  /** Remove o ponto de fechamento, se houver. */
  function abrirAnel(anel) {
    if (!anelFechado(anel)) return anel.map(function (p) { return [p[0], p[1]]; });
    return anel.slice(0, -1).map(function (p) { return [p[0], p[1]]; });
  }

  function bbox(geometria) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    percorrerCoords(geometria, function (p) {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
    });
    if (minX === Infinity) return null;
    return [minX, minY, maxX, maxY];
  }

  function unirBbox(a, b) {
    if (!a) return b ? b.slice() : null;
    if (!b) return a.slice();
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
  }

  function bboxValida(b) {
    return Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && b[0] <= b[2] && b[1] <= b[3];
  }

  function bboxIntersecta(a, b) {
    return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
  }

  function bboxContem(a, b) {
    return a[0] <= b[0] && a[1] <= b[1] && a[2] >= b[2] && a[3] >= b[3];
  }

  /** Percorre qualquer geometria GeoJSON entregando cada posição. */
  function percorrerCoords(geometria, fn) {
    if (!geometria) return;
    if (Array.isArray(geometria)) {
      // heurística: [x,y] é posição; senão é lista de posições/geometrias
      if (typeof geometria[0] === 'number' && typeof geometria[1] === 'number') { fn(geometria); return; }
      for (let i = 0; i < geometria.length; i++) percorrerCoords(geometria[i], fn);
      return;
    }
    if (geometria.type === 'Feature') return percorrerCoords(geometria.geometry, fn);
    if (geometria.type === 'FeatureCollection') {
      (geometria.features || []).forEach(function (f) { percorrerCoords(f, fn); });
      return;
    }
    if (geometria.coordinates) percorrerCoords(geometria.coordinates, fn);
    if (geometria.geometries) geometria.geometries.forEach(function (g) { percorrerCoords(g, fn); });
  }

  /** Lista de anéis externos e furos de um Polygon/MultiPolygon. */
  function aneisDe(geometria) {
    if (!geometria) return [];
    if (geometria.type === 'Polygon') return [geometria.coordinates];
    if (geometria.type === 'MultiPolygon') return geometria.coordinates;
    return [];
  }

  /** Lista de linhas de um LineString/MultiLineString. */
  function linhasDe(geometria) {
    if (!geometria) return [];
    if (geometria.type === 'LineString') return [geometria.coordinates];
    if (geometria.type === 'MultiLineString') return geometria.coordinates;
    return [];
  }

  function pontosDe(geometria) {
    if (!geometria) return [];
    if (geometria.type === 'Point') return [geometria.coordinates];
    if (geometria.type === 'MultiPoint') return geometria.coordinates;
    return [];
  }

  // ------------------------------------------------------------- geodésica
  const R_MEDIO = 6371008.7714; // raio médio (IUGG) para as conferências esféricas

  /**
   * Área geodésica em m² (com sinal) — triangulação em leque sobre a esfera
   * authálica, com o excesso de cada triângulo pela fórmula de L'Huilier estável.
   *
   * É uma rota INDEPENDENTE da UTM, de propósito: serve para conferir o número que
   * vai para o EIA. Em vez de somar ângulos internos (onde um erro de sinal passa
   * despercebido e devolve um resultado absurdo), soma o excesso de cada triângulo
   * (O, Pi, Pi+1) — o valor é o mesmo e a estabilidade numérica é muito melhor.
   *
   * Sinal positivo = anel anti-horário; usar Math.abs para hectare.
   */
  function areaGeodesicaRapida(anel, elipsoideNome) {
    const el = elipsoide(elipsoideNome);
    const a = el.a, f = el.f;
    const e2 = f * (2 - f);
    const e = Math.sqrt(e2);
    const b = a * (1 - f);
    // R² authálico: área = (excesso em rad) · R2
    const R2 = (a * a + (b * b) * Math.atanh(e) / e) / 2;

    const anelAb = abrirAnel(anel);
    const n = anelAb.length;
    if (n < 3) return 0;

    const rad = Math.PI / 180;
    const v = anelAb.map(function (p) {
      const phi = p[1] * rad;
      // Latitude authálica: preserva a área ao passar do elipsoide para a esfera.
      const la = Math.atan((1 - e2) * Math.tan(phi)
        * (1 + e2 / 2 * Math.sin(phi) * Math.sin(phi)));
      return [Math.cos(la) * Math.cos(p[0] * rad), Math.cos(la) * Math.sin(p[0] * rad), Math.sin(la)];
    });

    // Leque a partir do primeiro vértice; vértices repetidos (comuns em dado bruto)
    // não contribuem, e a fórmula devolve 0 em vez de NaN.
    let excesso = 0;
    for (let i = 1; i < n - 1; i++) {
      excesso += excessoTriangulo(v[0], v[i], v[i + 1]);
    }
    return excesso * R2;
  }

  /**
   * Excesso esférico (rad) do triângulo de vetores p1,p2,p3.
   * Fórmula vetorial de Girard (Eriksson): ângulo diedral em p1 pela tangente de
   * cada lado, o que dispensa normalizar e é estável para triângulos pequenos —
   * que é exatamente o caso (triângulos de metros a quilômetros num planeta).
   */
  function excessoTriangulo(p1, p2, p3) {
    return anguloDiedral(p1, p2, p3) + anguloDiedral(p2, p3, p1) + anguloDiedral(p3, p1, p2) - Math.PI;
  }

  function anguloDiedral(p1, p2, p3) {
    const t1 = normalizar(produtoVetorial(p1, p2));
    const t2 = normalizar(produtoVetorial(p1, p3));
    const c = Math.min(1, Math.max(-1, produtoEscalar(t1, t2)));
    return Math.acos(c);
  }

  function normalizar(v) {
    const m = Math.sqrt(produtoEscalar(v, v));
    if (m === 0) return [0, 0, 0];
    return [v[0] / m, v[1] / m, v[2] / m];
  }

  /** Valor absoluto da área geodésica (é o que interessa para hectare). */
  function areaGeodesica(anel, elipsoideNome) {
    return Math.abs(areaGeodesicaRapida(anel, elipsoideNome));
  }

  function produtoVetorial(u, w) {
    return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  }
  function produtoEscalar(u, w) { return u[0] * w[0] + u[1] * w[1] + u[2] * w[2]; }

  /** Comprimento geodésico de uma linha (m) — Vincenty com fallback de haversine. */
  function comprimentoGeodesico(linha, elipsoideNome) {
    const el = elipsoide(elipsoideNome);
    let total = 0;
    for (let i = 1; i < linha.length; i++) {
      total += distanciaVincenty(linha[i - 1], linha[i], el);
    }
    return total;
  }

  function distanciaVincenty(p1, p2, el) {
    const a = el.a, f = el.f, b = a * (1 - f);
    const L = (p2[0] - p1[0]) * Math.PI / 180;
    const U1 = Math.atan((1 - f) * Math.tan(p1[1] * Math.PI / 180));
    const U2 = Math.atan((1 - f) * Math.tan(p2[1] * Math.PI / 180));
    const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1);
    const sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);
    let lambda = L, lambdaAnt = 0, iter = 0;
    let cosSqAlpha = 0, sinSigma = 0, cos2SigmaM = 0, cosSigma = 0, sigma = 0, sinLambda = 0, cosLambda = 0;
    do {
      sinLambda = Math.sin(lambda); cosLambda = Math.cos(lambda);
      sinSigma = Math.sqrt(
        (cosU2 * sinLambda) ** 2
        + (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) ** 2
      );
      if (sinSigma === 0) return 0;
      cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
      sigma = Math.atan2(sinSigma, cosSigma);
      const sinAlpha = cosU1 * cosU2 * sinLambda / sinSigma;
      cosSqAlpha = 1 - sinAlpha * sinAlpha;
      cos2SigmaM = cosSqAlpha === 0 ? 0 : cosSigma - 2 * sinU1 * sinU2 / cosSqAlpha;
      const C = f / 16 * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha));
      lambdaAnt = lambda;
      lambda = L + (1 - C) * f * sinAlpha * (
        sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM))
      );
      iter++;
    } while (Math.abs(lambda - lambdaAnt) > 1e-12 && iter < 100);

    if (iter >= 100) {
      // não convergiu (pontos quase antipodais): haversine sobre raio médio
      return haversine(p1, p2);
    }
    const uSq = cosSqAlpha * (a * a - b * b) / (b * b);
    const A = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
    const B = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
    const dSigma = B * sinSigma * (
      cos2SigmaM + B / 4 * (
        cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)
        - B / 6 * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)
      )
    );
    return b * A * (sigma - dSigma);
  }

  function haversine(p1, p2) {
    const dLat = (p2[1] - p1[1]) * Math.PI / 180;
    const dLon = (p2[0] - p1[0]) * Math.PI / 180;
    const la1 = p1[1] * Math.PI / 180, la2 = p2[1] * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R_MEDIO * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // ------------------------------------------------------------- resolução/escala
  /** Resolução do terreno (m/pixel) do Web Mercator no zoom e latitude dados. */
  function resolucaoMercator(lat, zoom) {
    return 156543.03392804097 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom);
  }

  /** Zoom do Leaflet correspondente a uma escala de mapa (para tela de ~96 dpi). */
  function zoomParaEscala(lat, escala, dpiTela) {
    const dpi = dpiTela || 96;
    const resolucaoAlvo = escala * 0.0254 / dpi; // m por pixel
    const base = 156543.03392804097 * Math.cos(lat * Math.PI / 180);
    return Math.log2(base / resolucaoAlvo);
  }

  /** Escala real considerando a resolução de saída (dpi) do PDF. */
  function escalaParaDpi(lat, escala, dpiSaida, larguraMm, larguraPx) {
    // m por pixel desejado = escala * dpi / 25,4 / 1000 ... ver mapa.js
    const mPorPx = escala / 1000 * (25.4 / dpiSaida);
    const larguraTerrenoM = larguraMm / 1000 * escala / 1000 * 1000;
    return { mPorPx: mPorPx, larguraTerrenoM: larguraTerrenoM, px: Math.round(larguraTerrenoM / mPorPx) };
  }

  // ------------------------------------------------------------- formatação
  function num(v, casas) {
    if (!Number.isFinite(v)) return '—';
    const c = casas === undefined ? 2 : casas;
    const s = Math.abs(v).toFixed(c).split('.');
    const inteiro = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const dec = s[1] ? ',' + s[1] : '';
    return (v < 0 ? '-' : '') + inteiro + dec;
  }

  function ha(m2, casas) {
    return num(m2 / 10000, casas === undefined ? 2 : casas);
  }

  function km(m, casas) {
    return num(m / 1000, casas === undefined ? 3 : casas);
  }

  function graus(v, casas) {
    return num(v, casas === undefined ? 6 : casas);
  }

  /** Grau decimal -> DMS textual (ex.: 22°32'06,4"S). */
  function dms(valor, eixo) {
    const hemis = eixo === 'lat' ? (valor >= 0 ? 'N' : 'S') : (valor >= 0 ? 'E' : 'W');
    let v = Math.abs(valor);
    const g = Math.floor(v);
    v = (v - g) * 60;
    const m = Math.floor(v);
    const s = (v - m) * 60;
    const segundos = s.toFixed(1).replace('.', ',');
    const partes = segundos.split(',');
    const segTexto = String(Number(partes[0])).padStart(2, '0') + ',' + (partes[1] || '0');
    return g + '°' + String(m).padStart(2, '0') + "'" + segTexto + '"' + hemis;
  }

  /** Escala legível a partir do denominador: 5000 -> "1:5.000". */
  function escalaTexto(denominador) {
    return '1:' + num(denominador, 0);
  }

  // ------------------------------------------------------------- conferência
  /**
   * Compara área em UTM com área geodésica. Devolve a diferença relativa.
   * Usado nos testes e no relatório de qualidade do recorte.
   */
  function conferirArea(anel, elipsoideNome) {
    const centro = centroide(anel);
    const utm = geoParaUTM(centro[0], centro[1], { elipsoide: elipsoideNome || 'WGS84' });
    const proj = anel.map(function (p) {
      const q = geoParaUTM(p[0], p[1], {
        elipsoide: elipsoideNome || 'WGS84', fuso: utm.fuso, lon0: utm.lon0,
      });
      return [q.x, q.y];
    });
    const aUtm = areaAnel(proj);
    const aGeo = Math.abs(areaGeodesicaRapida(anel, elipsoideNome));
    const dif = aGeo > 0 ? Math.abs(aUtm - aGeo) / aGeo : 0;
    return {
      area_utm_m2: aUtm,
      area_geodesica_m2: aGeo,
      diferenca_relativa: dif,
      fuso: utm.fuso,
      epsg: epsgUTM(centro[1], centro[0]),
    };
  }

  function centroide(anel) {
    const ab = abrirAnel(anel);
    let x = 0, y = 0;
    for (let i = 0; i < ab.length; i++) { x += ab[i][0]; y += ab[i][1]; }
    return [x / ab.length, y / ab.length];
  }

  return {
    ELIPSOIDES: ELIPSOIDES,
    GEOGRAFICAS: GEOGRAFICAS,
    R_MEDIO: R_MEDIO,
    elipsoide: elipsoide,
    fusoUTM: fusoUTM,
    epsgUTM: epsgUTM,
    hemisferio: hemisferio,
    normalizarLon: normalizarLon,
    geoParaUTM: geoParaUTM,
    utmParaGeo: utmParaGeo,
    geoParaMercator: geoParaMercator,
    mercatorParaGeo: mercatorParaGeo,
    areaAnel: areaAnel,
    areaAnelAssinada: areaAnelAssinada,
    areaGeodesica: areaGeodesica,
    areaGeodesicaRapida: areaGeodesicaRapida,
    comprimentoGeodesico: comprimentoGeodesico,
    distanciaVincenty: distanciaVincenty,
    haversine: haversine,
    anelFechado: anelFechado,
    fecharAnel: fecharAnel,
    abrirAnel: abrirAnel,
    bbox: bbox,
    unirBbox: unirBbox,
    bboxValida: bboxValida,
    bboxIntersecta: bboxIntersecta,
    bboxContem: bboxContem,
    percorrerCoords: percorrerCoords,
    aneisDe: aneisDe,
    linhasDe: linhasDe,
    pontosDe: pontosDe,
    centroide: centroide,
    resolucaoMercator: resolucaoMercator,
    zoomParaEscala: zoomParaEscala,
    num: num,
    ha: ha,
    km: km,
    graus: graus,
    dms: dms,
    escalaTexto: escalaTexto,
    conferirArea: conferirArea,
  };
});
