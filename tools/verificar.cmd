@echo off
rem Roda todas as verificacoes do portal (Node, sem navegador).
rem Uso: tools\verificar.cmd  (ou: node tools/verificar.js)
node "%~dp0verificar.js" %*
