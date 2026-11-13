//! Battle.net: Uninstall entries published by Blizzard, launched via `battlenet://{code}`.

use std::path::Path;

use super::util::{exe_from_icon, norm_path, reg::UninstallEntry};
use crate::models::*;

/// DisplayName fragment (lowercase) -> Battle.net product code. Specific names first.
const CODES: &[(&str, &str)] = &[
    ("world of warcraft", "WoW"),
    ("overwatch", "Pro"),
    ("diablo iv", "Fen"),
    ("diablo ii: resurrected", "OSI"),
    ("diablo ii resurrected", "OSI"),
    ("diablo immortal", "ANBS"),
    ("diablo iii", "D3"),
    ("hearthstone", "WTCG"),
    ("heroes of the storm", "Hero"),
    ("starcraft ii", "S2"),
    ("starcraft", "S1"),
    ("warcraft iii", "W3"),
    ("call of duty", "Auks"),
];

fn product_code(name: &str) -> Option<&'static str> {
    let n = name.to_lowercase();
    CODES.iter().find(|(k, _)| n.contains(k)).map(|(_, c)| *c)
}

pub fn scan(entries: &[UninstallEntry]) -> anyhow::Result<Vec<Game>> {
    let mut games: Vec<Game> = Vec::new();
    for e in entries {
        if !e.publisher.to_lowercase().contains("blizzard")
            || e.display_name.eq_ignore_ascii_case("battle.net")
            || e.is_store_managed()
        {
            continue;
        }
        let launch = match product_code(&e.display_name) {
            Some(code) => LaunchTarget::Uri { uri: format!("battlenet://{code}") },
            None => {
                let Some(exe) = e.display_icon.as_deref().and_then(exe_from_icon) else { continue };
                if !Path::new(&exe).is_file() {
                    continue;
                }
                let cwd = Path::new(&exe).parent().map(norm_path);
                LaunchTarget::Exe { path: exe, args: String::new(), cwd }
            }
        };
        let id = format!("battlenet:{}", e.key_name);
        if games.iter().any(|g| g.id == id || same_uri(&g.launch, &launch)) {
            continue;
        }
        games.push(Game {
            id,
            name: e.display_name.clone(),
            source: GameSource::BattleNet,
            covers: Vec::new(),
            heroes: Vec::new(),
            logos: Vec::new(),
            install_dir: e.install_location.as_deref().map(norm_path),
            last_played: None,
            size_bytes: e.size_bytes.filter(|&b| b > 0),
            launch,
        });
    }
    Ok(games)
}

fn same_uri(a: &LaunchTarget, b: &LaunchTarget) -> bool {
    matches!((a, b), (LaunchTarget::Uri { uri: x }, LaunchTarget::Uri { uri: y }) if x == y)
}
