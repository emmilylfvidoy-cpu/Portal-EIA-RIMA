'use strict';
/* ============================================================================
 * consulta.js — o que existe no ponto que o usuário clicou (a ferramenta "i")
 *
 * É a lógica pura: recebe as camadas e o ponto, devolve as feições encontradas. Fica separada do
 * mapa de propósito — assim dá para verificar sem navegador, e o desenho do balão fica no app.js.
 *
 * DOIS CUIDADOS QUE MUDAM O RESULTADO:
 *  - FURO NÃO É DENTRO: `pontoNoPoligono` do vetorial responde "sim" para ponto em QUALQUER anel,
 *    inclusive furo. Para consultar isso está errado — a feição é o polígono COM o furo, e o
 *    ponto no furo está fora dela. Aqui o anel externo precisa conter E nenhum furo conter.
 *  - CLIQUE NÃO É PONTO EXATO: ninguém acerta um pixel de linha ou de ponto. Por isso linha e
 *    ponto usam TOLERÂNCIA (padrão ~60 m), e o polígono não usa: ou o clique caiu dentro, ou não.
 * ========================================================================== */
(function (raiz, fabrica) {
  const api = fabrica(
    typeof module === 'object' && module.exports
      ? { vetorial: require('./vetorial.js'), math: require('./math.js') }
      : { vetorial: raiz.EIA.vetorial, math: raiz.EIA.math }
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (raiz) { raiz.EIA = raiz.EIA || {}; raiz.EIA.consulta = api; }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : null), function (EIA) {
  'use strict';

  const TOLERANCIA_GRAUS = 0.0006;   // ~60 m: o bastante para o clique, sem pegar o vizinho
  const MAX_POR_CAMADA = 5;          // clique dentro de 300 fragmentos não pode virar 300 balões

  /** Ponto dentro de um polígono: anel externo contém E nenhum furo contém. */
  function dentroDoPoligono(ponto, aneis) {
    if (!aneis || !aneis.length) return false;
    if (!EIA.vetorial.pontoNoAnel(ponto, aneis[0])) return false;
    for (let i = 1; i < aneis.length; i++) if (EIA.vetorial.pontoNoAnel(ponto, aneis[i])) return false;
    return true;
  }

  /**
   * Distância do ponto ao SEGMENTO (não à reta): projeta e prende no intervalo.
   *
   * NÃO dá para usar `vetorial.emSegmento` aqui, e isso custou um teste vermelho: aquela função
   * exige o ponto EXATAMENTE colineal (`orientacao !== 0` devolve falso) e a tolerância dela só
   * alarga a caixa. Ela responde "o ponto está SOBRE a linha"; o que a consulta precisa é
   * "o ponto está PERTO da linha" — que é esta conta.
   */
  function distanciaAoSegmento(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const comp2 = dx * dx + dy * dy;
    let t = comp2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / comp2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    const px = a[0] + t * dx, py = a[1] + t * dy;
    return Math.sqrt((p[0] - px) * (p[0] - px) + (p[1] - py) * (p[1] - py));
  }

  function pertoDeLinha(ponto, coordenadas, tol) {
    for (let i = 0; i + 1 < coordenadas.length; i++) {
      if (distanciaAoSegmento(ponto, coordenadas[i], coordenadas[i + 1]) <= tol) return true;
    }
    return false;
  }

  function distancia(a, b) {
    return Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]));
  }

  /** A geometria contém (ou está perto de) o ponto? */
  function atingida(geometria, ponto, tol) {
    if (!geometria || !geometria.coordinates) return false;
    switch (geometria.type) {
      case 'Polygon': return dentroDoPoligono(ponto, geometria.coordinates);
      case 'MultiPolygon': return geometria.coordinates.some((p) => dentroDoPoligono(ponto, p));
      case 'LineString': return pertoDeLinha(ponto, geometria.coordinates, tol);
      case 'MultiLineString': return geometria.coordinates.some((l) => pertoDeLinha(ponto, l, tol));
      case 'Point': return distancia(ponto, geometria.coordinates) <= tol;
      case 'MultiPoint': return geometria.coordinates.some((p) => distancia(ponto, p) <= tol);
      case 'GeometryCollection':
        return (geometria.geometries || []).some((g) => atingida(g, ponto, tol));
      default: return false;
    }
  }

  /**
   * As feições das camadas que estão sob o ponto.
   * `camadas` são as LIGADAS (as que o usuário marcou) — consultar camada desligada seria mentir.
   */
  function encontrar(camadas, ponto, opcoes) {
    const o = opcoes || {};
    const tol = o.toleranciaGraus === undefined ? TOLERANCIA_GRAUS : o.toleranciaGraus;
    const max = o.maxPorCamada === undefined ? MAX_POR_CAMADA : o.maxPorCamada;
    const achados = [];
    for (const camada of (camadas || [])) {
      if (!camada || !camada.geojson || !camada.geojson.features) continue;
      const daCamada = [];
      let total = 0;
      for (const f of camada.geojson.features) {
        if (!f || !f.geometry) continue;
        if (!atingida(f.geometry, ponto, tol)) continue;
        total++;
        if (daCamada.length < max) daCamada.push(f);
      }
      if (total) achados.push({ camada: camada, feicoes: daCamada, total: total });
    }
    return achados;
  }

  /** Um rótulo curto para a feição: o campo de classe, se houver; senão o primeiro texto. */
  function rotulo(feicao, camada) {
    const p = (feicao && feicao.properties) || {};
    const campo = camada && camada.campo_classe;
    const escolhido = (campo && p[campo] !== undefined && p[campo] !== null && p[campo] !== '')
      ? p[campo]
      : Object.keys(p).map((k) => p[k]).find((v) => typeof v === 'string' && v.trim());
    return escolhido === undefined || escolhido === null ? '(sem rótulo)' : String(escolhido);
  }

  function formatarValor(v) {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    const s = String(v);
    return s.length > 160 ? s.slice(0, 160) + '…' : s;
  }

  return {
    TOLERANCIA_GRAUS: TOLERANCIA_GRAUS,
    MAX_POR_CAMADA: MAX_POR_CAMADA,
    dentroDoPoligono: dentroDoPoligono,
    atingida: atingida,
    encontrar: encontrar,
    rotulo: rotulo,
    formatarValor: formatarValor,
  };
}));
