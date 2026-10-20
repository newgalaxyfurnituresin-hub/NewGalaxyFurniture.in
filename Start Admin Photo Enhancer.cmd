@echo off
cd /d "%~dp0"
echo New Galaxy Furniture - admin upload AI enhancement
echo Keep this computer on and this window open to process website uploads.
echo Uploads from your phone and tablet work too. Review the result in admin.
node node_modules\tsx\dist\cli.mjs scripts\admin-photo-enhancer.ts
pause
