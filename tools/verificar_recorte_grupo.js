'use strict';
/* Reproduz o recorte em camada do GRUPO, com área de influência onde EXISTE dado:
 *  - UGRHI 5 + a área de influência de exemplo (10 pedaços cruzam, medido);
 *  - UGRHI 3 + uma caixa dentro do Litoral Norte.
 * Temporário. */
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const EIA = {
  math: require(path.join(raiz, 'js', 'math.js')),
  vetorial: require(path.join(raiz, 'js', 'vetorial.js')),
  recorte: require(path.join(raiz, 'js', 'recorte.js')),
  tiles: require(path.join(raiz, 'js', 'tiles.js')),
};
global.EIA = EIA;
const camadas = require(path.join(raiz, 'tools', 'verificacoes', '_camadas.js'));

const cat = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'catalogo.json'), 'utf8'));
const grupo = cat.camadas.find((x) => x.id === 'inventario-florestal');
const exemplo = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'areas-influencia-exemplo.geojson'), 'utf8'));

function areaDeExemplo() {
  return exemplo.features.map((f, i) => ({
    id: 'ai' + i, nome: f.properties.nome || 'AI ' + i, sigla: 'AI' + i,
    geometry: f.geometry, area_ha: f.properties.area_ha || 0,
  }));
}
function areaCaixa(nome, caixa) {
  return [{
    id: 'cx', nome: nome, sigla: 'CX',
    geometry: {
      type: 'Polygon',
      coordinates: [[[caixa[0], caixa[1]], [caixa[2], caixa[1]], [caixa[2], caixa[3]], [caixa[0], caixa[3]], [caixa[0], caixa[1]]]],
    },
    area_ha: 0,
  }];
}

function montar(camada) {
  const ativa = Object.assign({}, camada, { geojson: { type: 'FeatureCollection', features: [] } });
  const ind = JSON.parse(fs.readFileSync(path.join(raiz, camada.tiles), 'utf8'));
  for (const t of ind.tiles) {
    const fc = EIA.tiles.decodificar(camadas.lerTile(path.join(raiz, t.arquivo)));
    for (const f of fc.features) ativa.geojson.features.push(f);
  }
  return ativa;
}

const casos = [
  { id: 'inventario-ugrhi-5', nome: 'UGRHI 5 + área de exemplo', areas: areaDeExemplo() },
  { id: 'inventario-ugrhi-3', nome: 'UGRHI 3 + caixa no Litoral Norte (-45.5,-23.8 a -45.2,-23.5)', areas: areaCaixa('Litoral Norte', [-45.5, -23.8, -45.2, -23.5]) },
  { id: 'geologia', nome: 'geologia + área de exemplo (controle, já funciona)', areas: areaDeExemplo() },
];

for (const caso of casos) {
  const bruta = grupo.filhos ? grupo.filhos.concat(cat.camadas).find((c) => c.id === caso.id) : null;
  const camada = bruta || cat.camadas.find((c) => c.id === caso.id);
  console.log('=== ' + caso.nome);
  if (!camada) { console.log('    camada não encontrada'); continue; }
  console.log('    tipo: ' + JSON.stringify(camada.tipo) + '   campo_classe: ' + camada.campo_classe
    + '   tem campos: ' + !!(camada.campos && camada.campos.length) + '   tem classes: ' + !!(camada.classes && camada.classes.length));
  const ativa = montar(camada);
  console.log('    feições carregadas: ' + ativa.geojson.features.length.toLocaleString('pt-BR'));
  const r = EIA.recorte.recortarTudo(caso.areas, [ativa], { operacao: 'intersecao', areaMinimaHa: 0, simplificar: 0 });
  const res = r.resultados || [];
  const n = res.reduce((s, x) => s + (x.features ? x.features.length : 0), 0);
  const ha = res.reduce((s, x) => s + (x.features || []).reduce((t, f) => t + (Number(f.properties.eia_area_ha) || 0), 0), 0);
  console.log('    RESULTADO: ' + n + ' feições recortadas' + (ha ? ', ' + ha.toFixed(2) + ' ha' : '')
    + (n === 0 ? '   <-- VAZIO' : ''));
  console.log('');
}
