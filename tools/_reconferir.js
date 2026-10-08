'use strict';
/* Reconferência dos arquivos reais do cliente depois da correção do recorte.
 * Temporário. */
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const shapelib = require(path.join(raiz, 'js', 'shapelib.js'));
const crs = require(path.join(raiz, 'js', 'crs.js'));
const tiles = require(path.join(raiz, 'js', 'tiles.js'));
const recorte = require(path.join(raiz, 'js', 'recorte.js'));
const camadas = require(path.join(raiz, 'tools', 'verificacoes', '_camadas.js'));
global.EIA = { math: require(path.join(raiz, 'js', 'math.js')), vetorial: require(path.join(raiz, 'js', 'vetorial.js')), recorte: recorte, tiles: tiles };

(async () => {
  // a UGRHI 3 e a Geologia, para cruzar duas camadas diferentes
  const cat = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'catalogo.json'), 'utf8'));
  const filhos = cat.camadas.find((x) => x.id === 'inventario-florestal').filhos;
  const preparar = (camada) => {
    const ativa = Object.assign({}, camada, { geojson: { type: 'FeatureCollection', features: [] } });
    const ind = JSON.parse(fs.readFileSync(path.join(raiz, camada.tiles), 'utf8'));
    for (const t of ind.tiles) {
      const fc = tiles.decodificar(camadas.lerTile(path.join(raiz, t.arquivo)));
      for (const f of fc.features) ativa.geojson.features.push(f);
    }
    return ativa;
  };
  const ugrhi3 = preparar(filhos.find((f) => f.id === 'inventario-ugrhi-3'));

  const pasta = 'D:\\Geotec\\95.EIA TAMOIOS\\SIG\\VETOR\\Áreas de Influência';
  const arquivos = fs.readdirSync(pasta).filter((n) => /\.zip$/i.test(n)).sort();

  console.log('  arquivo                              anéis   UGRHI 3 (feições/ha)');
  for (const nome of arquivos) {
    try {
      const entradas = await shapelib.abrirZip(new Uint8Array(fs.readFileSync(path.join(pasta, nome))).buffer);
      const lido = shapelib.abrirShapefile(entradas);
      const epsg = crs.epsgDoPrj(lido.prj || '');
      const g = epsg ? crs.transformarGeoJson(lido.geojson, epsg, 'EPSG:4326') : lido.geojson;
      let aneis = 0;
      for (const f of g.features) {
        const partes = require(path.join(raiz, 'js', 'math.js')).aneisDe(f.geometry);
        for (const p of partes) aneis += p.length;
      }
      const areas = g.features.map((f, i) => ({ id: 'ai' + i, nome: nome, sigla: 'AI', geometry: f.geometry, area_ha: 0 }));
      const r = recorte.recortarTudo(areas, [ugrhi3], { operacao: 'intersecao', areaMinimaHa: 0, simplificar: 0 });
      const n = (r.resultados || []).reduce((s, x) => s + (x.features ? x.features.length : 0), 0);
      const ha = (r.resultados || []).reduce((s, x) => s + (x.features || []).reduce((t, f) => s + (Number(f.properties.eia_area_ha) || 0), 0), 0);
      console.log('  ' + nome.replace(/\.zip$/i, '').padEnd(36) + String(aneis).padStart(6)
        + '   ' + String(n).padStart(6) + ' feições' + (ha ? ', ' + ha.toFixed(1) + ' ha' : '')
        + (n === 0 ? '   <-- ainda vazio' : ''));
    } catch (e) {
      console.log('  ' + nome.padEnd(36) + '   ERRO: ' + e.message.slice(0, 80));
    }
  }
})().catch((e) => { console.error('FALHOU: ' + e.message); process.exit(1); });
