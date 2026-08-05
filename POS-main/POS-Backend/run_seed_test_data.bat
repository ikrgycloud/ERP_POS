@echo off
setlocal
cd /d "%~dp0"
python -m scripts.seed_test_data
pause
