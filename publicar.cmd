@echo off
chcp 65001 >nul
title Publicar o Portal EIA/RIMA
cd /d "%~dp0"

echo ===========================================================
echo   Publicar o Portal EIA/RIMA
echo ===========================================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo ERRO: nao encontrei o Git neste computador.
  echo Instale o Git for Windows ou use o Git Bash.
  echo.
  pause
  exit /b 1
)

echo O que ainda NAO foi para o GitHub:
echo.
git log --oneline origin/main..HEAD
if errorlevel 1 (
  echo   (nao consegui consultar o GitHub - confira a internet)
)
echo.

echo Situacao dos arquivos:
git status --short
echo.

echo -----------------------------------------------------------
echo 1. Salvar as mudancas (commit)
echo 2. Enviar para o GitHub (push)
echo 3. Sair sem fazer nada
echo -----------------------------------------------------------
set /p opcao="Escolha 1, 2 ou 3 e aperte Enter: "

if "%opcao%"=="3" goto fim
if "%opcao%"=="2" goto enviar
if "%opcao%"=="1" goto salvar

echo.
echo Opcao invalida.
goto fim

:salvar
echo.
git status --short | findstr /r "." >nul
if errorlevel 1 (
  echo Nada mudou desde o ultimo commit - nao ha o que salvar.
  echo.
  goto fim
)
echo Escreva uma descricao curta do que mudou.
echo Exemplo: base de geomorfologia importada
echo.
set /p mensagem="Descricao: "
if "%mensagem%"=="" set mensagem=Atualizacao da base do portal
echo.
git add -A
git commit -m "%mensagem%"
if errorlevel 1 (
  echo.
  echo O commit falhou. Leia a mensagem acima.
  echo.
  goto fim
)
echo.
echo Salvo. Agora enviando para o GitHub...
echo.

:enviar
git push
if errorlevel 1 (
  echo.
  echo ---------------------------------------------------------
  echo O envio FALHOU. O que fazer:
  echo.
  echo  - "Internal Server Error": erro do GitHub. Rode de novo.
  echo  - pediu usuario/senha: autorize na janela que abrir.
  echo  - "index.lock": o OneDrive esta sincronizando. Feche o
  echo    OneDrive, rode de novo e reabra depois.
  echo ---------------------------------------------------------
  echo.
  pause
  exit /b 1
)

echo.
echo ===========================================================
echo   PUBLICADO. A Vercel republica sozinha em ~30 segundos.
echo   Para conferir: abra o site e olhe o rodape do mapa
echo   (deve mostrar a versao mais nova).
echo ===========================================================
echo.

:fim
pause
