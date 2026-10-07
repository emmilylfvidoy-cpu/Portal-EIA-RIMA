'use strict';
async function executar() {
/* ============================================================================
 * verificar_referencias.js — a grafia de cada arquivo referenciado
 *
 * POR QUE ESTE TESTE EXISTE: no Windows o sistema de arquivos NÃO diferencia
 * maiúscula de minúscula. `js/Math.js` abre `js/math.js` sem reclamar. Na Vercel
 * (Linux) não abre — o site publicado quebra e o local funciona. Um erro de caixa
 * passa por toda a verificação feita na máquina do desenvolvedor.
 *
 * Também confere o inverso: módulo em js/ que o index.html não carrega (pode ser
 * intencional, mas tem de ser sabido) e .geojson publicado que o catálogo não lista.
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..', '..');

let falhas = 0, testes = 0;
const ok = (nome, cond, det) => {
  testes++;
  if (cond) console.log('  ok  ' + nome + (det ? '  [' + det + ']' : ''));
  else { falhas++; console.log('  FALHA ' + nome + (det ? '  [' + det + ']' : '')); }
};

/** Confere um caminho relativo pedaço por pedaço, exigindo a grafia EXATA. */
function conferirGrafia(alvo) {
  const partes = String(alvo).split('/');
  let pasta = raiz;
  for (let i = 0; i < partes.length; i++) {
    let entradas;
    try { entradas = fs.readdirSync(pasta); } catch (e) { return 'pasta inacessível: ' + pasta; }
    if (entradas.indexOf(partes[i]) < 0) {
      const parecido = entradas.find((x) => x.toLowerCase() === partes[i].toLowerCase());
      return parecido
        ? 'grafia diferente: o disco tem "' + parecido + '", a referência diz "' + partes[i] + '"'
        : 'não existe';
    }
    pasta = path.join(pasta, partes[i]);
  }
  return null;
}

const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

console.log('\n== Arquivos que o index.html carrega ==');
{
  const refs = Array.from(html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g))
    .map((m) => m[1])
    .filter((a) => !/^(https?:)?\/\//.test(a) && !a.startsWith('#'));
  ok('index.html referencia arquivos locais', refs.length >= 10, refs.length + ' referências');
  const erros = [];
  for (const r of refs) {
    const erro = conferirGrafia(r);
    if (erro) erros.push(r + ' → ' + erro);
  }
  ok('todos existem com a grafia exata', erros.length === 0, erros.join('; ') || refs.length + ' conferidos');

  // A ordem importa: sem o Leaflet antes, o mapa não monta e o app.js para na primeira
  // linha. Este é o tipo de erro que só aparece na página publicada.
  const posLeaflet = html.indexOf('vendor/leaflet.js');
  const posTurf = html.indexOf('vendor/turf.min.js');
  const posApp = html.indexOf('app.js');
  ok('leaflet.js é carregado antes do app.js', posLeaflet >= 0 && posLeaflet < posApp);
  ok('turf.min.js é carregado antes do app.js', posTurf >= 0 && posTurf < posApp);
}

console.log('\n== Camadas do catálogo ==');
{
  const catalogo = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'catalogo.json'), 'utf8'));
  const erros = [];
  for (const c of catalogo.camadas) {
    const erro = conferirGrafia(c.arquivo);
    if (erro) erros.push(c.arquivo + ' (' + c.nome + ') → ' + erro);
    else if (!fs.statSync(path.join(raiz, c.arquivo)).isFile()) erros.push(c.arquivo + ' não é arquivo');
  }
  ok('toda camada do catálogo tem arquivo, grafia exata', erros.length === 0,
    erros.join('; ') || catalogo.camadas.length + ' camadas conferidas');

  // .geojson em data/ que o catálogo não lista é dado publicado e invisível — ou lixo
  // de teste que ficou para trás. A exceção é o arquivo de áreas de influência de
  // exemplo: ele NÃO é camada de caracterização, é o molde de recorte usado nos testes
  // e na demonstração, e por isso não aparece no catálogo.
  const PERMITIDOS = ['areas-influencia-exemplo.geojson'];
  const listados = new Set(catalogo.camadas.map((c) => path.basename(c.arquivo)));
  const orfaos = fs.readdirSync(path.join(raiz, 'data'))
    .filter((f) => /\.geojson$/i.test(f) && !listados.has(f) && PERMITIDOS.indexOf(f) < 0);
  ok('nenhum .geojson órfão em data/', orfaos.length === 0,
    orfaos.length ? orfaos.join(', ') : 'todos listados no catálogo (ou declarados como área de influência)');
}

