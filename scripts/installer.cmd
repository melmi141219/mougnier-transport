@echo off
rem MOUGNIER TRANSPORT - lance l'installation avec les droits administrateur.
rem Double-clic sur ce fichier, puis repondre Oui a la question de Windows.
rem Une fenetre bleue s'ouvre et affiche le resultat. Elle reste ouverte a la fin.
powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoExit -ExecutionPolicy Bypass -File \"%~dp0installer-windows.ps1\"'"
