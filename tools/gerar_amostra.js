'use strict';
/* ============================================================================
 * gerar_amostra.js — monta as camadas de exemplo do portal
 *
 * Uso: node tools/gerar_amostra.js
 *
 * O que faz e por quê:
 *   - o LIMITE MUNICIPAL e o ZONEAMENTO são dado REAL de Piracicaba, já usado pelo
 *     projeto do geoportal: melhor exemplo é o dado verdadeiro;
 *   - HIDROGRAFIA é simplificada por Douglas–Peucker antes de ser publicada (o
 *     arquivo original tem 1 milhão de vértices e 53 MB — carregar isso na aba é
 *     o defeito nº 1 apontado na auditoria do outro portal);
 *   - GEOLOGIA, GEOMORFOLOGIA, SOLOS, DECLIVIDADE, VEGETAÇÃO e USO DO SOLO são
 *     sintéticos, recortados dentro do município. São de mentira de propósito, e o
 *     campo `fonte` de cada camada diz isso na tela — camada de exemplo que se
 *     passa por dado oficial é pior que não ter exemplo.
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const origem = path.resolve(raiz, '..', 'MVP-geoportal-Piracicaba-main', 'data');
const destino = path.join(raiz, 'data');
const math = require(path.join(raiz, 'js', 'math.js'));
const vetorial = require(path.join(raiz, 'js', 'vetorial.js'));

fs.mkdirSync(destino, { recursive: true });

// --------------------------------------------------------------- fonte real
const limite = lerJson(path.join(origem, 'Limite Municipal.geojson'));
const zoneamento = lerJson(path.join(origem, 'zoneamento.geojson'));
const bairros = lerJson(path.join(origem, 'bairros.geojson'));
const hidro = lerJson(path.join(origem, 'hidrografia.geojson'));

if (!limite) throw new Error('Não encontrei o limite municipal em ' + origem);

const aneisMunicipio = [];
for (const f of limite.features) {
  const partes = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const parte of partes) aneisMunicipio.push(parte[0]);
}
const bboxMunicipio = math.bbox(limite);
console.log('Município: bbox', bboxMunicipio.map((v) => v.toFixed(4)).join(', '));

// --------------------------------------------------------------- utilitários
function lerJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

function escrever(nome, geojson, meta) {
  const arq = path.join(destino, nome + '.geojson');
  geojson.type = 'FeatureCollection';
  geojson.metadados = Object.assign({ gerado_por: 'tools/gerar_amostra.js', gerado_em: new Date().toISOString() }, meta || {});
  fs.writeFileSync(arq, JSON.stringify(geojson));
  const tamanho = (fs.statSync(arq).size / 1024).toFixed(0);
  console.log('  ' + nome.padEnd(22) + geojson.features.length.toString().padStart(5) + ' feições  ' + tamanho.padStart(6) + ' KB');
}

/** Recorta uma feição sintética pelo município (para o exemplo ficar plausível). */
function recortarPeloMunicipio(geometria) {
  const partes = [];
  for (const f of limite.features) {
    const aneis = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const parte of aneis) {
      const r = vetorial.intersecaoUm(geometria.type === 'Polygon' ? geometria.coordinates[0] : geometria.coordinates[0][0], parte[0], {});
      for (const a of r) partes.push(a);
    }
  }
  if (!partes.length) return null;
  return partes.length === 1 ? { type: 'Polygon', coordinates: [partes[0]] } : { type: 'MultiPolygon', coordinates: partes.map((p) => [p]) };
}

/**
 * Divide o município em faixas verticais (variação longitudinal). Serve para as
 * camadas sintéticas: cada faixa recebe uma classe diferente, e o resultado tem
 * o desenho geral do município em vez de retângulos soltos.
 */
function faixasLongitudinais(n, deslocamento) {
  const [x0, , x1] = [bboxMunicipio[0], bboxMunicipio[1], bboxMunicipio[2]];
  const largura = (x1 - x0) / n;
  const faixas = [];
  for (let i = 0; i < n; i++) {
    const a = x0 + i * largura - (deslocamento || 0) * largura * 0.25;
    const b = x0 + (i + 1) * largura + (deslocamento || 0) * largura * 0.25;
    faixas.push([[a, bboxMunicipio[1] - 0.05], [b, bboxMunicipio[1] - 0.05], [b, bboxMunicipio[3] + 0.05], [a, bboxMunicipio[3] + 0.05], [a, bboxMunicipio[1] - 0.05]]);
  }
  return faixas;
}

