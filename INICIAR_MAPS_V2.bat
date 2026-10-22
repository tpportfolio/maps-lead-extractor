@echo off
title MAPS LEAD EXTRACTOR V2
cd /d "%~dp0apps\web"

docker info >nul 2>&1
if errorlevel 1 (
  echo ============================================================
  echo  ADVERTENCIA: Docker no esta corriendo.
  echo  El boton BUSCAR no va a funcionar, pero el resto si.
  echo  Abri Docker Desktop y espera a que diga "Running".
  echo ============================================================
  echo.
)

echo Iniciando MAPS LEAD EXTRACTOR V2...
echo El navegador se abrira solo en http://localhost:3000
start "MAPS V2 Browser" cmd /c "timeout /t 15 /nobreak >nul & start http://localhost:3000"
npm run dev
pause
