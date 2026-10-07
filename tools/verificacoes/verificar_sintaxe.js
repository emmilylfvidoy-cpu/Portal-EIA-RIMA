'use strict';
/* Verificação de sintaxe de tudo que o navegador carrega.
 *
 * Por que existe: os testes de Node cobrem os módulos que têm `module.exports`, mas
 * `app.js` só roda no navegador. Um erro de sintaxe ali derruba o portal inteiro e
 * não apareceria em nenhum outro teste. Aqui todos os arquivos servidos são
 * compilados com `new Function`, sem executar.
 *
 * Uso: node tools/verificacoes/verificar_sintaxe.js */
const fs = require('fs');
const path = require('path');

function executar() {
  const raiz = path.resolve(__dirname, '..', '..');
  const arquivos = [];

  const varrer = (dir, filtro) => {
    for (const nome of fs.readdirSync(dir)) {
      const p = path.join(dir, nome);
      const st = fs.statSync(p);
      if (st.isDirectory()) { varrer(p, filtro); continue; }
      if (filtro(nome)) arquivos.push(p);
    }
  };
  varrer(path.join(raiz, 'js'), (n) => n.endsWith('.js'));
  varrer(path.join(raiz, 'tools'), (n) => n.endsWith('.js') && n[0] !== '_');
  arquivos.push(path.join(raiz, 'app.js'));

  let falhas = 0, testes = 0;
  console.log('\n== Sintaxe dos arquivos servidos ==');
  for (const arq of arquivos) {
    const rel = path.relative(raiz, arq).replace(/\\/g, '/');
    if (!fs.existsSync(arq)) continue;
    testes++;
    const src = fs.readFileSync(arq, 'utf8');
    try {
      // `new Function` compila sem executar: pega erro de sintaxe e de escape
      new Function(src);
      console.log('  ok  ' + rel);
    } catch (e) {
      falhas++;
      console.log('  FALHA ' + rel + ' -> ' + e.message);
    }
    if (/\r\n/.test(src) && /[^\x00-\x7F]/.test(src)) {
      // aviso, não falha: só serve para não gravar arquivo com quebra mista
      console.log('        (atenção: o arquivo tem CRLF e acentos — mantenha LF)');
    }
  }

  console.log('\n== Referências do index.html ==');
  const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
  const refs = [];
  const re = /(?:src|href)="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const r = m[1];
    if (/^(https?:|data:|#)/.test(r)) continue;
    refs.push(r.split('?')[0]);
  }
  for (const r of refs) {
    testes++;
    const p = path.join(raiz, r);
    if (fs.existsSync(p)) console.log('  ok  ' + r);
    else { falhas++; console.log('  FALHA ' + r + ' (não existe)'); }
  }

  const idsHtml = new Set();
  const reId = /\sid="([^"]+)"/g;
  while ((m = reId.exec(html)) !== null) idsHtml.add(m[1]);
  const app = fs.readFileSync(path.join(raiz, 'app.js'), 'utf8');
  const usados = new Set();
  const reUso = /\$\('([^']+)'\)/g;
  while ((m = reUso.exec(app)) !== null) usados.add(m[1]);
  console.log('\n== Ids usados pelo app.js ==');
  for (const id of usados) {
    testes++;
    if (idsHtml.has(id)) console.log('  ok  #' + id);
    else { falhas++; console.log('  FALHA #' + id + ' não existe no index.html'); }
  }

  console.log('\n' + (falhas ? 'FALHAS: ' + falhas + '/' + testes : 'TODOS OS ' + testes + ' TESTES PASSARAM'));
  return falhas ? 1 : 0;
}

module.exports = { executar };
if (require.main === module) process.exit(executar());
