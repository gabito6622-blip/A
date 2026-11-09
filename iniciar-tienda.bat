@echo off
chcp 65001 >nul
title Gabriel Store
cd /d "%~dp0"

echo.
echo  ==============================
echo    Gabriel Store - iniciando
echo  ==============================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  Falta instalar Node.js.
  echo  Bajalo de https://nodejs.org  ^(version LTS, 22 o mas nueva^), instalalo y volve a abrir este archivo.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo  Instalando lo necesario ^(solo la primera vez, tarda un minuto^)...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :error
)

echo  Preparando la tienda...
call npm run build --silent
if errorlevel 1 goto :error

if not exist data\gabriel.db (
  echo.
  echo  Primera vez: vamos a crear tu usuario del panel.
  set /p GS_OWNER_USER= Usuario ^(minusculas, ej: gabriel^):
  set /p GS_OWNER_PASSWORD= Contrasena ^(minimo 10 caracteres^):
)

echo.
node dist/server/main.js
if errorlevel 1 goto :error
exit /b 0

:error
echo.
echo  Algo fallo. Mira el mensaje de arriba ^(podes sacarle una captura y mandarmela^).
pause
exit /b 1
