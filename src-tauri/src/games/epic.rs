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

#[derive(Default, Clone)]
struct Images {
    covers: Vec<String>,
    heroes: Vec<String>,
    logos: Vec<String>,
}

/// Запись каталога Epic (catcache.bin).
#[derive(Clone)]
struct CatalogItem {
    id: String,
    namespace: String,
    title: String,
    /// releaseInfo[].appId — это и есть AppName игры
    app_ids: Vec<String>,
    /// основная игра (не DLC/набор) из категории games
    is_main_game: bool,
    images: Images,
}

fn read_catcache() -> Vec<CatalogItem> {
    let path = data_dir().join("Catalog").join("catcache.bin");
    let Ok(raw) = std::fs::read(&path) else { return Vec::new() };
    // Usually base64 of a JSON array; accept plain JSON too.
    let json: Option<Value> = serde_json::from_slice(&raw).ok().or_else(|| {
        base64_decode(&raw).and_then(|bytes| serde_json::from_slice(&bytes).ok())
    });
    let Some(Value::Array(items)) = json else {
        log::debug!("epic: catcache.bin has unexpected format");
        return Vec::new();
    };
    let mut out = Vec::new();
    for item in items {
        let Some(id) = item.get("id").and_then(Value::as_str) else { continue };
        let imgs = item.get("keyImages").and_then(Value::as_array).cloned().unwrap_or_default();
        let find = |ty: &str| -> Option<String> {
            imgs.iter()
                .find(|i| i.get("type").and_then(Value::as_str) == Some(ty))
                .and_then(|i| i.get("url").and_then(Value::as_str))
                .filter(|u| u.starts_with("http"))
                .map(str::to_string)
        };
        let mut im = Images::default();
        for ty in ["DieselGameBoxTall", "OfferImageTall", "Thumbnail"] {
            if let Some(u) = find(ty) {
                push_unique(&mut im.covers, u);
            }
        }
        for ty in ["DieselGameBox", "OfferImageWide", "Featured"] {
            if let Some(u) = find(ty) {
                push_unique(&mut im.heroes, u);
            }
        }
        if let Some(u) = find("DieselGameBoxLogo") {
            push_unique(&mut im.logos, u);
        }
        let app_ids = item
            .get("releaseInfo")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|r| r.get("appId").and_then(Value::as_str))
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        let in_games = item
            .get("categories")
            .and_then(Value::as_array)
            .is_some_and(|c| c.iter().any(|x| x.get("path").and_then(Value::as_str) == Some("games")));
        // у DLC/наборов mainGameItem.id указывает на основную игру; у самой игры он пустой
        let parent_id = item
            .get("mainGameItem")
            .and_then(|m| m.get("id"))
            .and_then(Value::as_str)
            .unwrap_or("");
        let is_main_game = in_games && parent_id.is_empty();
        out.push(CatalogItem {
            id: id.to_string(),
            namespace: item.get("namespace").and_then(Value::as_str).unwrap_or("").to_string(),
            title: item.get("title").and_then(Value::as_str).unwrap_or("").to_string(),
            app_ids,
            is_main_game,
            images: im,
        });
    }
    out
}

/// catalog item id -> key images. Tolerant: any failure yields an empty map.
fn load_catcache() -> HashMap<String, Images> {
    read_catcache().into_iter().map(|c| (c.id, c.images)).collect()
}

fn launch_uri(ns: &str, item_id: &str, app_name: &str) -> String {
    if ns.is_empty() || item_id.is_empty() {
        format!("com.epicgames.launcher://apps/{app_name}?action=launch&silent=true")
    } else {
        format!("com.epicgames.launcher://apps/{ns}%3A{item_id}%3A{app_name}?action=launch&silent=true")
    }
}

/// Папки, куда Epic ставит игры: стандартные на всех дисках + родители известных установок.
fn install_roots(known_installs: &[String]) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    let mut add = |p: PathBuf| {
        if p.is_dir() && !roots.iter().any(|r| r == &p) {
            roots.push(p);
        }
    };
    for letter in b'C'..=b'Z' {
        let drive = PathBuf::from(format!("{}:\\", letter as char));
        if !drive.exists() {
            continue;
        }
        add(drive.join("Program Files").join("Epic Games"));
        add(drive.join("Epic Games"));
        add(drive.join("Games").join("Epic Games"));
    }
    for inst in known_installs {
        if let Some(parent) = PathBuf::from(inst).parent() {
            add(parent.to_path_buf());
        }
    }
    roots
}

