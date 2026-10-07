'use strict';
/* Verificação da quilometragem: leitura do km digitado e localização na camada.
 * Roda no Node, sem navegador. Uso: node tools/verificacoes/verificar_km.js */
function executar() {
  const path = require('path');
  const raiz = path.resolve(__dirname, '..', '..');
  const km = require(path.join(raiz, 'js', 'km.js'));
  const math = require(path.join(raiz, 'js', 'math.js'));

  let falhas = 0, testes = 0;
  function ok(nome, condicao, detalhe) {
    testes++;
    if (condicao) { console.log('  ok  ' + nome + (detalhe ? '  [' + detalhe + ']' : '')); }
    else { falhas++; console.log('  FALHA ' + nome + (detalhe ? '  [' + detalhe + ']' : '')); }
  }
  const perto = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);

  console.log('\n== Leitura do km digitado ==');
  {
    /* O ponto central deste módulo: o MESMO km se escreve de várias formas, e o usuário
     * digita como está acostumado. "70,500" tem de valer 70,5 km — não 70500. */
    const casos = [
      ['70', 70, 'número inteiro'],
      ['70,5', 70.5, 'vírgula decimal'],
      ['70.5', 70.5, 'ponto decimal (teclado numérico)'],
      ['70,500', 70.5, 'a forma que o cliente citou'],
      ['70.500', 70.5, 'mesma coisa com ponto'],
      ['70+500', 70.5, 'forma de rodovia (DNIT)'],
      ['70+5', 70.005, 'metros com 1 dígito'],
      ['70+050', 70.05, 'metros com zero à esquerda'],
      ['70+500,00', 70.5, 'rodovia com decimais'],
      ['70.500,00', 70.5, 'ponto de milhar e vírgula decimal'],
      ['70,500.00', 70.5, 'vírgula de milhar e ponto decimal'],
      ['KM 70+500', 70.5, 'com o prefixo KM'],
      ['km 70', 70, 'prefixo minúsculo'],
      ['Quilômetro 70,5', 70.5, 'escrito por extenso'],
      ['marco 70+500', 70.5, 'chamado de marco'],
      ['#70+500', 70.5, 'com cerquilha'],
      ['  70+500  ', 70.5, 'com espaços'],
      ['0', 0, 'km zero'],
      ['0+000', 0, 'km zero na forma de rodovia'],
      ['1234,5', 1234.5, 'rodovia longa'],
      ['70+5000', 75, 'metros além de 3 dígitos: lido como metros'],
    ];
    for (const [entrada, esperado, porque] of casos) {
      const r = km.interpretar(entrada);
      ok('"' + entrada + '" -> ' + String(esperado).replace('.', ',') + '  (' + porque + ')',
        r && perto(r.km, esperado, 1e-9), r ? r.km : 'null');
    }

    // o que NÃO pode virar um km: melhor recusar e dizer do que localizar errado
    const ruins = ['', '   ', 'abc', 'km', '++', '+500', '70+', 'x70y', '-5', 'NaN', null, undefined];
    for (const entrada of ruins) {
      ok('"' + String(entrada) + '" é recusado', km.interpretar(entrada) === null,
        JSON.stringify(km.interpretar(entrada)));
    }

    ok('número vindo de coluna do shapefile é aceito', km.interpretar(70.5).km === 70.5);
    ok('número negativo é recusado', km.interpretar(-3) === null);
    ok('reconhece a forma usada', km.interpretar('70+500').forma === 'rodovia'
      && km.interpretar('70,5').forma === 'decimal');
  }

  console.log('\n== Formatação para a tela ==');
  {
    ok('70,5 -> 70+500', km.formatar(70.5) === '70+500', km.formatar(70.5));
    ok('70 -> 70+000', km.formatar(70) === '70+000', km.formatar(70));
    ok('70,005 -> 70+005', km.formatar(70.005) === '70+005', km.formatar(70.005));
    ok('70,05 -> 70+050', km.formatar(70.05) === '70+050', km.formatar(70.05));
    ok('0 -> 0+000', km.formatar(0) === '0+000', km.formatar(0));
    ok('arredonda o metro e leva o excesso para o km seguinte',
      km.formatar(70.9996) === '71+000', km.formatar(70.9996));
    ok('curto: 70,5 km', km.formatarCurto(70.5) === '70,5 km', km.formatarCurto(70.5));
    ok('curto: 70 km (sem zeros à direita)', km.formatarCurto(70) === '70 km', km.formatarCurto(70));
    ok('curto: 70,05 km', km.formatarCurto(70.05) === '70,05 km', km.formatarCurto(70.05));

    // ida e volta: o que a tela mostra tem de voltar ao mesmo número
    const volta = km.interpretar(km.formatar(70.5));
    ok('ida e volta formatação -> leitura', perto(volta.km, 70.5, 1e-9), String(volta.km));
  }

  console.log('\n== Qual coluna guarda o km ==');
  {
    ok('acha KM', km.campoDeKm(['ID', 'KM', 'NOME']) === 'KM');
    ok('acha QUILOMETRO', km.campoDeKm(['quilometro', 'uso']) === 'quilometro');
    ok('acha KM_INICIO', km.campoDeKm(['KM_INICIO', 'NOME']) === 'KM_INICIO');
    ok('acha km_final', km.campoDeKm(['km_final']) === 'km_final');
    ok('aceita lista de objetos com nome', km.campoDeKm([{ nome: 'KM' }, { nome: 'X' }]) === 'KM');
    ok('não confunde longitude com km', km.campoDeKm(['LONGITUDE', 'LATITUDE']) === null,
      String(km.campoDeKm(['LONGITUDE', 'LATITUDE'])));
    ok('não confunde código com km', km.campoDeKm(['CODIGO', 'ID']) === null);
    ok('não confunde área com km', km.campoDeKm(['AREA_HA']) === null);
    ok('sem candidato devolve null', km.campoDeKm(['NOME', 'USO']) === null);
    ok('KM ganha de MARCO (mais específico)', km.campoDeKm(['MARCO', 'KM']) === 'KM');
  }

  console.log('\n== Km guardado no atributo ==');
  {
    ok('número', km.valorDoRegistro({ KM: 70.5 }, 'KM') === 70.5);
    ok('texto decimal', km.valorDoRegistro({ KM: '70,5' }, 'KM') === 70.5);
    ok('texto de rodovia', km.valorDoRegistro({ KM: '70+500' }, 'KM') === 70.5);
    ok('vazio é null', km.valorDoRegistro({ KM: '' }, 'KM') === null);
    ok('ausente é null', km.valorDoRegistro({}, 'KM') === null);
    ok('sem campo é null', km.valorDoRegistro({ KM: 70 }, null) === null);
  }

  console.log('\n== Marco mais próximo (camada de PONTOS) ==');
  {
    const marcos = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { KM: '69+000' }, geometry: { type: 'Point', coordinates: [-45.0, -23.0] } },
        { type: 'Feature', properties: { KM: '70+000' }, geometry: { type: 'Point', coordinates: [-45.01, -23.0] } },
        { type: 'Feature', properties: { KM: '70+500' }, geometry: { type: 'Point', coordinates: [-45.02, -23.0] } },
        { type: 'Feature', properties: { KM: '71+000' }, geometry: { type: 'Point', coordinates: [-45.03, -23.0] } },
      ],
    };
    const exato = km.localizar(marcos, 'KM', 70.5);
    ok('acha o marco exato', exato && exato.modo === 'marco' && perto(exato.km, 70.5),
      exato ? exato.rotulo : 'null');
    ok('no ponto do km 70+500', exato && exato.pos[0] === -45.02);
    ok('sem aviso quando é exato', exato && !exato.aviso, exato && exato.aviso);

    const perto_ = km.localizar(marcos, 'KM', 70.6);
    ok('acha o mais próximo quando não há exato', perto_ && perto_.km === 70.5, perto_ ? perto_.rotulo : 'null');
    ok('e diz a diferença', perto_ && /100 m/.test(perto_.aviso || ''), perto_ ? perto_.aviso : 'null');

    const longe = km.localizar(marcos, 'KM', 80);
    ok('km fora da faixa still localiza o mais próximo', longe && longe.km === 71, longe ? longe.rotulo : 'null');
    ok('e mede a distância em km quando passa de 1000 m',
      longe && /km/.test(longe.aviso || ''), longe ? longe.aviso : 'null');

    ok('sem campo de km não localiza', km.localizar(marcos, null, 70) === null);
  }

  console.log('\n== Referência linear (camada de LINHA / traçado) ==');
  {
    /* Linha ao longo do equador, de 1 grau = ~111,32 km (Vincenty). O km 50,000 tem de cair
     * na METADE do caminho, e a distância medida do início tem de dar 50 km. */
    const linha = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { nome: 'traçado' },
        geometry: { type: 'LineString', coordinates: [[-45, 0], [-44, 0]] },
      }],
    };
    const total = math.comprimentoGeodesico([[-45, 0], [-44, 0]]) / 1000;
    const meio = km.localizar(linha, null, 50);
    ok('a linha é reconhecida como traçado', km.temLinha(linha) === true && km.temPonto(linha) === false);
    ok('localiza no traçado', meio && meio.modo === 'tracado', meio ? meio.modo : 'null');
    /* 50 km NÃO é a metade dos 111,319 km da linha: o ponto tem de ficar a 50 km do início,
     * e por isso ANTES da metade em longitude (a conferência é a distância medida, não a
     * posição "no meio" — confundir as duas é o erro clássico de referência linear). */
    ok('o km 50 não passa da metade da linha', meio && meio.pos[0] < -44.5, meio ? meio.pos[0] : 'null');
    ok('a latitude continua no equador', meio && perto(meio.pos[1], 0, 1e-9));
    ok('o total medido bate com Vincenty', perto(meio.comprimentoKm, total, 1e-6),
      meio.comprimentoKm.toFixed(3) + ' km de ' + total.toFixed(3));

    // a METADE do comprimento é que cai na metade da longitude
    const metade = km.localizar(linha, null, total / 2);
    ok('a metade do comprimento cai na metade da longitude',
      metade && perto(metade.pos[0], -44.5, 1e-4), metade ? metade.pos[0] : 'null');

    // conferência independente: medir do início até o ponto encontrado tem de dar 50 km
    const dist = math.comprimentoGeodesico([[-45, 0], meio.pos]) / 1000;
    ok('medindo do início até o ponto dá 50 km', perto(dist, 50, 1e-6), dist.toFixed(6) + ' km');

    const inicio = km.localizar(linha, null, 0);
    ok('km 0 é o início da linha', inicio && perto(inicio.pos[0], -45, 1e-9), inicio ? inicio.pos[0] : 'null');

    const alem = km.localizar(linha, null, total + 10);
    ok('além do fim: devolve o fim e avisa', alem && !alem.dentro && /só/.test(alem.aviso || ''),
      alem ? alem.aviso : 'null');

    // linha com quebra: o km é medido em CADA trecho, não em linha reta
    const dobrada = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [[-45, 0], [-44.99, 0], [-44.99, 0.01]] },
      }],
    };
    const noCanto = km.localizar(dobrada, null, 1.5);
    ok('num traçado com curva, o km anda junto com a curva',
      noCanto && noCanto.modo === 'tracado' && noCanto.pos[1] > 0,
      noCanto ? JSON.stringify(noCanto.pos) : 'null');

    // várias linhas: usa a mais longa (o traçado principal)
    const duas = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-46, 0], [-45.9, 0]] } },
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-45, 0], [-44, 0]] } },
      ],
    };
    const escolhida = km.localizar(duas, null, 50);
    ok('com várias linhas, mede na MAIS LONGA (a de 111 km, não a de 11 km)',
      escolhida && escolhida.pos[0] > -45 && escolhida.pos[0] < -44,
      escolhida ? escolhida.pos[0] : 'null');
    ok('e avisa que sobrou trecho sem encaixe', escolhida && /encaixei/.test(escolhida.aviso || ''),
      escolhida ? escolhida.aviso : 'null');

    // TRECHOS ENCAIXADOS: rodovia dividida em dois arquivos/feições ligadas ponta a ponta.
    // Medir só na "linha mais longa" daria km errado assim que o ponto caísse no 2º trecho.
    const emenda = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-45, 0], [-44.99, 0]] } },
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-44.99, 0], [-44.98, 0]] } },
      ],
    };
    const cadeia = km.escolherTracado(emenda);
    ok('dois trechos ligados viram um traçado só', cadeia && cadeia.trechos === 2 && cadeia.sobraram === 0,
      cadeia ? cadeia.trechos + ' trechos, ' + cadeia.sobraram + ' sobrando' : 'null');
    const noSegundo = km.localizar(emenda, null, 1.5);
    // atenção ao sinal: -44,9865 é MAIOR que -44,99, e está entre os dois extremos
    ok('o km atravessa a emenda para o segundo trecho',
      noSegundo && noSegundo.pos[0] > -44.99 && noSegundo.pos[0] < -44.98,
      noSegundo ? noSegundo.pos[0] : 'null');
    ok('sem aviso quando todos os trechos entram', noSegundo && !noSegundo.aviso,
      noSegundo ? String(noSegundo.aviso) : 'null');

    // trecho INVERTIDO (a feição vem no sentido contrário) também encaixa
    const invertida = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-45, 0], [-44.99, 0]] } },
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-44.98, 0], [-44.99, 0]] } },
      ],
    };
    const inv = km.escolherTracado(invertida);
    ok('trecho no sentido contrário é invertido e encaixado', inv && inv.trechos === 2 && inv.sobraram === 0,
      inv ? inv.trechos + ' trechos' : 'null');
  }

  console.log('\n== Casos que não podem localizar nada ==');
  {
    ok('camada vazia', km.localizar({ type: 'FeatureCollection', features: [] }, 'KM', 70) === null);
    ok('sem geometria', km.localizar({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { KM: 70 } }] }, 'KM', 70) === null);
    ok('km alvo inválido', km.localizar({ type: 'FeatureCollection', features: [] }, 'KM', NaN) === null);
    ok('camada nula', km.localizar(null, 'KM', 70) === null);
    ok('linha com 1 ponto não localiza',
      km.localizar({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-45, 0]] } }] }, null, 5) === null);
  }

  console.log('\n' + (falhas ? 'FALHAS: ' + falhas + '/' + testes : 'TODOS OS ' + testes + ' TESTES PASSARAM'));
  return falhas ? 1 : 0;
}

module.exports = { executar };
if (require.main === module) process.exit(executar());
