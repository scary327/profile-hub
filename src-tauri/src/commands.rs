//! Tauri-команды. Имена и аргументы — контракт с src/api.ts.
//! Команды async, чтобы не блокировать главный поток (и окна можно создавать изнутри).

use crate::core::{self, state};
use crate::models::*;
use crate::{browsers, config, desktop, games, util};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

type CmdResult<T> = Result<T, String>;

fn e<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEntry {
    name: String,
    path: String,
    modified: Option<u64>,
}

#[tauri::command]
pub async fn get_state(app: AppHandle) -> HubState {
    core::hub_state(&app)
}

#[tauri::command]
pub async fn new_profile_template(app: AppHandle, kind: ProfileKind) -> Profile {
    let st = state(&app);
    let cfg = st.config.lock();
    let base = match kind {
        ProfileKind::Work => "Новый профиль",
        ProfileKind::Gaming => "Игры",
    };
    let mut name = base.to_string();
    let mut n = 2;
    while cfg.profiles.iter().any(|p| p.name == name) {
        name = format!("{base} {n}");
        n += 1;
    }
    config::new_profile(&cfg.settings, kind, &name)
}

#[tauri::command]
pub async fn save_profile(app: AppHandle, mut profile: Profile) -> CmdResult<HubState> {
    let st = state(&app);
    profile.name = profile.name.trim().to_string();
    if profile.name.is_empty() {
        return Err("Имя профиля не может быть пустым".into());
    }
    if !profile.projects_dir.trim().is_empty() {
        std::fs::create_dir_all(&profile.projects_dir)
            .map_err(|err| format!("Не удалось создать папку проектов: {err}"))?;
    }
    {
        let mut cfg = st.config.lock();
        match cfg.profiles.iter_mut().find(|p| p.id == profile.id) {
            Some(existing) => {
                // desktop_id управляется бэкендом
                profile.desktop_id = existing.desktop_id.clone();
                *existing = profile.clone();
            }
            None => {
                profile.desktop_id = None;
                cfg.profiles.push(profile.clone());
            }
        }
    }
    st.save_config().map_err(e)?;
    // имя стола и обои применяем сразу, если стол уже есть
    if let Some(d) = profile.desktop_id.as_deref().and_then(desktop::find) {
        let _ = d.set_name(&format!("{} {}", profile.icon, profile.name));
        if let Some(wp) = profile.wallpaper.as_deref().filter(|w| Path::new(w).is_file()) {
            let _ = desktop::set_wallpaper(&d, wp);
        }
    }
    core::register_hotkeys(&app);
    Ok(core::hub_state(&app))
}

#[tauri::command]
pub async fn delete_profile(app: AppHandle, id: String, delete_data: bool) -> CmdResult<HubState> {
    let st = state(&app);
    let profile = st.profile(&id).map_err(e)?;
    core::close_profile_apps(&app, &id);
    if let Some(did) = profile.desktop_id.as_deref() {
        if let Err(err) = desktop::remove(did) {
            log::warn!("удаление стола: {err}");
        }
    }
    if delete_data {
        let root = st.profiles_root();
        let _ = std::fs::remove_dir_all(config::profile_data_dir(&root, &id));
        // папку проектов удаляем только если она пустая — код не трогаем
        let _ = std::fs::remove_dir(&profile.projects_dir);
    }
    {
        let mut cfg = st.config.lock();
        cfg.profiles.retain(|p| p.id != id);
        if cfg.active_profile_id.as_deref() == Some(&id) {
            cfg.active_profile_id = None;
        }
    }
    {
        let mut prev = st.prev_work.lock();
        if prev.as_deref() == Some(&id) {
            *prev = None;
        }
    }
    st.save_config().map_err(e)?;
    core::register_hotkeys(&app);
    Ok(core::hub_state(&app))
}

#[tauri::command]
pub async fn switch_profile(app: AppHandle, id: String) -> CmdResult<HubState> {
    core::switch_profile(&app, &id).map_err(e)?;
    Ok(core::hub_state(&app))
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: Settings) -> CmdResult<HubState> {
    let st = state(&app);
    let autolaunch = app.autolaunch();
    let res = if settings.launch_on_startup {
        autolaunch.enable()
    } else {
        autolaunch.disable()
    };
    if let Err(err) = res {
        log::warn!("автозапуск: {err}");
    }
    st.config.lock().settings = settings;
    st.save_config().map_err(e)?;
    let failed = core::register_hotkeys(&app);
    if !failed.is_empty() {
        return Err(format!(
            "Настройки сохранены, но хоткеи заняты другой программой: {}",
            failed.join(", ")
        ));
    }
    Ok(core::hub_state(&app))
}

#[tauri::command]
pub async fn launch_browser(app: AppHandle, profile_id: String, kind: BrowserKind) -> CmdResult<()> {
    core::launch_browser(&app, &profile_id, kind).map_err(e)
}

#[tauri::command]
pub async fn launch_app(app: AppHandle, profile_id: String, app_id: String) -> CmdResult<()> {
    core::launch_app(&app, &profile_id, &app_id).map_err(e)
}

