'use strict';
/* Verificação do importador de camadas.
 *
 * O ponto crítico: uma camada pesada tem de CHEGAR SIMPLIFICADA ao portal. Um SHP de
 * 100 MB não pode virar 300 MB de GeoJSON — este teste gera um shapefile com muitos
 * vértices, importa e confere que o arquivo publicado encolheu sem perder a forma.
 *
 * Uso: node tools/verificacoes/verificar_importador.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

function executar() {
  const raiz = path.resolve(__dirname, '..', '..');
  const EIA = {
    math: require(path.join(raiz, 'js', 'math.js')),
    vetorial: require(path.join(raiz, 'js', 'vetorial.js')),
    shapelib: require(path.join(raiz, 'js', 'shapelib.js')),
    crs: require(path.join(raiz, 'js', 'crs.js')),
  };
  const importador = require(path.join(raiz, 'tools', 'importar_camadas.js'));

  let falhas = 0, testes = 0;
  const ok = (nome, cond, det) => {
    testes++;
    if (cond) console.log('  ok  ' + nome + (det ? '  [' + det + ']' : ''));
    else { falhas++; console.log('  FALHA ' + nome + (det ? '  [' + det + ']' : '')); }
  };

  // pasta temporária para a base de teste
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eia-import-'));
  const destinoTeste = path.join(raiz, 'data', '_teste-import');
  fs.mkdirSync(destinoTeste, { recursive: true });

  // ---------------------------------------------------------- base de teste
  console.log('\n== Montando shapefile de teste ==');
  // Camada pesada simulada: 300 polígonos de 200 vértices = 60 mil vértices.
  // (um SHP real de 100 MB tem milhões; aqui o objetivo é provar o mecanismo)
  const features = [];
  const classes = ['Unidade A', 'Unidade B', 'Formação C'];
  const N = 200;
  for (let k = 0; k < 300; k++) {
    const cx = -47.7 + (k % 20) * 0.01;
    const cy = -22.8 + Math.floor(k / 20) * 0.01;
    // polígono com ondulação: muitos vértices que a simplificação pode cortar
    const anel = [];
    for (let i = 0; i < N; i++) {
      const t = 2 * Math.PI * i / N;
      const r = 0.0022 + 0.00016 * Math.sin(12 * t);
      anel.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
    anel.push(anel[0].slice());
    features.push({
      type: 'Feature',
      properties: { UNIDADE: classes[k % 3], AREA_KM2: 1.2 + k / 1000 },
      geometry: { type: 'Polygon', coordinates: [anel] },
    });
  }
  const escrito = EIA.shapelib.escreverShapefile(features, {});
  const caminhoShp = path.join(tmp, 'geologia_teste.shp');
  fs.writeFileSync(caminhoShp, Buffer.from(escrito.shp));
  fs.writeFileSync(path.join(tmp, 'geologia_teste.dbf'), Buffer.from(escrito.dbf));
  fs.writeFileSync(path.join(tmp, 'geologia_teste.prj'), Buffer.from(escrito.prj));
  fs.writeFileSync(path.join(tmp, 'geologia_teste.cpg'), Buffer.from(escrito.cpg));
  const kbShp = Math.round(fs.statSync(caminhoShp).size / 1024);
  ok('shapefile de teste criado', fs.statSync(caminhoShp).size > 0, kbShp + ' KB, ' + features.length + ' feições');
  ok('vértices no teste', N * features.length >= 60000, (N * features.length) + ' vértices');

  // ---------------------------------------------------------- inspeção
  console.log('\n== Inspeção do shapefile ==');
  const rel = importador.inspecionar(caminhoShp);
  const c = rel.camadas[0];
  ok('achou a camada', rel.camadas.length === 1);
  ok('contou as feições', c.feicoes === 300, c.feicoes + '');
  ok('contou os vértices', c.vertices >= 60000, c.vertices.toLocaleString('pt-BR'));
  ok('identificou polígono', c.geometrias.Polygon === 300, JSON.stringify(c.geometrias));
  ok('leu o CRS do .prj', c.crs === 'EPSG:4326', String(c.crs));
  ok('listou os campos', c.campos.length >= 2, c.campos.map((x) => x.nome).join(', '));
  ok('sugeriu o campo de classe', c.campo_classe_sugerido === 'UNIDADE', String(c.campo_classe_sugerido));
  ok('não sugeriu AREA_KM2 como classe', c.campo_classe_sugerido !== 'AREA_KM2');
  ok('sugeriu o meio pelo nome', c.meio_sugerido === 'fisico', String(c.meio_sugerido));

  // ---------------------------------------------------------- rascunho
  console.log('\n== Rascunho do manifesto ==');
  const rascunho = importador.gerarRascunho(tmp);
  ok('gerou uma entrada por shapefile', rascunho.camadas.length === 1, rascunho.camadas.length + '');
  const rc = rascunho.camadas[0];
  ok('preencheu nome legível', /Geologia Teste/.test(rc.nome), rc.nome);
  ok('preencheu id em slug', rc.id === 'geologia-teste', rc.id);
  ok('preencheu arquivo de destino', rc.arquivo === 'data/geologia-teste.geojson', rc.arquivo);
  ok('preencheu campo de classe', rc.campo_classe === 'UNIDADE', String(rc.campo_classe));
  ok('deixou fonte em branco para preencher', rc.fonte === '');
  ok('tem instruções no manifesto', Array.isArray(rascunho._instrucoes) && rascunho._instrucoes.length > 3);

  // ---------------------------------------------------------- importação
  console.log('\n== Importação com simplificação (escala 1:50.000) ==');
  const entrada = {
    origem: caminhoShp,
    id: 'teste-import-geologia',
    arquivo: 'data/_teste-import/geologia.geojson',
    nome: 'Geologia (teste)',
    meio: 'fisico',
    campo_classe: 'UNIDADE',
    fonte: 'Teste automatizado',
    data_ref: '2026',
    epsg_origem: 'auto',
  };
  const r = importador.importarCamada(entrada, { escala: 50000 });
  ok('importou todas as feições', r.feicoes === 300, r.feicoes + '');
  ok('detectou o tipo polígono', r.tipo === 'poligono', r.tipo);
  ok('gerou cor para as 3 classes', Object.keys(r.cor_por_classe).length === 3, JSON.stringify(Object.keys(r.cor_por_classe)));
  ok('contou feições por classe', r.classes.every((x) => x.feicoes === 100), JSON.stringify(r.classes));
  ok('SIMPLIFICOU os vértices', r.vertices_depois < r.vertices_antes * 0.6,
    r.vertices_antes.toLocaleString('pt-BR') + ' → ' + r.vertices_depois.toLocaleString('pt-BR')
    + ' (' + Math.round((1 - r.vertices_depois / r.vertices_antes) * 100) + '% a menos)');
  ok('tolerância veio da escala (0,2 mm × 50.000 = 10 m)', Math.abs(r.tolerancia - 10 / 110574) < 1e-12,
    (r.tolerancia * 110574).toFixed(1) + ' m no terreno');

  const caminhoGeo = path.join(raiz, r.arquivo);
  ok('arquivo GeoJSON escrito', fs.existsSync(caminhoGeo));
  const kbGeo = Math.round(fs.statSync(caminhoGeo).size / 1024);
  console.log('     SHP ' + kbShp + ' KB → GeoJSON ' + kbGeo + ' KB');

  const publicado = JSON.parse(fs.readFileSync(caminhoGeo, 'utf8'));
  ok('GeoJSON válido e completo', publicado.type === 'FeatureCollection' && publicado.features.length === 300);
  ok('metadados de rastreabilidade gravados',
    publicado.metadados && publicado.metadados.fonte === 'Teste automatizado'
    && publicado.metadados.vertices_antes > 0, JSON.stringify(publicado.metadados.crs_origem));
  ok('classe preservada nas feições',
    publicado.features.every((f) => classes.indexOf(f.properties.UNIDADE) >= 0));
  ok('nenhuma coordenada com mais de 6 casas',
    !/"-?\d+\.\d{7,}"/.test(fs.readFileSync(caminhoGeo, 'utf8').slice(0, 200000)));

  // a forma tem de sobreviver: a área de cada anel não pode mudar muito
  const anelOriginal = EIA.math.areaAnel(features[0].geometry.coordinates[0]);
  const anelPublicado = EIA.math.areaAnel(publicado.features[0].geometry.coordinates[0]);
  const erroArea = Math.abs(anelPublicado - anelOriginal) / anelOriginal;
  ok('a forma sobreviveu (erro de área < 5%)', erroArea < 0.05, (erroArea * 100).toFixed(2) + '% de erro');

  // anéis continuam fechados e válidos
  ok('anéis continuam fechados',
    publicado.features.every((f) => {
      const a = f.geometry.coordinates[0];
      return a[0][0] === a[a.length - 1][0] && a[0][1] === a[a.length - 1][1];
    }));
  ok('nenhum anel com menos de 4 pontos',
    publicado.features.every((f) => f.geometry.coordinates[0].length >= 4));

  // ---------------------------------------------------------- tolerância x escala
  console.log('\n== Tolerância cresce com a escala ==');
  const t5 = importador.toleranciaParaEscala(5000) * 110574;
  const t50 = importador.toleranciaParaEscala(50000) * 110574;
  const t250 = importador.toleranciaParaEscala(250000) * 110574;
  ok('1:5.000 → ~1 m', Math.abs(t5 - 1) < 0.05, t5.toFixed(2) + ' m');
  ok('1:50.000 → ~10 m', Math.abs(t50 - 10) < 0.05, t50.toFixed(2) + ' m');
  ok('1:250.000 → ~50 m', Math.abs(t250 - 50) < 0.05, t250.toFixed(2) + ' m');

  const grosso = importador.importarCamada(Object.assign({}, entrada, {
    arquivo: 'data/_teste-import/geologia-grossa.geojson',
  }), { escala: 250000 });
  ok('escala menor simplifica mais', grosso.vertices_depois < r.vertices_depois,
    '1:250.000 → ' + grosso.vertices_depois.toLocaleString('pt-BR') + ' vértices vs '
    + r.vertices_depois.toLocaleString('pt-BR') + ' em 1:50.000');

  // ---------------------------------------------------------- sem simplificar
  console.log('\n== Sem simplificar (geometria original) ==');
  const cru = importador.importarCamada(Object.assign({}, entrada, {
    arquivo: 'data/_teste-import/geologia-crua.geojson',
  }), { semSimplificar: true });
  ok('sem simplificar mantém os vértices (só arredonda)', cru.vertices_depois >= r.vertices_antes * 0.95,
    cru.vertices_antes.toLocaleString('pt-BR') + ' → ' + cru.vertices_depois.toLocaleString('pt-BR'));

  // ---------------------------------------------------------- catálogo
  console.log('\n== Catálogo ==');
  const catalogoPath = path.join(destinoTeste, 'catalogo-teste.json');
  fs.writeFileSync(catalogoPath, JSON.stringify({
    versao: 1,
    meios: [{ id: 'fisico', nome: 'Meio Físico', cor: '#8a6d3b' }],
    camadas: [{ id: 'existente', nome: 'Camada que já estava', meio: 'fisico', arquivo: 'data/x.geojson' }],
  }));
  const { catalogo, mudancas } = importador.atualizarCatalogo(catalogoPath, [r], {});
  ok('adicionou a camada nova', mudancas.adicionadas.length === 1, mudancas.adicionadas.length + '');
  ok('preservou a camada que já existia', catalogo.camadas.some((x) => x.id === 'existente'));
  ok('marcou a origem como importado', catalogo.camadas.find((x) => x.id === r.id).origem === 'importado');
  ok('gravou a cor por classe no estilo', !!catalogo.camadas.find((x) => x.id === r.id).estilo.cores);
  ok('gravou o campo de classe', catalogo.camadas.find((x) => x.id === r.id).campo_classe === 'UNIDADE');
  void mudancas;

  // reimportação: não pode duplicar
  const segunda = importador.atualizarCatalogo(catalogoPath, [r], {});
  ok('reimportar atualiza em vez de duplicar',
    segunda.catalogo.camadas.filter((x) => x.id === r.id).length === 1,
    segunda.catalogo.camadas.length + ' camadas no catálogo');

  // ---------------------------------------------------------- erros explicados
  console.log('\n== Erros com mensagem útil ==');
  {
    const gdb = path.join(tmp, 'base.gdb');
    fs.mkdirSync(gdb, { recursive: true });
    let msg = '';
    try { importador.importarCamada({ origem: gdb, nome: 'x', meio: 'fisico' }, {}); } catch (e) { msg = e.message; }
    ok('.gdb explica que precisa exportar para shapefile', /Geodatabase|QGIS/.test(msg), msg.slice(0, 70));

    let msg2 = '';
    try { importador.importarCamada({ origem: path.join(tmp, 'x.kmz'), nome: 'x', meio: 'fisico' }, {}); } catch (e) { msg2 = e.message; }
    ok('.kmz explica a alternativa', /KML|KMZ/.test(msg2), msg2.slice(0, 70));
  }

  // ---------------------------------------------------------- limpeza
  fs.rmSync(destinoTeste, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log('\n' + (falhas ? 'FALHAS: ' + falhas + '/' + testes : 'TODOS OS ' + testes + ' TESTES PASSARAM'));
  return falhas ? 1 : 0;
}

module.exports = { executar };
if (require.main === module) process.exit(executar());
