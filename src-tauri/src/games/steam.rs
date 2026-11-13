//! Steam: libraryfolders.vdf + appmanifest_*.acf, local librarycache art + CDN fallbacks.

use std::path::{Path, PathBuf};

use super::util::{existing, norm_path, push_unique, reg};
use super::vdf;
use crate::models::*;

const CDN: &str = "https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps";

/// Known non-game app ids (redistributables, runtimes, SteamVR, Proton).
const EXCLUDED_IDS: &[&str] = &[
    "228980",  // Steamworks Common Redistributables
    "1070560", // Steam Linux Runtime
    "1391110", // Steam Linux Runtime - Soldier
    "1628350", // Steam Linux Runtime - Sniper
    "250820",  // SteamVR
    "1007",    // Steamworks SDK Redist
    "1493710", // Proton Experimental
    "2180100", // Proton Hotfix
    "1826330", // Proton EasyAntiCheat Runtime
    "1161040", // Proton BattlEye Runtime
    "323910",  // SteamVR Performance Test
    "431960",  // Wallpaper Engine (программа, не игра)
];
const EXCLUDED_PREFIXES: &[&str] = &["proton", "steam linux runtime", "steamworks", "steamvr"];

pub fn steam_path() -> Option<PathBuf> {
    let from_cu = reg::hkcu(r"Software\Valve\Steam").and_then(|k| reg::s(&k, "SteamPath"));
    let from_lm = || {
        reg::hklm(r"SOFTWARE\WOW6432Node\Valve\Steam")
            .and_then(|k| reg::s(&k, "InstallPath"))
    };
    [from_cu, from_lm()]
        .into_iter()
        .flatten()
        .map(|p| PathBuf::from(norm_path(p)))
        .find(|p| p.is_dir())
}

fn library_paths(steam: &Path) -> Vec<PathBuf> {
    let mut libs: Vec<PathBuf> = vec![steam.to_path_buf()];
    let vdf_path = steam.join("steamapps").join("libraryfolders.vdf");
    match std::fs::read_to_string(&vdf_path) {
        Ok(text) => {
            let doc = vdf::parse(&text);
            if let Some(root) = doc.get("libraryfolders") {
                for (_, v) in root.entries() {
                    let p = match v {
                        vdf::Vdf::Obj(_) => v.get_str("path"),
                        // legacy format: "1" "D:\\SteamLibrary"
                        vdf::Vdf::Str(s) if s.contains(['\\', '/']) => Some(s.as_str()),
                        _ => None,
                    };
                    if let Some(p) = p {
                        let pb = PathBuf::from(norm_path(p));
                        if !libs.iter().any(|l| norm_path(l).eq_ignore_ascii_case(&norm_path(&pb))) {
                            libs.push(pb);
                        }
                    }
                }
            }
        }
        Err(e) => log::warn!("steam: cannot read {}: {e}", vdf_path.display()),
    }
    libs
}

fn is_excluded(appid: &str, name: &str) -> bool {
    let lname = name.to_lowercase();
    EXCLUDED_IDS.contains(&appid) || EXCLUDED_PREFIXES.iter().any(|p| lname.starts_with(p))
}

/// Local librarycache files named `file`, in both layouts:
/// flat `{appid}_{file}`, per-app `{appid}/{file}`, and hashed `{appid}/*/{file}`.
fn local_art(cache: &Path, appid: &str, files: &[&str]) -> Vec<String> {
    let mut out = Vec::new();
    let app_dir = cache.join(appid);
    let subdirs: Vec<PathBuf> = std::fs::read_dir(&app_dir)
        .map(|rd| {
            rd.filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect()
        })
        .unwrap_or_default();
    for f in files {
        let mut cands = vec![cache.join(format!("{appid}_{f}")), app_dir.join(f)];
        cands.extend(subdirs.iter().map(|d| d.join(f)));
        for c in cands {
            if let Some(s) = existing(c) {
                push_unique(&mut out, s);
            }
        }
    }
    out
}

fn art(steam: &Path, appid: &str) -> (Vec<String>, Vec<String>, Vec<String>) {
    let cache = steam.join("appcache").join("librarycache");
    let mut covers = local_art(&cache, appid, &["library_600x900.jpg", "library_capsule.jpg"]);
    covers.push(format!("{CDN}/{appid}/library_600x900_2x.jpg"));
    covers.push(format!("{CDN}/{appid}/library_600x900.jpg"));
    covers.push(format!("{CDN}/{appid}/header.jpg"));

    let mut heroes = local_art(&cache, appid, &["library_hero.jpg"]);
    heroes.push(format!("{CDN}/{appid}/library_hero.jpg"));
    heroes.push(format!("{CDN}/{appid}/header.jpg"));

    let mut logos = local_art(&cache, appid, &["logo.png"]);
    logos.push(format!("{CDN}/{appid}/logo.png"));
    (covers, heroes, logos)
}

pub fn scan() -> anyhow::Result<Vec<Game>> {
    let Some(steam) = steam_path() else {
        log::info!("steam: not installed");
        return Ok(Vec::new());
    };
    let mut games: Vec<Game> = Vec::new();
    for lib in library_paths(&steam) {
        let apps = lib.join("steamapps");
        let Ok(rd) = std::fs::read_dir(&apps) else {
            log::debug!("steam: library missing {}", apps.display());
            continue;
        };
        for entry in rd.filter_map(Result::ok) {
            let fname = entry.file_name().to_string_lossy().to_lowercase();
            if !(fname.starts_with("appmanifest_") && fname.ends_with(".acf")) {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(entry.path()) else { continue };
            let doc = vdf::parse(&text);
            let Some(st) = doc.get("AppState") else { continue };
            let Some(appid) = st.get_str("appid").map(str::trim).filter(|s| !s.is_empty()) else {
                continue;
            };
            let name = st.get_str("name").unwrap_or("").trim().to_string();
            if name.is_empty() || is_excluded(appid, &name) {
                continue;
            }
            let id = format!("steam:{appid}");
            if games.iter().any(|g| g.id == id) {
                continue;
            }
            let install_dir = st
                .get_str("installdir")
                .filter(|d| !d.is_empty())
                .map(|d| norm_path(apps.join("common").join(d)));
            let size_bytes = st
                .get_str("SizeOnDisk")
                .and_then(|s| s.trim().parse::<u64>().ok())
                .filter(|&s| s > 0);
            let last_played = st
                .get_str("LastPlayed")
                .and_then(|s| s.trim().parse::<u64>().ok())
                .filter(|&t| t > 0);
            let (covers, heroes, logos) = art(&steam, appid);
            games.push(Game {
                id,
                name,
                source: GameSource::Steam,
                covers,
                heroes,
                logos,
                install_dir,
                last_played,
                size_bytes,
                launch: LaunchTarget::Uri { uri: format!("steam://rungameid/{appid}") },
            });
        }
    }
    Ok(games)
}
