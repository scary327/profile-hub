//! Detection of installed launcher clients.

use std::path::{Path, PathBuf};

use super::steam::steam_path;
use super::util::{env_dir, norm_path, reg};
use crate::models::*;

fn first_existing(cands: impl IntoIterator<Item = PathBuf>) -> Option<String> {
    cands.into_iter().find(|p| p.is_file()).map(norm_path)
}

fn pf86() -> PathBuf {
    env_dir("ProgramFiles(x86)", r"C:\Program Files (x86)")
}

fn pf() -> PathBuf {
    env_dir("ProgramW6432", r"C:\Program Files")
}

fn uninstall_location(entries: &[reg::UninstallEntry], name: &str) -> Vec<PathBuf> {
    entries
        .iter()
        .filter(|e| e.display_name.eq_ignore_ascii_case(name))
        .filter_map(|e| e.install_location.as_deref().map(PathBuf::from))
        .collect()
}

fn steam() -> Option<String> {
    steam_path().and_then(|p| first_existing([p.join("steam.exe")]))
}

fn epic(entries: &[reg::UninstallEntry]) -> Option<String> {
    let mut roots = vec![pf86().join("Epic Games"), pf().join("Epic Games")];
    roots.extend(uninstall_location(entries, "Epic Games Launcher"));
    let mut cands = Vec::new();
    // App Paths registration, if any
    if let Some(k) = reg::hklm(r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\EpicGamesLauncher.exe") {
        if let Some(p) = reg::s(&k, "") {
            cands.push(PathBuf::from(p.trim_matches('"')));
        }
    }
    for r in &roots {
        for base in [r.join("Launcher"), r.clone()] {
            for arch in ["Win64", "Win32"] {
                cands.push(base.join("Portal").join("Binaries").join(arch).join("EpicGamesLauncher.exe"));
            }
        }
    }
    first_existing(cands)
}

fn gog() -> Option<String> {
    let mut cands = Vec::new();
    if let Some(k) = reg::hklm(r"SOFTWARE\WOW6432Node\GOG.com\GalaxyClient\paths") {
        if let Some(dir) = reg::s(&k, "client") {
            cands.push(Path::new(&dir).join("GalaxyClient.exe"));
        }
    }
    cands.push(pf86().join("GOG Galaxy").join("GalaxyClient.exe"));
    first_existing(cands)
}

fn ubisoft() -> Option<String> {
    let mut dirs = Vec::new();
    if let Some(k) = reg::hklm(r"SOFTWARE\WOW6432Node\Ubisoft\Launcher") {
        if let Some(dir) = reg::s(&k, "InstallDir") {
            dirs.push(PathBuf::from(dir));
        }
    }
    dirs.push(pf86().join("Ubisoft").join("Ubisoft Game Launcher"));
    first_existing(
        dirs.iter()
            .flat_map(|d| [d.join("UbisoftConnect.exe"), d.join("upc.exe")]),
    )
}

fn ea() -> Option<String> {
    let mut cands = Vec::new();
    if let Some(k) = reg::hklm(r"SOFTWARE\Electronic Arts\EA Desktop") {
        if let Some(p) = reg::s(&k, "ClientPath").or_else(|| reg::s(&k, "LauncherAppPath")) {
            cands.push(PathBuf::from(p.trim_matches('"')));
        }
        if let Some(dir) = reg::s(&k, "InstallLocation") {
            cands.push(Path::new(&dir).join("EADesktop.exe"));
            cands.push(Path::new(&dir).join("EA Desktop").join("EADesktop.exe"));
        }
    }
    cands.push(pf().join("Electronic Arts").join("EA Desktop").join("EA Desktop").join("EADesktop.exe"));
    first_existing(cands)
}

fn battlenet(entries: &[reg::UninstallEntry]) -> Option<String> {
    let mut dirs = vec![pf86().join("Battle.net"), pf().join("Battle.net")];
    dirs.extend(uninstall_location(entries, "Battle.net"));
    first_existing(
        dirs.iter()
            .flat_map(|d| [d.join("Battle.net Launcher.exe"), d.join("Battle.net.exe")]),
    )
}

/// Installed launcher clients (Steam, Epic Games Launcher, GOG Galaxy, Ubisoft Connect, EA app, Battle.net).
pub fn list_launchers() -> Vec<LauncherInfo> {
    let entries = reg::uninstall_entries();
    let found = [
        (GameSource::Steam, "Steam", steam()),
        (GameSource::Epic, "Epic Games", epic(&entries)),
        (GameSource::Gog, "GOG Galaxy", gog()),
        (GameSource::Ubisoft, "Ubisoft Connect", ubisoft()),
        (GameSource::Ea, "EA app", ea()),
        (GameSource::BattleNet, "Battle.net", battlenet(&entries)),
    ];
    found
        .into_iter()
        .filter_map(|(source, name, exe)| {
            exe.map(|exe_path| LauncherInfo { source, name: name.to_string(), exe_path })
        })
        .collect()
}
