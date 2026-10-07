'use strict';
/* Verificação: cor para MUITAS classes e legenda que não estoura a folha.
 *
 * Defeito que originou: a paleta do portal tem 12 cores e repetia a partir da 13ª. Com as
 * 306 unidades litológicas da camada de Geologia, cada cor serviria 25 classes diferentes
 * — legenda inútil. E a legenda da folha era de 2 ou 3 colunas fixas, o que cabia para 6
 * camadas e não para uma legenda de unidade geológica. */
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..', '..');
const svg = require(path.join(raiz, 'js', 'svg.js'));
const mapa = require(path.join(raiz, 'js', 'mapa.js'));

let falhas = 0, testes = 0;
const ok = (nome, cond, det) => {
  testes++;
  if (cond) console.log('  ok  ' + nome + (det ? '  [' + det + ']' : ''));
  else { falhas++; console.log('  FALHA ' + nome + (det ? '  [' + det + ']' : '')); }
};

console.log('\n== Cor por classe ==');
{
  const ate12 = new Set();
  for (let i = 0; i < 12; i++) ate12.add(svg.cor(i, 12));
  ok('até 12 classes, paleta fixa (nada muda para as outras camadas)', ate12.size === 12, ate12.size + ' cores');

  for (const n of [20, 50, 306]) {
    const usadas = new Set();
    for (let i = 0; i < n; i++) usadas.add(svg.cor(i, n));
    ok(n + ' classes geram ' + n + ' cores distintas', usadas.size === n, usadas.size + ' de ' + n);
    const validas = Array.from(usadas).every((c) => /^#[0-9a-f]{6}$/.test(c));
    ok(n + ' classes: todas as cores em hexadecimal válido', validas);
  }
  // Duas cores vizinhas não podem ser parecidas (é o ponto do ângulo áureo)
  const dist = (a, b) => {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
    const A = p(a), B = p(b);
    return Math.sqrt((A[0] - B[0]) ** 2 + (A[1] - B[1]) ** 2 + (A[2] - B[2]) ** 2);
  };
  let perto = 0;
  for (let i = 0; i < 200; i++) if (dist(svg.cor(i, 306), svg.cor(i + 1, 306)) < 40) perto++;
  ok('cores consecutivas não se confundem', perto <= 6, perto + ' pares muito próximos de 200');
}

console.log('\n== Legenda da folha com muitas entradas ==');
{
  const itens = [];
  for (let i = 0; i < 80; i++) itens.push({ rotulo: 'Geologia: unidade ' + i, cor: svg.cor(i, 80), forma: 'poligono' });

  const bytes = mapa.gerarPdf({
    folha: 'A1', orientacao: 'paisagem', escala: 10000,
    bbox: [-47.9, -22.8, -47.6, -22.6],
    titulo: 'Teste de legenda cheia', projeto: 'Teste', responsavel: 'Eng.', crea: '000',
    fonte: 'Base de teste', legenda: itens, logos: [], data: '07/10/2026',
  });
  const texto = Buffer.from(bytes).toString('latin1');
  ok('PDF gerado com 80 entradas de legenda', bytes.length > 5000 && /%%EOF\s*$/.test(texto), Math.round(bytes.length / 1024) + ' KB');
  ok('PDF termina com xref válido', texto.indexOf('trailer') > 0 && texto.indexOf('startxref') > 0);

  // A4 tem rodapé pequeno: a legenda tem de caber ou declarar o que sobrou
  const bytesA4 = mapa.gerarPdf({
    folha: 'A4', orientacao: 'paisagem', escala: 50000,
    bbox: [-47.9, -22.8, -47.6, -22.6],
    titulo: 'Teste A4', projeto: 'Teste', legenda: itens, logos: [], data: '07/10/2026',
  });
  ok('A4 com 80 entradas também gera PDF', bytesA4.length > 3000, Math.round(bytesA4.length / 1024) + ' KB');

  // O texto da legenda tem de sair no PDF (é o que prova que ela foi desenhada)
  const achou = texto.indexOf('unidade 0') > 0 || texto.indexOf('unidade 1') > 0;
  ok('os rótulos da legenda entram no PDF', achou);
  const declarouSobra = texto.indexOf('e mais') > 0 || texto.indexOf('tabela de') > 0;
  console.log('     ' + (declarouSobra ? 'declarou a sobra' : 'coube tudo (sem sobra a declarar)'));
}

console.log('\n== Preview SVG da legenda ==');
{
  const itens = [];
  for (let i = 0; i < 40; i++) itens.push({ rotulo: 'U' + i, cor: svg.cor(i, 40), forma: 'poligono' });
  const s = svg.legenda(itens, { titulo: 'Legenda' });
  ok('SVG da legenda gerado', s.indexOf('<svg') === 0 && s.indexOf('</svg>') > 0, s.length + ' bytes');
  ok('uma entrada por item', (s.match(/<rect/g) || []).length === 40, (s.match(/<rect/g) || []).length + ' retângulos');
}

console.log('\n' + (falhas ? 'FALHAS: ' + falhas + '/' + testes : 'TODOS OS ' + testes + ' TESTES PASSARAM'));
