'use strict';
function executar(nOraculo) {
/* Verificação do motor de recorte.
 * Uso: node tools/verificacoes/verificar_vetorial.js */
const path = require('path');
const raiz = path.resolve(__dirname, '..', '..');
const math = require(path.join(raiz, 'js', 'math.js'));
const v = require(path.join(raiz, 'js', 'vetorial.js'));

let falhas = 0, testes = 0;
function ok(nome, cond, det) {
  testes++;
  if (cond) console.log('  ok  ' + nome + (det ? '  [' + det + ']' : ''));
  else { falhas++; console.log('  FALHA ' + nome + (det ? '  [' + det + ']' : '')); }
}
const perto = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol);

// anel retangular em coordenadas planas (o motor é agnóstico de unidade)
function ret(x0, y0, x1, y1) {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
}
/**
 * Área do resultado com sinal: o furo tem de SUBTRAIR.
 * Usar Math.abs em cada anel somava o furo (100 + 4 em vez de 100 - 4).
 */
function areaTotal(aneis) {
  return aneis.reduce((s, a) => s + math.areaAnelAssinada(a), 0);
}

console.log('\n== Interseccao de retangulos ==');
{
  // A = 0..10 x 0..10 ; B = 5..15 x 5..15 -> sobreposicao 5x5 = 25
  const r = v.intersecaoUm(ret(0, 0, 10, 10), ret(5, 5, 15, 15), {});
  ok('um pedaco', r.length === 1, r.length + ' pedacos');
  ok('area = 25', perto(areaTotal(r), 25, 1e-9), areaTotal(r).toFixed(9));
}

console.log('\n== Diferenca de retangulos ==');
{
  // A - B com B do canto inferior esquerdo, sobreposicao 5x5 = 25 -> area 75
  const r = v.diferencaUm(ret(0, 0, 10, 10), ret(-5, -5, 5, 5), {});
  ok('area = 75', perto(areaTotal(r), 75, 1e-9), areaTotal(r).toFixed(6) + ' em ' + r.length + ' pedaco(s)');
}

console.log('\n== Contencao ==');
{
  // B dentro de A
  const i = v.intersecaoUm(ret(0, 0, 10, 10), ret(2, 2, 4, 4), {});
  ok('intersecao de contido = o menor', perto(areaTotal(i), 4, 1e-9), areaTotal(i).toFixed(6));
  const d = v.diferencaUm(ret(0, 0, 10, 10), ret(2, 2, 4, 4), {});
  ok('diferenca com furo', perto(areaTotal(d) + areaTotal(i), 100, 1e-9),
    'diferenca=' + areaTotal(d).toFixed(4) + ' (esperado 96 como 100-4)');

  // A dentro de B
  const i2 = v.intersecaoUm(ret(2, 2, 4, 4), ret(0, 0, 10, 10), {});
  ok('intersecao invertida = o menor', perto(areaTotal(i2), 4, 1e-9), areaTotal(i2).toFixed(6));
  const d2 = v.diferencaUm(ret(2, 2, 4, 4), ret(0, 0, 10, 10), {});
  ok('diferenca invertida = vazio', d2.length === 0, d2.length + ' pedacos');
}

console.log('\n== Disjuntos e encostados ==');
{
  const i = v.intersecaoUm(ret(0, 0, 1, 1), ret(5, 5, 6, 6), {});
  ok('disjuntos -> vazio', i.length === 0);
  const d = v.diferencaUm(ret(0, 0, 1, 1), ret(5, 5, 6, 6), {});
  ok('diferenca disjunta = o sujeito', perto(areaTotal(d), 1, 1e-9), areaTotal(d).toFixed(6));

  const enc = v.intersecaoUm(ret(0, 0, 5, 5), ret(5, 0, 10, 5), {});
  ok('encostados pela aresta -> area zero', areaTotal(enc) < 1e-9, areaTotal(enc).toExponential(2));
}