/** Faixas horizontais (variação latitudinal), para cruzar com as verticais. */
function faixasLatitudinais(n) {
  const [, y0, , y1] = [bboxMunicipio[0], bboxMunicipio[1], bboxMunicipio[2], bboxMunicipio[3]];
  const altura = (y1 - y0) / n;
  const faixas = [];
  for (let i = 0; i < n; i++) {
    const a = y0 + i * altura;
    const b = y0 + (i + 1) * altura;
    faixas.push([[bboxMunicipio[0] - 0.05, a], [bboxMunicipio[2] + 0.05, a], [bboxMunicipio[2] + 0.05, b], [bboxMunicipio[0] - 0.05, b], [bboxMunicipio[0] - 0.05, a]]);
  }
  return faixas;
}

// --------------------------------------------------------------- camadas
console.log('\nGerando camadas de exemplo em data/');

// 1) Limite municipal (real)
escrever('limite-municipal', { features: limite.features.map((f) => ({ type: 'Feature', properties: { nome: f.properties.NM_MUN, uf: f.properties.SIGLA_UF, area_km2: f.properties.AREA_KM2 }, geometry: f.geometry })) },
  { fonte: 'IBGE — malha municipal', data_ref: '2022', real: true });

// 2) Hidrografia (real, simplificada)
if (hidro) {
  const feicoes = [];
  let antes = 0, depois = 0;
  for (const f of hidro.features) {
    const linhas = f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [f.geometry.coordinates];
    const simplificadas = [];
    for (const l of linhas) {
      antes += l.length;
      const s = vetorial.simplificar(l, 0.0006); // ~60 m
      depois += s.length;
      if (s.length >= 2) simplificadas.push(s);
    }
    if (simplificadas.length) {
      feicoes.push({
        type: 'Feature',
        properties: { tipo: f.properties.Tipo || 'Curso d\'água', nome: f.properties.Tipo || '' },
        geometry: { type: 'MultiLineString', coordinates: simplificadas },
      });
    }
  }
  escrever('hidrografia', { features: feicoes },
    { fonte: 'Base hidrográfica do projeto (simplificada de ' + antes.toLocaleString('pt-BR') + ' para ' + depois.toLocaleString('pt-BR') + ' vértices)', data_ref: '2024', real: true });
} else {
  console.log('  hidrografia            (não encontrada na origem)');
}

// 3) Geologia (sintética, 5 unidades em faixas)
{
  const classes = [
    { unidade: 'Formação Corumbataí', litologia: 'siltito e argilito', idade: 'Permiano' },
    { unidade: 'Formação Piramboia', litologia: 'arenito fino', idade: 'Jurássico' },
    { unidade: 'Formação Serra Geral', litologia: 'basalto', idade: 'Cretáceo' },
    { unidade: 'Depósitos aluvionares', litologia: 'areia e cascalho', idade: 'Quaternário' },
    { unidade: 'Grupo Itararé', litologia: 'arenito e diamictito', idade: 'Carbonífero' },
  ];
  const feicoes = [];
  const faixas = faixasLongitudinais(5, 0);
  faixas.forEach((faixa, i) => {
    const g = recortarPeloMunicipio({ type: 'Polygon', coordinates: [faixa] });
    if (!g) return;
    feicoes.push({ type: 'Feature', properties: Object.assign({ id: i + 1 }, classes[i]), geometry: g });
  });
  escrever('geologia', { features: feicoes }, { fonte: 'EXEMPLO SINTÉTICO — não usar em estudo', data_ref: 'exemplo', real: false });
}

// 4) Geomorfologia (sintética, faixas latitudinais)
{
  const classes = [
    { forma: 'Planície aluvial', relevo: 'plano', declividade_media: '0 a 3%' },
    { forma: 'Colinas amplas', relevo: 'suave ondulado', declividade_media: '3 a 8%' },
    { forma: 'Colinas médias', relevo: 'ondulado', declividade_media: '8 a 20%' },
    { forma: 'Morrotes', relevo: 'forte ondulado', declividade_media: '20 a 45%' },
    { forma: 'Escarpas', relevo: 'montanhoso', declividade_media: 'acima de 45%' },
  ];
  const feicoes = [];
  faixasLatitudinais(5).forEach((faixa, i) => {
    const g = recortarPeloMunicipio({ type: 'Polygon', coordinates: [faixa] });
    if (!g) return;
    feicoes.push({ type: 'Feature', properties: Object.assign({ id: i + 1 }, classes[i]), geometry: g });
  });
  escrever('geomorfologia', { features: feicoes }, { fonte: 'EXEMPLO SINTÉTICO — não usar em estudo', data_ref: 'exemplo', real: false });
}

