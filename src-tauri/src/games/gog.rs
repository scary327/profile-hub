//! GOG: HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\{id}. Launched directly via the game exe.

use std::path::Path;

use super::util::{norm_path, reg, split_args};
use crate::models::*;

pub fn scan() -> anyhow::Result<Vec<Game>> {
    let Some(root) = reg::hklm(r"SOFTWARE\WOW6432Node\GOG.com\Games") else {
        log::info!("gog: no games registry key");
        return Ok(Vec::new());
    };
    let mut games = Vec::new();
    for key_name in reg::subkeys(&root) {
        let Ok(k) = root.open_subkey(&key_name) else { continue };
        let gid = reg::s(&k, "gameID").unwrap_or_else(|| key_name.clone());
        let Some(name) = reg::s(&k, "gameName").or_else(|| reg::s(&k, "GAMENAME")) else {
            continue;
        };
        let path = reg::s(&k, "path");
        // Prefer exe + launchParam; fall back to parsing launchCommand.
        let (exe, args) = match reg::s(&k, "exe") {
            Some(exe) => (exe.trim_matches('"').to_string(), reg::s(&k, "launchParam").unwrap_or_default()),
            None => {
                let Some(cmd) = reg::s(&k, "launchCommand") else { continue };
                let mut parts = split_args(&cmd);
                if parts.is_empty() {
                    continue;
                }
                let exe = parts.remove(0);
                let args = parts
                    .iter()
                    .map(|a| if a.contains(' ') { format!("\"{a}\"") } else { a.clone() })
                    .collect::<Vec<_>>()
                    .join(" ");
                (exe, args)
            }
        };
        if !Path::new(&exe).is_file() {
            log::debug!("gog: exe missing for {name}: {exe}");
            continue;
        }
        let cwd = reg::s(&k, "workingDir")
            .or_else(|| path.clone())
            .or_else(|| Path::new(&exe).parent().map(|p| p.to_string_lossy().into_owned()))
            .map(norm_path);
        games.push(Game {
            id: format!("gog:{gid}"),
            name,
            source: GameSource::Gog,
            covers: Vec::new(),
            heroes: Vec::new(),
            logos: Vec::new(),
            install_dir: path.map(norm_path),
            last_played: None,
            size_bytes: None,
            launch: LaunchTarget::Exe { path: norm_path(&exe), args, cwd },
        });
    }
    Ok(games)
}
