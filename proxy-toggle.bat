@echo off
chcp 65001 >nul
setlocal

rem ===== Настройки =====
set "PROXY_IP=10.0.24.52"
set "PROXY_MASK=255.255.255.255"
set "PROXY_GW=10.84.159.1"
set "PROXY_METRIC=1"

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

call :POLICY proxyon
echo   + прокси включен

rem Политика "Запретить изменение параметров прокси":
rem и в конфигурации компьютера, и в конфигурации пользователя
call :POLICY add
reg add "%POL_HKCU%" /v Proxy /t REG_DWORD /d 1 /f >nul
reg add "%POL_HKLM%" /v Proxy /t REG_DWORD /d 1 /f >nul
call :GPUPDATE
echo   + изменение настроек прокси заблокировано (компьютер + пользователь)

call :REFRESH
echo Готово: прокси ВКЛЮЧЕН.
goto :END


:DISABLE
echo Маршрут до %PROXY_IP% найден - ВЫКЛЮЧАЮ прокси.

route delete %PROXY_IP% >nul
echo   - маршрут %PROXY_IP% удален

rem Снять блокировку во всех местах, где она может быть задана
call :POLICY remove
reg delete "%POL_HKCU%" /v Proxy /f >nul 2>&1
reg delete "%POL_HKLM%" /v Proxy /f >nul 2>&1
call :GPUPDATE

set "STILL_LOCKED="
reg query "%POL_HKCU%" /v Proxy >nul 2>&1 && set "STILL_LOCKED=1" && echo   [!] Блокировка осталась в политике ПОЛЬЗОВАТЕЛЯ
reg query "%POL_HKLM%" /v Proxy >nul 2>&1 && set "STILL_LOCKED=1" && echo   [!] Блокировка осталась в политике КОМПЬЮТЕРА
if defined STILL_LOCKED (
    echo   [!] Скорее всего, она приходит из доменной групповой политики - локально ее не снять.
) else (
    echo   - изменение настроек прокси разблокировано (компьютер + пользователь)
)

call :POLICY proxyoff
echo   - прокси выключен

call :REFRESH
echo Готово: прокси ВЫКЛЮЧЕН.
goto :END


:POLICY
rem Встроенный PowerShell-блок в конце файла:
rem   add / remove      - локальные групповые политики (Registry.pol)
rem   proxyon / proxyoff - переключатель "Использовать прокси-сервер"
set "POL_ACTION=%~1"
set "POL_SELF=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:POL_SELF); iex $t.Substring($t.LastIndexOf('#'+'PSBEGIN'))"
if errorlevel 1 echo   [!] Ошибка при выполнении: %~1
exit /b 0


:GPUPDATE
echo   ... применение групповых политик (gpupdate)
echo N | gpupdate /force >nul 2>&1
exit /b 0


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
goto :EOF

#PSBEGIN
# ---------------------------------------------------------------------------
# PowerShell part: edits Local Group Policy files (Registry.pol + gpt.ini)
#   add    - policy "Prevent changing proxy settings" = Enabled
#            in Computer Configuration and User Configuration
#   remove - policy = Not configured everywhere
# Per-user local policies (GroupPolicyUsers\<SID>) are always cleaned.
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$add     = ($env:POL_ACTION -eq 'add')
$polKey  = 'Software\Policies\Microsoft\Internet Explorer\Control Panel'
$polVal  = 'Proxy'
$gpRoot  = Join-Path $env:windir 'System32\GroupPolicy'
$gpUsers = Join-Path $env:windir 'System32\GroupPolicyUsers'
$cseReg  = '{35378EAC-683F-11D2-A89A-0000F87A3B66}'
$toolM   = '{0F6B957D-509E-11D1-A7CC-0000F87A3B66}'
$toolU   = '{0F6B957E-509E-11D1-A7CC-0000F87A3B66}'
$uni     = [Text.Encoding]::Unicode

function Save-Bytes([string]$path, [byte[]]$bytes) {
    New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
    $attr = $null
    if (Test-Path -LiteralPath $path) {
        $fi = Get-Item -LiteralPath $path -Force
        $attr = $fi.Attributes
        $fi.Attributes = 'Normal'
    }
    [IO.File]::WriteAllBytes($path, $bytes)
    if ($attr) { (Get-Item -LiteralPath $path -Force).Attributes = $attr }
}

function Read-Pol([string]$path) {
    $list = New-Object System.Collections.ArrayList
    if (-not (Test-Path -LiteralPath $path)) { return ,$list }
    $b = [IO.File]::ReadAllBytes($path)
    $p = 8                                                    # 'PReg' + version
    while ($p + 2 -le $b.Length) {
        $p += 2                                               # '['
        $s = $p; while ($b[$p] -ne 0 -or $b[$p+1] -ne 0) { $p += 2 }
        $key = $uni.GetString($b, $s, $p - $s); $p += 4       # \0 ;
        $s = $p; while ($b[$p] -ne 0 -or $b[$p+1] -ne 0) { $p += 2 }
        $val = $uni.GetString($b, $s, $p - $s); $p += 4       # \0 ;
        $type = [BitConverter]::ToUInt32($b, $p); $p += 6     # type ;
        $size = [BitConverter]::ToUInt32($b, $p); $p += 6     # size ;
        $data = New-Object byte[] $size
        if ($size) { [Array]::Copy($b, $p, $data, 0, $size) }
        $p += $size + 2                                       # data ]
        [void]$list.Add([pscustomobject]@{ Key = $key; Value = $val; Type = $type; Data = $data })
    }
    return ,$list
}