// 5) Solos (sintética, cruzando as duas direções para gerar manchas variadas)
{
  const classes = [
    { classe: 'Latossolo Vermelho', textura: 'argilosa', fertilidade: 'baixa', aptidao: 'lavoura mecanizada' },
    { classe: 'Latossolo Vermelho-Amarelo', textura: 'média', fertilidade: 'baixa a média', aptidao: 'lavoura e pastagem' },
    { classe: 'Argissolo Vermelho-Amarelo', textura: 'média a argilosa', fertilidade: 'média', aptidao: 'pastagem e silvicultura' },
    { classe: 'Neossolo Quartzarênico', textura: 'arenosa', fertilidade: 'muito baixa', aptidao: 'vegetação natural' },
    { classe: 'Gleissolo', textura: 'argilosa', fertilidade: 'média', aptidao: 'área úmida, restrição legal' },
    { classe: 'Nitossolo', textura: 'muito argilosa', fertilidade: 'alta', aptidao: 'lavoura' },
  ];
  const feicoes = [];
  faixasLongitudinais(3, 0.6).forEach((fx, i) => {
    faixasLatitudinais(2).forEach((fy, j) => {
      const classe = classes[(i * 2 + j) % classes.length];
      const g1 = recortarPeloMunicipio({ type: 'Polygon', coordinates: [fx] });
      if (!g1) return;
      // recorta a faixa horizontal pela vertical usando interseção de anéis
      const aneis = g1.type === 'Polygon' ? g1.coordinates : g1.coordinates.flat();
      const pedacos = [];
      for (const anel of aneis) {
        const r = vetorial.intersecaoUm(anel, fy, {});
        for (const p of r) pedacos.push(p);
      }
      if (!pedacos.length) return;
      const geom = pedacos.length === 1 ? { type: 'Polygon', coordinates: [pedacos[0]] } : { type: 'MultiPolygon', coordinates: pedacos.map((p) => [p]) };
      feicoes.push({ type: 'Feature', properties: Object.assign({ id: i * 2 + j + 1 }, classe), geometry: geom });
    });
  });
  escrever('solos', { features: feicoes }, { fonte: 'EXEMPLO SINTÉTICO — não usar em estudo', data_ref: 'exemplo', real: false });
}

// 6) Declividade (sintética, 4 classes)
{
  const classes = [
    { classe: '0 a 3% (plano)', risco_erosao: 'muito baixo' },
    { classe: '3 a 8% (suave ondulado)', risco_erosao: 'baixo' },
    { classe: '8 a 20% (ondulado)', risco_erosao: 'médio' },
    { classe: '20 a 45% (forte ondulado)', risco_erosao: 'alto' },
  ];
  const feicoes = [];
  const faixas = faixasLongitudinais(4, 1.1);
  faixas.forEach((faixa, i) => {
    const g = recortarPeloMunicipio({ type: 'Polygon', coordinates: [faixa] });
    if (!g) return;
    feicoes.push({ type: 'Feature', properties: Object.assign({ id: i + 1 }, classes[i % classes.length]), geometry: g });
  });
  escrever('declividade', { features: feicoes }, { fonte: 'EXEMPLO SINTÉTICO — não usar em estudo', data_ref: 'exemplo', real: false });
}

