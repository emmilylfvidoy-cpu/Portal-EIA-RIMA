'use strict';
/* Verificação do agrupamento escolhido pelo usuário.
 *
 * O que prova: agrupar por colunas escolhidas (inclusive combinadas, como
 * NOME_UNIDA + LITOTIPO1) muda a tabela, o gráfico e o relatório sem recortar de novo,
 * e SEM PERDER ÁREA — agrupar é repartir, então a soma das linhas tem de continuar igual
 * à soma das feições. É a invariante que pega erro de agrupamento. */
const path = require('path');
const raiz = path.resolve(__dirname, '..', '..');
const tabela = require(path.join(raiz, 'js', 'tabela.js'));
const relatorio = require(path.join(raiz, 'js', 'relatorio.js'));

let falhas = 0, testes = 0;
const ok = (nome, cond, det) => {
  testes++;
  if (cond) console.log('  ok  ' + nome + (det ? '  [' + det + ']' : ''));
  else { falhas++; console.log('  FALHA ' + nome + (det ? '  [' + det + ']' : '')); }
};

// --- resultado de recorte de mentira, com a forma exata da saída real
function feicao(sigla, nome, lito, area) {
  return {
    type: 'Feature',
    properties: {
      eia_ai: 'ADA', eia_meio: 'fisico', eia_camada: 'geologia', eia_classe: sigla,
      eia_area_ha: area, eia_compr_km: 0, eia_pct_ai: 1, eia_area_orig_ha: area, eia_metodo: 'intersecao',
      SIGLA_UNID: sigla, NOME_UNIDA: nome, LITOTIPO1: lito,
    },
    geometry: null,
  };
}

const resultados = [{
  camada: {
    id: 'geologia', nome: 'Geologia', meio: 'fisico', tipo: 'poligono',
    campo_classe: 'SIGLA_UNID', fonte: 'Litologia de SP',
    campos: [{ nome: 'SIGLA_UNID' }, { nome: 'NOME_UNIDA' }, { nome: 'LITOTIPO1' }],
    estilo: { cor: '#8a6d3b', cores: { P2i: '#a33f3f', NP3p: '#2f6b3a' } },
  },
  relatorio: { ai: 'ADA', ai_nome: 'Área de Influência Direta', ai_area_ha: 100, operacao: 'intersecao', feicoes_resultado: 4, area_total_ha: 100, comprimento_total_km: 0 },
  features: [
    feicao('P2i', 'Granito', 'biotita granito', 30),
    feicao('P2i', 'Granito', 'muscovita granito', 10),
    feicao('NP3p', 'Xisto', 'xisto', 40),
    feicao('NP3p', 'Xisto', '', 20),
  ],
}];

const somaTotal = 100;

console.log('\n== Colunas disponíveis por camada ==');
{
  const cols = tabela.colunasDisponiveis(resultados);
  ok('uma entrada por camada', cols.length === 1, cols.length + '');
  ok('a camada é a esperada', cols[0].id === 'geologia');
  ok('campo padrão é o do catálogo', cols[0].campo_padrao === 'SIGLA_UNID', String(cols[0].campo_padrao));
  ok('colunas vêm na ordem do catálogo', cols[0].colunas.join(',') === 'SIGLA_UNID,NOME_UNIDA,LITOTIPO1',
    cols[0].colunas.join(','));
  ok('colunas eia_* não são oferecidas', !cols[0].colunas.some((c) => /^eia_/.test(c)));
}

console.log('\n== Agrupamento padrão (sem escolha) não mudou ==');
{
  const linhas = tabela.porClasse(resultados);
  ok('2 linhas (uma por unidade do catálogo)', linhas.length === 2, linhas.length + '');
  ok('classes são as do catálogo', linhas.map((l) => l.classe).sort().join(',') === 'NP3p,P2i',
    linhas.map((l) => l.classe).sort().join(','));
  const soma = linhas.reduce((s, l) => s + l.area_ha, 0);
  ok('soma preservada', Math.abs(soma - somaTotal) < 1e-9, soma + ' ha');
}

console.log('\n== Agrupar por UMA coluna escolhida ==');
{
  const linhas = tabela.porClasse(resultados, { agrupamento: { geologia: ['NOME_UNIDA'] } });
  ok('2 grupos (Granito, Xisto)', linhas.length === 2, linhas.length + '');
  ok('rótulo é o valor da coluna', linhas.map((l) => l.classe).sort().join(',') === 'Granito,Xisto',
    linhas.map((l) => l.classe).join(','));
  const g = linhas.find((l) => l.classe === 'Granito');
  ok('área somada dentro do grupo', g.area_ha === 40, g.area_ha + ' ha');
  ok('feições contadas dentro do grupo', g.feicoes === 2, g.feicoes + '');
  ok('a classe do mapa (para a cor) é a dominante', g.classe_base === 'P2i', String(g.classe_base));
  ok('registra por que coluna agrupou', g.grupo_por === 'NOME_UNIDA', String(g.grupo_por));
  const soma = linhas.reduce((s, l) => s + l.area_ha, 0);
  ok('soma preservada no agrupamento por 1 coluna', Math.abs(soma - somaTotal) < 1e-9, soma + ' ha');
}

