@echo off
echo Stopping MongoDB processes...
taskkill /F /IM mongod.exe /T 2>nul
echo MongoDB stopped (if it was running).
pause
