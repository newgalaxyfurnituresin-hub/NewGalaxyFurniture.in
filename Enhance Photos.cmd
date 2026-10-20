@echo off
cd /d "%~dp0"
echo New Galaxy Furniture - free local AI photo enhancement
echo Keep this window open while processing. Press Ctrl+C to stop.
echo Original photos are preserved. Review the results before uploading.
if not exist ".wrangler\image-enhancer\engine\realesrgan-ncnn-vulkan.exe" (
  echo First run the setup instructions in docs\PHOTO-ENHANCEMENT.md.
  pause
  exit /b 1
)
if not exist ".wrangler\image-enhancer\inbox" mkdir ".wrangler\image-enhancer\inbox"
if not exist ".wrangler\image-enhancer\review" mkdir ".wrangler\image-enhancer\review"
start "" ".wrangler\image-enhancer\inbox"
start "" ".wrangler\image-enhancer\review"
node node_modules\tsx\dist\cli.mjs scripts\enhance-photos.ts --watch
pause
