'use strict';
/* Testa se o WFS do DataGEO entrega o SHAPE-ZIP por UGRHI (sem baixar o arquivo inteiro).
 * Temporario. */
const CAMINHO = 'geoserver/datageo/INVENTARIO_FLORESTAL_UGRHI17_IPA_2020_POL/wfs'
  + '?version=1.0.0&request=GetFeature&outputFormat=SHAPE-ZIP'
  + '&typeName=INVENTARIO_FLORESTAL_UGRHI17_IPA_2020_POL';

async function testar(base) {
  const url = base + '/' + CAMINHO;
  try {
    const cab = await fetch(url, { method: 'HEAD' });
    console.log('  ' + base);
    console.log('    HEAD -> HTTP ' + cab.status
      + '   tipo: ' + (cab.headers.get('content-type') || '(sem)')
      + '   tamanho: ' + (cab.headers.get('content-length')
        ? (Number(cab.headers.get('content-length')) / 1048576).toFixed(1) + ' MB' : '(não informado)'));
    if (cab.status !== 200) {
      const r = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-300' } });
      const t = await r.text();
      const m = t.match(/ExceptionText>([^<]+)</) || t.match(/<ows:Exception[^>]*>/);
      console.log('    GET parcial -> HTTP ' + r.status + (m ? '   ' + m[1].slice(0, 160) : ''));
    }
  } catch (e) {
    console.log('  ' + base + '  -> FALHOU: ' + e.message);
  }
}

(async () => {
  await testar('https://datageo.ambiente.sp.gov.br');
  await testar('http://datageo.ambiente.sp.gov.br');
})();
