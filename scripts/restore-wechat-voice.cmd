@echo off
chcp 65001 >nul
title 恢复微信语音
set PY=%~dp0..\data\speech-env\Scripts\python.exe
if not exist "%PY%" set PY=%~dp0..\data\astrbot-env\Scripts\python.exe
"%PY%" -B "%~dp0rearm-wechat-voice.py" %*
echo.
pause
