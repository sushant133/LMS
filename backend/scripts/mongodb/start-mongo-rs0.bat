@echo off
setlocal enabledelayedexpansion

echo ================================================
echo   Nepal School ERP - MongoDB Replica Set (rs0)
echo ================================================
echo.

:: Ensure data directory exists
if not exist "C:\data\rs0" (
    echo Creating data directory C:\data\rs0 ...
    mkdir "C:\data\rs0" >nul 2>&1
)

:: Create logs directory (relative to project)
if not exist "..\..\logs" mkdir "..\..\logs"

:: Generate timestamped log file
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set datetime=%%I
set LOGFILE=..\..\logs\mongo-rs0-%datetime:~0,8%_%datetime:~8,6%.log

echo [%date% %time%] Starting MongoDB as Replica Set rs0...
echo [%date% %time%] Data Path : C:\data\rs0
echo [%date% %time%] Log File  : %LOGFILE%
echo.

:: Start MongoDB with replica set configuration + logging
mongod --replSet rs0 ^
       --dbpath "C:\data\rs0" ^
       --port 27017 ^
       --bind_ip localhost ^
       --logpath "%LOGFILE%" ^
       --logappend

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] MongoDB failed to start.
    echo Check the log file for details: %LOGFILE%
    pause
    exit /b 1
)

pause