// 7) Uso do solo (sintética, mosaico)
{
  const classes = [
    { classe: 'Cana-de-açúcar', grupo: 'agricultura', area_observada: '' },
    { classe: 'Pastagem', grupo: 'pecuária', area_observada: '' },
    { classe: 'Floresta nativa', grupo: 'vegetação natural', area_observada: '' },
    { classe: 'Silvicultura (eucalipto)', grupo: 'silvicultura', area_observada: '' },
    { classe: 'Área urbana', grupo: 'área antrópica', area_observada: '' },
    { classe: 'Corpo d\'água', grupo: 'recursos hídricos', area_observada: '' },
    { classe: 'Cultura anual', grupo: 'agricultura', area_observada: '' },
    { classe: 'Vegetação secundária', grupo: 'vegetação natural', area_observada: '' },
  ];
  const feicoes = [];
  const fx = faixasLongitudinais(4, 0.4);
  const fy = faixasLatitudinais(2);
  let n = 0;
  fx.forEach((a, i) => {
    fy.forEach((b, j) => {
      const classe = classes[(i * 2 + j) % classes.length];
      const g1 = recortarPeloMunicipio({ type: 'Polygon', coordinates: [a] });
      if (!g1) return;
      const aneis = g1.type === 'Polygon' ? g1.coordinates : g1.coordinates.flat();
      const pedacos = [];
      for (const anel of aneis) {
        const r = vetorial.intersecaoUm(anel, b, {});
        for (const p of r) pedacos.push(p);
      }
      if (!pedacos.length) return;
      n++;
      const geom = pedacos.length === 1 ? { type: 'Polygon', coordinates: [pedacos[0]] } : { type: 'MultiPolygon', coordinates: pedacos.map((p) => [p]) };
      feicoes.push({ type: 'Feature', properties: Object.assign({ id: n }, classe), geometry: geom });
    });
  });
  escrever('uso-do-solo', { features: feicoes }, { fonte: 'EXEMPLO SINTÉTICO — não usar em estudo', data_ref: 'exemplo', real: false });
}

// 8) Vegetação (sintética, a partir dos bairros reais, agrupados em 3 fitofisionomias)
if (bairros) {
  const classes = [
    { fitofisionomia: 'Floresta Estacional Semidecidual', estagio: 'secundária inicial', relevancia: 'média' },
    { fitofisionomia: 'Floresta Estacional Semidecidual', estagio: 'secundária média', relevancia: 'alta' },
    { fitofisionomia: 'Cerrado', estagio: 'sensu stricto', relevancia: 'alta' },
    { fitofisionomia: 'Formação pioneira', estagio: 'várzea', relevancia: 'média' },
  ];
  const feicoes = bairros.features.map((f, i) => ({
    type: 'Feature',
    properties: Object.assign({ id: i + 1, localidade: f.properties.Nome }, classes[i % classes.length]),
    geometry: f.geometry,
  }));
  escrever('vegetacao', { features: feicoes }, { fonte: 'EXEMPLO SINTÉTICO sobre a divisão por bairros do projeto', data_ref: 'exemplo', real: false });
}

// 9) Zoneamento (real)
if (zoneamento) {
  const feicoes = zoneamento.features.map((f) => ({
    type: 'Feature',
    properties: {
      sigla: f.properties.Sigla || f.properties.Zona_final || f.properties.Zonas || 'Zona',
      zona: f.properties.Zoneamento || f.properties.Zonas || '',
    },
    geometry: f.geometry,
  }));
  escrever('zoneamento', { features: feicoes }, { fonte: 'Zoneamento municipal fornecido ao projeto', data_ref: '2024', real: true });
}

// 10) Áreas de influência de exemplo (para o usuário testar de imediato)
{
  const centro = [(bboxMunicipio[0] + bboxMunicipio[2]) / 2, (bboxMunicipio[1] + bboxMunicipio[3]) / 2];
  const raio = 0.06;
  const anel = [];
  for (let i = 0; i < 40; i++) {
    const t = 2 * Math.PI * i / 40;
    anel.push([centro[0] + raio * Math.cos(t) * 1.25, centro[1] + raio * Math.sin(t)]);
  }
  anel.push(anel[0].slice());
  const interno = [];
  for (let i = 0; i < 32; i++) {
    const t = 2 * Math.PI * i / 32;
    interno.push([centro[0] + raio * 0.35 * Math.cos(t), centro[1] + raio * 0.32 * Math.sin(t)]);
  }
  interno.push(interno[0].slice());
  const feicoes = [
    { type: 'Feature', properties: { sigla: 'AID', nome: 'Área de Influência Direta (exemplo)', tipo: 'exemplo' }, geometry: { type: 'Polygon', coordinates: [anel] } },
    { type: 'Feature', properties: { sigla: 'ADA', nome: 'Área Diretamente Afetada (exemplo)', tipo: 'exemplo' }, geometry: { type: 'Polygon', coordinates: [interno] } },
  ];
  escrever('areas-influencia-exemplo', { features: feicoes }, { fonte: 'EXEMPLO SINTÉTICO — áreas de influência fictícias', data_ref: 'exemplo', real: false });
}

