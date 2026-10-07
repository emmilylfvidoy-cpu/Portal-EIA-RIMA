'use strict';
/* Servidor estático mínimo para o teste de fumaça do portal.
 * Uso: node tools/servidor.js [porta]   (padrão 8099)
 *
 * Não é parte do produto: o portal é estático e vai para a Vercel. Este arquivo
 * existe só para o teste de navegador poder buscar o catálogo por HTTP. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const raiz = path.resolve(__dirname, '..');
const porta = Number(process.argv[2] || 8099);

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const servidor = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const arq = path.join(raiz, rel);
  if (!arq.startsWith(raiz)) { res.writeHead(403).end('fora do diretório'); return; }
  fs.readFile(arq, (err, dados) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('não encontrado: ' + rel); return; }
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(arq).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(dados);
  });
});

servidor.listen(porta, '127.0.0.1', () => {
  console.log('servidor de teste em http://127.0.0.1:' + porta + ' servindo ' + raiz);
});
