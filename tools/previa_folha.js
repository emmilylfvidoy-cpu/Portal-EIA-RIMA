'use strict';
/* Gera o SVG da folha com o MESMO caminho da prévia (gravarFolha + itensParaSvg) para eu poder
 * CONFERIR O LAYOUT como imagem, sem navegador. Temporário. */
const fs = require('fs');
const path = require('path');
const raiz = path.resolve(__dirname, '..');
const EIA = {
  math: require(path.join(raiz, 'js', 'math.js')),
  pdf: require(path.join(raiz, 'js', 'pdf.js')),
  svg: require(path.join(raiz, 'js', 'svg.js')),
  mapa: require(path.join(raiz, 'js', 'mapa.js')),
};
global.EIA = EIA;

const legenda = [
  { rotulo: 'SP-055', cor: '#c0392b', forma: 'linha', espessura: 1.6 },
  { rotulo: 'Área de Influência Direta (AID)', cor: '#f1c40f', forma: 'linha', espessura: 1.6 },
  { rotulo: 'Área de Influência Indireta (AII)', cor: '#c0392b', forma: 'linha', espessura: 1.2 },
  { rotulo: 'Proteção Integral', cor: '#f6d7d7', forma: 'poligono' },
  { rotulo: 'Uso Sustentável', cor: '#a8d08d', forma: 'poligono' },
  { rotulo: 'Zona de Amortecimento', cor: '#8fa6c0', forma: 'poligono' },
  { rotulo: 'Limites Municipais', cor: '#5b6b75', forma: 'linha', espessura: 0.8 },
  { rotulo: 'Terras Indígenas', cor: '#a05a25', forma: 'poligono' },
  { rotulo: 'Áreas de Quilombolas', cor: '#5b21b6', forma: 'poligono' },
  { rotulo: 'Ponto de coleta', cor: '#425496', forma: 'ponto' },
];

const especificacao = {
  folha: 'A1',
  orientacao: 'paisagem',
  escala: 25000,
  bbox: null,
  titulo: 'MAPA DE CARACTERIZAÇÃO AMBIENTAL',
  tituloChapa: 'MAPA DAS ÁREAS PROTEGIDAS',
  projeto: 'EIA TAMOIOS — adequação do licenciamento da malha viária',
  data: '01/01/2026',
  desenhista: 'EMMILY VIDOY',
  verificador: 'FELIPE CALDEIRA',
  responsavel: 'EMMILY VIDOY',
  crea: '000000/D',
  fonte: 'IBGE · SEMIL/IPA · CETESB · IPHAN · FUNAI',
  datum: 'SIRGAS 2000 / UTM 23S · WGS 84',
  numeroFolha: 'FOLHA ÚNICA',
  nomeImagemMapa: 'img0',
  logos: [],
  legenda: legenda,
};

const gravado = EIA.mapa.gravarFolha(especificacao, { imagens: [] });
const svg = EIA.mapa.itensParaSvg(gravado, { escalaTela: 1 });
const saida = path.join(__dirname, '_previa.svg');
fs.writeFileSync(saida, svg, 'utf8');

console.log('  itens gravados: ' + gravado.itens.length);
console.log('  pagina: ' + gravado.pagina.larguraMm + ' x ' + gravado.pagina.alturaMm + ' mm');
const porTipo = {};
for (const it of gravado.itens) porTipo[it.t] = (porTipo[it.t] || 0) + 1;
console.log('  por tipo: ' + JSON.stringify(porTipo));
console.log('  svg: ' + saida + '  (' + (svg.length / 1024).toFixed(0) + ' KB)');
console.log('');
// o que o cliente procura no layout
const precisa = ['MAPA DAS ÁREAS PROTEGIDAS', 'DATA', 'ESCALA', 'DESENHO', 'VERIFICADO', 'FONTE',
  'ARTICULAÇÃO', 'Legenda', 'SIRGAS'];
for (const t of precisa) {
  console.log('  ' + (svg.indexOf(t) >= 0 ? 'presente  ' : 'AUSENTE   ') + t);
}
