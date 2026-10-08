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

# Proxy checkbox ("Use a proxy server").
# Set through the official WinINet API (INTERNET_OPTION_PER_CONNECTION_OPTION):
# Windows itself writes DefaultConnectionSettings to the right place and
# notifies all programs. Address/port/exceptions are not touched.
$wininet = @'
using System;
using System.Runtime.InteropServices;
public static class WinInetProxy {
    [StructLayout(LayoutKind.Sequential)] public struct Opt { public int dwOption; public IntPtr value; }
    [StructLayout(LayoutKind.Sequential)] public struct OptList {
        public int dwSize; public IntPtr pszConnection; public int dwOptionCount; public int dwOptionError; public IntPtr pOptions;
    }
    [DllImport("wininet.dll", SetLastError = true, EntryPoint = "InternetQueryOptionW")]
    static extern bool QueryList(IntPtr h, int o, ref OptList b, ref int l);
    [DllImport("wininet.dll", SetLastError = true, EntryPoint = "InternetSetOptionW")]
    static extern bool SetList(IntPtr h, int o, ref OptList b, int l);
    [DllImport("wininet.dll", SetLastError = true, EntryPoint = "InternetSetOptionW")]
    static extern bool SetPtr(IntPtr h, int o, IntPtr b, int l);

    const int PER_CONNECTION_OPTION = 75, PER_CONN_FLAGS = 1, SETTINGS_CHANGED = 39, REFRESH = 37;

    public static int GetFlags() {
        Opt opt = new Opt(); opt.dwOption = PER_CONN_FLAGS;
        IntPtr p = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Opt)));
        try {
            Marshal.StructureToPtr(opt, p, false);
            OptList l = NewList(p);
            int len = l.dwSize;
            if (!QueryList(IntPtr.Zero, PER_CONNECTION_OPTION, ref l, ref len)) throw new System.ComponentModel.Win32Exception();
            opt = (Opt)Marshal.PtrToStructure(p, typeof(Opt));
            return (int)(opt.value.ToInt64() & 0xFFFFFFFF);
        } finally { Marshal.FreeHGlobal(p); }
    }

    public static int SetProxy(bool on) {
        int flags = GetFlags();
        flags = on ? (flags | 0x03) : ((flags & ~0x02) | 0x01);   // 0x01 DIRECT, 0x02 PROXY
        Opt opt = new Opt(); opt.dwOption = PER_CONN_FLAGS; opt.value = new IntPtr(flags);
        IntPtr p = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Opt)));
        try {
            Marshal.StructureToPtr(opt, p, false);
            OptList l = NewList(p);
            if (!SetList(IntPtr.Zero, PER_CONNECTION_OPTION, ref l, l.dwSize)) throw new System.ComponentModel.Win32Exception();
        } finally { Marshal.FreeHGlobal(p); }
        SetPtr(IntPtr.Zero, SETTINGS_CHANGED, IntPtr.Zero, 0);
        SetPtr(IntPtr.Zero, REFRESH, IntPtr.Zero, 0);
        return GetFlags();
    }

    static OptList NewList(IntPtr p) {
        OptList l = new OptList();
        l.dwSize = Marshal.SizeOf(typeof(OptList)); l.dwOptionCount = 1; l.pOptions = p;
        return l;
    }
}
'@

function Set-ProxyFlag([bool]$on) {
    # The proxy setting is per user: warn if the script runs under another account
    $me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $logged = (Get-CimInstance Win32_ComputerSystem).UserName
    if ($logged -and $logged -ne $me) {
        Write-Host "  [!] Script runs as '$me', but the logged-on user is '$logged'."
        Write-Host "  [!] Proxy will be switched for '$me' only. Run 'as administrator' under '$logged'."
    }
    $perUser = (Get-ItemProperty 'HKLM:\Software\Policies\Microsoft\Windows\CurrentVersion\Internet Settings' -Name ProxySettingsPerUser -ErrorAction SilentlyContinue).ProxySettingsPerUser
    if ($perUser -eq 0) { Write-Host '  [i] Policy ProxySettingsPerUser=0: proxy settings are per-machine' }

    Add-Type -TypeDefinition $wininet
    $flags = [WinInetProxy]::SetProxy($on)
    Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -Name ProxyEnable -Value ([int]$on) -Type DWord
    $state = if ($flags -band 0x02) { 'ON' } else { 'OFF' }
    Write-Host ('  [i] user {0}: proxy flags = 0x{1:X2} (proxy {2})' -f $me, $flags, $state)
    if ([bool]($flags -band 0x02) -ne $on) { throw 'Windows did not accept the proxy setting' }
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
