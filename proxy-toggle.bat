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

rem ===== Режим: on / off / без параметра = переключить =====
call :POLICY status "BEFORE"
if /i "%~1"=="on"  goto :ENABLE
if /i "%~1"=="off" goto :DISABLE
route print -4 | findstr /r /c:"^ *%PROXY_IP:.=\.% " >nul
if errorlevel 1 goto :ENABLE
goto :DISABLE


:ENABLE
echo ===== ВКЛЮЧАЮ прокси =====

route delete %PROXY_IP% >nul 2>&1
route -p add %PROXY_IP% mask %PROXY_MASK% %PROXY_GW% metric %PROXY_METRIC% >nul
if errorlevel 1 (
    echo [ОШИБКА] Не удалось добавить маршрут.
    pause
    exit /b 1
)
echo   + маршрут %PROXY_IP% через %PROXY_GW% добавлен

rem Политика "Запретить изменение параметров прокси":
rem и в конфигурации компьютера, и в конфигурации пользователя
call :POLICY add
reg add "%POL_HKCU%" /v Proxy /t REG_DWORD /d 1 /f >nul
reg add "%POL_HKLM%" /v Proxy /t REG_DWORD /d 1 /f >nul
call :GPUPDATE
echo   + изменение настроек прокси заблокировано (компьютер + пользователь)

rem Переключатель ставится ПОСЛЕ gpupdate, чтобы политики его не перезаписали
call :POLICY proxyon
goto :DONE


:DISABLE
echo ===== ВЫКЛЮЧАЮ прокси =====

route delete %PROXY_IP% >nul 2>&1
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
goto :DONE


:DONE
rem Через 3 секунды перечитать реальное состояние - видно, не сбросил ли его кто-то
timeout /t 3 /nobreak >nul
call :POLICY status "AFTER (3 sec later)"
goto :END


:POLICY
rem Встроенный PowerShell-блок в конце файла:
rem   add / remove      - локальные групповые политики (Registry.pol)
rem   proxyon / proxyoff - переключатель "Использовать прокси-сервер"
rem   status             - вывод фактического состояния
set "POL_ACTION=%~1"
set "POL_TITLE=%~2"
set "POL_SELF=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText($env:POL_SELF); iex $t.Substring($t.LastIndexOf('#'+'PSBEGIN'))"
if errorlevel 1 echo   [!] Ошибка при выполнении: %~1
exit /b 0


:GPUPDATE
echo   ... применение групповых политик (gpupdate)
echo N | gpupdate /force >nul 2>&1
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

# Users whose proxy we switch: everyone logged on interactively (owners of explorer.exe).
# Proxy settings live in each user's own hive (HKEY_USERS\<SID>), so when the script
# is elevated under another admin account, HKCU is the WRONG place.
function Get-TargetUsers {
    $res = @{}
    foreach ($pr in Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" -ErrorAction SilentlyContinue) {
        try {
            $o = Invoke-CimMethod -InputObject $pr -MethodName GetOwner
            if ($o.User) {
                $name = "$($o.Domain)\$($o.User)"
                $sid  = (New-Object Security.Principal.NTAccount($name)).Translate([Security.Principal.SecurityIdentifier]).Value
                $res[$sid] = $name
            }
        } catch { }
    }
    if ($res.Count -eq 0) {
        $me = [Security.Principal.WindowsIdentity]::GetCurrent()
        $res[$me.User.Value] = $me.Name
    }
    foreach ($sid in $res.Keys) {
        if (Test-Path "Registry::HKEY_USERS\$sid") { [pscustomobject]@{ Sid = $sid; Name = $res[$sid] } }
    }
}

$ieRel  = 'Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$polRel = 'Software\Policies\Microsoft\Internet Explorer\Control Panel'

# Proxy checkbox = flag 0x02 in Connections\DefaultConnectionSettings (byte 8).
function Set-ProxyFlag([bool]$on) {
    $me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    foreach ($t in Get-TargetUsers) {
        $ie = "Registry::HKEY_USERS\$($t.Sid)\$ieRel"
        $found = $false
        foreach ($n in 'DefaultConnectionSettings', 'SavedLegacySettings') {
            $b = (Get-ItemProperty -Path "$ie\Connections" -Name $n -ErrorAction SilentlyContinue).$n
            if (-not $b -or $b.Length -lt 12) { continue }
            $cnt = ([long][BitConverter]::ToUInt32($b, 4) + 1) % 4294967296
            [BitConverter]::GetBytes([uint32]$cnt).CopyTo($b, 4)
            if ($on) { $b[8] = $b[8] -bor 0x03 } else { $b[8] = ($b[8] -band 0xFD) -bor 0x01 }
            Set-ItemProperty -Path "$ie\Connections" -Name $n -Value ([byte[]]$b)
            if ($n -eq 'DefaultConnectionSettings') { $found = $true }
        }
        Set-ItemProperty -Path $ie -Name ProxyEnable -Value ([int]$on) -Type DWord
        if (-not $found) { Write-Host "  [!] $($t.Name): no DefaultConnectionSettings - set the proxy once manually" }
        Write-Host "  [i] $($t.Name): proxy $(if ($on) { 'ON' } else { 'OFF' })"

        # Tell the user's programs (Settings, browsers) to re-read the settings
        if ($t.Sid -eq $me) {
            Add-Type -TypeDefinition $wininet
            [void][WinInetProxy]::SetProxy($on)
        } else {
            Send-Refresh $t.Name
        }
    }
}