console.log('\n== Poligono concavo (o caso que o turf erra) ==');
{
  // "L": 10x10 menos o quadrante superior direito 5x5
  const L = [[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10], [0, 0]];
  ok('area do L = 75', perto(math.areaAnel(L), 75, 1e-9), math.areaAnel(L));
  // recorte: faixa vertical 3..7 em x, de -1 a 11 -> deveria pegar 3..7 em toda altura util
  const faixa = ret(3, -1, 7, 11);
  const i = v.intersecaoUm(L, faixa, {});
  // area esperada: coluna 3..5 com 10 de altura = 20 ; coluna 5..7 com 5 de altura = 10 -> 30
  ok('intersecao do L com faixa = 30', perto(areaTotal(i), 30, 1e-6), areaTotal(i).toFixed(6) + ' em ' + i.length + ' pedaco(s)');
  const d = v.diferencaUm(L, faixa, {});
  ok('diferenca do L com faixa = 45', perto(areaTotal(d), 45, 1e-6), areaTotal(d).toFixed(6) + ' em ' + d.length + ' pedaco(s)');
}

console.log('\n== Concavo x concavo (dois L que se encostam) ==');
{
  const L1 = [[0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10], [0, 0]];
  // L espelhado, deslocado: os dois se tocam nas arestas x=5 e x=10, sem area comum
  const L2 = [[5, 5], [15, 5], [15, 15], [10, 15], [10, 10], [5, 10], [5, 5]];
  const i = v.intersecaoUm(L1, L2, {});
  const d = v.diferencaUm(L1, L2, {});
  ok('interseccao de area nula = vazio', areaTotal(i) < 1e-9, areaTotal(i).toExponential(2));
  ok('diferenca = o proprio L1', perto(areaTotal(d), 75, 1e-6), areaTotal(d).toFixed(6));

  // Agora com sobreposicao real: L3 invade L1 pelo canto inferior direito.
  // A faixa util e 7,5 <= x <= 10 com 2,5 <= y <= 5 (acima de y=5 cai no recorte
  // do L1), logo 2,5 x 2,5 = 6,25 — nao os 12,5 que eu tinha suposto.
  const L3 = [[7.5, 2.5], [15, 2.5], [15, 15], [10, 15], [10, 10], [7.5, 10], [7.5, 2.5]];
  const i3 = v.intersecaoUm(L1, L3, {});
  ok('interseccao com sobreposicao = 6,25', perto(areaTotal(i3), 6.25, 1e-6), areaTotal(i3).toFixed(6));
  const d3 = v.diferencaUm(L1, L3, {});
  ok('diferenca correspondente = 68,75', perto(areaTotal(d3), 68.75, 1e-6), areaTotal(d3).toFixed(6));
  ok('soma = area de L1', perto(areaTotal(i3) + areaTotal(d3), 75, 1e-6),
    (areaTotal(i3) + areaTotal(d3)).toFixed(6));
}

console.log('\n== Rotacionado (losango) ==');
{
  // losango de diagonais 10 -> area 50
  const losango = [[5, 0], [10, 5], [5, 10], [0, 5], [5, 0]];
  ok('area do losango = 50', perto(math.areaAnel(losango), 50, 1e-9), math.areaAnel(losango));
  const i = v.intersecaoUm(losango, ret(5, 0, 10, 10), {});
  ok('intersecao do losango com meio quadrado = 25', perto(areaTotal(i), 25, 1e-6),
    areaTotal(i).toFixed(6) + ' em ' + i.length + ' pedaco(s)');
  const d = v.diferencaUm(losango, ret(5, 0, 10, 10), {});
  ok('diferenca = 25', perto(areaTotal(d), 25, 1e-6), areaTotal(d).toFixed(6));
}

console.log('\n== Montanha: muitos vertices (circulo) ==');
{
  const N = 360;
  const circulo = [];
  for (let i = 0; i < N; i++) {
    const t = 2 * Math.PI * i / N;
    circulo.push([5 + 5 * Math.cos(t), 5 + 5 * Math.sin(t)]);
  }
  circulo.push(circulo[0].slice());
  const areaCirc = math.areaAnel(circulo);
  const exato = 0.5 * N * 25 * Math.sin(2 * Math.PI / N);
  ok('area do 360-gono = formula exata', perto(areaCirc, exato, 1e-9), areaCirc.toFixed(6) + ' vs ' + exato.toFixed(6));
  ok('area do 360-gono ~ 78,54', perto(areaCirc, 78.5398, 0.01), areaCirc.toFixed(4));
  const i = v.intersecaoUm(circulo, ret(5, 0, 10, 10), {});
  ok('meia lua ~ 39,27', perto(areaTotal(i), areaCirc / 2, 0.02), areaTotal(i).toFixed(4));
  const d = v.diferencaUm(circulo, ret(5, 0, 10, 10), {});
  ok('outra meia lua', perto(areaTotal(i) + areaTotal(d), areaCirc, 1e-6),
    (areaTotal(i) + areaTotal(d)).toFixed(4));
}

