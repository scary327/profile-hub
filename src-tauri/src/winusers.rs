//! Учётные записи и сеансы Windows: каждый профиль — отдельный локальный пользователь.

use crate::models::WinUserInfo;
use anyhow::{anyhow, bail, Context, Result};
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
use windows_sys::Win32::System::RemoteDesktop::{
    WTSActive, WTSDisconnectSession, WTSDisconnected, WTSEnumerateSessionsW, WTSFreeMemory,
    WTSQuerySessionInformationW, WTSUserName, WTS_CURRENT_SERVER_HANDLE, WTS_CURRENT_SESSION,
    WTS_SESSION_INFOW,
};
use windows_sys::Win32::System::Shutdown::{ExitWindowsEx, EWX_LOGOFF, SHUTDOWN_REASON};
use windows_sys::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};
use windows_sys::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

/// SID и имя пользователя текущего процесса.
pub fn current_user() -> Result<(String, String)> {
    let out = Command::new("whoami")
        .args(["/user", "/fo", "csv", "/nh"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .context("whoami")?;
    // "pc\user","S-1-5-21-..."
    let text = String::from_utf8_lossy(&out.stdout);
    let parts: Vec<&str> = text.trim().split("\",\"").collect();
    let sid = parts
        .get(1)
        .map(|s| s.trim_matches('"').trim().to_string())
        .filter(|s| s.starts_with("S-"))
        .ok_or_else(|| anyhow!("не удалось определить SID пользователя"))?;
    let username = std::env::var("USERNAME").unwrap_or_default();
    Ok((sid, username))
}

/// Имена пользователей, у которых сейчас есть сеанс (активный или отключённый).
pub fn logged_in_usernames() -> Vec<String> {
    let mut names = Vec::new();
    unsafe {
        let mut infos: *mut WTS_SESSION_INFOW = std::ptr::null_mut();
        let mut count = 0u32;
        if WTSEnumerateSessionsW(WTS_CURRENT_SERVER_HANDLE, 0, 1, &mut infos, &mut count) == 0 {
            return names;
        }
        for i in 0..count as usize {
            let info = &*infos.add(i);
            if info.State != WTSActive && info.State != WTSDisconnected {
                continue;
            }
            let mut buf: windows_sys::core::PWSTR = std::ptr::null_mut();
            let mut bytes = 0u32;
            if WTSQuerySessionInformationW(
                WTS_CURRENT_SERVER_HANDLE,
                info.SessionId,
                WTSUserName,
                &mut buf,
                &mut bytes,
            ) != 0
                && !buf.is_null()
            {
                let len = (0..).take_while(|&j| *buf.add(j) != 0).count();
                let name = String::from_utf16_lossy(std::slice::from_raw_parts(buf, len));
                if !name.is_empty() {
                    names.push(name);
                }
                WTSFreeMemory(buf as _);
            }
        }
        WTSFreeMemory(infos as _);
    }
    names
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PsUser {
    name: String,
    #[serde(default)]
    full_name: Option<String>,
    enabled: bool,
    sid: String,
}

/// Локальные пользователи (без служебных: Administrator, Guest, WDAGUtilityAccount, DefaultAccount).
pub fn list_users(current_sid: &str) -> Result<Vec<WinUserInfo>> {
    let script = "Get-LocalUser | Select-Object Name,FullName,Enabled,@{n='Sid';e={$_.SID.Value}} | ConvertTo-Json -Compress";
    let out = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &format!("[Console]::OutputEncoding=[Text.Encoding]::UTF8; {script}")])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .context("Get-LocalUser")?;
    let text = String::from_utf8_lossy(&out.stdout);
    let text = text.trim();
    let users: Vec<PsUser> = if text.starts_with('[') {
        serde_json::from_str(text)?
    } else if text.starts_with('{') {
        vec![serde_json::from_str(text)?]
    } else {
        Vec::new()
    };
    let sessions: Vec<String> = logged_in_usernames().into_iter().map(|n| n.to_lowercase()).collect();
    Ok(users
        .into_iter()
        // встроенные служебные учётки имеют RID 500/501/503/504
        .filter(|u| !["-500", "-501", "-503", "-504"].iter().any(|r| u.sid.ends_with(r)))
        .map(|u| WinUserInfo {
            logged_in: sessions.contains(&u.name.to_lowercase()),
            is_current: u.sid == current_sid,
            full_name: u.full_name.unwrap_or_default(),
            enabled: u.enabled,
            username: u.name,
            sid: u.sid,
        })
        .collect())
}

/// Уйти на экран входа, оставив текущий сеанс работать в фоне.
pub fn disconnect_to_sign_in() -> Result<()> {
    let ok = unsafe { WTSDisconnectSession(WTS_CURRENT_SERVER_HANDLE, WTS_CURRENT_SESSION, 0) };
    if ok == 0 {
        bail!("не удалось перейти к экрану входа: {}", std::io::Error::last_os_error());
    }
    Ok(())
}

/// Выйти из текущей учётки (все программы закрываются).
pub fn sign_out() -> Result<()> {
    let ok = unsafe { ExitWindowsEx(EWX_LOGOFF, 0 as SHUTDOWN_REASON) };
    if ok == 0 {
        bail!("не удалось выйти из учётки: {}", std::io::Error::last_os_error());
    }
    Ok(())
}

/// Допустимое имя учётки: латиница, цифры, '-', '_', 1..20 символов.
pub fn validate_username(name: &str) -> Result<()> {
    if name.is_empty() || name.len() > 20 {
        bail!("Имя учётки должно быть от 1 до 20 символов");
    }
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        bail!("Имя учётки: только латинские буквы, цифры, «-» и «_»");
    }
    Ok(())
}

