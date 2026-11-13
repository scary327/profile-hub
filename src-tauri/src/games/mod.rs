//! Game library: scanning installed games from Steam, Epic, GOG, Ubisoft Connect, EA app,
//! Battle.net and manually added entries; launching them; detecting launcher clients.

mod battlenet;
mod ea;
mod epic;
mod gog;
mod launch;
mod launchers;
mod steam;
mod ubisoft;
mod util;
mod vdf;

use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::models::*;

pub use launch::launch;
pub use launchers::list_launchers;

fn manual_games(manual: &[ManualGame]) -> Vec<Game> {
    manual
        .iter()
        .map(|m| {
            let dir = Path::new(&m.exe_path)
                .parent()
                .map(util::norm_path)
                .filter(|d| !d.is_empty());
            Game {
                id: format!("manual:{}", m.id),
                name: m.name.clone(),
                source: GameSource::Manual,
                covers: m.cover.iter().filter(|s| !s.is_empty()).cloned().collect(),
                heroes: m.hero.iter().filter(|s| !s.is_empty()).cloned().collect(),
                logos: Vec::new(),
                install_dir: dir.clone(),
                last_played: None,
                size_bytes: None,
                launch: LaunchTarget::Exe {
                    path: m.exe_path.clone(),
                    args: m.args.clone(),
                    cwd: dir,
                },
            }
        })
        .collect()
}

/// Run one source, turning errors and panics into a log line.
fn run_source(name: &str, f: impl FnOnce() -> anyhow::Result<Vec<Game>>) -> Vec<Game> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)) {
        Ok(Ok(v)) => {
            log::info!("games: {name}: {} found", v.len());
            v
        }
        Ok(Err(e)) => {
            log::warn!("games: {name} scan failed: {e:#}");
            Vec::new()
        }
        Err(_) => {
            log::error!("games: {name} scan panicked");
            Vec::new()
        }
    }
}

/// Scan all sources. Never panics; a failing source just logs and is skipped.
pub fn scan_all(manual: &[ManualGame], last_played: &HashMap<String, u64>) -> Vec<Game> {
    let uninstall = run_uninstall();
    let mut all = Vec::new();
    all.extend(run_source("steam", steam::scan));
    all.extend(run_source("epic", epic::scan));
    all.extend(run_source("gog", gog::scan));
    all.extend(run_source("ubisoft", ubisoft::scan));
    all.extend(run_source("ea", || ea::scan(&uninstall)));
    all.extend(run_source("battlenet", || battlenet::scan(&uninstall)));
    all.extend(run_source("manual", || Ok(manual_games(manual))));

    let mut seen = HashSet::new();
    all.retain(|g| seen.insert(g.id.clone()));

    for g in &mut all {
        if let Some(&t) = last_played.get(&g.id) {
            g.last_played = Some(g.last_played.map_or(t, |x| x.max(t)));
        }
    }
    all.sort_by(|a, b| {
        b.last_played
            .unwrap_or(0)
            .cmp(&a.last_played.unwrap_or(0))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    all
}

fn run_uninstall() -> Vec<util::reg::UninstallEntry> {
    std::panic::catch_unwind(util::reg::uninstall_entries).unwrap_or_else(|_| {
        log::error!("games: reading Uninstall registry panicked");
        Vec::new()
    })
}
