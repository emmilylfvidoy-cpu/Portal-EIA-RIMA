'use strict';
/* ============================================================================
 * cores_inventario.js — aplica as cores do próprio serviço (SEMIL/IPA) nas classes do Inventário
 *
 * As cores vêm do renderer da camada TEMATICOS/InventarioFlorestal_2020 do serviço da SEMIL —
 * a mesma fonte que usei para a Geologia (o .xml) e para a CETESB (o renderer do ArcGIS).
 *
 * OS NOMES NÃO SÃO IDÊNTICOS: o shapefile do IPA traz o estágio de conservação no nome
 * ("Floresta Estacional Semidecidual estágio médio") e o serviço traz só a fitofisionomia
 * ("Floresta Estacional Semidecidual"). Além disso um diz "de Terras Baixas" e o outro "das
 * Terras Baixas". Por isso o casamento é por nome NORMALIZADO — sem acento, sem conectivos
 * (de/da/das/do/dos) — e do nome mais longo para o mais curto, senão "Floresta Ombrófila Densa"
 * casaria antes de "Floresta Ombrófila Densa das Terras Baixas".
 *
 * O que não casar fica na paleta do portal, e o relatório diz exatamente o quê.
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');

// renderer do serviço da SEMIL: fitofisionomia -> cor (RGB do ArcGIS convertido para hex)
const CORES_DO_SERVICO = {
  'Floresta Estacional Decidual': '#73b273',
  'Floresta Estacional Semidecidual': '#89cd66',
  'Floresta Ombrófila Densa': '#267300',
  'Floresta Ombrófila Densa das Terras Baixas': '#55ff00',
  'Floresta Ombrófila Mista': '#446589',
  'Formação Pioneira com Influência Fluvial': '#7ab6f5',
  'Formação Pioneira com Influência Fluviomarinha': '#00c5ff',
  'Refúgio Ecológico': '#ffbebe',
  'Savana Arborizada': '#e69800',
  'Savana Florestada': '#e64c00',
  'Savana Gramíneo-lenhosa': '#ffd37f',
};

function normalizar(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')     // tira acento
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(de|da|das|do|dos|e)\b/g, ' ')            // tira conectivos
    .replace(/\s+/g, ' ')
    .trim();
}

// do mais longo para o mais curto: "densa das terras baixas" antes de "densa"
const CHAVES = Object.keys(CORES_DO_SERVICO)
  .map((k) => ({ nome: k, chave: normalizar(k) }))
  .sort((a, b) => b.chave.length - a.chave.length);

function corPara(classe) {
  const n = normalizar(classe);
  for (const c of CHAVES) {
    if (n === c.chave || n.indexOf(c.chave) === 0 || n.indexOf(c.chave) >= 0) return c.nome;
  }
  return null;
}

const pc = path.join(raiz, 'data', 'catalogo.json');
const cat = JSON.parse(fs.readFileSync(pc, 'utf8'));
const grupo = cat.camadas.find((x) => x.id === 'inventario-florestal');
if (!grupo || !grupo.filhos) { console.error('grupo do Inventário não encontrado'); process.exit(1); }

const semCor = new Map();
let totalClasses = 0, casadas = 0;

for (const filho of grupo.filhos) {
  const cores = {};
  for (const c of (filho.classes || [])) {
    totalClasses++;
    const doServico = corPara(c.classe);
    if (doServico) { cores[c.classe] = CORES_DO_SERVICO[doServico]; casadas++; }
    else semCor.set(c.classe, (semCor.get(c.classe) || 0) + c.feicoes);
  }
  filho.estilo = Object.assign({}, filho.estilo, {
    cores: cores,
    cores_origem: 'estilo',
    estilo_arquivo: 'renderer do serviço da SEMIL (TEMATICOS/InventarioFlorestal_2020), do IPA',
  });
  filho.obs = String(filho.obs || '').replace(/\s*As cores do IPA não vêm no shapefile[^.]*\./, '')
    + ' Cores copiadas do renderer do serviço da SEMIL (o mesmo mapa do IPA): o shapefile não traz '
    + 'paleta, e os nomes das classes não são idênticos — o casamento é por nome normalizado.';
}

fs.writeFileSync(pc, JSON.stringify(cat, null, 2) + '\n', 'utf8');

console.log('  classes nas 22 UGRHIs: ' + totalClasses.toLocaleString('pt-BR'));
console.log('  com cor do serviço:    ' + casadas.toLocaleString('pt-BR') + '  ('
  + (casadas / totalClasses * 100).toFixed(1) + '%)');
if (semCor.size) {
  console.log('  SEM cor do serviço (ficam na paleta do portal):');
  for (const [c, n] of Array.from(semCor.entries()).sort((a, b) => b[1] - a[1])) {
    console.log('    ' + String(n).padStart(6) + '  ' + c);
  }
} else {
  console.log('  todas as classes casaram com uma cor do serviço.');
}
const exemplo = grupo.filhos.find((f) => Object.keys(f.estilo.cores).length > 3);
if (exemplo) {
  console.log('');
  console.log('  exemplo — ' + exemplo.nome + ':');
  for (const [c, cor] of Object.entries(exemplo.estilo.cores).slice(0, 6)) {
    console.log('    ' + cor + '  ' + c);
  }
}
