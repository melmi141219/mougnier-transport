@echo off
rem MOUGNIER TRANSPORT - met a jour la plateforme installee avec le programme du projet.
rem Pas besoin des droits administrateur. Double-clic, puis attendre la ligne verte "OK".
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0mettre-a-jour.ps1"
pause