console.log('\n== Módulos em js/ ==');
{
  const noHtml = new Set(Array.from(html.matchAll(/src\s*=\s*"([^"]+)"/g)).map((m) => m[1]));
  const arquivos = fs.readdirSync(path.join(raiz, 'js'));
  const usados = arquivos.filter((f) => noHtml.has('js/' + f));
  const soFerramenta = arquivos.filter((f) => !noHtml.has('js/' + f));
  ok('módulos do navegador carregados', usados.length >= 10, usados.length + ' de ' + arquivos.length);
  // Não é falha: xml.js e simbologia.js rodam só na curadoria da base (Node). A lista
  // fica impressa para o caso de alguém esperar encontrá-los na página.
  if (soFerramenta.length) console.log('  nota  só de ferramenta (não vão para a página): ' + soFerramenta.join(', '));

  // Todo módulo carregado precisa registrar algo em window.EIA — senão é arquivo
  // carregado que não serve para nada.
  const semRegistro = [];
  for (const f of usados) {
    const t = fs.readFileSync(path.join(raiz, 'js', f), 'utf8');
    if (t.indexOf('raiz.EIA') < 0 && t.indexOf('window.EIA') < 0) semRegistro.push(f);
  }
  ok('todo módulo carregado registra em window.EIA', semRegistro.length === 0, semRegistro.join(', ') || 'todos');
}

console.log('\n== vercel.json ==');
{
  /* A Vercel valida este arquivo contra um schema RÍGIDO: qualquer chave que ela não
   * conhece derruba a publicação com "should NOT have additional property". Aconteceu:
   * uma chave de anotação (`_nota_cache`) entrou aqui e TODO deploy a partir daquele
   * commit falhou — o site ficou congelado numa versão antiga sem ninguém entender por
   * quê. Anotação vai na documentação, não em arquivo que validador lê. */
  const PERMITIDAS = ['$schema', 'framework', 'outputDirectory', 'buildCommand', 'installCommand',
    'devCommand', 'ignoreCommand', 'headers', 'redirects', 'rewrites', 'routes', 'cleanUrls',
    'trailingSlash', 'regions', 'functions', 'builds', 'public', 'git', 'github', 'crons',
    'images', 'fluid', 'bulkRedirectsPath', 'version'];
  let cfg = null;
  let erroParse = null;
  const texto = fs.readFileSync(path.join(raiz, 'vercel.json'), 'utf8');
  try { cfg = JSON.parse(texto); } catch (e) { erroParse = e.message; }
  ok('vercel.json é JSON válido', !!cfg, erroParse || 'ok');
  if (cfg) {
    const desconhecidas = Object.keys(cfg).filter((k) => PERMITIDAS.indexOf(k) < 0);
    ok('vercel.json só tem chaves que a Vercel aceita', desconhecidas.length === 0,
      desconhecidas.length ? 'chave(s) inválida(s): ' + desconhecidas.join(', ') + '  → a publicação vai falhar'
        : Object.keys(cfg).join(', '));
    // cada bloco de header precisa de source e de uma lista de {key,value}
    const mauFormado = (cfg.headers || []).filter((h) => !h || typeof h.source !== 'string'
      || !Array.isArray(h.headers) || !h.headers.length
      || h.headers.some((x) => !x || typeof x.key !== 'string' || typeof x.value !== 'string'));
    ok('blocos de headers bem formados', mauFormado.length === 0, mauFormado.length + ' com problema');
    // o que não pode voltar a acontecer: cache imutável no código do site
    const imutavelEmJs = (cfg.headers || []).some((h) => /^\/(js|app\.js|style\.css)/.test(h.source || '')
      && (h.headers || []).some((x) => /immutable/.test(String(x.value))));
    ok('código do site não fica em cache imutável', !imutavelEmJs,
      imutavelEmJs ? 'sem versionamento por query string, o visitante veria a versão antiga' : 'ok');
  }
}

console.log('\n' + (falhas ? 'FALHAS: ' + falhas + '/' + testes : 'TODOS OS ' + testes + ' TESTES PASSARAM'));
return falhas ? 1 : 0;
}
module.exports = { executar };
if (require.main === module) executar().then((c) => process.exit(c));