/// Игры, у которых есть папка .egstore, но нет записи в Manifests
/// (у некоторых версий лаунчера список установленных игр не хранится в ProgramData).
fn scan_install_folders(already: &[Game]) -> Vec<Game> {
    let known: Vec<String> = already.iter().filter_map(|g| g.install_dir.clone()).collect();
    let catalog = read_catcache();
    let mut out: Vec<Game> = Vec::new();
    for root in install_roots(&known) {
        let Ok(rd) = std::fs::read_dir(&root) else { continue };
        for entry in rd.filter_map(Result::ok) {
            let dir = entry.path();
            if !dir.join(".egstore").is_dir() {
                continue;
            }
            let folder = entry.file_name().to_string_lossy().to_string();
            if ["Launcher", "DirectXRedist", "GameInputRedist"].iter().any(|s| s.eq_ignore_ascii_case(&folder)) {
                continue;
            }
            let dir_s = norm_path(&dir);
            if known.iter().any(|k| k.eq_ignore_ascii_case(&dir_s)) {
                continue;
            }
            // сопоставить с каталогом: по AppName (= имя папки по умолчанию), затем по названию
            let item = catalog
                .iter()
                .filter(|c| c.is_main_game)
                .find(|c| c.app_ids.iter().any(|a| a.eq_ignore_ascii_case(&folder)))
                .or_else(|| {
                    catalog
                        .iter()
                        .filter(|c| c.is_main_game)
                        .find(|c| c.title.eq_ignore_ascii_case(&folder))
                });
            let (name, app_name, ns, item_id, images) = match item {
                Some(c) => (
                    c.title.clone(),
                    c.app_ids
                        .iter()
                        .find(|a| a.eq_ignore_ascii_case(&folder))
                        .or(c.app_ids.first())
                        .cloned()
                        .unwrap_or_else(|| folder.clone()),
                    c.namespace.clone(),
                    c.id.clone(),
                    c.images.clone(),
                ),
                None => (folder.clone(), folder.clone(), String::new(), String::new(), Images::default()),
            };
            let id = format!("epic:{app_name}");
            if already.iter().chain(out.iter()).any(|g| g.id.eq_ignore_ascii_case(&id)) {
                continue;
            }
            log::info!("epic: найдено по .egstore: {name} ({})", dir.display());
            out.push(Game {
                id,
                name,
                source: GameSource::Epic,
                covers: images.covers,
                heroes: images.heroes,
                logos: images.logos,
                install_dir: Some(dir_s),
                last_played: None,
                size_bytes: None,
                launch: LaunchTarget::Uri { uri: launch_uri(&ns, &item_id, &app_name) },
            });
        }
    }
    out
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

    /// Smoke test against the real machine: печатает игры, найденные по .egstore.
    #[test]
    fn install_folders_scan_runs() {
        for c in super::read_catcache().iter().filter(|c| c.title == "Fortnite") {
            println!("catalog: id={} ns={} apps={:?} main={} covers={}", c.id, c.namespace, c.app_ids, c.is_main_game, c.images.covers.len());
        }
        for g in super::scan_install_folders(&[]) {
            println!("{} | {} | cover={:?} | {:?}", g.id, g.name, g.covers.first(), g.launch);
        }
    }
}

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(Value::as_str).unwrap_or("").trim()
}

pub fn scan() -> anyhow::Result<Vec<Game>> {
    let mut games = scan_manifests();
    let extra = scan_install_folders(&games);
    games.extend(extra);
    Ok(games)
}

fn scan_manifests() -> Vec<Game> {
    let dir = data_dir().join("Manifests");
    let Ok(rd) = std::fs::read_dir(&dir) else {
        log::info!("epic: no manifests dir {}", dir.display());
        return Vec::new();
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
            launch: LaunchTarget::Uri { uri: launch_uri(ns, item_id, app_name) },
        });
    }
    games
}
