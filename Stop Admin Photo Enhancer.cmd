@echo off
cd /d "%~dp0"
if not exist ".wrangler\image-enhancer" mkdir ".wrangler\image-enhancer"
echo stop>".wrangler\image-enhancer\stop-admin.request"
echo The admin photo enhancer will stop after its current photo.
pause
