'use strict';
/* ============================================================================
 * verificar_consulta.js — a ferramenta "i" (clicar na camada e ver os atributos)
 *
 * O que este teste protege:
 *  - FURO NÃO É DENTRO. A função pronta do vetorial responde "sim" para ponto em qualquer anel;
 *    para consultar isso está errado, e é o erro mais fácil de cometer aqui.
 *  - LINHA E PONTO USAM TOLERÂNCIA: ninguém acerta o pixel de uma linha; polígono não usa
 *    tolerância nenhuma (ou caiu dentro, ou não caiu).
 *  - CAMADA DESLIGADA NÃO É CONSULTADA: a lista recebida é a das camadas ligadas.
 *  - CLIQUE DENTRO DE MUITOS FRAGMENTOS NÃO VIRA MIL BALÕES (limite por camada, com o total).
 *
 * Uso: node tools/verificacoes/verificar_consulta.js
 * ========================================================================== */
function executar() {
  const path = require('path');
  const raiz = path.resolve(__dirname, '..', '..');
  global.EIA = {
    math: require(path.join(raiz, 'js', 'math.js')),
    vetorial: require(path.join(raiz, 'js', 'vetorial.js')),
  };
  const consulta = require(path.join(raiz, 'js', 'consulta.js'));

  let falhas = 0, testes = 0;
  function ok(nome, condicao, detalhe) {
    testes++;
    if (condicao) console.log('  ok  ' + nome + (detalhe ? '  [' + detalhe + ']' : ''));
    else { falhas++; console.log('  FALHA ' + nome + (detalhe ? '  [' + detalhe + ']' : '')); }
  }

  const quadrado = (lon, lat, lado) => [[lon, lat], [lon + lado, lat], [lon + lado, lat + lado], [lon, lat + lado], [lon, lat]];
  const camada = (id, nome, geometrias, campo_classe) => ({
    id: id, nome: nome, campo_classe: campo_classe,
    geojson: {
      type: 'FeatureCollection',
      features: geometrias.map((g, i) => ({ type: 'Feature', properties: { id: i, classe: 'Classe ' + i }, geometry: g })),
    },
  });

  // ---- polígono COM FURO: o furo está no meio do quadrado
  const comFuro = camada('furo', 'Com furo', [{
    type: 'Polygon',
    coordinates: [
      quadrado(-45.00, -23.00, 0.10),                 // externo: -45,00 a -44,90 / -23,00 a -22,90
      quadrado(-44.97, -22.97, 0.04),                 // furo:   -44,97 a -44,93 / -22,97 a -22,93
    ],
  }], 'classe');

  // ---- MultiPolygon: duas partes distantes
  const multi = camada('multi', 'Duas partes', [{
    type: 'MultiPolygon',
    coordinates: [[quadrado(-45.00, -23.00, 0.02)], [quadrado(-44.50, -22.50, 0.02)]],
  }], 'classe');

  // ---- linha e ponto
  const linha = camada('linha', 'Uma linha', [{
    type: 'LineString', coordinates: [[-45.00, -23.00], [-44.90, -23.00]],
  }], 'classe');
  const ponto = camada('ponto', 'Um ponto', [{ type: 'Point', coordinates: [-45.00, -23.00] }], 'classe');

  console.log('\n== polígono: dentro é dentro, furo é FORA ==');
  {
    const dentro = consulta.encontrar([comFuro], [-44.99, -22.99]);
    ok('clique dentro do polígono acha a feição', dentro.length === 1 && dentro[0].feicoes.length === 1);
    const noFuro = consulta.encontrar([comFuro], [-44.95, -22.95]);
    ok('clique NO FURO não acha nada (a feição é o polígono com o furo)',
      noFuro.length === 0, noFuro.length + ' camada(s)');
    const fora = consulta.encontrar([comFuro], [-45.50, -23.50]);
    ok('clique longe não acha nada', fora.length === 0);
  }

  console.log('\n== MultiPolygon: as duas partes valem ==');
  {
    const p1 = consulta.encontrar([multi], [-44.99, -22.99]);
    const p2 = consulta.encontrar([multi], [-44.49, -22.49]);
    ok('acha na primeira parte', p1.length === 1);
    ok('acha na segunda parte também', p2.length === 1);
  }

  console.log('\n== linha e ponto: com tolerância, porque clique não é pixel ==');
  {
    const naLinha = consulta.encontrar([linha], [-44.95, -23.00]);
    ok('clique em cima da linha acha', naLinha.length === 1);
    const perto = consulta.encontrar([linha], [-44.95, -23.0004]);   // ~44 m
    ok('clique a ~44 m da linha ainda acha', perto.length === 1);
    const longe = consulta.encontrar([linha], [-44.95, -23.01]);     // ~1,1 km
    ok('clique a ~1,1 km da linha não acha', longe.length === 0);
    const noPonto = consulta.encontrar([ponto], [-45.0003, -23.0003]);
    ok('clique perto do ponto acha', noPonto.length === 1);
    const foraDoPonto = consulta.encontrar([ponto], [-45.01, -23.01]);
    ok('clique longe do ponto não acha', foraDoPonto.length === 0);
  }

  console.log('\n== o que a lista devolve ==');
  {
    // o ponto precisa estar DENTRO do polígono (que começa em -45,00 / -23,00) e perto do ponto
    const duas = consulta.encontrar([comFuro, ponto], [-44.9998, -22.9998]);
    ok('acha em mais de uma camada ao mesmo tempo', duas.length === 2,
      duas.map((x) => x.camada.nome).join(' + '));
    ok('camada vazia (sem geojson) é ignorada', consulta.encontrar([{ id: 'x', nome: 'X' }], [-45, -23]).length === 0);
    ok('lista vazia não quebra', consulta.encontrar([], [-45, -23]).length === 0);
    ok('ponto inválido não quebra', consulta.encontrar([comFuro], [NaN, NaN]).length === 0);
  }

  console.log('\n== limite por camada (clique dentro de muitos fragmentos) ==');
  {
    // 10 fragmentos sobrepostos no mesmo lugar
    const muitos = camada('muitos', 'Muitos', Array.from({ length: 10 }, () => ({
      type: 'Polygon', coordinates: [quadrado(-45.00, -23.00, 0.05)],
    })), 'classe');
    const r = consulta.encontrar([muitos], [-44.98, -22.98]);
    ok('devolve no máximo o limite por camada', r[0].feicoes.length === consulta.MAX_POR_CAMADA,
      r[0].feicoes.length + ' de ' + r[0].total);
    ok('e informa o TOTAL encontrado', r[0].total === 10, String(r[0].total));
    const semLimite = consulta.encontrar([muitos], [-44.98, -22.98], { maxPorCamada: 99 });
    ok('o limite pode ser afrouxado', semLimite[0].feicoes.length === 10);
  }

  console.log('\n== rótulo e formatação dos valores ==');
  {
    const f = { properties: { classe: 'Argissolos', obs: 'texto' } };
    ok('rótulo usa o campo de classe da camada', consulta.rotulo(f, { campo_classe: 'classe' }) === 'Argissolos');
    ok('sem campo de classe, usa o primeiro texto', consulta.rotulo({ properties: { a: '', b: 'Achei' } }, {}) === 'Achei');
    ok('feição sem nada tem rótulo explícito', consulta.rotulo({ properties: {} }, {}) === '(sem rótulo)');
    ok('valor vazio vira travessão', consulta.formatarValor('') === '—' && consulta.formatarValor(null) === '—');
    ok('texto enorme é cortado', consulta.formatarValor('x'.repeat(500)).length <= 161);
  }

  console.log('\n' + (falhas ? 'FALHAS: ' + falhas + '/' + testes : 'TODOS OS ' + testes + ' TESTES PASSARAM'));
  return falhas ? 1 : 0;
}

module.exports = { executar };
if (require.main === module) process.exit(executar());
