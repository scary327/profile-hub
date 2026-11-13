//! Epic Games Store: launcher manifests (*.item) + optional catcache.bin key images.

use std::collections::HashMap;
use std::path::PathBuf;

use serde_json::Value;

use super::util::{base64_decode, env_dir, norm_path, push_unique};
use crate::models::*;

fn data_dir() -> PathBuf {
    env_dir("ProgramData", r"C:\ProgramData")
        .join("Epic")
        .join("EpicGamesLauncher")
        .join("Data")
}

#[derive(Default)]
struct Images {
    covers: Vec<String>,
    heroes: Vec<String>,
    logos: Vec<String>,
}

/// catalog item id -> key images. Tolerant: any failure yields an empty map.
fn load_catcache() -> HashMap<String, Images> {
    let mut map = HashMap::new();
    let path = data_dir().join("Catalog").join("catcache.bin");
    let Ok(raw) = std::fs::read(&path) else { return map };
    // Usually base64 of a JSON array; accept plain JSON too.
    let json: Option<Value> = serde_json::from_slice(&raw).ok().or_else(|| {
        base64_decode(&raw).and_then(|bytes| serde_json::from_slice(&bytes).ok())
    });
    let Some(Value::Array(items)) = json else {
        log::debug!("epic: catcache.bin has unexpected format");
        return map;
    };
    for item in items {
        let Some(id) = item.get("id").and_then(Value::as_str) else { continue };
        let Some(imgs) = item.get("keyImages").and_then(Value::as_array) else { continue };
        let find = |ty: &str| -> Option<String> {
            imgs.iter()
                .find(|i| i.get("type").and_then(Value::as_str) == Some(ty))
                .and_then(|i| i.get("url").and_then(Value::as_str))
                .filter(|u| u.starts_with("http"))
                .map(str::to_string)
        };
        let mut im = Images::default();
        for ty in ["DieselGameBoxTall", "Thumbnail"] {
            if let Some(u) = find(ty) {
                push_unique(&mut im.covers, u);
            }
        }
        if let Some(u) = find("DieselGameBox") {
            push_unique(&mut im.heroes, u);
        }
        if let Some(u) = find("DieselGameBoxLogo") {
            push_unique(&mut im.logos, u);
        }
        map.insert(id.to_string(), im);
    }
    map
}

#[cfg(test)]
mod tests {
    /// Smoke test against the real machine: decoding must not fail when the file exists.
    #[test]
    fn catcache_decodes_if_present() {
        let path = super::data_dir().join("Catalog").join("catcache.bin");
        if path.is_file() {
            let m = super::load_catcache();
            let with_cover = m.values().filter(|i| !i.covers.is_empty()).count();
            println!("catcache: {} items, {} with covers", m.len(), with_cover);
            assert!(!m.is_empty());
        }
    }
}

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(Value::as_str).unwrap_or("").trim()
}

pub fn scan() -> anyhow::Result<Vec<Game>> {
    let dir = data_dir().join("Manifests");
    let Ok(rd) = std::fs::read_dir(&dir) else {
        log::info!("epic: no manifests dir {}", dir.display());
        return Ok(Vec::new());
    };
    let mut catcache: Option<HashMap<String, Images>> = None;
    let mut games: Vec<Game> = Vec::new();
    for entry in rd.filter_map(Result::ok) {
        let path = entry.path();
        if !path
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("item"))
        {
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else { continue };
        let Ok(m) = serde_json::from_slice::<Value>(&bytes) else {
            log::warn!("epic: bad manifest {}", path.display());
            continue;
        };
        if m.get("bIsIncompleteInstall").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        if let Some(cats) = m.get("AppCategories").and_then(Value::as_array) {
            if !cats.iter().any(|c| c.as_str() == Some("games")) {
                continue;
            }
        }
        let app_name = s(&m, "AppName");
        let main_app = s(&m, "MainGameAppName");
        if app_name.is_empty() || (!main_app.is_empty() && !main_app.eq_ignore_ascii_case(app_name)) {
            continue; // DLC / add-on
        }
        let name = match s(&m, "DisplayName") {
            "" => app_name,
            n => n,
        }
        .to_string();
        let ns = s(&m, "CatalogNamespace");
        let item_id = s(&m, "CatalogItemId");
        let id = format!("epic:{app_name}");
        if games.iter().any(|g| g.id == id) {
            continue;
        }
        let imgs = catcache
            .get_or_insert_with(load_catcache)
            .remove(item_id)
            .unwrap_or_default();
        let install = s(&m, "InstallLocation");
        games.push(Game {
            id,
            name,
            source: GameSource::Epic,
            covers: imgs.covers,
            heroes: imgs.heroes,
            logos: imgs.logos,
            install_dir: (!install.is_empty()).then(|| norm_path(install)),
            last_played: None,
            size_bytes: m.get("InstallSize").and_then(Value::as_u64).filter(|&x| x > 0),
            launch: LaunchTarget::Uri {
                uri: format!(
                    "com.epicgames.launcher://apps/{ns}%3A{item_id}%3A{app_name}?action=launch&silent=true"
                ),
            },
        });
    }
    Ok(games)
}