#[tauri::command]
pub async fn close_profile_apps(app: AppHandle, profile_id: String) -> CmdResult<HubState> {
    core::close_profile_apps(&app, &profile_id);
    // дать окнам закрыться, прежде чем пересчитывать «запущенные»
    std::thread::sleep(std::time::Duration::from_millis(600));
    Ok(core::hub_state(&app))
}

fn projects_dir(app: &AppHandle, profile_id: &str) -> CmdResult<PathBuf> {
    let p = state(app).profile(profile_id).map_err(e)?;
    let dir = PathBuf::from(p.projects_dir);
    std::fs::create_dir_all(&dir).map_err(e)?;
    Ok(dir)
}

#[tauri::command]
pub async fn open_projects_dir(app: AppHandle, profile_id: String) -> CmdResult<()> {
    let dir = projects_dir(&app, &profile_id)?;
    util::shell_open(&dir.to_string_lossy()).map_err(e)
}

fn entry(path: &Path) -> ProjectEntry {
    let modified = std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());
    ProjectEntry {
        name: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        path: path.to_string_lossy().to_string(),
        modified,
    }
}

#[tauri::command]
pub async fn list_projects(app: AppHandle, profile_id: String) -> CmdResult<Vec<ProjectEntry>> {
    let dir = projects_dir(&app, &profile_id)?;
    let mut list: Vec<ProjectEntry> = std::fs::read_dir(&dir)
        .map_err(e)?
        .flatten()
        .filter(|d| d.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter(|d| !d.file_name().to_string_lossy().starts_with('.'))
        .map(|d| entry(&d.path()))
        .collect();
    list.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(list)
}

#[tauri::command]
pub async fn create_project(app: AppHandle, profile_id: String, name: String) -> CmdResult<ProjectEntry> {
    let clean = config::sanitize_dir_name(&name);
    let dir = projects_dir(&app, &profile_id)?.join(&clean);
    if dir.exists() {
        return Err(format!("Проект «{clean}» уже существует"));
    }
    std::fs::create_dir_all(&dir).map_err(e)?;
    Ok(entry(&dir))
}

#[tauri::command]
pub async fn open_in_editor(path: String) -> CmdResult<()> {
    util::open_in_editor(&path).map_err(e)
}

#[tauri::command]
pub async fn open_path(path: String) -> CmdResult<()> {
    util::shell_open(&path).map_err(e)
}

#[tauri::command]
pub async fn list_games(app: AppHandle, refresh: bool) -> Vec<Game> {
    core::games(&app, refresh)
}

#[tauri::command]
pub async fn launch_game(app: AppHandle, game_id: String) -> CmdResult<()> {
    core::launch_game(&app, &game_id).map_err(e)
}

#[tauri::command]
pub async fn list_launchers() -> Vec<LauncherInfo> {
    games::list_launchers()
}

#[tauri::command]
pub async fn launch_launcher(source: GameSource) -> CmdResult<()> {
    let l = games::list_launchers()
        .into_iter()
        .find(|l| l.source == source)
        .ok_or("Лаунчер не установлен")?;
    util::spawn_detached(&l.exe_path, &[], None).map_err(e)?;
    Ok(())
}

#[tauri::command]
pub async fn add_manual_game(app: AppHandle, mut game: ManualGame) -> CmdResult<HubState> {
    if !Path::new(&game.exe_path).is_file() {
        return Err("Файл игры не найден".into());
    }
    if game.id.trim().is_empty() {
        game.id = uuid::Uuid::new_v4().simple().to_string();
    }
    let st = state(&app);
    {
        let mut cfg = st.config.lock();
        cfg.manual_games.retain(|g| g.id != game.id);
        cfg.manual_games.push(game);
    }
    st.save_config().map_err(e)?;
    core::games(&app, true);
    Ok(core::hub_state(&app))
}

#[tauri::command]
pub async fn remove_manual_game(app: AppHandle, id: String) -> CmdResult<HubState> {
    let st = state(&app);
    st.config.lock().manual_games.retain(|g| g.id != id);
    st.save_config().map_err(e)?;
    core::games(&app, true);
    Ok(core::hub_state(&app))
}

#[tauri::command]
pub async fn enter_game_mode(app: AppHandle) -> CmdResult<()> {
    core::enter_game_mode(&app).map_err(e)
}

#[tauri::command]
pub async fn exit_game_mode(app: AppHandle) -> CmdResult<()> {
    core::exit_game_mode(&app).map_err(e)
}

#[tauri::command]
pub async fn hide_hub(app: AppHandle) {
    core::hide_hub(&app);
}

#[tauri::command]
pub async fn get_gamepad_info() -> crate::gamepad::PadInfo {
    crate::gamepad::current_info()
}

/// Диагностика из фронтенда в общий лог.
#[tauri::command]
pub async fn debug_log(msg: String) {
    log::info!("[ui] {msg}");
}

#[tauri::command]
pub async fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Пересканировать браузеры (например, после установки нового).
pub fn refresh_browsers(app: &AppHandle) {
    *state(app).browsers.lock() = browsers::detect();
}