console.log('\n== Agrupar por DUAS colunas (o caso pedido) ==');
{
  const linhas = tabela.porClasse(resultados, { agrupamento: { geologia: ['NOME_UNIDA', 'LITOTIPO1'] } });
  // 4 combinações na massa: Granito·biotita, Granito·muscovita, Xisto·xisto, Xisto·(vazio)
  ok('4 grupos (combinações distintas)', linhas.length === 4, linhas.length + ': ' + linhas.map((l) => l.classe).join(' | '));
  ok('rótulo combina as duas colunas com separador',
    linhas.some((l) => l.classe === 'Granito' + tabela.SEPARADOR + 'biotita granito'),
    linhas.map((l) => l.classe).join(' | '));
  ok('valor vazio vira (vazio), não some',
    linhas.some((l) => l.classe === 'Xisto' + tabela.SEPARADOR + '(vazio)'),
    linhas.map((l) => l.classe).join(' | '));
  ok('grupo registra as duas colunas', linhas[0].grupo_por === 'NOME_UNIDA + LITOTIPO1', linhas[0].grupo_por);
  const soma = linhas.reduce((s, l) => s + l.area_ha, 0);
  ok('soma preservada no agrupamento por 2 colunas', Math.abs(soma - somaTotal) < 1e-9, soma + ' ha');
  const granito = linhas.find((l) => l.classe.indexOf('Granito') === 0 && l.classe.indexOf('biotita') > 0);
  ok('grupo mais fino tem a área só dele', granito.area_ha === 30, granito.area_ha + ' ha');
}

console.log('\n== Agrupamento vale para os gráficos ==');
{
  const g = tabela.dadosParaGraficos(resultados, { agrupamento: { geologia: ['NOME_UNIDA', 'LITOTIPO1'] } });
  ok('um gráfico', g.length === 1, g.length + '');
  ok('4 fatias', g[0].classes.length === 4, g[0].classes.length + '');
  ok('gráfico registra o agrupamento', g[0].grupo_por === 'NOME_UNIDA + LITOTIPO1', g[0].grupo_por);
  ok('cada fatia traz a classe do mapa (cor)', g[0].classes.every((c) => !!c.base),
    g[0].classes.map((c) => c.base).join(','));
  ok('total do gráfico é a área total', Math.abs(g[0].total_ha - somaTotal) < 1e-9, g[0].total_ha + ' ha');
  ok('ordenado por área decrescente', g[0].classes[0].valor >= g[0].classes[1].valor,
    g[0].classes.map((c) => c.valor).join(' >= '));
}

console.log('\n== Agrupamento aparece no relatório ==');
{
  const sem = relatorio.redigir(resultados, { nome: 'Teste' });
  const texto1 = relatorio.textoSimples(sem);
  ok('sem agrupamento: texto diz que usa o campo do catálogo',
    /campo de classe definido para cada camada/.test(texto1));

  const com = relatorio.redigir(resultados, { nome: 'Teste' }, { agrupamento: { geologia: ['NOME_UNIDA', 'LITOTIPO1'] } });
  const texto2 = relatorio.textoSimples(com);
  ok('com agrupamento: o texto DECLARA as colunas',
    /NOME_UNIDA \+ LITOTIPO1/.test(texto2),
    'o número da tabela depende do agrupamento; sem declarar, o leitor não sabe a que pergunta ele responde');
  ok('texto avisa que os totais por AI não mudam', /totais por área de influência não mudam/.test(texto2));
  ok('texto avisa o que muda', /o que muda é como as feições são somadas/.test(texto2));
}

console.log('\n== Casos de borda ==');
{
  const semClasse = tabela.porClasse([{
    camada: { id: 'x', nome: 'X', meio: 'fisico', campo_classe: null, campos: [{ nome: 'A' }] },
    relatorio: { ai: 'ADA', ai_nome: 'ADA', ai_area_ha: 10, feicoes_resultado: 1, area_total_ha: 5, comprimento_total_km: 0 },
    features: [{ properties: { eia_classe: 'Sem classe', eia_area_ha: 5, A: 'v' } }],
  }], { agrupamento: { x: ['A'] } });
  ok('camada sem campo de classe aceita agrupamento escolhido', semClasse.length === 1 && semClasse[0].classe === 'v',
    JSON.stringify(semClasse.map((l) => l.classe)));

  const colunaInexistente = tabela.porClasse(resultados, { agrupamento: { geologia: ['NAO_EXISTE'] } });
  ok('coluna inexistente agrupa em (vazio), não quebra',
    colunaInexistente.length === 1 && colunaInexistente[0].classe === '(vazio)',
    JSON.stringify(colunaInexistente.map((l) => l.classe)));

  const vazio = tabela.porClasse(resultados, { agrupamento: { geologia: [] } });
  ok('lista de colunas vazia volta ao padrão do catálogo', vazio.length === 2, vazio.length + '');
}

console.log('\n' + (falhas ? 'FALHAS: ' + falhas + '/' + testes : 'TODOS OS ' + testes + ' TESTES PASSARAM'));
