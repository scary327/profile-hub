//! Хранение конфигурации в %APPDATA%\ProfileHub\config.json и пути к данным профилей.

use crate::models::*;
use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

pub fn app_data_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("ProfileHub")
}

fn config_path() -> PathBuf {
    app_data_dir().join("config.json")
}

pub fn default_profiles_root() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("C:\\"))
        .join("ProfileHub")
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

/// Скрытая папка с внутренними данными профиля (данные браузеров и т.п.).
pub fn profile_data_dir(root: &Path, profile_id: &str) -> PathBuf {
    root.join(".data").join(profile_id)
}

pub fn new_profile(settings: &Settings, kind: ProfileKind, name: &str) -> Profile {
    let id = uuid::Uuid::new_v4().simple().to_string()[..12].to_string();
    let root = PathBuf::from(&settings.profiles_root);
    let (icon, color) = match kind {
        ProfileKind::Work => ("💼", "#4f8cff"),
        ProfileKind::Gaming => ("🎮", "#7c5cff"),
    };
    let projects_dir = match kind {
        ProfileKind::Work => root.join(sanitize_dir_name(name)).join("Projects"),
        ProfileKind::Gaming => root.join(sanitize_dir_name(name)),
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
        projects_dir: projects_dir.to_string_lossy().to_string(),
        apps: Vec::new(),
        on_leave: match kind {
            ProfileKind::Work => LeaveBehavior::CloseOnGaming,
            ProfileKind::Gaming => LeaveBehavior::Keep,
        },
        hotkey: None,
        desktop_id: None,
    }
}

fn default_config() -> AppConfig {
    let settings = Settings {
        hub_hotkey: "Ctrl+Alt+Space".into(),
        game_hotkey: "Ctrl+Alt+G".into(),
        profiles_root: default_profiles_root().to_string_lossy().to_string(),
        launch_on_startup: false,
        apply_windows_theme: true,
    };
    let mut work = new_profile(&settings, ProfileKind::Work, "Работа");
    work.hotkey = Some("Ctrl+Alt+1".into());
    let mut games = new_profile(&settings, ProfileKind::Gaming, "Игры");
    games.hotkey = Some("Ctrl+Alt+2".into());
    AppConfig {
        settings,
        profiles: vec![work, games],
        active_profile_id: None,
        manual_games: Vec::new(),
        last_played: Default::default(),
    }
}

pub fn load() -> AppConfig {
    let path = config_path();
    match std::fs::read_to_string(&path) {
        Ok(text) => match serde_json::from_str::<AppConfig>(&text) {
            Ok(cfg) => cfg,
            Err(e) => {
                log::error!("config.json повреждён ({e}), сохраняю копию и создаю новый");
                let _ = std::fs::copy(&path, path.with_extension("broken.json"));
                default_config()
            }
        },
        Err(_) => {
            let cfg = default_config();
            let _ = save(&cfg);
            cfg
        }
    }
}

pub fn save(cfg: &AppConfig) -> Result<()> {
    let dir = app_data_dir();
    std::fs::create_dir_all(&dir).context("не удалось создать папку настроек")?;
    let tmp = dir.join("config.json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(cfg)?)?;
    std::fs::rename(&tmp, config_path())?;
    Ok(())
}