function Write-Pol([string]$path, $list) {
    $ms = New-Object IO.MemoryStream
    $w = { param([byte[]]$x) $ms.Write($x, 0, $x.Length) }
    & $w ([byte[]](0x50, 0x52, 0x65, 0x67, 1, 0, 0, 0))
    foreach ($e in $list) {
        & $w $uni.GetBytes('[' + $e.Key + [char]0 + ';' + $e.Value + [char]0 + ';')
        & $w ([BitConverter]::GetBytes([uint32]$e.Type));        & $w $uni.GetBytes(';')
        & $w ([BitConverter]::GetBytes([uint32]$e.Data.Length)); & $w $uni.GetBytes(';')
        & $w ([byte[]]$e.Data);                                  & $w $uni.GetBytes(']')
    }
    Save-Bytes $path $ms.ToArray()
}

# Remove our policy (Enabled "Proxy" or Disabled "**del.Proxy"), optionally add Enabled.
# Returns $true if the file was changed.
function Update-Pol([string]$path, [bool]$enable) {
    $list = Read-Pol $path
    $keep = @($list | Where-Object {
        -not ($_.Key -ieq $polKey -and ($_.Value -ieq $polVal -or $_.Value -ieq "**del.$polVal"))
    })
    $changed = ($keep.Count -ne $list.Count)
    if ($enable) {
        $keep += [pscustomobject]@{ Key = $polKey; Value = $polVal; Type = 4; Data = [BitConverter]::GetBytes([uint32]1) }
        $changed = $true
    }
    if ($changed) { Write-Pol $path $keep }
    return $changed
}

function Add-Ext($cur, [string]$pair) {
    $groups = @([regex]::Matches([string]$cur, '\[[^\]]*\]') | ForEach-Object { $_.Value })
    if ($groups -match [regex]::Escape($cseReg)) { return $cur }
    return ((@($groups) + $pair | Sort-Object) -join '')
}

# Bump gpt.ini version (low word - computer, high word - user) so Windows re-reads the policy
function Update-Gpt([string]$path, [bool]$machine, [bool]$user, [bool]$ensureExt) {
    $ini = [ordered]@{}
    if (Test-Path -LiteralPath $path) {
        foreach ($l in Get-Content -LiteralPath $path -Force) {
            if ($l -match '^\s*([^=\[]+?)\s*=(.*)$') { $ini[$matches[1]] = $matches[2] }
        }
    }
    if (-not $ini.Contains('gPCFunctionalityVersion')) { $ini.Insert(0, 'gPCFunctionalityVersion', '2') }
    [long]$ver = 0
    if ($ini.Contains('Version')) { $ver = [long]$ini['Version'] }
    if ($machine) { $ver += 1 }
    if ($user)    { $ver += 0x10000 }
    $ini['Version'] = $ver
    if ($ensureExt) {
        if ($machine) { $ini['gPCMachineExtensionNames'] = Add-Ext $ini['gPCMachineExtensionNames'] "[$cseReg$toolM]" }
        if ($user)    { $ini['gPCUserExtensionNames']    = Add-Ext $ini['gPCUserExtensionNames']    "[$cseReg$toolU]" }
    }
    $lines = @('[General]') + @($ini.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" })
    Save-Bytes $path ([Text.Encoding]::ASCII.GetBytes(($lines -join "`r`n") + "`r`n"))
}

# Proxy checkbox. Windows reads it from the binary value
# Connections\DefaultConnectionSettings (byte 8 = flags, 0x02 = proxy on),
# ProxyEnable is only a legacy copy.
function Set-ProxyFlag([bool]$on) {
    $ie = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
    $k  = "$ie\Connections"
    $done = $false
    foreach ($n in 'DefaultConnectionSettings', 'SavedLegacySettings') {
        $b = (Get-ItemProperty -Path $k -Name $n -ErrorAction SilentlyContinue).$n
        if (-not $b -or $b.Length -lt 12) { continue }
        $cnt = ([long][BitConverter]::ToUInt32($b, 4) + 1) % 4294967296
        [BitConverter]::GetBytes([uint32]$cnt).CopyTo($b, 4)  # change counter
        if ($on) { $b[8] = $b[8] -bor 0x03 } else { $b[8] = ($b[8] -band 0xFD) -bor 0x01 }
        Set-ItemProperty -Path $k -Name $n -Value ([byte[]]$b)
        $done = $true
    }
    Set-ItemProperty -Path $ie -Name ProxyEnable -Value ([int]$on) -Type DWord
    if (-not $done) { Write-Host '  [!] DefaultConnectionSettings not found - set the proxy once manually in Settings' }
}

if ($env:POL_ACTION -like 'proxy*') {
    try { Set-ProxyFlag ($env:POL_ACTION -eq 'proxyon'); exit 0 }
    catch { Write-Host "  [!] $($_.Exception.Message)"; exit 1 }
}

try {
    # Local Group Policy: Computer Configuration + User Configuration
    $m = Update-Pol (Join-Path $gpRoot 'Machine\Registry.pol') $add
    $u = Update-Pol (Join-Path $gpRoot 'User\Registry.pol')    $add
    if ($m -or $u) { Update-Gpt (Join-Path $gpRoot 'gpt.ini') $m $u $add }

    # Per-user local policies (Administrators / Non-Administrators / specific users)
    if (Test-Path -LiteralPath $gpUsers) {
        foreach ($d in Get-ChildItem -LiteralPath $gpUsers -Directory -Force) {
            $pu = Join-Path $d.FullName 'User\Registry.pol'
            if ((Test-Path -LiteralPath $pu) -and (Update-Pol $pu $false)) {
                Update-Gpt (Join-Path $d.FullName 'gpt.ini') $false $true $false
                Write-Host "  - policy removed from GroupPolicyUsers\$($d.Name)"
            }
        }
    }
    exit 0
} catch {
    Write-Host "  [!] $($_.Exception.Message)"
    exit 1
}
