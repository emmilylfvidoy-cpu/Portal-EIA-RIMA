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
   * ORDEM DE EIXOS: a armadilha do WFS, medida num servidor real.
   *
   * Em WFS 2.0 a caixa segue a definição do CRS, e não a ordem do GeoJSON. No GeoServer do
   * IPHAN (camada SICG:sitios), com a extensão de São Paulo:
   *
   *   bbox=lon,lat (sem CRS)                    -> 0 feições
   *   bbox=lat,lon,urn:ogc:def:crs:EPSG::4674   -> 4.036 feições   <- certo
   *   bbox=lon,lat,urn:ogc:def:crs:EPSG::4674   -> 0 feições
   *   bbox=lon,lat,urn:ogc:def:crs:OGC:1.3:CRS84 -> HTTP 400 (o servidor recusa)
   *
   * Ou seja: o erro não é barulhento — devolve ZERO feição e o mapa fica vazio, sem aviso.
   * Por isso a ordem e o CRS são declarados por camada, com o padrão brasileiro (SIRGAS 2000,
   * latitude,longitude). CRS84 fica disponível para quem aceitar.
   */
  const CRS_PADRAO = 'urn:ogc:def:crs:EPSG::4674';   // SIRGAS 2000, o padrão do Brasil
  const CRS84 = 'urn:ogc:def:crs:OGC:1.3:CRS84';     // longitude,latitude

  /**
   * Caixa no formato do WFS: quatro números na ordem do CRS, seguidos do CRS.
   * eixo: 'latlon' (padrão, SIRGAS/EPSG:4674) ou 'lonlat' (CRS84).
   */
  function caixaParaWfs(caixa, crs, eixo) {
    const [a, b, c, d] = caixa.map((v) => Number(v));
    const ordem = (eixo === 'lonlat') ? [a, b, c, d] : [b, a, d, c];
    // sem CRS declarado, o EIXO decide: 'lonlat' pede CRS84 (longitude,latitude por definição),
    // senão vale o padrão brasileiro (SIRGAS 2000, latitude,longitude)
    return ordem.map((v) => v.toFixed(6)).join(',') + ','
      + (crs || (eixo === 'lonlat' ? CRS84 : CRS_PADRAO));
  }

  /**
   * Anexa a caixa CRUA na URL. O URLSearchParams codifica a vírgula como %2C e o GeoServer
   * recusa a consulta (HTTP 400) — medido no IPHAN. O resto dos parâmetros vai codificado
   * normalmente; a caixa não.
   */
  function urlComCaixa(base, parametros, caixa) {
    const bruto = parametros.toString();
    if (!caixa) return base + '?' + bruto;
    return base + '?' + bruto + '&bbox=' + caixa;
  }

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
      p.set('srsName', camada.servico.eixo === 'lonlat' ? CRS84 : (camada.servico.crs || CRS_PADRAO));
      /* SEM count/startIndex: o GeoServer do IPHAN recusa paginar camada sem chave primária
       * ('Cannot do natural order without a primary key'). Sem paginação ele devolve tudo que
       * cruza a caixa, e o número vem do tamanho da caixa, não de um pedido de página. */
      // a caixa vai CRUA (vírgula não codificada): ver urlComCaixa
      return urlComCaixa(camada.servico.url, p, caixaParaWfs(caixa, camada.servico.crs, camada.servico.eixo));
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
    CRS_PADRAO: CRS_PADRAO,
    caixaParaWfs: caixaParaWfs,
    urlComCaixa: urlComCaixa,
    tipoDe: tipoDe,
    urlDaPagina: urlDaPagina,
    temMais: temMais,
    feicoesDe: feicoesDe,
    explicarFalha: explicarFalha,
  };
}));
