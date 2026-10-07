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

  /**
   * Tabela por classe dentro de cada área de influência (a tabela principal do EIA).
   * @param {Array} resultados saída de recorte.recortarTudo
   */
  function porClasse(resultados, opcoes) {
    const o = opcoes || {};
    const linhas = [];
    for (const r of resultados) {
      if (o.apenasMeio && r.camada.meio !== o.apenasMeio) continue;
      const grupos = new Map();
      let somaAreas = 0, somaComprimento = 0;
      for (const f of r.features) {
        const p = f.properties;
        const chave = p.eia_classe || 'Sem classe';
        let g = grupos.get(chave);
        if (!g) { g = { classe: chave, area: 0, n: 0, comprimento: 0 }; grupos.set(chave, g); }
        g.area += Number(p.eia_area_ha) || 0;
        g.comprimento += Number(p.eia_compr_km) || 0;
        g.n += 1;
        somaAreas += Number(p.eia_area_ha) || 0;
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
          feicoes: g.n,
          area_ha: arredondar(g.area, 4),
          comprimento_km: arredondar(g.comprimento, 4),
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
    const porAiCamada = new Map();
    for (const r of resultados) {
      if (o.apenasMeio && r.camada.meio !== o.apenasMeio) continue;
      const chave = r.relatorio.ai + '|' + r.camada.id;
      let item = porAiCamada.get(chave);
      if (!item) {
        item = { ai: r.relatorio.ai, camada: r.camada.nome, meio: r.camada.meio, classes: new Map(), areaAi: r.relatorio.ai_area_ha };
        porAiCamada.set(chave, item);
      }
      for (const f of r.features) {
        const c = f.properties.eia_classe || 'Sem classe';
        item.classes.set(c, (item.classes.get(c) || 0) + (Number(f.properties.eia_area_ha) || 0));
      }
    }
    const graficos = [];
    for (const item of porAiCamada.values()) {
      const classes = Array.from(item.classes.entries())
        .map(([rotulo, valor]) => ({ rotulo: rotulo, valor: arredondar(valor, 3) }))
        .sort((a, b) => b.valor - a.valor);
      if (!classes.length) continue;
      graficos.push({
        ai: item.ai, camada: item.camada, meio: item.meio, area_ai_ha: item.areaAi,
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
    porClasse: porClasse,
    porAreaCamada: porAreaCamada,
    atributos: atributos,
    conferirFechamento: conferirFechamento,
    dadosParaGraficos: dadosParaGraficos,
    arredondar: arredondar,
  };
});
