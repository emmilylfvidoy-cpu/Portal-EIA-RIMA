'use strict';
/* Roda todas as verificaÃ§Ãµes do portal no MESMO processo.
 * Uso: node tools/verificar.js [n_oraculo]
 *
 * Sem `child_process`: o sandbox do Windows bloqueia captura por pipe e o relatÃ³rio
 * sairia vazio. Cada suÃ­te exporta `executar()` e Ã© chamada aqui diretamente.
 * As suÃ­tes tambÃ©m continuam rodando sozinhas (`node tools/verificacoes/x.js`). */
const path = require('path');
const raiz = path.resolve(__dirname);
const oraculoN = process.argv[2] || 500;

const suites = [
  // Cada entrada é [nome, arquivo]. A entrada da suíte de serviços chegou aqui com um terceiro
  // elemento por erro de script, e como o laço lê só os dois primeiros, ela NUNCA rodou.
  ['math', path.join(raiz, 'verificacoes', 'verificar_math.js')],
  ['servicos', path.join(raiz, 'verificacoes', 'verificar_servicos.js')],
  ['areas', path.join(raiz, 'verificacoes', 'verificar_recorte_areas.js')],
  ['consulta', path.join(raiz, 'verificacoes', 'verificar_consulta.js')],
  ['docx', path.join(raiz, 'verificacoes', 'verificar_docx.js')],
  ['vetorial', path.join(raiz, 'verificacoes', 'verificar_vetorial.js')],
  ['formatos', path.join(raiz, 'verificacoes', 'verificar_formatos.js')],
  ['saidas', path.join(raiz, 'verificacoes', 'verificar_saidas.js')],
  ['importador', path.join(raiz, 'verificacoes', 'verificar_importador.js')],
  ['simbologia', path.join(raiz, 'verificacoes', 'verificar_simbologia.js')],
  ['referencias', path.join(raiz, 'verificacoes', 'verificar_referencias.js')],
  ['legenda', path.join(raiz, 'verificacoes', 'verificar_legenda.js')],
  ['agrupamento', path.join(raiz, 'verificacoes', 'verificar_agrupamento.js')],
  ['sintaxe', path.join(raiz, 'verificacoes', 'verificar_sintaxe.js')],
  ['integracao', path.join(raiz, 'verificacoes', 'verificar_integracao.js')],
  ['fumaca', path.join(raiz, 'verificacoes', 'verificar_fumaca.js')],
  ['oraculo', path.join(raiz, 'verificacoes', 'verificar_oraculo.js')],
];

(async function () {
  let falhou = 0;
  for (const [nome, arquivo] of suites) {
    console.log('\n===== ' + nome + ' =====');
    delete require.cache[require.resolve(arquivo)];
    try {
      const suite = require(arquivo);
      if (typeof suite.executar === 'function') {
        const r = await suite.executar(oraculoN);
        if (r !== 0) falhou++;
      } else {
        console.log('(suÃ­te sem executar(); rode o arquivo direto)');
      }
    } catch (e) {
      falhou++;
      console.log('ERRO: ' + (e && e.message));
    }
  }
  console.log('\n' + (falhou ? 'HOUVE FALHA' : 'VERIFICACOES OK'));
  process.exit(falhou ? 1 : 0);
})();

