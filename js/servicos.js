'use strict';
/* ============================================================================
 * servicos.js — monta as consultas de camadas AO VIVO e decide a paginação
 *
 * Existem dois tipos de serviço em uso no portal:
 *
 *   arcgis — MapServer do ArcGIS (serviço da SEMIL/CETESB). Consulta por envelope, resposta em
 *            GeoJSON, página de 1000 e o sinal de "tem mais" no campo exceededTransferLimit.
 *
 *   wfs    — Web Feature Service (GeoServer, MapServer, deegree...; é o padrão OGC). Consulta
 *            por bbox, resposta em GeoJSON, página de 1000 e o sinal de "tem mais" em
 *            numberReturned/totalFeatures.
 *
 * Está separado do app.js para poder ser verificado sem navegador: montar URL e decidir
 * paginação são as duas coisas que quebram em silêncio, e as duas dão para testar aqui.
 * ========================================================================== */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (raiz) {
    raiz.EIA = raiz.EIA || {};
    raiz.EIA.servicos = api;
  }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : null), function () {
  'use strict';

  const PAGINA = 1000;   // limite dos dois serviços (ArcGIS maxRecordCount, WFS count)

  /**
   * CRS84 = longitude,latitude — a ordem que o GeoJSON usa.
   *
   * Isto não é detalhe: em WFS 2.0, "EPSG:4326" segue a definição do EPSG, que é
   * LATITUDE,longitude. Passar a caixa em lon,lat dizendo EPSG:4326 devolve o retângulo
   * errado (trocado) sem erro nenhum — o clássico. CRS84 não tem ambiguidade.
   */
  const CRS84 = 'urn:ogc:def:crs:OGC:1.3:CRS84';

  function tipoDe(camada) {
    const s = camada && camada.servico;
    if (!s) return null;
    return s.tipo || 'arcgis';
  }

  /** URL da consulta de uma página, por tipo de serviço. */
  function urlDaPagina(camada, caixa, offset) {
    const tipo = tipoDe(camada);
    const p = new URLSearchParams();
    if (tipo === 'wfs') {
      p.set('service', 'WFS');
      p.set('version', '2.0.0');
      p.set('request', 'GetFeature');
      p.set('typeNames', camada.servico.camada);
      p.set('outputFormat', 'application/json');
      p.set('srsName', CRS84);
      p.set('bbox', caixa.map((v) => Number(v).toFixed(6)).join(',') + ',' + CRS84);
      p.set('count', String(PAGINA));
      p.set('startIndex', String(offset || 0));
      return camada.servico.url + '?' + p.toString();
    }
    // arcgis (padrão)
    p.set('where', '1=1');
    p.set('geometry', caixa.map((v) => Number(v).toFixed(6)).join(','));
    p.set('geometryType', 'esriGeometryEnvelope');
    p.set('inSR', '4326');
    p.set('spatialRel', 'esriSpatialRelIntersects');
    p.set('outFields', '*');
    p.set('returnGeometry', 'true');
    p.set('outSR', '4326');
    p.set('f', 'geojson');
    p.set('resultOffset', String(offset || 0));
    p.set('resultRecordCount', String(PAGINA));
    return camada.servico.url + '/query?' + p.toString();
  }

  /**
   * A resposta trouxe uma página cheia? Então provavelmente tem mais.
   *
   * Cada serviço diz isso de um jeito:
   *  - ArcGIS: exceededTransferLimit (booleano) quando cortou a resposta;
   *  - WFS: numberReturned == count pedido (o GeoServer manda totalFeatures/numberMatched).
   */
  function temMais(tipo, dados, quantosVieram) {
    if (!quantosVieram) return false;
    if (tipo === 'wfs') {
      if (typeof dados.numberMatched === 'number') {
        const jaTemos = (dados.numberReturned || quantosVieram);
        return dados.numberMatched > jaTemos;
      }
      if (typeof dados.totalFeatures === 'number' && dados.totalFeatures > 0) {
        return dados.totalFeatures > quantosVieram;
      }
      return quantosVieram >= PAGINA;
    }
    return dados.exceededTransferLimit === true;
  }

  /** Mensagem de erro que diz o que fazer, não só o que aconteceu. */
  function explicarFalha(camada, mensagem) {
    const tipo = tipoDe(camada) || 'arcgis';
    return 'Não carreguei ' + camada.nome + ' do serviço ' + tipo.toUpperCase() + ': ' + mensagem
      + '. Se for bloqueio do navegador (CORS), o servidor não libera consulta de outro site — '
      + 'nesse caso a saída é publicar uma foto da camada na base.';
  }

  /** Normaliza a resposta para FeatureCollection (os dois devolvem GeoJSON, mas confira). */
  function feicoesDe(dados) {
    if (!dados) return [];
    if (dados.error) throw new Error(dados.error.message || 'erro no serviço');
    if (dados.type === 'FeatureCollection' && Array.isArray(dados.features)) return dados.features;
    if (Array.isArray(dados.features)) return dados.features;
    return [];
  }

  return {
    PAGINA: PAGINA,
    CRS84: CRS84,
    tipoDe: tipoDe,
    urlDaPagina: urlDaPagina,
    temMais: temMais,
    feicoesDe: feicoesDe,
    explicarFalha: explicarFalha,
  };
}));
