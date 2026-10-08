'use strict';
/* ============================================================================
 * recorte.js — o coração do portal: áreas de influência × camadas de caracterização
 *
 * Recebe as áreas de influência (do usuário) e as camadas do catálogo, e devolve
 * uma camada derivada por par, com os atributos originais preservados MAIS as
 * colunas de resultado (área em hectare, percentuais, comprimento).
 *
 * Toda área é calculada em projeção (UTM), nunca em graus — ver math.js. O módulo
 * também emite um RELATÓRIO do processo (quantas feições entraram, saíram, foram
 * divididas, avisos de geometria), porque é esse relatório que sustenta o número
 * no EIA.
 * ========================================================================== */

(function (raiz, fabrica) {
  const node = typeof module === 'object' && module.exports;
  const math = node ? require('./math.js') : raiz.EIA.math;
  const vetorial = node ? require('./vetorial.js') : raiz.EIA.vetorial;
  const crs = node ? require('./crs.js') : raiz.EIA.crs;
  const api = fabrica(math, vetorial, crs);
  if (node) module.exports = api;
  if (raiz) {
    raiz.EIA = raiz.EIA || {};
    raiz.EIA.recorte = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (math, vetorial, crs) {

  /** Área de um anel/geometria em hectares, calculada em UTM. */
  function areaHectares(geometria, opcoes) {
    const o = opcoes || {};
    const aneis = math.aneisDe(geometria);
    if (!aneis.length) return 0;
    let total = 0;
    for (const parte of aneis) {
      for (let i = 0; i < parte.length; i++) {
        const a = areaAnelProjetada(parte[i], o);
        total += i === 0 ? a : -a; // furo subtrai
      }
    }
    return Math.abs(total);
  }

  function areaAnelProjetada(anel, o) {
    if (anel.length < 3) return 0;
    const lon0 = o && Number.isFinite(o.origem) ? o.origem[0] : math.centroide(anel)[0];
    const lat0 = o && Number.isFinite(o.origem) ? o.origem[1] : math.centroide(anel)[1];
    const fuso = (o && o.fuso) || math.fusoUTM(lon0);
    const elipsoide = (o && o.elipsoide) || 'WGS84';
    const proj = anel.map((p) => {
      const q = math.geoParaUTM(p[0], p[1], { fuso: fuso, elipsoide: elipsoide });
      return [q.x, q.y];
    });
    return math.areaAnel(proj);
  }

  /** Comprimento em metros de uma linha, em UTM. */
  function comprimentoMetros(geometria, opcoes) {
    const o = opcoes || {};
    const linhas = math.linhasDe(geometria);
    let total = 0;
    for (const linha of linhas) {
      for (let i = 1; i < linha.length; i++) {
        const p = linha[i - 1], q = linha[i];
        const origem = (o.origem) || p;
        const fuso = o.fuso || math.fusoUTM(origem[0]);
        const el = o.elipsoide || 'WGS84';
        const a = math.geoParaUTM(p[0], p[1], { fuso: fuso, elipsoide: el });
        const b = math.geoParaUTM(q[0], q[1], { fuso: fuso, elipsoide: el });
        total += Math.hypot(b.x - a.x, b.y - a.y);
      }
    }
    return total;
  }

  /** Colunas fixas que o portal acrescenta às feições recortadas. */
  const COLUNAS = [
    { campo: 'eia_ai', rotulo: 'Área de influência', tipo: 'texto' },
    { campo: 'eia_camada', rotulo: 'Camada', tipo: 'texto' },
    { campo: 'eia_meio', rotulo: 'Meio', tipo: 'texto' },
    { campo: 'eia_classe', rotulo: 'Classe', tipo: 'texto' },
    { campo: 'eia_area_ha', rotulo: 'Área (ha)', tipo: 'numero' },
    { campo: 'eia_area_orig_ha', rotulo: 'Área original (ha)', tipo: 'numero' },
    { campo: 'eia_pct_ai', rotulo: '% da área de influência', tipo: 'numero' },
    { campo: 'eia_pct_feicao', rotulo: '% da feição', tipo: 'numero' },
    { campo: 'eia_compr_km', rotulo: 'Comprimento (km)', tipo: 'numero' },
    { campo: 'eia_metodo', rotulo: 'Método', tipo: 'texto' },
    { campo: 'eia_fonte', rotulo: 'Fonte', tipo: 'texto' },
    { campo: 'eia_data_ref', rotulo: 'Data de referência', tipo: 'texto' },
  ];

  /**
   * Recorta uma camada por uma área de influência.
   *
   * @param {object} camada    { id, nome, meio, campo_classe, fonte, data_ref, geojson }
   * @param {object} area      { id, nome, sigla, geometry }
   * @param {object} opcoes    { operacao: 'intersecao'|'diferenca', simplificar, areaMinimaHa }
   * @returns {{features:Array, relatorio:object}}
   */
  function recortarCamada(camada, area, opcoes) {
    const o = opcoes || {};
    const operacao = o.operacao === 'diferenca' ? 'diferenca' : 'intersecao';
    const inicio = Date.now();
    const features = (camada.geojson && camada.geojson.features) || [];
    const aneisArea = aneisDaGeometria(area.geometry);
    if (!aneisArea.length) throw new Error('A área de influência "' + (area.nome || area.id) + '" não tem polígono válido.');

    const bboxArea = vetorial.bboxDeAneis(aneisArea);
    const areaAiHa = areaHectares(area.geometry) / 10000;
    const classeCampo = camada.campo_classe || o.campo_classe;
    const resultado = [];
    let candidatas = 0, recortadas = 0, divididas = 0, descartadas = 0, invalidas = 0;

    for (const f of features) {
      if (!f.geometry) continue;
      const bb = math.bbox(f.geometry);
      if (!bb || !math.bboxIntersecta(bb, bboxArea)) continue; // longe: nem tenta
      candidatas++;

      if (vetorial.temAutoIntersecao(f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : [])) invalidas++;

      let geo = f.geometry;
      if (o.simplificar > 0) geo = simplificarGeometria(geo, o.simplificar);

      const antes = contarPartes(geo);
      /* A ÁREA DE INFLUÊNCIA PODE TER VÁRIOS POLÍGONOS E FUROS, e isso tem de ser respeitado.
       *
       * Antes esta chamada recebia TODOS os anéis numa lista só, e o recorte aplicava a mesma
       * operação a cada um: o FURO virava nova interseção (em vez de ser subtraído) e o SEGUNDO
       * polígono virava furo do primeiro. Medido: área de 4 partes devolvia 0 feições, e área
       * com furo devolvia só 1 das 4 manchas — o defeito que o cliente encontrou com o "AID
       * Socio" (0 feições) contra o "AID Meios Físico e Biótico" (121 feições).
       *
       * Agora vai polígono por polígono: intersecta pelo anel EXTERNO e SUBTRAI cada FURO. Os
       * pedaços dos vários polígonos são somados (as partes de uma área válida não se sobrepõem).
       */
      const poligonosArea = math.aneisDe(area.geometry);
      let recortado = { type: 'FeatureCollection', features: [] };
      try {
        for (const poligono of poligonosArea) {
          if (!poligono.length) continue;
          let pedacos = vetorial.recortarFeatures(
            [{ type: 'Feature', properties: f.properties, geometry: geo }],
            [poligono[0]], operacao, { areaMinima: (o.areaMinimaHa || 0) / 10000 * 1e-4 }
          );
          for (const furo of poligono.slice(1)) {
            if (!pedacos.features.length) break;
            pedacos = vetorial.recortarFeatures(
              pedacos.features, [furo], 'diferenca', { areaMinima: 0 }
            );
          }
          for (const p of pedacos.features) recortado.features.push(p);
        }
      } catch (e) {
        descartadas++;
        continue;
      }

      const areaOrigHa = areaHectares(geo) / 10000;
      const comprOrigKm = comprimentoMetros(geo) / 1000;

      for (const rf of recortado.features) {
        const areaHa = areaHectares(rf.geometry) / 10000;
        if (areaHa < (o.areaMinimaHa || 0)) { descartadas++; continue; }
        const props = Object.assign({}, rf.properties);
        props.eia_ai = area.sigla || area.nome || area.id;
        props.eia_camada = camada.id || camada.nome || '';
        props.eia_meio = camada.meio || '';
        props.eia_classe = classeCampo ? (rf.properties ? rf.properties[classeCampo] : undefined) : undefined;
        if (props.eia_classe === undefined || props.eia_classe === null || props.eia_classe === '') props.eia_classe = 'Sem classe';
        props.eia_area_ha = arredondar(areaHa, 4);
        props.eia_area_orig_ha = arredondar(areaOrigHa, 4);
        /* Percentual da área de influência, LIMITADO a 100.
         *
         * O recorte é numérico: a soma dos pedaços pode passar da área da AI por alguns
         * décimos de por cento (arte da biblioteca de recorte e do arredondamento das
         * coordenadas). Medido numa das camadas novas do estado, um pedaço saiu com 101,83%
         * da AI. Pedaço de um todo não pode ser maior que o todo — e um "101,83%" na tabela
         * e no relatório de um EIA é o tipo de número que faz o analista desconfiar do
         * programa inteiro. O limite é explícito aqui, com esta razão escrita. */
        const pct = areaAiHa > 0 ? areaHa / areaAiHa * 100 : 0;
        props.eia_pct_ai = arredondar(Math.min(100, pct), 4);
        props.eia_pct_feicao = areaOrigHa > 0 ? arredondar(Math.min(100, areaHa / areaOrigHa * 100), 2) : 0;
        props.eia_compr_km = comprimentoMetros(rf.geometry) / 1000;
        props.eia_metodo = operacao;
        props.eia_fonte = camada.fonte || '';
        props.eia_data_ref = camada.data_ref || '';
        if (props.eia_compr_km > 0) props.eia_compr_km = arredondar(props.eia_compr_km, 4);
        resultado.push({ type: 'Feature', properties: props, geometry: rf.geometry });
        recortadas++;
        divididas += Math.max(0, contarPartes(rf.geometry) - antes);
      }
    }

    const relatorio = {
      ai: area.sigla || area.nome || area.id,
      ai_nome: area.nome || area.id,
      ai_area_ha: arredondar(areaAiHa, 4),
      camada: camada.id || camada.nome,
      camada_nome: camada.nome || camada.id,
      meio: camada.meio || '',
      operacao: operacao,
      feicoes_na_camada: features.length,
      feicoes_candidatas: candidatas,
      feicoes_resultado: resultado.length,
      feicoes_divididas: divididas,
      feicoes_descartadas: descartadas,
      geometrias_invalidas: invalidas,
      area_total_ha: arredondar(resultado.reduce((s, f) => s + f.properties.eia_area_ha, 0), 4),
      comprimento_total_km: arredondar(resultado.reduce((s, f) => s + (f.properties.eia_compr_km || 0), 0), 4),
      ms: Date.now() - inicio,
    };

    return {
      features: resultado,
      relatorio: relatorio,
      geojson: {
        type: 'FeatureCollection',
        name: (area.sigla || area.id) + '_' + (camada.id || camada.nome),
        crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
        features: resultado,
        metadados: {
          gerado_por: 'Portal EIA/RIMA',
          gerado_em: new Date().toISOString(),
          area_influencia: area.nome || area.id,
          camada: camada.nome || camada.id,
          operacao: operacao,
          area_ai_ha: relatorio.ai_area_ha,
          fonte: camada.fonte || '',
          data_ref: camada.data_ref || '',
          colunas: COLUNAS,
        },
      },
    };
  }

  /**
   * Roda a matriz completa (todas as áreas × todas as camadas).
   * @param {Array} areas
   * @param {Array} camadas  cada uma com { id, nome, meio, geojson, ... }
   * @param {object} opcoes   { operacao, apenas, progresso(fn) }
   */
  function recortarTudo(areas, camadas, opcoes) {
    const o = opcoes || {};
    const resultados = [];
    const relatorios = [];
    const erros = [];
    let feito = 0;
    const total = areas.length * camadas.length;

    for (const area of areas) {
      for (const camada of camadas) {
        if (o.apenas && o.apenas.indexOf(camada.id) < 0) continue;
        try {
          const r = recortarCamada(camada, area, o);
          resultados.push({
            id: (area.sigla || area.id) + '|' + camada.id,
            area: area, camada: camada,
            geojson: r.geojson, features: r.features,
            relatorio: r.relatorio,
          });
          relatorios.push(r.relatorio);
        } catch (e) {
          erros.push({ area: area.nome || area.id, camada: camada.nome || camada.id, erro: e.message });
        }
        feito++;
        if (typeof o.progresso === 'function') o.progresso(feito, total, area, camada);
      }
    }

    return {
      resultados: resultados,
      relatorios: relatorios,
      erros: erros,
      resumo: resumir(relatorios, erros, areas, camadas),
    };
  }

  function resumir(relatorios, erros, areas, camadas) {
    const totalHa = relatorios.reduce((s, r) => s + r.area_total_ha, 0);
    const totalFeicoes = relatorios.reduce((s, r) => s + r.feicoes_resultado, 0);
    return {
      areas: areas.length,
      camadas: camadas.length,
      combinacoes: relatorios.length,
      erros: erros.length,
      feicoes_resultado: totalFeicoes,
      area_total_ha: arredondar(totalHa, 2),
      ms: relatorios.reduce((s, r) => s + r.ms, 0),
    };
  }

  /**
   * Todos os anéis (externos e furos) de uma geometria, achatados numa lista.
   *
   * Aceita Feature, FeatureCollection e GeometryCollection — porque a área de influência
   * carregada de arquivo é um FeatureCollection, e a de vários polígonos o portal guarda
   * como GeometryCollection. Antes esta função só entendia Polygon e MultiPolygon e
   * devolvia lista VAZIA para o resto: o recorte de uma área vinda de arquivo com vários
   * polígonos parava em "não tem polígono válido", mesmo com o polígono desenhado na tela.
   *
   * Delega para `math.aneisDe`, que é quem sabe percorrer coleções — uma regra só.
   */
  function aneisDaGeometria(geometria) {
    const partes = math.aneisDe(geometria);
    const saida = [];
    for (const parte of partes) for (const anel of parte) saida.push(anel);
    return saida;
  }

  function contarPartes(geometria) {
    if (!geometria) return 0;
    if (geometria.type === 'FeatureCollection') {
      return (geometria.features || []).reduce(function (s, f) { return s + contarPartes(f); }, 0);
    }
    if (geometria.type === 'Feature') return contarPartes(geometria.geometry);
    if (geometria.type === 'GeometryCollection') {
      return (geometria.geometries || []).reduce(function (s, g) { return s + contarPartes(g); }, 0);
    }
    if (geometria.type === 'Polygon') return 1;
    if (geometria.type === 'MultiPolygon') return geometria.coordinates.length;
    if (geometria.type === 'LineString') return 1;
    if (geometria.type === 'MultiLineString') return geometria.coordinates.length;
    return 1;
  }

  function simplificarGeometria(geometria, tolerancia) {
    const mapa = (c) => {
      if (typeof c[0] === 'number') return c;
      if (typeof c[0][0] === 'number') {
        const s = vetorial.simplificar(c, tolerancia);
        return s.length >= 4 ? s : c;
      }
      return c.map(mapa);
    };
    return { type: geometria.type, coordinates: mapa(geometria.coordinates) };
  }

  function arredondar(v, casas) {
    const f = Math.pow(10, casas);
    return Math.round((Number(v) + Number.EPSILON) * f) / f;
  }

  return {
    COLUNAS: COLUNAS,
    areaHectares: areaHectares,
    comprimentoMetros: comprimentoMetros,
    recortarCamada: recortarCamada,
    recortarTudo: recortarTudo,
    aneisDaGeometria: aneisDaGeometria,
    arredondar: arredondar,
  };
});
