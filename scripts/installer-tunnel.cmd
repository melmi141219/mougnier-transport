@echo off
rem MOUGNIER TRANSPORT - branche ce PC au tunnel Cloudflare (transport.mougniertech.com).
rem Double-clic sur ce fichier, puis repondre Oui a la question de Windows.
rem Une fenetre bleue s'ouvre, demande de coller la commande copiee dans Cloudflare, et reste ouverte a la fin.
powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoExit -ExecutionPolicy Bypass -File \"%~dp0installer-tunnel.ps1\"'"
