@echo off
setlocal
set URL=http://127.0.0.1:8099/tools/_fumaca.html
set PERFIL=%TEMP%\fumaca-eia-%RANDOM%%RANDOM%
set SAIDA=%~dp0_fumaca-dom.html

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set NAV=%ProgramFiles%\Google\Chrome\Application\chrome.exe
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set NAV=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe
echo NAV=%NAV%
"%NAV%" --headless --disable-gpu --no-sandbox --disable-dev-shm-usage --no-first-run --user-data-dir="%PERFIL%" --virtual-time-budget=90000 --dump-dom "%URL%" > "%SAIDA%" 2>"%~dp0_fumaca-erro.txt"
echo exit=%ERRORLEVEL%
for %%A in ("%SAIDA%") do echo bytes=%%~zA
