'use strict';
/* ============================================================================
 * tabela.js — da lista de feições recortadas para a tabela que vai ao EIA
 *
 * Três coisas que este módulo garante e que, na prática, são onde o número se
 * perde: (1) a soma das classes dentro de uma área de influência FECHA com a área
 * da própria AI; (2) feição sem classe não desaparece (virou "Sem classe" no
 * recorte, e aqui é contada como tal); (3) a área em hectare é a mesma que está
 * na coluna da feição, não uma segunda conta.
 * ========================================================================== */

(function (raiz, fabrica) {
  const node = typeof module === 'object' && module.exports;
  const math = node ? require('./math.js') : raiz.EIA.math;
  const api = fabrica(math);
  if (node) module.exports = api;
  if (raiz) {
    raiz.EIA = raiz.EIA || {};
    raiz.EIA.tabela = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (math) {

  /** Separador do agrupamento por mais de uma coluna. */
  const SEPARADOR = ' · ';

  /**
   * Agrupamento ESCOLHIDO PELO USUÁRIO.
   *
   * O recorte já guarda TODOS os atributos originais de cada feição, então trocar o
   * agrupamento não exige recortar de novo: a chave é recalculada na hora, a partir das
   * colunas pedidas. Agrupar por "NOME_UNIDA + LITOTIPO1" é uma decisão de análise — e a
   * análise muda de pergunta no meio do trabalho ("e se eu abrir por litotipo?"). Ter de
   * reeditar o catálogo e reimportar a camada para isso seria inviável.
   *
   * O mapa NÃO muda: a cor continua vinda do campo de classe do catálogo, que é a
   * definição cartográfica da camada (as cores do ArcGIS, no caso da Geologia). O
   * agrupamento é da TABELA, do GRÁFICO e do RELATÓRIO.
   */
  function textoDe(valor) {
    if (valor === null || valor === undefined) return '(vazio)';
    const t = String(valor).trim();
    return t === '' ? '(vazio)' : t;
  }

  /** Chave de agrupamento de uma feição, dadas as colunas pedidas. */
  function chaveDoGrupo(props, colunas, campoPadrao) {
    if (!colunas || !colunas.length) {
      if (props.eia_classe !== undefined && props.eia_classe !== null) return String(props.eia_classe);
      return campoPadrao ? textoDe(props[campoPadrao]) : 'Sem classe';
    }
    return colunas.map((c) => textoDe(props[c])).join(SEPARADOR);
  }

  /**
   * Colunas que o usuário pode escolher para agrupar, POR CAMADA.
   *
   * Por camada, e não uma lista única, porque camada de geologia tem SIGLA_UNID e
   * LITOTIPO1 e camada de uso do solo tem CLASSE — oferecer a união das duas faria o
   * usuário escolher coluna que não existe no dado que está olhando.
   */
  function colunasDisponiveis(resultados) {
    const porCamada = new Map();
    for (const r of resultados) {
      const id = r.camada.id;
      if (porCamada.has(id)) continue;
      // a ordem do catálogo é a ordem que o analista definiu, com a classe primeiro
      let colunas = (r.camada.campos || []).map((c) => c.nome).filter((n) => n && !/^eia_/.test(n));
      if (!colunas.length) {
        const vistos = new Set();
        for (const f of r.features) {
          for (const k of Object.keys(f.properties || {})) if (!/^eia_/.test(k)) vistos.add(k);
        }
        colunas = Array.from(vistos).sort();
      }
      porCamada.set(id, {
        id: id,
        nome: r.camada.nome,
        meio: r.camada.meio || '',
        campo_padrao: r.camada.campo_classe || null,
        padrao_texto: (r.camada.campos || []).find((c) => c.nome === r.camada.campo_classe),
        colunas: colunas,
      });
    }
    return Array.from(porCamada.values());
  }

  /** Classe do catálogo que domina um grupo (é a que dá a cor da barra). */
  function dominante(mapaDeAreas) {
    let melhor = null;
    let maior = -1;
    for (const [classe, area] of mapaDeAreas.entries()) {
      if (area > maior) { maior = area; melhor = classe; }
    }
    return melhor;
  }

  /**
   * Tabela por classe (ou por agrupamento escolhido) dentro de cada área de influência.
   * @param {Array} resultados saída de recorte.recortarTudo
   * @param {object} opcoes { apenasMeio, agrupamento: { idDaCamada: [colunas] } }
   */
  function porClasse(resultados, opcoes) {
    const o = opcoes || {};
    const agrup = o.agrupamento || {};
    const linhas = [];
    for (const r of resultados) {
      if (o.apenasMeio && r.camada.meio !== o.apenasMeio) continue;
      const colunas = agrup[r.camada.id] || null;
      const grupos = new Map();
      let somaAreas = 0, somaComprimento = 0;
      for (const f of r.features) {
        const p = f.properties;
        const chave = chaveDoGrupo(p, colunas, r.camada.campo_classe);
        let g = grupos.get(chave);
        if (!g) {
          g = { classe: chave, area: 0, n: 0, comprimento: 0, base: new Map() };
          grupos.set(chave, g);
        }
        const area = Number(p.eia_area_ha) || 0;
        g.area += area;
        g.comprimento += Number(p.eia_compr_km) || 0;
        g.n += 1;
        g.base.set(p.eia_classe || 'Sem classe', (g.base.get(p.eia_classe || 'Sem classe') || 0) + area);
        somaAreas += area;
        somaComprimento += Number(p.eia_compr_km) || 0;
      }
      const areaAiHa = r.relatorio.ai_area_ha || 0;
      for (const g of grupos.values()) {
        linhas.push({
          ai: r.relatorio.ai,
          ai_nome: r.relatorio.ai_nome,
          meio: r.camada.meio || '',
          camada: r.camada.id,
          camada_nome: r.camada.nome,
          classe: g.classe,
          classe_base: dominante(g.base),
          grupo_por: colunas ? colunas.join(' + ') : (r.camada.campo_classe || ''),
          feicoes: g.n,
          area_ha: arredondar(g.area, 4),
          comprimento_km: arredondar(g.comprimento, 4),
          /* SEM limite em 100, de propósito: aqui é SOMA de classes, e os polígonos da camada
         * de origem se sobrepõem (associação de solos, unidade geológica sobre unidade
         * geológica). A soma pode passar da área da AI legitimamente — limitar esconderia um
         * número verdadeiro. O limite de 100 existe só POR FEIÇÃO, no recorte, onde um pedaço
         * não pode ser maior que o todo. */
        pct_ai: areaAiHa > 0 ? arredondar(g.area / areaAiHa * 100, 3) : 0,
          pct_camada: somaAreas > 0 ? arredondar(g.area / somaAreas * 100, 3) : 0,
          fonte: r.camada.fonte || '',
          data_ref: r.camada.data_ref || '',
        });
      }
      void somaComprimento;
    }
    linhas.sort((a, b) => (a.ai + a.camada + b.classe).localeCompare(b.ai + b.camada + a.classe));
    return linhas;
  }

  /** Tabela resumida: uma linha por área de influência × camada. */
  function porAreaCamada(resultados) {
    return resultados.map((r) => ({
      ai: r.relatorio.ai,
      ai_nome: r.relatorio.ai_nome,
      meio: r.camada.meio || '',
      camada: r.camada.id,
      camada_nome: r.camada.nome,
      feicoes: r.relatorio.feicoes_resultado,
      area_ha: r.relatorio.area_total_ha,
      comprimento_km: r.relatorio.comprimento_total_km,
      area_ai_ha: r.relatorio.ai_area_ha,
      pct_ai: r.relatorio.ai_area_ha > 0
        ? arredondar(r.relatorio.area_total_ha / r.relatorio.ai_area_ha * 100, 3) : 0,
      operacao: r.relatorio.operacao,
    }));
  }

  /**
   * Tabela de atributos completa (todas as feições recortadas), com as colunas
   * pedidas primeiro e as originais depois.
   */
  function atributos(resultados, opcoes) {
    const o = opcoes || {};
    const fixas = o.colunasFixas || [
      'eia_ai', 'eia_meio', 'eia_camada', 'eia_classe', 'eia_area_ha',
      'eia_pct_ai', 'eia_pct_feicao', 'eia_area_orig_ha', 'eia_compr_km', 'eia_metodo',
    ];
    const linhas = [];
    const originais = new Set();
    for (const r of resultados) {
      for (const f of r.features) {
        for (const k of Object.keys(f.properties || {})) {
          if (fixas.indexOf(k) < 0) originais.add(k);
        }
      }
    }
    const colunasOriginais = Array.from(originais).filter((k) => !/^eia_/.test(k)).sort();
    const colunas = fixas.concat(colunasOriginais);
    for (const r of resultados) {
      for (const f of r.features) {
        const p = f.properties || {};
        linhas.push(colunas.map((c) => (p[c] === undefined ? '' : p[c])));
      }
    }
    return {
      colunas: colunas.map((c) => ({ campo: c, rotulo: ROTULOS[c] || c })),
      linhas: linhas,
    };
  }

  const ROTULOS = {
    eia_ai: 'Área de influência',
    eia_meio: 'Meio',
    eia_camada: 'Camada',
    eia_classe: 'Classe',
    eia_area_ha: 'Área (ha)',
    eia_pct_ai: '% da AI',
    eia_pct_feicao: '% da feição',
    eia_area_orig_ha: 'Área original (ha)',
    eia_compr_km: 'Comprimento (km)',
    eia_metodo: 'Método',
    eia_fonte: 'Fonte',
    eia_data_ref: 'Data de referência',
    ai: 'AI',
    ai_nome: 'Área de influência',
    meio: 'Meio',
    camada: 'Camada',
    camada_nome: 'Nome da camada',
    classe: 'Classe',
    classe_base: 'Classe do mapa',
    grupo_por: 'Agrupado por',
    colunas_grupo: 'Agrupado por',
    feicoes: 'Feições',
    area_ha: 'Área (ha)',
    pct_ai: '% da AI',
    pct_camada: '% da camada',
    comprimento_km: 'Comprimento (km)',
    area_ai_ha: 'Área da AI (ha)',
    operacao: 'Operação',
    fonte: 'Fonte',
    data_ref: 'Data de referência',
  };

  /**
   * Conferência de fechamento: a soma das classes de cada camada dentro de cada AI
   * não pode passar da área da AI. Diferença acima de 0,5% vira aviso na tela —
   * é o sintoma de área de influência sobreposta ou de camada duplicada.
   */
  function conferirFechamento(resultados) {
    const porAi = new Map();
    for (const r of resultados) {
      const chave = r.relatorio.ai;
      let item = porAi.get(chave);
      if (!item) { item = { ai: chave, ai_nome: r.relatorio.ai_nome, area_ai_ha: r.relatorio.ai_area_ha, somas: [] }; porAi.set(chave, item); }
      item.somas.push({ camada: r.camada.nome, area: r.relatorio.area_total_ha });
    }
    const avisos = [];
    for (const item of porAi.values()) {
      for (const s of item.somas) {
        if (item.area_ai_ha > 0 && s.area > item.area_ai_ha * 1.005) {
          avisos.push({
            ai: item.ai_nome,
            camada: s.camada,
            area: s.area,
            area_ai: item.area_ai_ha,
            mensagem: 'A camada "' + s.camada + '" ocupa ' + math.num(s.area, 2)
              + ' ha na ' + item.ai_nome + ', mais que a própria área de influência ('
              + math.num(item.area_ai_ha, 2) + ' ha). Confira sobreposição de feições ou de áreas.',
          });
        }
      }
    }
    return avisos;
  }

  /** Grades para os gráficos: uma por camada, com classes ordenadas por área. */
  function dadosParaGraficos(resultados, opcoes) {
    const o = opcoes || {};
    const agrup = o.agrupamento || {};
    const porAiCamada = new Map();
    for (const r of resultados) {
      if (o.apenasMeio && r.camada.meio !== o.apenasMeio) continue;
      const colunas = agrup[r.camada.id] || null;
      const chave = r.relatorio.ai + '|' + r.camada.id;
      let item = porAiCamada.get(chave);
      if (!item) {
        item = {
          ai: r.relatorio.ai, camada: r.camada.nome, camada_id: r.camada.id, meio: r.camada.meio,
          classes: new Map(), areaAi: r.relatorio.ai_area_ha,
          grupo_por: colunas ? colunas.join(' + ') : (r.camada.campo_classe || ''),
        };
        porAiCamada.set(chave, item);
      }
      for (const f of r.features) {
        const p = f.properties;
        const c = chaveDoGrupo(p, colunas, r.camada.campo_classe);
        let g = item.classes.get(c);
        if (!g) { g = { valor: 0, base: new Map() }; item.classes.set(c, g); }
        const area = Number(p.eia_area_ha) || 0;
        g.valor += area;
        const cb = p.eia_classe || 'Sem classe';
        g.base.set(cb, (g.base.get(cb) || 0) + area);
      }
    }
    const graficos = [];
    for (const item of porAiCamada.values()) {
      const classes = Array.from(item.classes.entries())
        .map(([rotulo, g]) => ({
          rotulo: rotulo,
          valor: arredondar(g.valor, 3),
          // a classe do catálogo dominante no grupo: é ela que dá a cor da barra, para o
          // gráfico ler com a mesma cor do mapa
          base: dominante(g.base),
        }))
        .sort((a, b) => b.valor - a.valor);
      if (!classes.length) continue;
      graficos.push({
        ai: item.ai, camada: item.camada, camada_id: item.camada_id, meio: item.meio,
        grupo_por: item.grupo_por, area_ai_ha: item.areaAi,
        total_ha: arredondar(classes.reduce((s, c) => s + c.valor, 0), 3),
        classes: classes,
      });
    }
    return graficos;
  }

  function arredondar(v, casas) {
    const f = Math.pow(10, casas);
    return Math.round((Number(v) + Number.EPSILON) * f) / f;
  }

  return {
    ROTULOS: ROTULOS,
    SEPARADOR: SEPARADOR,
    chaveDoGrupo: chaveDoGrupo,
    colunasDisponiveis: colunasDisponiveis,
    porClasse: porClasse,
    porAreaCamada: porAreaCamada,
    atributos: atributos,
    conferirFechamento: conferirFechamento,
    dadosParaGraficos: dadosParaGraficos,
    arredondar: arredondar,
  };
});
