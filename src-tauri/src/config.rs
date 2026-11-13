//! Общая для всех учёток конфигурация: C:\ProgramData\ProfileHub\config.json.
//! Hub запущен в каждой учётке, поэтому все изменения делаются как
//! «прочитать с диска → изменить → записать», а не из закэшированной копии.

use crate::models::*;
use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

pub fn shared_dir() -> PathBuf {
    std::env::var_os("ProgramData")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("C:\\ProgramData"))
        .join("ProfileHub")
}

fn config_path() -> PathBuf {
    shared_dir().join("config.json")
}

/// Где конфиг лежал до перехода на учётки (в профиле текущего пользователя).
fn legacy_config_path() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("ProfileHub").join("config.json"))
}

/// Имя, пригодное для папки Windows.
pub fn sanitize_dir_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.').trim();
    if trimmed.is_empty() {
        "Profile".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Папка пользователя Windows (C:\Users\<имя>) — для умолчаний, папка может ещё не существовать.
pub fn user_home(username: &str) -> PathBuf {
    let users_root = dirs::home_dir()
        .and_then(|h| h.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("C:\\Users"));
    users_root.join(username)
}

pub fn default_projects_dir(username: &str) -> String {
    user_home(username).join("Projects").to_string_lossy().to_string()
}

pub fn new_profile(kind: ProfileKind, name: &str) -> Profile {
    let id = uuid::Uuid::new_v4().simple().to_string()[..12].to_string();
    let (icon, color) = match kind {
        ProfileKind::Work => ("💼", "#4f8cff"),
        ProfileKind::Gaming => ("🎮", "#7c5cff"),
    };
    Profile {
        id,
        name: name.to_string(),
        icon: icon.to_string(),
        color: color.to_string(),
        kind,
        wallpaper: None,
        theme: ThemeMode::Dark,
        browsers: Vec::new(),
        // заполняется при привязке учётки
        projects_dir: String::new(),
        apps: Vec::new(),
        on_leave: LeaveBehavior::Keep,
        hotkey: None,
        windows_user: None,
    }
}

fn default_config() -> AppConfig {
    let settings = Settings {
        hub_hotkey: "Ctrl+Alt+H".into(),
        game_hotkey: "Ctrl+Alt+G".into(),
        profiles_root: String::new(),
        launch_on_startup: true,
        apply_windows_theme: true,
    };
    let mut work = new_profile(ProfileKind::Work, "Работа");
    work.hotkey = Some("Ctrl+Alt+1".into());
    let mut games = new_profile(ProfileKind::Gaming, "Игры");
    games.hotkey = Some("Ctrl+Alt+2".into());
    AppConfig {
        settings,
        profiles: vec![work, games],
        active_profile_id: None,
        manual_games: Vec::new(),
        last_played: Default::default(),
        prev_work_profile_id: None,
        pending_game_mode_sid: None,
    }
}

/// Привести конфиг к модели «профиль = учётка»: если ни один профиль не привязан
/// (первый запуск или переход со старой версии), текущая учётка достаётся
/// активному либо первому рабочему профилю.
fn migrate(cfg: &mut AppConfig, current_sid: &str, current_username: &str) -> bool {
    if cfg.profiles.iter().any(|p| p.windows_user.is_some()) {
        return false;
    }
    let target = cfg
        .active_profile_id
        .as_ref()
        .and_then(|id| cfg.profiles.iter().position(|p| &p.id == id && p.kind == ProfileKind::Work))
        .or_else(|| cfg.profiles.iter().position(|p| p.kind == ProfileKind::Work));
    let Some(i) = target else { return false };
    let p = &mut cfg.profiles[i];
    p.windows_user = Some(WindowsUser { sid: current_sid.to_string(), username: current_username.to_string() });
    if p.projects_dir.trim().is_empty() {
        p.projects_dir = default_projects_dir(current_username);
    }
    // у профилей без учётки старые папки (из корня профилей) больше не имеют смысла
    for p in cfg.profiles.iter_mut().filter(|p| p.windows_user.is_none()) {
        p.projects_dir.clear();
    }
    // старое «закрывать приложения» теперь означало бы выход из учётки с потерей
    // несохранённой работы — при переносе включаем безопасное «оставлять в фоне»
    for p in cfg.profiles.iter_mut() {
        p.on_leave = LeaveBehavior::Keep;
    }
    // старые хоткеи по умолчанию: Ctrl+Alt+Space часто занят другими программами
    if cfg.settings.hub_hotkey == "Ctrl+Alt+Space" {
        cfg.settings.hub_hotkey = "Ctrl+Alt+H".into();
    }
    true
}

fn read(path: &Path) -> Option<AppConfig> {
    let text = std::fs::read_to_string(path).ok()?;
    match serde_json::from_str::<AppConfig>(&text) {
        Ok(cfg) => Some(cfg),
        Err(e) => {
            log::error!("{} повреждён ({e}), сохраняю копию", path.display());
            let _ = std::fs::copy(path, path.with_extension("broken.json"));
            None
        }
    }
}

/// Загрузить конфиг (с переносом старого и привязкой текущей учётки при первом запуске).
pub fn load(current_sid: &str, current_username: &str) -> AppConfig {
    let mut cfg = read(&config_path())
        .or_else(|| legacy_config_path().and_then(|p| read(&p)))
        .unwrap_or_else(default_config);
    let changed = migrate(&mut cfg, current_sid, current_username);
    if changed || !config_path().is_file() {
        if let Err(e) = save(&cfg) {
            log::error!("не удалось сохранить конфиг: {e:#}");
        }
    }
    cfg
}

/// Перечитать конфиг с диска (его могла изменить копия Hub в другой учётке).
pub fn reload() -> Option<AppConfig> {
    read(&config_path())
}

pub fn save(cfg: &AppConfig) -> Result<()> {
    let dir = shared_dir();
    std::fs::create_dir_all(&dir).context("не удалось создать папку настроек")?;
    let tmp = dir.join(format!("config.{}.tmp", std::process::id()));
    std::fs::write(&tmp, serde_json::to_string_pretty(cfg)?)?;
    std::fs::rename(&tmp, config_path()).context(
        "не удалось записать общий конфиг (нет прав на C:\\ProgramData\\ProfileHub — переустановите Profile Hub)",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_links_current_user_to_work_profile() {
        let mut cfg = default_config();
        cfg.settings.hub_hotkey = "Ctrl+Alt+Space".into();
        assert!(migrate(&mut cfg, "S-1-5-21-1", "User"));
        let work = cfg.profiles.iter().find(|p| p.kind == ProfileKind::Work).unwrap();
        assert_eq!(work.windows_user.as_ref().unwrap().sid, "S-1-5-21-1");
        assert!(work.projects_dir.ends_with("User\\Projects"));
        assert_eq!(cfg.settings.hub_hotkey, "Ctrl+Alt+H");
        assert!(cfg.profiles.iter().all(|p| p.on_leave == LeaveBehavior::Keep));
        // повторно ничего не меняется
        assert!(!migrate(&mut cfg, "S-1-5-21-2", "Other"));
    }

    #[test]
    fn old_leave_values_still_parse() {
        let v: LeaveBehavior = serde_json::from_str("\"closeOnGaming\"").unwrap();
        assert_eq!(v, LeaveBehavior::SignOutOnGaming);
        let v: LeaveBehavior = serde_json::from_str("\"close\"").unwrap();
        assert_eq!(v, LeaveBehavior::SignOut);
    }
}
