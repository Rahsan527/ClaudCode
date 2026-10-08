@echo off
chcp 65001 >nul
setlocal

rem ===== Настройки =====
set "PROXY_IP=10.0.24.52"
set "PROXY_MASK=255.255.255.255"
set "PROXY_GW=10.84.159.1"
set "PROXY_METRIC=1"

set "INET_KEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings"
set "POL_HKCU=HKCU\Software\Policies\Microsoft\Internet Explorer\Control Panel"
set "POL_HKLM=HKLM\Software\Policies\Microsoft\Internet Explorer\Control Panel"

rem ===== Проверка прав администратора =====
net session >nul 2>&1
if errorlevel 1 (
    echo [ОШИБКА] Запустите скрипт от имени администратора.
    pause
    exit /b 1
)

rem ===== Есть ли маршрут до прокси =====
route print -4 | findstr /r /c:"^ *%PROXY_IP:.=\.% " >nul
if errorlevel 1 goto :ENABLE
goto :DISABLE


:ENABLE
echo Маршрут до %PROXY_IP% не найден - ВКЛЮЧАЮ прокси.

route -p add %PROXY_IP% mask %PROXY_MASK% %PROXY_GW% metric %PROXY_METRIC% >nul
if errorlevel 1 (
    echo [ОШИБКА] Не удалось добавить маршрут.
    pause
    exit /b 1
)
echo   + маршрут %PROXY_IP% через %PROXY_GW% добавлен

reg add "%INET_KEY%" /v ProxyEnable /t REG_DWORD /d 1 /f >nul
echo   + прокси включен

rem Политика "Запретить изменение параметров прокси"
reg add "%POL_HKCU%" /v Proxy /t REG_DWORD /d 1 /f >nul
reg add "%POL_HKLM%" /v Proxy /t REG_DWORD /d 1 /f >nul
echo   + изменение настроек прокси заблокировано

call :REFRESH
echo Готово: прокси ВКЛЮЧЕН.
goto :END


:DISABLE
echo Маршрут до %PROXY_IP% найден - ВЫКЛЮЧАЮ прокси.

route delete %PROXY_IP% >nul
echo   - маршрут %PROXY_IP% удален

reg delete "%POL_HKCU%" /v Proxy /f >nul 2>&1
reg delete "%POL_HKLM%" /v Proxy /f >nul 2>&1
echo   - изменение настроек прокси разблокировано

reg add "%INET_KEY%" /v ProxyEnable /t REG_DWORD /d 0 /f >nul
echo   - прокси выключен

call :REFRESH
echo Готово: прокси ВЫКЛЮЧЕН.
goto :END


:REFRESH
rem Уведомить WinINet об изменении настроек, чтобы они применились без перезагрузки
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s='[DllImport(\"wininet.dll\")] public static extern bool InternetSetOption(IntPtr h,int o,IntPtr b,int l);';" ^
  "$t=Add-Type -MemberDefinition $s -Name W -Namespace I -PassThru;" ^
  "[void]$t::InternetSetOption(0,39,0,0); [void]$t::InternetSetOption(0,37,0,0)" >nul 2>&1
exit /b 0


:END
echo.
pause
endlocal