/// Выполнить PowerShell-скрипт с правами администратора (покажется UAC) и вернуть его JSON-ответ.
/// Параметры передаются файлом, который скрипт удаляет сразу после чтения.
fn run_elevated(script: &str, job: &serde_json::Value) -> Result<serde_json::Value> {
    let dir = std::env::temp_dir().join(format!("profilehub-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir)?;
    let script_path = dir.join("task.ps1");
    let job_path = dir.join("job.json");
    let out_path = dir.join("result.json");
    let cleanup = |d: &PathBuf| {
        let _ = std::fs::remove_dir_all(d);
    };
    // BOM, чтобы Windows PowerShell 5.1 прочитал кириллицу в скрипте как UTF-8
    std::fs::write(&script_path, [b"\xEF\xBB\xBF".as_slice(), script.as_bytes()].concat())?;
    std::fs::write(&job_path, serde_json::to_vec(job)?)?;

    let params = format!(
        "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{}\" -Job \"{}\" -Out \"{}\"",
        script_path.display(),
        job_path.display(),
        out_path.display()
    );
    let verb = wide("runas");
    let file = wide("powershell.exe");
    let params_w = wide(&params);
    let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
    info.fMask = SEE_MASK_NOCLOSEPROCESS;
    info.lpVerb = verb.as_ptr();
    info.lpFile = file.as_ptr();
    info.lpParameters = params_w.as_ptr();
    info.nShow = 0; // SW_HIDE
    let launched = unsafe { ShellExecuteExW(&mut info) } != 0;
    if !launched || info.hProcess.is_null() {
        cleanup(&dir);
        bail!("Действие отменено: нужны права администратора (окно UAC)");
    }
    unsafe {
        let wait = WaitForSingleObject(info.hProcess, 5 * 60 * 1000);
        let mut code = 0u32;
        GetExitCodeProcess(info.hProcess, &mut code);
        CloseHandle(info.hProcess);
        if wait != WAIT_OBJECT_0 {
            cleanup(&dir);
            bail!("Операция с учёткой не завершилась вовремя");
        }
    }
    let result = std::fs::read(&out_path)
        .ok()
        .and_then(|b| {
            let b = b.strip_prefix(b"\xEF\xBB\xBF".as_slice()).unwrap_or(&b).to_vec();
            serde_json::from_slice::<serde_json::Value>(&b).ok()
        });
    cleanup(&dir);
    let result = result.ok_or_else(|| anyhow!("Скрипт учётки не вернул результат"))?;
    if result.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        let msg = result.get("error").and_then(|v| v.as_str()).unwrap_or("неизвестная ошибка");
        bail!("Windows: {msg}");
    }
    Ok(result)
}

const CREATE_SCRIPT: &str = r#"
param([string]$Job, [string]$Out)
$ErrorActionPreference = 'Stop'
function Done($obj) { $obj | ConvertTo-Json -Compress | Out-File -FilePath $Out -Encoding utf8 }
try {
  $j = Get-Content -Raw -Encoding UTF8 $Job | ConvertFrom-Json
  Remove-Item -Force $Job
  $common = @{ Name = $j.username; FullName = $j.fullName; Description = 'Profile Hub'; AccountNeverExpires = $true }
  if ($j.password) {
    $sec = ConvertTo-SecureString $j.password -AsPlainText -Force
    $u = New-LocalUser @common -Password $sec -PasswordNeverExpires
  } else {
    $u = New-LocalUser @common -NoPassword
  }
  Add-LocalGroupMember -SID 'S-1-5-32-545' -Member $u
  Done @{ ok = $true; sid = $u.SID.Value }
} catch {
  Done @{ ok = $false; error = $_.Exception.Message }
}
"#;

/// Создать локального пользователя (группа «Пользователи»). Возвращает SID.
pub fn create_user(username: &str, full_name: &str, password: Option<&str>) -> Result<String> {
    validate_username(username)?;
    let job = serde_json::json!({
        "username": username,
        "fullName": full_name,
        "password": password,
    });
    let res = run_elevated(CREATE_SCRIPT, &job)?;
    res.get("sid")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| anyhow!("Учётка создана, но SID не получен"))
}

