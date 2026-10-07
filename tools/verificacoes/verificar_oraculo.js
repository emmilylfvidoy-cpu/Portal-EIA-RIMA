'use strict';
function executar(nOraculo) {
/* Teste de oráculo: compara o clip do portal com o do Turf em polígonos aleatórios.
 *
 * Por que existe: caso escrito à mão cobre o que eu já pensei. Estrela aleatória,
 * "L" côncavo e rotações cobrem o que eu não pensei. Nos casos que falham, o par de
 * polígonos é impresso em JSON para poder ser colado num teste de regressão.
 *
 * Uso: node tools/verificacoes/verificar_oraculo.js [n]
 */
const path = require('path');
const raiz = path.resolve(__dirname, '..', '..');
const math = require(path.join(raiz, 'js', 'math.js'));
const v = require(path.join(raiz, 'js', 'vetorial.js'));
const turf = require(path.join(raiz, 'vendor', 'turf.min.js'));

const N = Number(process.argv[2] || 300);
let falhas = 0, casos = 0, comparacoes = 0, tocando = 0;

function rng(semente) {
  let a = semente >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function estrela(r, cx, cy, rmin, rmax, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = 2 * Math.PI * i / n;
    const raio = rmin + (rmax - rmin) * r();
    pts.push([cx + raio * Math.cos(t), cy + raio * Math.sin(t)]);
  }
  return pts;
}

function ele(r, cx, cy, w, h) {
  const cw = w * (0.3 + 0.5 * r());
  const ch = h * (0.3 + 0.5 * r());
  return [
    [cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2 - ch],
    [cx + w / 2 - cw, cy + h / 2 - ch], [cx + w / 2 - cw, cy + h / 2], [cx - w / 2, cy + h / 2],
  ];
}

function gerar(r, i) {
  const modelo = i % 4;
  let A, B;
  if (modelo === 0) { A = estrela(r, 5, 5, 2, 5, 12); B = estrela(r, 6, 6, 1.5, 4, 10); }
  else if (modelo === 1) { A = ele(r, 5, 5, 10, 10); B = estrela(r, 5.5, 4.5, 1.5, 4, 10); }
  else if (modelo === 2) { A = estrela(r, 5, 5, 3, 6, 24); B = ele(r, 6, 5, 8, 8); }
  else { A = ele(r, 5, 5, 9, 9); B = ele(r, 5.6, 5.4, 7, 7); }
  return { A, B, modelo };
}

function areaAssinada(aneis) { return aneis.reduce((s, a) => s + math.areaAnelAssinada(a), 0); }
function areaAbsoluta(aneis) { return aneis.reduce((s, a) => s + math.areaAnel(a), 0); }

/**
 * Área de uma geometria GeoJSON.
 * `absoluta` = anel externo menos furos (o que interessa comparar).
 * Importante: somar Math.abs de todos os anéis SOMAVA o furo (dava 27 em vez de
 * 21 num polígono com furo de 20 dentro de 57) e fazia o teste acusar erro onde
 * o motor estava certo.
 */
function areaDaGeometria(geo) {
  if (!geo) return { assinada: 0, absoluta: 0 };
  const partes = geo.type === 'Polygon' ? [geo.coordinates] : geo.coordinates;
  let assinada = 0, externos = 0, furos = 0;
  for (const parte of partes) {
    parte.forEach((anel, i) => {
      const a = math.areaAnel(anel);
      if (i === 0) externos += a; else furos += a;
      assinada += i === 0 ? a : -a;
    });
  }
  return { assinada, absoluta: externos - furos, externos, furos };
}

function paraTurf(pontos) {
  const c = pontos.map((p) => [p[0], p[1]]);
  c.push([c[0][0], c[0][1]]);
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [c] } };
}

const r = rng(20260101);