# Run InternetSetOption(SETTINGS_CHANGED/REFRESH) inside the user's session
# via a one-time scheduled task (no password needed for Interactive logon type).
function Send-Refresh([string]$user) {
    $code = '$t=Add-Type -MemberDefinition ''[DllImport("wininet.dll")] public static extern bool InternetSetOption(IntPtr h,int o,IntPtr b,int l);'' -Name W -Namespace I -PassThru; [void]$t::InternetSetOption(0,39,0,0); [void]$t::InternetSetOption(0,37,0,0)'
    $enc  = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
    $name = 'ProxyToggleRefresh'
    try {
        $act = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -EncodedCommand $enc"
        $prn = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive
        Register-ScheduledTask -TaskName $name -Action $act -Principal $prn -Force | Out-Null
        Start-ScheduledTask -TaskName $name
        for ($i = 0; $i -lt 30 -and (Get-ScheduledTask -TaskName $name).State -eq 'Running'; $i++) { Start-Sleep -Milliseconds 500 }
    } catch {
        Write-Host "  [!] Could not notify $user ($($_.Exception.Message)) - reopen Settings/browser"
    } finally {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
    }
}

# Lock value directly in each user's hive (takes effect at once, without user's gpupdate)
function Set-UserLock([bool]$on) {
    foreach ($t in Get-TargetUsers) {
        $k = "Registry::HKEY_USERS\$($t.Sid)\$polRel"
        if ($on) {
            New-Item -Path $k -Force | Out-Null
            Set-ItemProperty -Path $k -Name Proxy -Value 1 -Type DWord
        } else {
            Remove-ItemProperty -Path $k -Name Proxy -ErrorAction SilentlyContinue
        }
    }
}

# Real state, read straight from the registry
function Show-Status {
    $line = '  ' + ('-' * 60)
    Write-Host "$line`n  $env:POL_TITLE"
    Write-Host "  Script account : $([Security.Principal.WindowsIdentity]::GetCurrent().Name)"
    $route = Get-NetRoute -DestinationPrefix "$env:PROXY_IP/32" -ErrorAction SilentlyContinue
    Write-Host "  Route to proxy : $(if ($route) { 'yes, via ' + $route[0].NextHop } else { 'no' })"
    $lm = (Get-ItemProperty "HKLM:\$polRel" -Name Proxy -ErrorAction SilentlyContinue).Proxy
    Write-Host "  Lock (computer): $(if ($lm -eq 1) { 'yes' } else { 'no' })"
    foreach ($t in Get-TargetUsers) {
        $ie = "Registry::HKEY_USERS\$($t.Sid)\$ieRel"
        $b  = (Get-ItemProperty "$ie\Connections" -Name DefaultConnectionSettings -ErrorAction SilentlyContinue).DefaultConnectionSettings
        $fl = if ($b -and $b.Length -ge 12) {
            $f = $b[8]; $x = @()
            if ($f -band 2) { $x += 'PROXY' }; if ($f -band 4) { $x += 'SCRIPT' }; if ($f -band 8) { $x += 'AUTODETECT' }
            '0x{0:X2} [{1}]' -f $f, ($x -join ',')
        } else { '(no DefaultConnectionSettings)' }
        $u  = Get-ItemProperty $ie -ErrorAction SilentlyContinue
        $ul = (Get-ItemProperty "Registry::HKEY_USERS\$($t.Sid)\$polRel" -Name Proxy -ErrorAction SilentlyContinue).Proxy
        Write-Host "  User $($t.Name):"
        Write-Host "      flags $fl, ProxyServer=$($u.ProxyServer), lock(user)=$(if ($ul -eq 1) { 'yes' } else { 'no' })"
    }
    Write-Host $line
}

if ($env:POL_ACTION -eq 'status') { try { Show-Status } catch { Write-Host "  [!] $($_.Exception.Message)" }; exit 0 }

if ($env:POL_ACTION -like 'proxy*') {
    try { Set-ProxyFlag ($env:POL_ACTION -eq 'proxyon'); exit 0 }
    catch { Write-Host "  [!] $($_.Exception.Message)"; exit 1 }
}

try {
    # Local Group Policy: Computer Configuration + User Configuration
    $m = Update-Pol (Join-Path $gpRoot 'Machine\Registry.pol') $add
    $u = Update-Pol (Join-Path $gpRoot 'User\Registry.pol')    $add
    if ($m -or $u) { Update-Gpt (Join-Path $gpRoot 'gpt.ini') $m $u $add }
    Set-UserLock $add

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