console.log('\n== Linhas ==');
{
  // linha horizontal de -5 a 15 na altura 5, recortada pelo quadrado 0..10
  const linha = [[-5, 5], [15, 5]];
  const comprimento = (pedacos) => pedacos.reduce((s, l) => {
    let d = 0;
    for (let i = 1; i < l.length; i++) d += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
    return s + d;
  }, 0);
  const dentro = v.recortarLinha(linha, [ret(0, 0, 10, 10)], 'intersecao');
  ok('linha recortada = 10', perto(comprimento(dentro), 10, 1e-9), comprimento(dentro).toFixed(6) + ' em ' + dentro.length + ' pedaco(s)');
  const fora = v.recortarLinha(linha, [ret(0, 0, 10, 10)], 'diferenca');
  ok('linha fora = 10', perto(comprimento(fora), 10, 1e-9), comprimento(fora).toFixed(6) + ' em ' + fora.length + ' pedaco(s)');

  // linha vertical que atravessa o quadrado: corta em 0 e 10
  const vertical = [[5, -5], [5, 15]];
  const dv = v.recortarLinha(vertical, [ret(0, 0, 10, 10)], 'intersecao');
  ok('linha vertical recortada = 10', perto(comprimento(dv), 10, 1e-9), comprimento(dv).toFixed(6));

  // linha inteiramente fora
  const longe = [[20, 0], [30, 0]];
  const dl = v.recortarLinha(longe, [ret(0, 0, 10, 10)], 'intersecao');
  ok('linha fora do poligono = vazio', dl.length === 0, dl.length + ' pedacos');
}

console.log('\n== Pontos e features ==');
{
  const feats = [
    { type: 'Feature', properties: { nome: 'dentro' }, geometry: { type: 'Point', coordinates: [5, 5] } },
    { type: 'Feature', properties: { nome: 'fora' }, geometry: { type: 'Point', coordinates: [50, 50] } },
    { type: 'Feature', properties: { nome: 'poli' }, geometry: { type: 'Polygon', coordinates: [ret(0, 0, 10, 10)] } },
  ];
  const r = v.recortarFeatures(feats, [ret(0, 0, 10, 10)], 'intersecao', {});
  ok('2 feicoes mantidas', r.features.length === 2, r.features.map((f) => f.properties.nome).join(','));
  ok('propriedades preservadas', r.features[0].properties.nome === 'dentro');
  ok('1 descartada', r.descartadas.length === 1);
}

console.log('\n== Validacao ==');
{
  ok('quadrado sem auto-intersecao', !v.temAutoIntersecao(ret(0, 0, 1, 1)));
  ok('borboleta com auto-intersecao', v.temAutoIntersecao([[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]));
  ok('orientacao anti-horaria', v.orientacaoAnel(ret(0, 0, 1, 1)) === 1);
  ok('orientacao horaria', v.orientacaoAnel(ret(0, 0, 1, 1).slice().reverse()) === -1);
}

console.log('\n== Ponto em anel: casos de borda ==');
{
  const q = ret(0, 0, 10, 10);
  ok('centro dentro', v.pontoNoAnel([5, 5], q));
  ok('fora', !v.pontoNoAnel([15, 5], q));
  ok('vertice', v.pontoNoAnel([0, 0], q));
}

console.log('\n== Simplificacao ==');
{
  const linha = [[0, 0], [1, 0.001], [2, -0.001], [3, 0], [4, 0]];
  const s = v.simplificar(linha, 0.01);
  ok('Douglas-Peucker reduz', s.length < linha.length, linha.length + ' -> ' + s.length);
  ok('mantem as pontas', s[0][0] === 0 && s[s.length - 1][0] === 4);
}

console.log('\n' + (falhas ? 'FALHAS: ' + falhas + '/' + testes : 'TODOS OS ' + testes + ' TESTES PASSARAM'));
  return falhas ? 1 : 0;
}

module.exports = { executar };
if (require.main === module) {
  process.exit(executar(Number(process.argv[2] || 500)));
}