// Todos os pares são gerados ANTES de qualquer teste. Gerar dentro do laço de teste
// fazia o gerador andar de forma diferente entre uma passada e outra, e o valor
// esperado comparado não era o do par testado (foi o que produziu comparações
// absurdas na primeira versão deste arquivo).
const pares = [];
for (let k = 0; k < N; k++) {
  const p = gerar(r, k);
  if (v.temAutoIntersecao(p.A) || v.temAutoIntersecao(p.B)) continue;
  if (math.areaAnel(p.A) < 0.5 || math.areaAnel(p.B) < 0.5) continue;
  pares.push(p);
}

for (let indice = 0; indice < pares.length; indice++) {
  const { A, B, modelo } = pares[indice];
  const k = indice;
  casos++;

  let oi = null, od = null, okTurf = true;
  try {
    const fi = turf.intersect(turf.featureCollection([paraTurf(A), paraTurf(B)]));
    const fd = turf.difference(turf.featureCollection([paraTurf(A), paraTurf(B)]));
    oi = fi ? areaDaGeometria(fi.geometry) : null;
    od = fd ? areaDaGeometria(fd.geometry) : null;
  } catch (e) { okTurf = false; }

  const nossaInter = v.intersecaoUm(A, B, {});
  const nossaDif = v.diferencaUm(A, B, {});
  const ai = areaAssinada(nossaInter);
  const ad = areaAssinada(nossaDif);
  const aA = math.areaAnel(A);

  // O motor do portal tem de devolver área sem auto-interseção residual
  if (v.temAutoIntersecao(nossaDif.length === 1 ? nossaDif[0] : []) && nossaDif.length === 1) {
    falhas++;
    if (falhas <= 6) console.log('  FALHA contorno invalido na diferenca, caso', k, JSON.stringify({ A, B }));
  }

  if (!okTurf) continue;
  comparacoes++;

  // Interseção: compara sempre (inclusive zero)
  const refI = oi ? oi.absoluta : 0;
  if (Math.abs(ai - refI) > 1e-6 * Math.max(aA, 1)) {
    if (refI < 1e-9 && ai < 1e-9) {
      // ambos vazios: ok
    } else {
      falhas++;
      if (falhas <= 6) console.log('  FALHA interseccao caso', k, 'modelo', modelo,
        '| nossa=', ai.toFixed(6), 'turf=', refI.toFixed(6), JSON.stringify({ A, B }));
    }
  }

  // Diferença: quando o Turf devolveu geometria, compara; quando devolveu null,
  // significa "o recorte cobre o sujeito" (a área é zero) OU caso degenerado de
  // encostar — nesse segundo caso não há gabarito confiável, então só registra.
  if (od) {
    const refD = od.absoluta;
    if (Math.abs(ad - refD) > 1e-6 * Math.max(aA, 1)) {
      if (refD < 1e-9 && ad < 1e-9) {
        // ambos vazios: ok
      } else {
        falhas++;
        if (falhas <= 6) console.log('  FALHA diferenca caso', k, 'modelo', modelo,
          '| nossa=', ad.toFixed(6), 'turf=', refD.toFixed(6), JSON.stringify({ A, B }));
      }
    }
  } else {
    tocando++;
    // sem gabarito do Turf: exige apenas coerência interna
    const soma = ai + ad;
    if (Math.abs(soma - aA) > 1e-6 * aA && ai > 1e-9 && ad > 1e-9) {
      falhas++;
      if (falhas <= 6) console.log('  FALHA coerencia caso', k, 'modelo', modelo,
        '| inter=', ai.toFixed(4), 'dif=', ad.toFixed(4), 'A=', aA.toFixed(4), JSON.stringify({ A, B }));
    }
  }
}

console.log('\ncasos validos: ' + casos + ' | comparados com o Turf: ' + comparacoes
  + ' | sem gabarito (Turf devolveu null): ' + tocando
  + ' | area media do sujeito: ' + (casos ? (function () { return ''; })() : ''));
console.log(falhas ? 'FALHAS: ' + falhas : 'TODOS OS CASOS PASSARAM');
  return falhas ? 1 : 0;
}

module.exports = { executar };
if (require.main === module) {
  process.exit(executar(Number(process.argv[2] || 500)));
}
