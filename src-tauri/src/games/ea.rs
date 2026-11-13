//! EA app: Uninstall entries published by Electronic Arts, launched via their main exe.

use std::path::Path;

use super::util::{exe_from_icon, norm_path, path_inside, reg::UninstallEntry};
use crate::models::*;

fn is_launcher(name: &str) -> bool {
    let n = name.to_lowercase();
    n == "ea" || n == "origin" || n.starts_with("ea app") || n.starts_with("ea desktop")
        || (n.starts_with("origin") && n.contains("launcher"))
}

pub fn scan(entries: &[UninstallEntry]) -> anyhow::Result<Vec<Game>> {
    let mut games: Vec<Game> = Vec::new();
    for e in entries {
        if !e.publisher.to_lowercase().contains("electronic arts")
            || is_launcher(&e.display_name)
            || e.is_store_managed()
        {
            continue;
        }
        let Some(loc) = e.install_location.as_deref().filter(|l| !l.is_empty()) else { continue };
        let Some(exe) = e.display_icon.as_deref().and_then(exe_from_icon) else { continue };
        if !path_inside(&exe, loc) || !Path::new(&exe).is_file() {
            continue;
        }
        let id = format!("ea:{}", e.key_name);
        if games.iter().any(|g| g.id == id) {
            continue;
        }
        let cwd = Path::new(&exe).parent().map(norm_path);
        games.push(Game {
            id,
            name: e.display_name.clone(),
            source: GameSource::Ea,
            covers: Vec::new(),
            heroes: Vec::new(),
            logos: Vec::new(),
            install_dir: Some(norm_path(loc)),
            last_played: None,
            size_bytes: e.size_bytes.filter(|&b| b > 0),
            launch: LaunchTarget::Exe { path: exe, args: String::new(), cwd },
        });
    }
    Ok(games)
}
