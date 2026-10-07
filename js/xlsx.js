'use strict';
/* ============================================================================
 * xlsx.js — gera planilha .xlsx (Excel) e CSV, sem biblioteca
 *
 * O .xlsx é um ZIP com XML dentro. O ZIP sai daqui mesmo (`shapelib`/`kml` já
 * resolvem a compressão), e o XML é escrito direto — evita dependência de 900 KB
 * para o que é, no fundo, uma tabela de atributos.
 * ========================================================================== */

(function (raiz, fabrica) {
  const node = typeof module === 'object' && module.exports;
  const kml = node ? require('./kml.js') : raiz.EIA.kml;
  const api = fabrica(kml);
  if (node) module.exports = api;
  if (raiz) {
    raiz.EIA = raiz.EIA || {};
    raiz.EIA.xlsx = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (kml) {

  /** Junta várias entradas num ZIP (usa o montador do kml.js). */
  /**
   * ZIP com várias entradas.
   *
   * Cada entrada traz `texto` (string) OU `bytes` (binário). Aceitar os dois é o que
   * permite usar o MESMO escritor para a planilha (XML, texto) e para o shapefile
   * (.shp/.dbf/.prj, binário). Antes ele só entendia `texto`: passar bytes virava
   * `encode(undefined)` — o ZIP saía com o texto "undefined" no lugar do arquivo, e o erro
   * só aparecia depois, ao LER o ZIP de volta ("Offset is outside the bounds of the
   * DataView"). Falha longe da causa.
   */
  async function zipar(arquivos) {
    return montarZipMultiplo(arquivos);
  }

  async function montarZipMultiplo(arquivos) {
    const locais = [];
    const centrais = [];
    let deslocamento = 0;

    for (const a of arquivos) {
      const dados = a.bytes !== undefined
        ? (a.bytes instanceof Uint8Array ? a.bytes : new Uint8Array(a.bytes))
        : new TextEncoder().encode(a.texto);
      let corpo = dados, metodo = 0;
      if (typeof CompressionStream !== 'undefined') {
        const fluxo = new Blob([dados]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        corpo = new Uint8Array(await new Response(fluxo).arrayBuffer());
        metodo = 8;
      }
      const crc = kml.crc32(dados);
      const nomeBytes = new TextEncoder().encode(a.nome);

      const local = new ArrayBuffer(30 + nomeBytes.length);
      const lv = new DataView(local);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(8, metodo, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, corpo.length, true);
      lv.setUint32(22, dados.length, true);
      lv.setUint16(26, nomeBytes.length, true);
      new Uint8Array(local, 30).set(nomeBytes);
      locais.push(new Uint8Array(local), corpo);

      const central = new ArrayBuffer(46 + nomeBytes.length);
      const cv = new DataView(central);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(10, metodo, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, corpo.length, true);
      cv.setUint32(24, dados.length, true);
      cv.setUint16(28, nomeBytes.length, true);
      cv.setUint32(42, deslocamento, true);
      new Uint8Array(central, 46).set(nomeBytes);
      centrais.push(new Uint8Array(central));

      deslocamento += local.byteLength + corpo.length;
    }

    const tamCentral = centrais.reduce((s, c) => s + c.length, 0);
    const fim = new ArrayBuffer(22);
    const fv = new DataView(fim);
    fv.setUint32(0, 0x06054b50, true);
    fv.setUint16(8, arquivos.length, true);
    fv.setUint16(10, arquivos.length, true);
    fv.setUint32(12, tamCentral, true);
    fv.setUint32(16, deslocamento, true);

    const todas = locais.concat(centrais, [new Uint8Array(fim)]);
    const total = todas.reduce((s, p) => s + p.length, 0);
    const saida = new Uint8Array(total);
    let p = 0;
    for (const parte of todas) { saida.set(parte, p); p += parte.length; }
    return saida;
  }

  function escaparXml(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function colunaLetra(n) {
    let s = '';
    let x = n;
    while (x >= 0) {
      s = String.fromCharCode(65 + (x % 26)) + s;
      x = Math.floor(x / 26) - 1;
    }
    return s;
  }

  /**
   * Monta o .xlsx a partir de abas.
   * @param {{nome:string, colunas:Array, linhas:Array<Array>}[]} abas
   * @returns {Promise<Uint8Array>}
   */
  async function gerar(abas, opcoes) {
    const o = opcoes || {};
    const arquivos = [];

    const sheetXml = abas.map((aba, i) => {
      const linhas = [];
      linhas.push('<row r="1">' + aba.colunas.map((c, k) => {
        const ref = colunaLetra(k) + '1';
        return '<c r="' + ref + '" t="inlineStr" s="1"><is><t>' + escaparXml(c.rotulo || c.campo || c) + '</t></is></c>';
      }).join('') + '</row>');

      aba.linhas.forEach((linha, li) => {
        const r = li + 2;
        linhas.push('<row r="' + r + '">' + linha.map((valor, k) => {
          const ref = colunaLetra(k) + r;
          if (valor === null || valor === undefined || valor === '') return '';
          if (typeof valor === 'number' && Number.isFinite(valor)) {
            return '<c r="' + ref + '"><v>' + valor + '</v></c>';
          }
          return '<c r="' + ref + '" t="inlineStr"><is><t>' + escaparXml(valor) + '</t></is></c>';
        }).join('') + '</row>');
      });

      const larguras = (aba.colunas || []).map((c, k) => {
        const maior = Math.min(40, Math.max(10, String(c.rotulo || c.campo || '').length + 4));
        return '<col min="' + (k + 1) + '" max="' + (k + 1) + '" width="' + maior + '" customWidth="1"/>';
      }).join('');

      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + '<cols>' + larguras + '</cols>'
        + '<sheetData>' + linhas.join('') + '</sheetData></worksheet>';
    });

    sheetXml.forEach((xml, i) => arquivos.push({ nome: 'xl/worksheets/sheet' + (i + 1) + '.xml', texto: xml }));

    arquivos.push({
      nome: '[Content_Types].xml',
      texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + sheetXml.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1)
          + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')
        + '</Types>',
    });

    arquivos.push({
      nome: '_rels/.rels',
      texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        + '</Relationships>',
    });

    arquivos.push({
      nome: 'xl/workbook.xml',
      texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
        + abas.map((a, i) => '<sheet name="' + escaparXml(a.nome.slice(0, 31)) + '" sheetId="' + (i + 1)
          + '" r:id="rId' + (i + 1) + '"/>').join('')
        + '</sheets></workbook>',
    });

    arquivos.push({
      nome: 'xl/_rels/workbook.xml.rels',
      texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + abas.map((a, i) => '<Relationship Id="rId' + (i + 1)
          + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'
          + (i + 1) + '.xml"/>').join('')
        + '<Relationship Id="rId' + (abas.length + 1)
        + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        + '</Relationships>',
    });

    arquivos.push({
      nome: 'xl/styles.xml',
      texto: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
        + '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
        + '<fills count="2"><fill><patternFill patternType="none"/></fill>'
        + '<fill><patternFill patternType="gray125"/></fill></fills>'
        + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
        + '</styleSheet>',
    });

    void o;
    return zipar(arquivos);
  }

  /** CSV com separador ponto e vírgula (padrão do Excel em português). */
  function gerarCsv(colunas, linhas, opcoes) {
    const o = opcoes || {};
    const sep = o.separador || ';';
    const quebra = o.quebra || '\r\n';
    const cabecalho = colunas.map((c) => celula(c.rotulo || c.campo || c)).join(sep);
    const corpo = linhas.map((linha) => linha.map(celula).join(sep));
    return '\uFEFF' + [cabecalho].concat(corpo).join(quebra) + quebra;

    function celula(v) {
      if (v === null || v === undefined) return '';
      let s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
      if (/[";\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
  }

  return {
    gerar: gerar,
    gerarCsv: gerarCsv,
    zipar: zipar,
  };
});
