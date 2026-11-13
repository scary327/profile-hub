//! Ubisoft Connect: HKLM\SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs\{id}.

use std::path::Path;

use super::util::{norm_path, reg};
use crate::models::*;

pub fn scan() -> anyhow::Result<Vec<Game>> {
    let Some(root) = reg::hklm(r"SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs") else {
        log::info!("ubisoft: no installs registry key");
        return Ok(Vec::new());
    };
    let mut games = Vec::new();
    for id in reg::subkeys(&root) {
        let Ok(k) = root.open_subkey(&id) else { continue };
        let Some(dir) = reg::s(&k, "InstallDir").map(norm_path) else { continue };
        if !Path::new(&dir).is_dir() {
            log::debug!("ubisoft: install dir missing for {id}: {dir}");
            continue;
        }
        let uninstall = reg::hklm(&format!(r"{}\Uplay Install {id}", reg::UNINSTALL_WOW))
            .or_else(|| reg::hklm(&format!(r"{}\Uplay Install {id}", reg::UNINSTALL)));
        let name = uninstall
            .as_ref()
            .and_then(|u| reg::s(u, "DisplayName"))
            .or_else(|| {
                Path::new(&dir)
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
            })
            .unwrap_or_else(|| format!("Ubisoft {id}"));
        let size_bytes = uninstall
            .as_ref()
            .and_then(|u| reg::dword(u, "EstimatedSize"))
            .map(|kb| kb as u64 * 1024)
            .filter(|&b| b > 0);
        games.push(Game {
            id: format!("ubisoft:{id}"),
            name,
            source: GameSource::Ubisoft,
            covers: Vec::new(),
            heroes: Vec::new(),
            logos: Vec::new(),
            install_dir: Some(dir),
            last_played: None,
            size_bytes,
            launch: LaunchTarget::Uri { uri: format!("uplay://launch/{id}/0") },
        });
    }
    Ok(games)
}
