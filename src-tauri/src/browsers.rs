//! Поиск браузеров и запуск с изолированной папкой данных для каждого профиля.

use crate::models::*;
use crate::util;
use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};
use winreg::enums::*;
use winreg::RegKey;

pub const ALL: [BrowserKind; 7] = [
    BrowserKind::Chrome,
    BrowserKind::Edge,
    BrowserKind::Firefox,
    BrowserKind::Opera,
    BrowserKind::OperaGx,
    BrowserKind::Brave,
    BrowserKind::Yandex,
];

pub fn display_name(kind: BrowserKind) -> &'static str {
    match kind {
        BrowserKind::Chrome => "Google Chrome",
        BrowserKind::Edge => "Microsoft Edge",
        BrowserKind::Firefox => "Firefox",
        BrowserKind::Opera => "Opera",
        BrowserKind::OperaGx => "Opera GX",
        BrowserKind::Brave => "Brave",
        BrowserKind::Yandex => "Яндекс Браузер",
    }
}

/// Классифицировать браузер по имени из реестра StartMenuInternet.
fn classify(name: &str) -> Option<BrowserKind> {
    let n = name.to_lowercase();
    if n.contains("opera gx") || n.contains("operagx") {
        Some(BrowserKind::OperaGx)
    } else if n.contains("opera") {
        Some(BrowserKind::Opera)
    } else if n.contains("edge") {
        Some(BrowserKind::Edge)
    } else if n.contains("firefox") {
        Some(BrowserKind::Firefox)
    } else if n.contains("brave") {
        Some(BrowserKind::Brave)
    } else if n.contains("yandex") {
        Some(BrowserKind::Yandex)
    } else if n.contains("chrome") && !n.contains("chromium") {
        Some(BrowserKind::Chrome)
    } else {
        None
    }
}

/// Вытащить путь к exe из строки команды вида `"C:\..\x.exe" -- "%1"`.
fn exe_from_command(cmd: &str) -> Option<String> {
    let cmd = cmd.trim();
    let path = if let Some(rest) = cmd.strip_prefix('"') {
        rest.split('"').next()?.to_string()
    } else {
        let lower = cmd.to_lowercase();
        let end = lower.find(".exe")? + 4;
        cmd[..end].to_string()
    };
    Path::new(&path).is_file().then_some(path)
}

fn from_start_menu_internet() -> Vec<(BrowserKind, String)> {
    let mut found = Vec::new();
    let roots = [
        (HKEY_CURRENT_USER, "Software\\Clients\\StartMenuInternet"),
        (HKEY_LOCAL_MACHINE, "SOFTWARE\\Clients\\StartMenuInternet"),
        (HKEY_LOCAL_MACHINE, "SOFTWARE\\WOW6432Node\\Clients\\StartMenuInternet"),
    ];
    for (hive, path) in roots {
        let Ok(key) = RegKey::predef(hive).open_subkey(path) else { continue };
        for sub in key.enum_keys().flatten() {
            let Ok(k) = key.open_subkey(&sub) else { continue };
            let name: String = k.get_value("").unwrap_or_else(|_| sub.clone());
            let Some(kind) = classify(&name).or_else(|| classify(&sub)) else { continue };
            let Ok(cmd_key) = k.open_subkey("shell\\open\\command") else { continue };
            let Ok(cmd) = cmd_key.get_value::<String, _>("") else { continue };
            if let Some(exe) = exe_from_command(&cmd) {
                found.push((kind, exe));
            }
        }
    }
    found
}

fn known_paths(kind: BrowserKind) -> Vec<PathBuf> {
    let local = dirs::data_local_dir().unwrap_or_default();
    let pf = PathBuf::from("C:\\Program Files");
    let pf86 = PathBuf::from("C:\\Program Files (x86)");
    match kind {
        BrowserKind::Chrome => vec![
            pf.join("Google\\Chrome\\Application\\chrome.exe"),
            pf86.join("Google\\Chrome\\Application\\chrome.exe"),
            local.join("Google\\Chrome\\Application\\chrome.exe"),
        ],
        BrowserKind::Edge => vec![
            pf86.join("Microsoft\\Edge\\Application\\msedge.exe"),
            pf.join("Microsoft\\Edge\\Application\\msedge.exe"),
        ],
        BrowserKind::Firefox => vec![
            pf.join("Mozilla Firefox\\firefox.exe"),
            pf86.join("Mozilla Firefox\\firefox.exe"),
        ],
        BrowserKind::Opera => vec![local.join("Programs\\Opera\\opera.exe"), pf.join("Opera\\opera.exe")],
        BrowserKind::OperaGx => vec![local.join("Programs\\Opera GX\\opera.exe")],
        BrowserKind::Brave => vec![
            pf.join("BraveSoftware\\Brave-Browser\\Application\\brave.exe"),
            local.join("BraveSoftware\\Brave-Browser\\Application\\brave.exe"),
        ],
        BrowserKind::Yandex => vec![local.join("Yandex\\YandexBrowser\\Application\\browser.exe")],
    }
}

/// Opera регистрирует launcher.exe — для изоляции нужен сам opera.exe рядом с ним.
fn normalize_exe(kind: BrowserKind, exe: String) -> String {
    if matches!(kind, BrowserKind::Opera | BrowserKind::OperaGx) {
        let p = Path::new(&exe);
        if p.file_name().map(|f| f.eq_ignore_ascii_case("launcher.exe")).unwrap_or(false) {
            if let Some(dir) = p.parent() {
                let opera = dir.join("opera.exe");
                if opera.is_file() {
                    return opera.to_string_lossy().to_string();
                }
            }
        }
    }
    exe
}

pub fn detect() -> Vec<BrowserInfo> {
    let registered = from_start_menu_internet();
    ALL.iter()
        .map(|&kind| {
            let exe = registered
                .iter()
                .find(|(k, _)| *k == kind)
                .map(|(_, e)| e.clone())
                .or_else(|| {
                    known_paths(kind)
                        .into_iter()
                        .find(|p| p.is_file())
                        .map(|p| p.to_string_lossy().to_string())
                })
                .map(|e| normalize_exe(kind, e));
            BrowserInfo {
                kind,
                name: display_name(kind).to_string(),
                installed: exe.is_some(),
                exe_path: exe,
            }
        })
        .collect()
}

/// Запустить браузер. Изоляция между профилями обеспечивается тем, что
/// у каждого профиля своя учётка Windows (и свои данные браузеров в ней).
pub fn launch(info: &BrowserInfo) -> Result<u32> {
    let exe = info
        .exe_path
        .as_deref()
        .ok_or_else(|| anyhow!("{} не установлен", info.name))?;
    util::spawn_detached(exe, &[], None)
}