// --------------------------------------------------------------- catálogo
const catalogo = {
  versao: 1,
  gerado_em: new Date().toISOString(),
  aviso: 'As camadas marcadas com fonte "EXEMPLO SINTÉTICO" servem para demonstrar o fluxo. Substitua por dado oficial antes de usar no estudo.',
  meios: [
    { id: 'fisico', nome: 'Meio Físico', cor: '#8a6d3b' },
    { id: 'biotico', nome: 'Meio Biótico', cor: '#2f6b3a' },
    { id: 'socioeconomico', nome: 'Meio Socioeconômico', cor: '#2f5b8a' },
  ],
  camadas: [
    { id: 'geologia', nome: 'Geologia', meio: 'fisico', tipo: 'poligono', arquivo: 'data/geologia.geojson', campo_classe: 'unidade', estilo: { cor: '#c8a165', opacidade: 0.35 }, fonte: 'EXEMPLO SINTÉTICO', data_ref: 'exemplo', obs: 'Substituir por carta geológica oficial (CPRM).' },
    { id: 'geomorfologia', nome: 'Geomorfologia', meio: 'fisico', tipo: 'poligono', arquivo: 'data/geomorfologia.geojson', campo_classe: 'forma', estilo: { cor: '#b08d5a', opacidade: 0.3 }, fonte: 'EXEMPLO SINTÉTICO', data_ref: 'exemplo', obs: '' },
    { id: 'solos', nome: 'Solos', meio: 'fisico', tipo: 'poligono', arquivo: 'data/solos.geojson', campo_classe: 'classe', estilo: { cor: '#8a6d3b', opacidade: 0.3 }, fonte: 'EXEMPLO SINTÉTICO', data_ref: 'exemplo', obs: '' },
    { id: 'declividade', nome: 'Declividade', meio: 'fisico', tipo: 'poligono', arquivo: 'data/declividade.geojson', campo_classe: 'classe', estilo: { cor: '#a8763b', opacidade: 0.3 }, fonte: 'EXEMPLO SINTÉTICO', data_ref: 'exemplo', obs: 'No uso real, gerar do MDE (SRTM ou LiDAR).' },
    { id: 'hidrografia', nome: 'Hidrografia', meio: 'fisico', tipo: 'linha', arquivo: 'data/hidrografia.geojson', campo_classe: 'tipo', estilo: { cor: '#2f5b8a', opacidade: 0 }, fonte: 'Base hidrográfica do projeto', data_ref: '2024', obs: 'Simplificada para 60 m: confira a escala antes de usar em 1:5.000.' },
    { id: 'vegetacao', nome: 'Vegetação', meio: 'biotico', tipo: 'poligono', arquivo: 'data/vegetacao.geojson', campo_classe: 'fitofisionomia', estilo: { cor: '#2f6b3a', opacidade: 0.35 }, fonte: 'EXEMPLO SINTÉTICO', data_ref: 'exemplo', obs: '' },
    { id: 'uso-do-solo', nome: 'Uso e ocupação do solo', meio: 'biotico', tipo: 'poligono', arquivo: 'data/uso-do-solo.geojson', campo_classe: 'classe', estilo: { cor: '#6b8a2f', opacidade: 0.3 }, fonte: 'EXEMPLO SINTÉTICO', data_ref: 'exemplo', obs: 'Substituir por classificação oficial ou obtida por sensoriamento remoto.' },
    { id: 'limite-municipal', nome: 'Limite municipal', meio: 'socioeconomico', tipo: 'poligono', arquivo: 'data/limite-municipal.geojson', campo_classe: 'nome', estilo: { cor: '#1f2d36', opacidade: 0 }, fonte: 'IBGE — malha municipal', data_ref: '2022', obs: '' },
    { id: 'zoneamento', nome: 'Zoneamento municipal', meio: 'socioeconomico', tipo: 'poligono', arquivo: 'data/zoneamento.geojson', campo_classe: 'sigla', estilo: { cor: '#8a5fd9', opacidade: 0.28 }, fonte: 'Zoneamento fornecido ao projeto', data_ref: '2024', obs: '' },
  ],
};
fs.writeFileSync(path.join(destino, 'catalogo.json'), JSON.stringify(catalogo, null, 2));
console.log('\n  catalogo.json          ' + catalogo.camadas.length + ' camadas');
console.log('\nPronto. Camadas de exemplo em data/.');
