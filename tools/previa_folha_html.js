'use strict';
/* ============================================================================
 * previa_folha_html.js — gera a prancha (plano B) como HTML e como PDF
 *
 * Existe pelo mesmo motivo do previa_folha.js: eu preciso VER o que entrego. Com HTML/CSS quem
 * desenha é o navegador, então a conferência é um Chrome headless — que é também o motor que
 * imprime o PDF de verdade.
 *
 * Usa o CATÁLOGO REAL, para a legenda sair com a cor de cada camada e de cada classe.
 *
 * Uso:  node tools/previa_folha_html.js [folha]
 *       (depois: chrome --headless --screenshot/--print-to-pdf)
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const EIA = {
  folhaHtml: require(path.join(raiz, 'js', 'folhaHtml.js')),
};
global.EIA = EIA;

const folha = process.argv[2] || 'A3';
const cat = JSON.parse(fs.readFileSync(path.join(raiz, 'data', 'catalogo.json'), 'utf8'));

// as camadas ligadas: as físicas de polígono + as do sócio, como no mapa do cliente
const ids = ['geologia', 'geomorfologia', 'pedologia', 'cetesb-areas-contaminadas',
  'biomas', 'unidades-conservacao', 'terras-indigenas', 'quilombolas'];
const camadas = ids.map((id) => cat.camadas.find((c) => c.id === id)).filter(Boolean);

const legenda = EIA.folhaHtml.legendaPorMeio(camadas, null);

// rótulos de coordenada (em graus, como o portal mostra hoje)
const extensao = [-45.38, -23.62, -45.06, -23.46];
const rotulos = { topo: [], esquerda: [] };
for (let i = 0; i <= 4; i++) {
  const lon = extensao[0] + (extensao[2] - extensao[0]) * i / 4;
  const lat = extensao[1] + (extensao[3] - extensao[1]) * i / 4;
  const g = (v) => Math.abs(v).toFixed(4).replace('.', ',') + '°' + (v < 0 ? 'W' : 'E');
  const g2 = (v) => Math.abs(v).toFixed(4).replace('.', ',') + '°' + (v < 0 ? 'S' : 'N');
  rotulos.topo.push({ pos: (i / 4 * 100).toFixed(1), texto: g(lon) });
  rotulos.esquerda.push({ pos: ((1 - i / 4) * 100).toFixed(1), texto: g2(lat) });
}

const modelo = EIA.folhaHtml.montarFolha({
  folha: folha,
  orientacao: 'paisagem',
  escala: 25000,
  titulo: 'MAPA DE CARACTERIZAÇÃO AMBIENTAL',
  tituloChapa: 'MAPA DAS ÁREAS PROTEGIDAS',
  projeto: 'EIA TAMOIOS — adequação do licenciamento da malha viária',
  data: '01/01/2026',
  desenhista: 'EMMILY VIDOY',
  verificador: 'FELIPE CALDEIRA',
  responsavel: 'EMMILY VIDOY',
  crea: '000000/D',
  fonte: 'Geologia e Geomorfologia (IG/SEMA) · Pedologia (IAC) · Biomas (IBGE) · CETESB · FUNAI · Palmares',
  extensao: extensao,
  rotulos: rotulos,
  mapaHref: null,
  logos: [],
  legenda: legenda,
  numeroFolha: 'FOLHA ÚNICA',
});

const html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
  + '<title>Prancha ' + folha + '</title>'
  + '<link rel="stylesheet" href="../folha.css">'
  + '<style>@page{size:' + (folha === 'A4' ? 'A4' : folha) + ' landscape;margin:0}'
  + 'html,body{margin:0;padding:0;background:#fff}</style>'
  + '</head><body>' + EIA.folhaHtml.paraHtml(modelo) + '</body></html>';

const saida = path.join(__dirname, '_folha.html');
fs.writeFileSync(saida, html, 'utf8');

const nItens = legenda.reduce((s, m) => s + m.camadas.reduce((t, c) => t + c.itens.length, 0), 0);
console.log('  folha: ' + modelo.folha + ' ' + modelo.larguraMm + 'x' + modelo.alturaMm + ' mm');
console.log('  meios na legenda: ' + legenda.length + '   camadas: '
  + legenda.reduce((s, m) => s + m.camadas.length, 0) + '   itens (classes): ' + nItens);
console.log('  amostra de cores vindas das camadas:');
let mostrados = 0;
for (const m of legenda) {
  for (const c of m.camadas) {
    for (const it of c.itens.slice(0, 2)) {
      if (mostrados++ < 8) console.log('    ' + it.cor + '  ' + c.nome + ' → ' + it.rotulo.slice(0, 40));
    }
  }
}
console.log('  html: ' + saida);