const DELETE_SCRIPT: &str = r#"
param([string]$Job, [string]$Out)
$ErrorActionPreference = 'Stop'
function Done($obj) { $obj | ConvertTo-Json -Compress | Out-File -FilePath $Out -Encoding utf8 }
try {
  $j = Get-Content -Raw -Encoding UTF8 $Job | ConvertFrom-Json
  Remove-Item -Force $Job
  $u = Get-LocalUser -SID $j.sid
  # завершить сеанс пользователя, если он вошёл
  $line = (quser 2>$null) | Where-Object { $_ -match ('^\s*>?' + [regex]::Escape($u.Name) + '\s') } | Select-Object -First 1
  if ($line) {
    $id = ($line -split '\s+' | Where-Object { $_ -match '^\d+$' } | Select-Object -First 1)
    if ($id) { logoff $id; Start-Sleep -Seconds 3 }
  }
  Get-CimInstance Win32_UserProfile | Where-Object { $_.SID -eq $j.sid } | Remove-CimInstance
  Remove-LocalUser -SID $j.sid
  Done @{ ok = $true }
} catch {
  Done @{ ok = $false; error = $_.Exception.Message }
}
"#;

/// Удалить пользователя вместе с его папкой профиля (C:\Users\<имя>).
pub fn delete_user(sid: &str) -> Result<()> {
    run_elevated(DELETE_SCRIPT, &serde_json::json!({ "sid": sid }))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn username_rules() {
        assert!(validate_username("Igry_2").is_ok());
        assert!(validate_username("").is_err());
        assert!(validate_username("Игры").is_err());
        assert!(validate_username("a b").is_err());
        assert!(validate_username("abcdefghijklmnopqrstu").is_err());
    }

    #[test]
    fn current_user_and_list_work() {
        let (sid, name) = current_user().unwrap();
        assert!(sid.starts_with("S-1-5-"));
        let users = list_users(&sid).unwrap();
        let me = users.iter().find(|u| u.is_current).expect("текущий пользователь в списке");
        assert!(me.username.eq_ignore_ascii_case(&name));
        assert!(me.logged_in);
    }
}
