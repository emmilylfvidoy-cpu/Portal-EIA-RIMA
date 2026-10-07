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
  const rascunho = importador.gerarRascunho(tmp).manifesto;
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

  // ---------------------------------------------------------- campo de classe
  console.log('\n== Escolha do campo de classe ==');
  {
    // Caso real: camada de uso do solo do cliente. "Rodovia" tem 2 valores (a rodovia do
    // trecho) e "Nível_II" tem 11 (a classe de uso). A heurística antiga escolhia Rodovia
    // só por ter menos valores — e a tabela do EIA sairia agrupada por rodovia.
    const campos = [
      { nome: 'Rodovia', tipo: 'C' }, { nome: 'Área', tipo: 'F' },
      { nome: 'Nível_I', tipo: 'C' }, { nome: 'Nível_II', tipo: 'C' },
    ];
    const registros = [];
    const nivel1 = ['Antrópico', 'Vegetação'];
    const nivel2 = ['Pastagem', 'Cana', 'Mata', 'Cerrado', 'Urbano', 'Água', 'Silvicultura', 'Cultura', 'Solo exposto', 'Campo', 'Várzea'];
    for (let k = 0; k < 120; k++) {
      registros.push({ Rodovia: k % 2 === 0 ? 'SP-160' : 'SP-55', Área: 1.5, 'Nível_I': nivel1[k % 2], 'Nível_II': nivel2[k % 11] });
    }
    const melhor = importador.adivinharCampoClasse(campos, registros);
    ok('nao escolhe a coluna de identificador (Rodovia)', melhor !== 'Rodovia', String(melhor));
    ok('escolhe um campo de classe de verdade', /Nível/.test(String(melhor)), String(melhor));
    ok('nao escolhe campo numerico de medida (Área)', melhor !== 'Área');
    const cands = importador.candidatosCampoClasse(campos, registros, 4);
    ok('lista alternativas em ordem', cands.length >= 2 && cands[0].nota >= cands[1].nota,
      cands.map((c) => c.campo + '(' + c.distintos + ')').join(' > '));
    ok('a alternativa inclui o outro nível', cands.some((c) => c.campo === 'Nível_II'),
      cands.map((c) => c.campo).join(','));

    // Nome próprio: numa camada pequena ele É a classe (o nome do quilombo)
    const camposQ = [{ nome: 'Rodovia', tipo: 'C' }, { nome: 'km', tipo: 'C' }, { nome: 'Denominaç', tipo: 'C' }];
    const regQ = [{ Rodovia: 'SP-55', km: '10', 'Denominaç': 'Quilombo A' }, { Rodovia: 'SP-55', km: '20', 'Denominaç': 'Quilombo B' }];
    ok('camada pequena: nome proprio vira classe', importador.adivinharCampoClasse(camposQ, regQ) === 'Denominaç',
      String(importador.adivinharCampoClasse(camposQ, regQ)));
  }

  // ---------------------------------------------------------- nome da camada
  console.log('\n== Nome de exibição da camada ==');
  {
    // Com fronteira ASCII (\b\w), o acento conta como fim de palavra e a letra
    // seguinte vira maiúscula: "Malha RodoviáRia". Em português isso atinge quase tudo.
    const casos = [
      ['2.2.a1. Malha rodoviária', '2.2.a1. Malha rodoviária'],
      ['3.1. Uso do solo, ocupação e cobertura da terra', '3.1. Uso do solo, ocupação e cobertura da terra'],
      ['3.4 Recursos Hídricos', '3.4 Recursos Hídricos'],
      ['LIMITE_MUNICIPAL', 'Limite Municipal'],
      ['geologia teste', 'Geologia Teste'],
      ['uso_do_solo', 'Uso Do Solo'],
      ['ÁREA_INDÍGENA', 'Área Indígena'],
    ];
    for (const [entrada, esperado] of casos) {
      const obtido = importador.tituloDe(entrada);
      ok('nome: ' + entrada.slice(0, 32), obtido === esperado, obtido === esperado ? undefined : 'saiu "' + obtido + '"');
    }
    ok('nome nao produz maiuscula depois de acento',
      !/á[A-Z]|ã[A-Z]|é[A-Z]|í[A-Z]|ó[A-Z]|ú[A-Z]/.test(importador.tituloDe('malha rodoviária e marcação quilométrica')),
      importador.tituloDe('malha rodoviária e marcação quilométrica'));
  }

  // ---------------------------------------------------------- nomenclatura
  console.log('\n== Símbolos estratigráficos (palavra -> símbolo) ==');
  {
    /* O .dbf não comporta γ δ β λ μ nem o Є do Cambriano, então o mapa antigo escreveu as
     * palavras. A troca é por texto literal com o sublinhado no padrão — é o sublinhado que
     * separa símbolo de palavra comum, e é o que impede "Betari", "Leque Deltaico" e
     * "Muscovita" de serem destruídos. */
    const SUB = {
      '_C_cortado_': 'Є', 'C_cortado_': 'Є',
      '_gamma_': 'γ', '_gamma': 'γ',
      '_delta_': 'δ', '_delta': 'δ',
      '_beta_': 'β', '_beta': 'β',
      '_lambda_': 'λ', '_lambda': 'λ',
      '_mu_': 'μ', '_mu': 'μ',
    };
    const t = (v) => importador.substituirEmTexto(v, SUB);

    const casos = [
      ['NP3p_gamma_2Ipe', 'NP3pγ2Ipe'],
      ['K1_beta_sg', 'K1βsg'],
      ['K1_delta_sg', 'K1δsg'],
      ['K1_lambda_ja', 'K1λja'],
      ['C_cortado_1a_gamma_4Igt', 'Є1aγ4Igt'],
      ['C_cortado_a_delta_4bm', 'Єaδ4bm'],
      ['NP3_C_cortado_1e', 'NP3Є1e'],
      ['NP3p_gamma_2', 'NP3pγ2'],
      ['NP3p_gamma_2I', 'NP3pγ2I'],
      ['NP3e_gamma', 'NP3eγ'],
      ['K_lambda', 'Kλ'],
      ['PPam_mu', 'PPamμ'],
      ['A34atg', 'A34atg'],
    ];
    for (const [de, para] of casos) {
      const saida = t(de);
      ok('  ' + de + ' -> ' + para, saida === para, saida === para ? undefined : 'saiu "' + saida + '"');
    }

    // OS FALSOS POSITIVOS: palavras comuns que contêm o nome da letra
    const intactos = ['Betari', 'Leque Deltaico', 'Muscovita', 'metavulcânica', 'Ponunduva',
      'Xistos e metarenitos', 'Serra Preta', 'granulítica'];
    for (const v of intactos) {
      ok('  "' + v + '" fica intacto', t(v) === v, t(v) === v ? undefined : 'virou "' + t(v) + '"');
    }

    // a paleta precisa ser re-chaveada junto, senão a cor deixa de casar com a classe
    const mapa = { 'NP3p_gamma_2Ipe': '#fd868c', 'K1_beta_sg': '#46cb83', 'A34atg': '#f5c4c8' };
    const novo = importador.reChavear(mapa, SUB);
    ok('paleta re-chaveada', !!novo['NP3pγ2Ipe'] && !!novo['K1βsg'] && !!novo['A34atg'],
      Object.keys(novo).join(', '));
    ok('cores preservadas na troca', novo['NP3pγ2Ipe'] === '#fd868c' && novo['K1βsg'] === '#46cb83');
    ok('nenhuma chave antiga sobra', !novo['NP3p_gamma_2Ipe'] && !novo['K1_beta_sg']);
  }

  // ---------------------------------------------------------- limpeza
  fs.rmSync(destinoTeste, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });


  console.log('\n== Faixa fina não pode ser apagada pela simplificação ==');
  {
    /* O DEFEITO QUE ISTO COBRE: numa camada de solos, as faixas finas (solo de vale) têm
     * 100-300 m de largura. Aplicar 400 m de tolerância APAGA a faixa — o anel vira um
     * sliver de área zero e o mapa fica com FENDAS, listras vazias onde a origem tinha solo.
     * O cliente viu isso como "feição estranha", e era: a Pedologia perdia 2,4% da área.
     *
     * A regra: nenhum anel é simplificado além de 1/4 da sua espessura aparente
     * (2·área/perímetro). Faixa fina sobrevive; anel grande continua com a tolerância global,
     * então o arquivo não engorda. */
    const GRAU_M = 111320;

    // retângulo de 200 m x 5 km: a faixa fina que estava sendo apagada
    const larg = 200 / GRAU_M, comp = 5000 / GRAU_M;
    const pontos = [];
    const passos = 200;
    for (let i = 0; i <= passos; i++) pontos.push([-47 + comp * i / passos, -22]);
    for (let i = passos; i >= 0; i--) pontos.push([-47 + comp * i / passos, -22 + larg]);
    pontos.push(pontos[0].slice());
    const anel = pontos;

    const areaGraus = (a) => {
      let s = 0;
      for (let i = 0, j = a.length - 1; i < a.length; j = i++) s += (a[j][0] * a[i][1]) - (a[i][0] * a[j][1]);
      return Math.abs(s / 2);
    };
    const antes = areaGraus(anel);

    // tolerância de 400 m (1:2.000.000), a que apagava a faixa
    const r = importador.prepararGeometria(
      { type: 'Polygon', coordinates: [anel] },
      { tolerancia: 400 / GRAU_M, casas: 7 }
    );
    const depois = r.geometria ? areaGraus(r.geometria.coordinates[0]) : 0;
    const perda = antes > 0 ? (1 - depois / antes) * 100 : 100;
    ok('a faixa fina NÃO é apagada (perda de área < 5%)', perda < 5,
      perda.toFixed(2) + '% de perda   (' + Math.round(depois * GRAU_M * GRAU_M / 10000) + ' ha de '
      + Math.round(antes * GRAU_M * GRAU_M / 10000) + ' ha)');
    ok('a faixa mantém pontos suficientes para ser desenhada',
      r.geometria && r.geometria.coordinates[0].length >= 4,
      r.geometria ? r.geometria.coordinates[0].length + ' pontos' : 'geometria descartada');

    // um quadrado GRANDE (20 km) tem de continuar sendo simplificado pela tolerância global
    const grande = [];
    const l = 20000 / GRAU_M;
    for (let i = 0; i <= 400; i++) grande.push([-48 + l * i / 400, -22]);
    for (let i = 0; i <= 400; i++) grande.push([-48 + l, -22 + l * i / 400]);
    for (let i = 400; i >= 0; i--) grande.push([-48 + l * i / 400, -22 + l]);
    for (let i = 400; i >= 0; i--) grande.push([-48, -22 + l * i / 400]);
    grande.push(grande[0].slice());
    const rg = importador.prepararGeometria(
      { type: 'Polygon', coordinates: [grande] },
      { tolerancia: 400 / GRAU_M, casas: 7 }
    );
    const nGrande = rg.geometria ? rg.geometria.coordinates[0].length : 0;
    ok('anel grande continua simplificado pela tolerância global (não engorda)',
      nGrande > 0 && nGrande < 40, nGrande + ' pontos de 1604');
    ok('e o anel grande não perde área de forma relevante',
      rg.geometria && Math.abs(1 - areaGraus(rg.geometria.coordinates[0]) / areaGraus(grande)) < 0.02,
      rg.geometria ? ((1 - areaGraus(rg.geometria.coordinates[0]) / areaGraus(grande)) * 100).toFixed(3) + '%' : 'sem geometria');
  }

  console.log('\n' + (falhas ? 'FALHAS: ' + falhas + '/' + testes : 'TODOS OS ' + testes + ' TESTES PASSARAM'));
  return falhas ? 1 : 0;
}

module.exports = { executar };
if (require.main === module) process.exit(executar());
