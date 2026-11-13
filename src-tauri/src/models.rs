//! Общие типы данных. ЭТО КОНТРАКТ между Rust и фронтендом (src/api.ts).
//! Все структуры сериализуются в camelCase.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum ProfileKind {
    Work,
    Gaming,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ThemeMode {
    Dark,
    Light,
}

/// Что делать с сеансом Windows профиля, когда уходим из него.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LeaveBehavior {
    /// Оставить сеанс работать в фоне (всё открытое остаётся как было).
    Keep,
    /// Выйти из учётки (все программы профиля закрываются, память освобождается).
    #[serde(alias = "close")]
    SignOut,
    /// Выходить из учётки только при переходе в игровой профиль.
    #[serde(alias = "closeOnGaming")]
    SignOutOnGaming,
}

/// Учётная запись Windows, привязанная к профилю.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WindowsUser {
    pub sid: String,
    pub username: String,
}

/// Локальный пользователь Windows (для списка в UI).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WinUserInfo {
    pub sid: String,
    pub username: String,
    pub full_name: String,
    pub enabled: bool,
    /// У пользователя сейчас есть сеанс (вошёл в систему, активен или в фоне).
    pub logged_in: bool,
    /// Это пользователь текущего сеанса.
    pub is_current: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum BrowserKind {
    Chrome,
    Edge,
    Firefox,
    Opera,
    OperaGx,
    Brave,
    Yandex,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileBrowser {
    pub kind: BrowserKind,
    /// Запускать автоматически при входе в профиль.
    pub autostart: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileApp {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(default)]
    pub args: String,
    #[serde(default)]
    pub autostart: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    /// Эмодзи-иконка профиля.
    pub icon: String,
    /// Акцентный цвет, "#RRGGBB".
    pub color: String,
    pub kind: ProfileKind,
    /// Путь к картинке обоев или None.
    pub wallpaper: Option<String>,
    pub theme: ThemeMode,
    pub browsers: Vec<ProfileBrowser>,
    /// Папка проектов профиля (абсолютный путь).
    pub projects_dir: String,
    pub apps: Vec<ProfileApp>,
    pub on_leave: LeaveBehavior,
    /// Глобальный хоткей для прямого переключения, напр. "Ctrl+Alt+1".
    pub hotkey: Option<String>,
    /// Учётная запись Windows профиля. None — ещё не создана/не привязана.
    #[serde(default)]
    pub windows_user: Option<WindowsUser>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualGame {
    pub id: String,
    pub name: String,
    pub exe_path: String,
    #[serde(default)]
    pub args: String,
    /// URL или локальный путь к обложке (вертикальной/квадратной).
    pub cover: Option<String>,
    /// URL или локальный путь к широкой фоновой картинке.
    pub hero: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// Хоткей открытия хаба.
    pub hub_hotkey: String,
    /// Хоткей входа в игровой режим.
    pub game_hotkey: String,
    /// Корень, где лежат данные профилей (браузеры, проекты).
    pub profiles_root: String,
    pub launch_on_startup: bool,
    /// Применять светлую/тёмную тему Windows при переключении.
    pub apply_windows_theme: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub settings: Settings,
    pub profiles: Vec<Profile>,
    pub active_profile_id: Option<String>,
    #[serde(default)]
    pub manual_games: Vec<ManualGame>,
    /// gameId -> unix-время последнего запуска через хаб (секунды).
    #[serde(default)]
    pub last_played: std::collections::HashMap<String, u64>,
    /// Последний рабочий профиль — куда возвращаться из игрового режима.
    #[serde(default)]
    pub prev_work_profile_id: Option<String>,
    /// SID учётки, в которой после входа нужно сразу открыть игровой режим
    /// (переход в игры из другой учётки идёт через экран входа).
    #[serde(default)]
    pub pending_game_mode_sid: Option<String>,
}

/// Информация о браузере, найденном в системе.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserInfo {
    pub kind: BrowserKind,
    pub name: String,
    pub installed: bool,
    pub exe_path: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum GameSource {
    Steam,
    Epic,
    Gog,
    Ubisoft,
    Ea,
    BattleNet,
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    /// Уникальный id: "{source}:{id в источнике}", напр. "steam:570".
    pub id: String,
    pub name: String,
    pub source: GameSource,
    /// Кандидаты обложки (вертикальная 600x900 или квадратная), по приоритету.
    /// Это http(s)-URL или абсолютные локальные пути (фронт конвертирует через convertFileSrc).
    pub covers: Vec<String>,
    /// Кандидаты широкой фоновой картинки (hero), по приоритету.
    pub heroes: Vec<String>,
    /// Кандидаты логотипа (прозрачный png), по приоритету.
    pub logos: Vec<String>,
    pub install_dir: Option<String>,
    /// Unix-время последнего запуска (из лаунчера или хаба), если известно.
    pub last_played: Option<u64>,
    /// Размер на диске в байтах, если известен.
    pub size_bytes: Option<u64>,
    /// Внутренние данные для запуска (URI или exe+args), фронт их не трогает.
    pub launch: LaunchTarget,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum LaunchTarget {
    /// Открыть URI через ShellExecute (steam://..., com.epicgames.launcher://..., uplay://...).
    Uri { uri: String },
    /// Запустить exe напрямую.
    Exe { path: String, args: String, cwd: Option<String> },
}

/// Установленный лаунчер (Steam, Epic Games и т.д.) для ряда «Приложения».
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherInfo {
    pub source: GameSource,
    pub name: String,
    pub exe_path: String,
}

/// Состояние, которое фронт получает целиком.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HubState {
    pub config: AppConfig,
    pub browsers: Vec<BrowserInfo>,
    /// id профилей, чья учётка сейчас в системе (есть сеанс Windows).
    pub running_profiles: Vec<String>,
    /// Хоткеи, которые не удалось зарегистрировать (заняты другой программой).
    pub busy_hotkeys: Vec<String>,
    /// Пользователь текущего сеанса.
    pub current_user: WinUserInfo,
    /// Профиль, привязанный к текущему пользователю (None — учётка не привязана).
    pub current_profile_id: Option<String>,
    /// Все локальные пользователи Windows (для привязки к профилю).
    pub windows_users: Vec<WinUserInfo>,
}
