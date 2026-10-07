'use strict';
async function executar() {
/* Verificação do leitor de simbologia e do XML mínimo.
 *
 * O que prova: as cores e o campo de classe saem do arquivo de estilo do SIG —
 * .qml (QGIS), .sld (OGC) e .lyrx (ArcGIS Pro) — e o `.lyr` (binário do ArcGIS
 * Desktop) é reconhecido como não legível, sem inventar cor.
 *
 * Uso: node tools/verificacoes/verificar_simbologia.js */
const fs = require('fs');
const path = require('path');
const os = require('os');

const raiz = path.resolve(__dirname, '..', '..');
const xml = require(path.join(raiz, 'js', 'xml.js'));
const simbologia = require(path.join(raiz, 'js', 'simbologia.js'));
const importador = require(path.join(raiz, 'tools', 'importar_camadas.js'));
const shapelib = require(path.join(raiz, 'js', 'shapelib.js'));

let falhas = 0, testes = 0;
const ok = (nome, cond, det) => {
  testes++;
  if (cond) console.log('  ok  ' + nome + (det ? '  [' + det + ']' : ''));
  else { falhas++; console.log('  FALHA ' + nome + (det ? '  [' + det + ']' : '')); }
};

// ---------------------------------------------------------------- XML
console.log('\n== Leitor de XML ==');
{
  const doc = xml.analisar('<?xml version="1.0"?>\n<!-- comentário -->\n<raiz a="1" b=\'dois\'>\n'
    + '  <filho>texto &amp; mais &lt;escapado&gt;</filho>\n'
    + '  <vazio/>\n'
    + '  <com-cdata><![CDATA[<b>negrito</b> & cia]]></com-cdata>\n'
    + '  <aninhado><neto nome="x">valor</neto></aninhado>\n'
    + '</raiz>');
  const raizNo = doc.filhos[0];
  ok('elemento raiz', raizNo.nome === 'raiz', raizNo.nome);
  ok('atributo com aspas duplas', xml.atributo(raizNo, 'a') === '1');
  ok('atributo com aspas simples', xml.atributo(raizNo, 'b') === 'dois');
  ok('filhos contados', xml.filhos(raizNo, 'filho').length === 1);
  ok('texto com entidades decodificadas', xml.texto(xml.filhos(raizNo, 'filho')[0]) === 'texto & mais <escapado>',
    JSON.stringify(xml.texto(xml.filhos(raizNo, 'filho')[0])));
  ok('elemento auto-fechado', xml.filhos(raizNo, 'vazio').length === 1);
  ok('CDATA preservado', xml.texto(xml.filhos(raizNo, 'com-cdata')[0]) === '<b>negrito</b> & cia',
    JSON.stringify(xml.texto(xml.filhos(raizNo, 'com-cdata')[0])));
  ok('descendente aninhado', xml.descendentes(raizNo, 'neto').length === 1);
  ok('comentário ignorado', jsonSemComentario(raizNo), 'nenhum nó com nome de comentário');
  ok('namespace ignorado no nome local', xml.nomeLocal('ogc:Literal') === 'Literal');

  function jsonSemComentario(no) {
    return !no.filhos.some((f) => f.nome.indexOf('!') === 0);
  }
}

// ---------------------------------------------------------------- QML
const QML_CATEGORIZADO = `<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis version="3.28.4-Firenze" styleCategories="Symbology|Labeling">
  <renderer-v2 forceraster="0" symbollevels="0" type="categorizedSymbol" attr="UNIDADE" enableorderby="0">
    <categories>
      <category value="Arenito" symbol="0" label="Arenito" render="true"/>
      <category value="Basalto" symbol="1" label="Basalto &amp; diabásio" render="true"/>
      <category value="Argila" symbol="2" label="Argila" render="true"/>
      <category value="" symbol="3" label="&lt;all other values&gt;" render="true"/>
    </categories>
    <symbols>
      <symbol name="0" type="fill" alpha="0.65" clip_to_extent="1">
        <layer class="SimpleFill" locked="0" enabled="1" pass="0">
          <Option type="QString" name="color" value="200,161,101,255"/>
          <Option type="QString" name="outline_color" value="35,35,35,255"/>
        </layer>
      </symbol>
      <symbol name="1" type="fill" alpha="1" clip_to_extent="1">
        <layer class="SimpleFill">
          <Option type="QString" name="color" value="122,79,138,255"/>
        </layer>
      </symbol>
      <symbol name="2" type="fill" alpha="1" clip_to_extent="1">
        <layer class="SimpleFill">
          <Option type="QString" name="color" value="#8a6d3b"/>
        </layer>
      </symbol>
      <symbol name="3" type="fill" alpha="1" clip_to_extent="1">
        <layer class="SimpleFill">
          <Option type="QString" name="color" value="204,204,204,255"/>
        </layer>
      </symbol>
    </symbols>
  </renderer-v2>
</qgis>`;

console.log('\n== QGIS .qml (categorizado) ==');
{
  const s = simbologia.lerQml(QML_CATEGORIZADO);
  ok('formato reconhecido', s.formato === 'qml');
  ok('tipo categorizado', s.tipo === 'categorizado', s.tipo);
  ok('campo de classe lido do attr', s.campo === 'UNIDADE', String(s.campo));
  ok('leu as 4 classes na ordem da legenda', s.ordem.length === 4, s.ordem.join(' | '));
  ok('cor do Arenito (200,161,101)', s.cores['Arenito'] === '#c8a165', s.cores['Arenito']);
  ok('cor do Basalto (122,79,138)', s.cores['Basalto'] === '#7a4f8a', s.cores['Basalto']);
  ok('cor em hexadecimal aceita', s.cores['Argila'] === '#8a6d3b', s.cores['Argila']);
  ok('classe vazia entra como chave vazia', s.cores[''] === '#cccccc', s.cores['']);
  ok('opacidade vem do atributo alpha do simbolo', s.opacidade === 0.65, String(s.opacidade));
  ok('rotulo com entidade decodificado', s.rotulos && s.rotulos['Basalto'] === 'Basalto & diabásio',
    s.rotulos ? s.rotulos['Basalto'] : 'sem rotulos');
}

console.log('\n== QGIS .qml (simbolo unico) ==');
{
  const s = simbologia.lerQml(`<qgis version="3.28">
    <renderer-v2 type="singleSymbol" symbollevels="0">
      <symbols><symbol name="0" type="line" alpha="0.8">
        <layer class="SimpleLine"><Option name="line_color" value="47,91,138,255"/></layer>
      </symbol></symbols>
    </renderer-v2></qgis>`);
  ok('tipo unico', s.tipo === 'unico', s.tipo);
  ok('cor da linha lida', s.cor === '#2f5b8a', String(s.cor));
  ok('opacidade lida', s.opacidade === 0.8, String(s.opacidade));
}

console.log('\n== QGIS .qml (graduado) ==');
{
  const s = simbologia.lerQml(`<qgis version="3.28">
    <renderer-v2 type="graduatedSymbol" attr="DECLIV">
      <ranges>
        <range lower="0" upper="3" symbol="0" label="0 - 3%"/>
        <range lower="3" upper="8" symbol="1" label="3 - 8%"/>
      </ranges>
      <symbols>
        <symbol name="0" type="fill"><layer class="SimpleFill"><Option name="color" value="240,240,200,255"/></layer></symbol>
        <symbol name="1" type="fill"><layer class="SimpleFill"><Option name="color" value="200,220,150,255"/></layer></symbol>
      </symbols>
    </renderer-v2></qgis>`);
  ok('tipo graduado', s.tipo === 'graduado', s.tipo);
  ok('leu as faixas', s.ordem.length === 2, s.ordem.join(' | '));
  ok('avisa que o portal trabalha com classe categorica', s.avisos.length > 0 && /GRADUADA/i.test(s.avisos[0]),
    s.avisos[0] ? s.avisos[0].slice(0, 60) : 'sem aviso');
}

// ---------------------------------------------------------------- SLD
console.log('\n== OGC .sld ==');
{
  const s = simbologia.lerSld(`<?xml version="1.0" encoding="UTF-8"?>
<sld:StyledLayerDescriptor version="1.0.0" xmlns:sld="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc">
  <sld:NamedLayer><sld:Name>geologia</sld:Name>
    <sld:UserStyle><sld:FeatureTypeStyle>
      <sld:Rule><sld:Name>Arenito</sld:Name>
        <ogc:Filter><ogc:PropertyIsEqualTo>
          <ogc:PropertyName>UNIDADE</ogc:PropertyName><ogc:Literal>Arenito</ogc:Literal>
        </ogc:PropertyIsEqualTo></ogc:Filter>
        <sld:PolygonSymbolizer><sld:Fill>
          <sld:CssParameter name="fill">#c8a165</sld:CssParameter>
          <sld:CssParameter name="fill-opacity">0.7</sld:CssParameter>
        </sld:Fill></sld:PolygonSymbolizer>
      </sld:Rule>
      <sld:Rule><sld:Name>Basalto</sld:Name>
        <ogc:Filter><ogc:PropertyIsEqualTo>
          <ogc:PropertyName>UNIDADE</ogc:PropertyName><ogc:Literal>Basalto</ogc:Literal>
        </ogc:PropertyIsEqualTo></ogc:Filter>
        <sld:PolygonSymbolizer><sld:Fill>
          <sld:CssParameter name="fill">#7a4f8a</sld:CssParameter>
        </sld:Fill></sld:PolygonSymbolizer>
      </sld:Rule>
    </sld:FeatureTypeStyle></sld:UserStyle>
  </sld:NamedLayer>
</sld:StyledLayerDescriptor>`);
  ok('formato sld', s.formato === 'sld');
  ok('tipo categorizado', s.tipo === 'categorizado', s.tipo);
  ok('campo lido do PropertyName', s.campo === 'UNIDADE', String(s.campo));
  ok('2 classes', s.ordem.length === 2, s.ordem.join(' | '));
  ok('cor do Arenito', s.cores['Arenito'] === '#c8a165', s.cores['Arenito']);
  ok('cor do Basalto', s.cores['Basalto'] === '#7a4f8a', s.cores['Basalto']);
  ok('opacidade lida', s.opacidade === 0.7, String(s.opacidade));
}

// ---------------------------------------------------------------- LYR (ArcGIS Pro)
console.log('\n== ArcGIS Pro .lyrx ==');
{
  const lyrx = JSON.stringify({
    type: 'CIMLayerDocument',
    layerDefinitions: [{
      type: 'CIMFeatureLayer',
      name: 'Geologia',
      renderer: {
        type: 'CIMUniqueValueRenderer',
        fields: ['UNIDADE'],
        groups: [{
          type: 'CIMUniqueValueGroup',
          classes: ['Arenito', 'Basalto'].map((valor, i) => ({
            type: 'CIMUniqueValueClass',
            label: valor,
            values: [{ type: 'CIMUniqueValue', fieldName: 'UNIDADE', fieldValue: valor }],
            symbol: {
              type: 'CIMSymbolReference',
              symbol: {
                type: 'CIMPolygonSymbol',
                symbolLayers: [
                  { type: 'CIMSolidStroke', color: { type: 'CIMRGBColor', values: [35, 35, 35, 100] } },
                  { type: 'CIMSolidFill', color: { type: 'CIMRGBColor', values: i === 0 ? [200, 161, 101, 100] : [122, 79, 138, 100] } },
                ],
              },
            },
          })),
        }],
      },
    }],
  });
  const s = simbologia.lerLyrx(lyrx);
  ok('formato lyrx', s.formato === 'lyrx');
  ok('tipo categorizado', s.tipo === 'categorizado', s.tipo);
  ok('campo lido de fields', s.campo === 'UNIDADE', String(s.campo));
  ok('2 classes', s.ordem.length === 2, s.ordem.join(' | '));
  ok('pegou a cor de PREENCHIMENTO, nao a do contorno', s.cores['Arenito'] === '#c8a165',
    'Arenito=' + s.cores['Arenito'] + ' (o contorno era #232323)');
  ok('segunda classe correta', s.cores['Basalto'] === '#7a4f8a', s.cores['Basalto']);
  ok('opacidade do alfa (100/100)', s.opacidade === 1, String(s.opacidade));
}

// ---------------------------------------------------------------- LYR (ArcGIS Desktop)
console.log('\n== ArcGIS Desktop .lyr (binario) ==');
{
  // monta um binário com um WKT legível e uma rampa, como o ArcGIS faz
  const texto = 'GEOGCS["GCS_SIRGAS_2000",DATUM["D_SIRGAS_2000",SPHEROID["GRS_1980",6378137.0,298.257222101]],'
    + 'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433],AUTHORITY["EPSG",4674]]';
  const bytes = [];
  const escreverUtf16 = (t) => {
    for (const ch of t) { bytes.push(ch.charCodeAt(0)); bytes.push(0); }
    bytes.push(0x2A, 0x00, 0xFF, 0x00);   // separador binário entre os textos
  };
  escreverUtf16(texto);
  escreverUtf16('Pastels');
  const s = simbologia.lerLyr(bytes);
  ok('formato lyr', s.formato === 'lyr');
  ok('tipo binario declarado', s.tipo === 'binario', s.tipo);
  ok('CRS extraido do binario', s.crs === 'EPSG:4674', String(s.crs));
  ok('rampa de cor identificada', s.rampa === 'Pastels', String(s.rampa));
  ok('NAO inventou cor', s.cor === null && Object.keys(s.cores).length === 0);
  ok('avisa que as cores nao foram lidas', s.avisos.length > 0 && /binário/i.test(s.avisos[0]),
    s.avisos[0] ? s.avisos[0].slice(0, 70) : 'sem aviso');
  ok('aviso diz o caminho alternativo', /lyrx|qml/i.test(s.avisos[0]));
}

// ---------------------------------------------------------------- biblioteca de símbolos
console.log('\n== Biblioteca de símbolos do QGIS (qgis_style com símbolos nomeados) ==');
{
  /* Este é o formato que salvou o caso real: o .lyr do ArcMap é binário e não dá as
   * cores, mas o estilo exportado do projeto é um XML com os símbolos NOMEADOS pelo valor
   * da classe. Foi assim que as 306 unidades litológicas do cliente receberam as cores
   * dele. Sem este leitor, o portal pintaria o mapa com cor inventada. */
  const estilo = `<!DOCTYPE qgis_style>
<qgis_style version="2">
  <symbols>
    <symbol type="fill" is_animated="0" alpha="1" name="A34atg">
      <data_defined_properties><Option type="Map"><Option name="properties"/></Option></data_defined_properties>
      <layer class="SimpleFill" enabled="1" pass="0">
        <Option type="Map">
          <Option type="QString" value="245,196,200,255,rgb:0.9607843,0.7686275,0.7843137,1" name="color"/>
          <Option type="QString" value="0,0,0,255,rgb:0,0,0,1" name="outline_color"/>
        </Option>
      </layer>
    </symbol>
    <symbol type="fill" alpha="1" name="A4PPr">
      <layer class="SimpleFill" enabled="1" pass="0">
        <Option type="Map">
          <Option type="QString" value="188,92,130,255,rgb:0.7372549,0.3607843,0.5098039,1" name="color"/>
        </Option>
      </layer>
    </symbol>
    <symbol type="fill" alpha="1" name="C2P1a">
      <layer class="SimpleFill" enabled="1" pass="0">
        <Option type="Map">
          <Option type="QString" value="146,185,178,255,rgb:0.572549,0.7254902,0.6980392,1" name="color"/>
        </Option>
      </layer>
    </symbol>
  </symbols>
  <colorramps/>
  <textformats/>
</qgis_style>`;

  const s = simbologia.lerQml(estilo);
  ok('tipo categorizado', s.tipo === 'categorizado', s.tipo);
  ok('marcado como biblioteca de símbolos', s.biblioteca_simbolos === true);
  ok('leu as 3 classes', s.ordem.length === 3, s.ordem.join(' | '));
  ok('A34atg -> #f5c4c8 (245,196,200)', s.cores['A34atg'] === '#f5c4c8', s.cores['A34atg']);
  ok('A4PPr -> #bc5c82', s.cores['A4PPr'] === '#bc5c82', s.cores['A4PPr']);
  ok('C2P1a -> #92b9b2', s.cores['C2P1a'] === '#92b9b2', s.cores['C2P1a']);
  ok('pegou o preenchimento, nao o contorno (que e preto)',
    s.cores['A34atg'] !== '#000000', 'o contorno era 0,0,0,255');
  ok('sem aviso de erro', s.avisos.length === 0, s.avisos.join('; ') || 'nenhum');

  // CONTORNO: e o que separa as unidades no mapa. `outline_width = 0` no QGIS significa
  // fio de cabelo, NAO ausencia de contorno — o mapa do cliente tem divisa preta.
  // Na massa só o A34atg declara contorno; os outros dois só têm preenchimento, e NÃO
  // podem ganhar contorno inventado.
  const contornos = s.contornos || {};
  ok('contorno lido só de quem declara', Object.keys(contornos).length === 1,
    Object.keys(contornos).length + ': ' + Object.keys(contornos).join(','));
  ok('contorno do A34atg e preto', contornos['A34atg'] === '#000000', String(contornos['A34atg']));
  ok('classe sem contorno no arquivo fica sem contorno', !contornos['A4PPr'] && !contornos['C2P1a']);

  // caso 2 camadas: o preenchimento tem outline_style="no" (contorno DESLIGADO) e o
  // contorno real vem da camada SimpleLine. Usar a cor do preenchimento aqui pintaria
  // uma divisa que o mapa do cliente nao tem.
  const duasCamadas = simbologia.lerQml(`<qgis_style version="2"><symbols>
    <symbol type="fill" name="ENrc">
      <layer class="SimpleFill" enabled="1" pass="0"><Option type="Map">
        <Option type="QString" value="254,207,25,255,rgb:1,0.81,0.1,1" name="color"/>
        <Option type="QString" value="35,35,35,255,rgb:0.13,0.13,0.13,1" name="outline_color"/>
        <Option type="QString" value="no" name="outline_style"/>
        <Option type="QString" value="0.26" name="outline_width"/>
      </Option></layer>
      <layer class="SimpleLine" enabled="1" pass="0"><Option type="Map">
        <Option type="QString" value="0,0,0,255,rgb:0,0,0,1" name="line_color"/>
        <Option type="QString" value="0" name="line_width"/>
      </Option></layer>
    </symbol></symbols></qgis_style>`);
  ok('2 camadas: preenchimento lido', duasCamadas.cores['ENrc'] === '#fecf19', duasCamadas.cores['ENrc']);
  ok('2 camadas: contorno vem da SimpleLine (preto), nao do outline_color desligado',
    duasCamadas.contornos['ENrc'] === '#000000', String(duasCamadas.contornos['ENrc']));

  // a extensão .xml também tem de ser aceita (é como o arquivo chega do projeto)
  ok('lido pela extensão .xml', simbologia.ler(estilo, 'xml').cores['A34atg'] === '#f5c4c8');
  ok('decidido pelo conteúdo sem extensão', simbologia.ler(estilo, '').cores['A34atg'] === '#f5c4c8');

  // um QML de camada comum (com renderer) NÃO pode ser confundido com biblioteca
  const comRenderer = simbologia.lerQml(QML_CATEGORIZADO);
  ok('qml com renderer segue o caminho normal', !comRenderer.biblioteca_simbolos && comRenderer.campo === 'UNIDADE',
    String(comRenderer.campo));
}

// ---------------------------------------------------------------- automático
console.log('\n== Deteccao pelo conteudo (sem confiar na extensao) ==');
{
  ok('decide qml pelo conteudo', simbologia.ler(QML_CATEGORIZADO, '').formato === 'qml');
  ok('decide lyrx pelo conteudo', simbologia.ler('{"type":"CIMLayerDocument","renderer":{"type":"CIMSimpleRenderer"}}', '').formato === 'lyrx');
  ok('decide sld pelo conteudo', simbologia.ler('<StyledLayerDescriptor><NamedLayer/></StyledLayerDescriptor>', '').formato === 'sld');
}

// ---------------------------------------------------------------- integração
console.log('\n== Integracao: shapefile + .qml + .shp.xml ==');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eia-simb-'));
  const features = [];
  const classes = ['Arenito', 'Basalto', 'Argila'];
  for (let k = 0; k < 30; k++) {
    const cx = -47.7 + (k % 6) * 0.01;
    const cy = -22.8 + Math.floor(k / 6) * 0.01;
    const anel = [];
    for (let i = 0; i < 40; i++) {
      const t = 2 * Math.PI * i / 40;
      anel.push([cx + 0.003 * Math.cos(t), cy + 0.003 * Math.sin(t)]);
    }
    anel.push(anel[0].slice());
    features.push({
      type: 'Feature',
      properties: { UNIDADE: classes[k % 3], ID: k + 1 },
      geometry: { type: 'Polygon', coordinates: [anel] },
    });
  }
  const e = shapelib.escreverShapefile(features, {});
  const base = path.join(tmp, 'geologia');
  fs.writeFileSync(base + '.shp', Buffer.from(e.shp));
  fs.writeFileSync(base + '.dbf', Buffer.from(e.dbf));
  fs.writeFileSync(base + '.prj', Buffer.from(e.prj));
  fs.writeFileSync(base + '.qml', QML_CATEGORIZADO.replace('value="Argila" symbol="2" label="Argila"', 'value="Argila" symbol="2" label="Argila"'));
  fs.writeFileSync(base + '.shp.xml', `<?xml version="1.0"?><metadata>
    <idinfo><citation><citeinfo><title>Geologia do município</title>
      <origin>CPRM — Serviço Geológico do Brasil</origin>
      <pubdate>20240315</pubdate></citeinfo></citation>
      <descript><abstract>Carta geológica na escala 1:50.000.</abstract></descript>
    </idinfo></metadata>`);

  const lado = simbologia.sidecars(base + '.shp');
  ok('achou o .qml ao lado do shapefile', lado.estilos.length >= 1 && /\.qml$/.test(lado.estilos[0].caminho),
    lado.estilos.map((x) => x.extensao).join(','));
  ok('achou o .shp.xml como metadado', !!lado.metadado && /shp\.xml$/.test(lado.metadado));

  // O .shp.xml é METADADO e não pode ser confundido com o arquivo de estilo .xml — são
  // nomes diferentes (Geologia.shp.xml x Geologia.xml) e o sidecar só procura o segundo.
  ok('o .shp.xml não entra na lista de estilos', !lado.estilos.some((x) => /\.shp\.xml$/.test(x.caminho)),
    lado.estilos.map((x) => x.caminho.split(/[\\/]/).pop()).join(','));

  const meta = simbologia.lerMetadadosShpXml(fs.readFileSync(lado.metadado, 'utf8'));
  ok('metadados: titulo', meta.titulo === 'Geologia do município', String(meta.titulo));
  ok('metadados: fonte (origin)', /CPRM/.test(meta.fonte || ''), String(meta.fonte));
  ok('metadados: data', meta.data === '2024-03-15', String(meta.data));

  const r = importador.gerarRascunho(tmp);
  const camada = r.manifesto.camadas[0];
  ok('rascunho: campo de classe veio do .qml', camada.campo_classe === 'UNIDADE', String(camada.campo_classe));
  ok('rascunho: cores por classe preenchidas', !!camada.cores_classe && Object.keys(camada.cores_classe).length === 4,
    camada.cores_classe ? Object.keys(camada.cores_classe).join(',') : 'nenhuma');
  ok('rascunho: fonte veio do .shp.xml', /CPRM/.test(camada.fonte || ''), String(camada.fonte));
  ok('rascunho: data_ref veio do .shp.xml', camada.data_ref === '2024-03-15', String(camada.data_ref));
  const pista = r.pistas[0];
  ok('rascunho: reporta o arquivo de estilo', /\.qml$/.test(pista.estilo || ''), String(pista.estilo));
  ok('rascunho: reporta quantas cores leu', pista.cores_lidas === 4, String(pista.cores_lidas));

  // importa e confere que as cores foram para o catálogo
  const resultado = importador.importarCamada(Object.assign({}, camada, {
    id: 'teste-simb-geologia',
    arquivo: 'data/_teste-simb/geologia.geojson',
    meio: 'fisico',
  }), { escala: 50000 });
  ok('import: cores do estilo usadas', resultado.cores_origem === 'estilo', resultado.cores_origem);
  ok('import: cor do Arenito preservada', resultado.cor_por_classe['Arenito'] === '#c8a165',
    resultado.cor_por_classe['Arenito']);
  ok('import: ordem das classes e a da legenda', resultado.classes[0].classe === 'Arenito',
    resultado.classes.map((c) => c.classe).join(' > '));
  ok('import: opacidade do .qml aplicada', Math.abs(resultado.opacidade - 0.65) < 1e-9, String(resultado.opacidade));

  const catalogoPath = path.join(tmp, 'catalogo.json');
  importador.atualizarCatalogo(catalogoPath, [resultado], {});
  const cat = JSON.parse(fs.readFileSync(catalogoPath, 'utf8'));
  const entrada = cat.camadas.find((c) => c.id === 'teste-simb-geologia');
  ok('catalogo: cor por classe gravada', entrada.estilo.cores['Basalto'] === '#7a4f8a');
  ok('catalogo: opacidade gravada', Math.abs(entrada.estilo.opacidade - 0.65) < 1e-9, String(entrada.estilo.opacidade));
  ok('catalogo: registra de onde veio a cor', entrada.cores_origem === 'estilo', String(entrada.cores_origem));
  ok('catalogo: registra o arquivo de estilo', /\.qml$/.test(entrada.estilo_arquivo || ''), String(entrada.estilo_arquivo));

  fs.rmSync(path.join(raiz, 'data', '_teste-simb'), { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('\n== Classificacao sem estilo (paleta automatica) ==');
{
  const geojson = {
    type: 'FeatureCollection',
    features: [
      { properties: { U: 'A' } }, { properties: { U: 'A' } }, { properties: { U: 'B' } },
    ],
  };
  const auto = importador.classesECores(geojson, 'U', null);
  ok('sem paleta: origem auto', auto.cores_origem === 'auto', auto.cores_origem);
  ok('sem paleta: todas as classes com cor', Object.keys(auto.cores).length === 2);
  ok('sem paleta: ordena por quantidade', auto.classes[0].classe === 'A', auto.classes.map((c) => c.classe).join('>'));

  const comPaleta = importador.classesECores(geojson, 'U', { ordem: ['B', 'A'], cores: { B: '#111111' } });
  ok('com paleta: origem misto', comPaleta.cores_origem === 'misto', comPaleta.cores_origem);
  ok('com paleta: ordem da legenda respeitada', comPaleta.classes[0].classe === 'B', comPaleta.classes.map((c) => c.classe).join('>'));
  ok('com paleta: cor do estilo aplicada', comPaleta.cores['B'] === '#111111', comPaleta.cores['B']);
  ok('com paleta: classe sem cor no estilo recebe cor da paleta', !!comPaleta.cores['A'], comPaleta.cores['A']);
}

console.log('\n' + (falhas ? 'FALHAS: ' + falhas + '/' + testes : 'TODOS OS ' + testes + ' TESTES PASSARAM'));
return falhas ? 1 : 0;
}
module.exports = { executar };
if (require.main === module) executar().then((c) => process.exit(c));
