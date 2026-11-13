//! «Стыковка» окна чужой программы (Chrome, Discord, Telegram, чаты Steam) в панель
//! игрового режима: снимаем рамку, делаем окно принадлежащим окну игр (его нет в Alt+Tab
//! и на панели задач, оно всегда над игровым режимом) и ставим поверх области панели.
//! Отстыковка возвращает исходный стиль, владельца и место окна.

use crate::core::state;
use crate::models::*;
use crate::{browsers, games, util, winfocus};
use anyhow::{anyhow, bail, Result};
use parking_lot::Mutex;
use std::collections::HashSet;
use std::path::PathBuf;
use std::time::{Duration, Instant};
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use tauri::{AppHandle, Emitter, Manager};
use windows_sys::Win32::Foundation::{HWND, LPARAM, RECT};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindow, GetWindowLongPtrW, GetWindowPlacement, GetWindowRect, GetWindowTextLengthW,
    GetWindowTextW, GetWindowThreadProcessId, IsWindow, IsWindowVisible, SetWindowLongPtrW,
    SetWindowPlacement, SetWindowPos, ShowWindow, GWLP_HWNDPARENT, GWL_EXSTYLE, GWL_STYLE, GW_OWNER,
    HWND_TOP, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW,
    SW_HIDE, SW_RESTORE, SW_SHOW, WINDOWPLACEMENT, WS_CAPTION, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
    WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_SYSMENU, WS_THICKFRAME,
};

const WAIT_WINDOW: Duration = Duration::from_secs(12);

struct Docked {
    app_id: String,
    hwnd: isize,
    style: isize,
    ex_style: isize,
    owner: isize,
    placement: WINDOWPLACEMENT,
    visible: bool,
}

// SAFETY: HWND хранится как isize; WINDOWPLACEMENT — POD.
unsafe impl Send for Docked {}

static DOCKED: Mutex<Option<Docked>> = Mutex::new(None);
/// Открытия идут по одному: повторный dock_open того же приложения во время холодного
/// запуска дождётся первого и просто переставит уже пристыкованное окно.
static OPEN_LOCK: Mutex<()> = Mutex::new(());

// ---------------- приложения ----------------

fn telegram_exe() -> Option<PathBuf> {
    let p = dirs::data_dir()?.join("Telegram Desktop").join("Telegram.exe");
    p.is_file().then_some(p)
}

fn discord_updater() -> Option<PathBuf> {
    let local = dirs::data_local_dir()?;
    ["Discord", "DiscordPTB", "DiscordCanary"]
        .iter()
        .map(|d| local.join(d).join("Update.exe"))
        .find(|p| p.is_file())
}

fn browser_kind(id: &str) -> Option<BrowserKind> {
    serde_json::from_value(serde_json::Value::String(id.to_string())).ok()
}

pub fn list_apps(app: &AppHandle) -> Vec<DockApp> {
    let mut out: Vec<DockApp> = state(app)
        .browsers
        .lock()
        .iter()
        .map(|b| DockApp {
            id: serde_json::to_value(b.kind).ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default(),
            name: b.name.clone(),
            kind: "browser".into(),
            installed: b.installed,
        })
        .collect();
    out.push(DockApp { id: "discord".into(), name: "Discord".into(), kind: "voice".into(), installed: discord_updater().is_some() });
    out.push(DockApp { id: "telegram".into(), name: "Telegram".into(), kind: "voice".into(), installed: telegram_exe().is_some() });
    out.push(DockApp {
        id: "steamChat".into(),
        name: "Чаты Steam".into(),
        kind: "voice".into(),
        installed: games::list_launchers().iter().any(|l| l.source == GameSource::Steam),
    });
    out
}

/// Имена процессов, чьи окна принадлежат приложению.
fn process_names(app: &AppHandle, app_id: &str) -> Result<Vec<String>> {
    Ok(match app_id {
        "discord" => vec!["discord.exe".into(), "discordptb.exe".into(), "discordcanary.exe".into()],
        "telegram" => vec!["telegram.exe".into()],
        "steamChat" => vec!["steamwebhelper.exe".into()],
        id => {
            let kind = browser_kind(id).ok_or_else(|| anyhow!("неизвестное приложение {id}"))?;
            let exe = browser_exe(app, kind)?;
            vec![PathBuf::from(exe).file_name().map(|f| f.to_string_lossy().to_lowercase()).unwrap_or_default()]
        }
    })
}

fn browser_exe(app: &AppHandle, kind: BrowserKind) -> Result<String> {
    state(app)
        .browsers
        .lock()
        .iter()
        .find(|b| b.kind == kind)
        .and_then(|b| b.exe_path.clone())
        .ok_or_else(|| anyhow!("{} не установлен", browsers::display_name(kind)))
}

/// Запустить/активировать приложение. Для браузера `new_window` — открыть отдельное окно.
fn launch(app: &AppHandle, app_id: &str, url: Option<&str>, new_window: bool) -> Result<()> {
    match app_id {
        "discord" => {
            let up = discord_updater().ok_or_else(|| anyhow!("Discord не установлен"))?;
            let exe = match up.parent().and_then(|p| p.file_name()).and_then(|n| n.to_str()) {
                Some("DiscordPTB") => "DiscordPTB.exe",
                Some("DiscordCanary") => "DiscordCanary.exe",
                _ => "Discord.exe",
            };
            util::spawn_detached(&up.to_string_lossy(), &["--processStart".into(), exe.into()], None)?;
        }
        "telegram" => {
            let exe = telegram_exe().ok_or_else(|| anyhow!("Telegram не установлен"))?;
            util::spawn_detached(&exe.to_string_lossy(), &[], None)?;
        }
        "steamChat" => games::launch(&LaunchTarget::Uri { uri: "steam://open/friends".into() })?,
        id => {
            let kind = browser_kind(id).ok_or_else(|| anyhow!("неизвестное приложение {id}"))?;
            let exe = browser_exe(app, kind)?;
            let mut args: Vec<String> = Vec::new();
            if new_window {
                args.push(if kind == BrowserKind::Firefox { "-new-window" } else { "--new-window" }.into());
            }
            if let Some(u) = url {
                args.push(u.to_string());
            }
            util::spawn_detached(&exe, &args, None)?;
        }
    }
    Ok(())
}

// ---------------- окна ----------------

fn pids_of(names: &[String]) -> HashSet<u32> {
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_exe(UpdateKind::Never));
    sys.processes()
        .iter()
        .filter(|(_, p)| names.contains(&p.name().to_string_lossy().to_lowercase()))
        .map(|(pid, _)| pid.as_u32())
        .collect()
}

fn title_of(hwnd: HWND) -> String {
    unsafe {
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 {
            return String::new();
        }
        let mut buf = vec![0u16; len as usize + 1];
        let n = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }
}

struct Cand {
    hwnd: isize,
    area: i64,
    title: String,
}

struct EnumCtx<'a> {
    pids: &'a HashSet<u32>,
    out: Vec<Cand>,
}

unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> i32 {
    // SAFETY: lparam указывает на EnumCtx на стеке вызывающего на время EnumWindows.
    let ctx = unsafe { &mut *(lparam as *mut EnumCtx) };
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    if !ctx.pids.contains(&pid) || unsafe { IsWindowVisible(hwnd) } == 0 {
        return 1;
    }
    let ex = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } as u32;
    let owned = !unsafe { GetWindow(hwnd, GW_OWNER) }.is_null();
    if owned || ex & WS_EX_TOOLWINDOW != 0 {
        return 1;
    }
    let title = title_of(hwnd);
    if title.trim().is_empty() {
        return 1;
    }
    let mut r: RECT = unsafe { std::mem::zeroed() };
    unsafe { GetWindowRect(hwnd, &mut r) };
    let area = (r.right - r.left) as i64 * (r.bottom - r.top) as i64;
    if area < 200 * 150 {
        return 1;
    }
    ctx.out.push(Cand { hwnd: hwnd as isize, area, title });
    1
}

fn windows_of(pids: &HashSet<u32>) -> Vec<Cand> {
    let mut ctx = EnumCtx { pids, out: Vec::new() };
    unsafe { EnumWindows(Some(enum_proc), &mut ctx as *mut EnumCtx as LPARAM) };
    ctx.out
}

fn is_steam_chat_title(t: &str) -> bool {
    let t = t.to_lowercase();
    ["friends", "друз", "chat", "чат"].iter().any(|k| t.contains(k))
}

/// Дождаться окна приложения. `exclude` — окна, существовавшие до запуска (для нового окна браузера).
fn wait_window(app_id: &str, names: &[String], exclude: &HashSet<isize>) -> Result<Cand> {
    let deadline = Instant::now() + WAIT_WINDOW;
    loop {
        let pids = pids_of(names);
        let mut c: Vec<Cand> = windows_of(&pids)
            .into_iter()
            .filter(|c| !exclude.contains(&c.hwnd))
            .filter(|c| app_id != "steamChat" || is_steam_chat_title(&c.title))
            .collect();
        c.sort_by_key(|c| std::cmp::Reverse(c.area));
        if let Some(best) = c.into_iter().next() {
            return Ok(best);
        }
        if Instant::now() >= deadline {
            bail!("Окно приложения не появилось — попробуйте ещё раз");
        }
        std::thread::sleep(Duration::from_millis(150));
    }
}

// ---------------- стыковка ----------------

/// Прямоугольник панели (CSS px относительно окна игр) → экранные координаты.
fn screen_rect(app: &AppHandle, rect: Rect) -> Result<(i32, i32, i32, i32)> {
    let w = app.get_webview_window("game").ok_or_else(|| anyhow!("игровой режим не открыт"))?;
    let pos = w.inner_position()?;
    let s = w.scale_factor()?;
    Ok((
        pos.x + (rect.x * s).round() as i32,
        pos.y + (rect.y * s).round() as i32,
        (rect.width * s).round().max(1.0) as i32,
        (rect.height * s).round().max(1.0) as i32,
    ))
}

fn game_hwnd(app: &AppHandle) -> Result<isize> {
    let w = app.get_webview_window("game").ok_or_else(|| anyhow!("игровой режим не открыт"))?;
    Ok(w.hwnd()?.0 as isize)
}

fn attach(hwnd: isize, owner: isize, r: (i32, i32, i32, i32)) -> Docked {
    let h = hwnd as HWND;
    unsafe {
        let mut placement: WINDOWPLACEMENT = std::mem::zeroed();
        placement.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
        GetWindowPlacement(h, &mut placement);
        let style = GetWindowLongPtrW(h, GWL_STYLE);
        let ex_style = GetWindowLongPtrW(h, GWL_EXSTYLE);
        let old_owner = GetWindowLongPtrW(h, GWLP_HWNDPARENT);
        ShowWindow(h, SW_RESTORE); // из «развёрнуто» — иначе SetWindowPos не сработает
        let frame = (WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU) as isize;
        SetWindowLongPtrW(h, GWL_STYLE, style & !frame);
        SetWindowLongPtrW(h, GWL_EXSTYLE, (ex_style & !(WS_EX_APPWINDOW as isize)) | WS_EX_TOOLWINDOW as isize);
        SetWindowLongPtrW(h, GWLP_HWNDPARENT, owner);
        SetWindowPos(h, HWND_TOP, r.0, r.1, r.2, r.3, SWP_FRAMECHANGED | SWP_SHOWWINDOW);
        winfocus::force_foreground(h);
        Docked { app_id: String::new(), hwnd, style, ex_style, owner: old_owner, placement, visible: true }
    }
}

fn detach(d: &Docked, show: bool) {
    let h = d.hwnd as HWND;
    unsafe {
        if IsWindow(h) == 0 {
            return;
        }
        ShowWindow(h, SW_HIDE);
        SetWindowLongPtrW(h, GWLP_HWNDPARENT, d.owner);
        SetWindowLongPtrW(h, GWL_STYLE, d.style);
        SetWindowLongPtrW(h, GWL_EXSTYLE, d.ex_style);
        SetWindowPos(h, std::ptr::null_mut(), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
        let mut p = d.placement;
        p.showCmd = if show { if p.showCmd == 0 { SW_SHOW as u32 } else { p.showCmd } } else { SW_HIDE as u32 };
        SetWindowPlacement(h, &p);
        if show {
            ShowWindow(h, SW_SHOW);
        }
    }
}

fn dock_state_of(d: &Docked) -> DockState {
    DockState { app_id: d.app_id.clone(), title: title_of(d.hwnd as HWND), visible: d.visible }
}

pub fn current(app: &AppHandle) -> Option<DockState> {
    let _ = app;
    DOCKED.lock().as_ref().map(dock_state_of)
}

fn emit_changed(app: &AppHandle) {
    let _ = app.emit_to("game", "dock-changed", current(app));
}

pub fn open(app: &AppHandle, app_id: &str, url: Option<&str>, rect: Rect) -> Result<DockState> {
    if let Some(u) = url {
        if !(u.starts_with("http://") || u.starts_with("https://")) {
            bail!("можно открывать только http/https");
        }
    }
    let _serial = OPEN_LOCK.lock();
    let owner = game_hwnd(app)?;
    let r = screen_rect(app, rect)?;

    // то же приложение уже в панели
    {
        let mut guard = DOCKED.lock();
        if let Some(d) = guard.as_mut().filter(|d| d.app_id == app_id && unsafe { IsWindow(d.hwnd as HWND) } != 0) {
            let h = d.hwnd as HWND;
            unsafe {
                SetWindowPos(h, HWND_TOP, r.0, r.1, r.2, r.3, SWP_SHOWWINDOW);
            }
            winfocus::force_foreground(h);
            d.visible = true;
            let st = dock_state_of(d);
            drop(guard);
            if url.is_some() {
                // браузер откроет адрес новой вкладкой в последнем активном окне — нашем
                launch(app, app_id, url, false)?;
            }
            emit_changed(app);
            return Ok(st);
        }
    }
    release(app);

    let names = process_names(app, app_id)?;
    let is_browser = browser_kind(app_id).is_some();
    // для браузера — всегда отдельное новое окно, чтобы не утащить окно, в котором вы работаете
    let before: HashSet<isize> = if is_browser {
        windows_of(&pids_of(&names)).into_iter().map(|c| c.hwnd).collect()
    } else {
        HashSet::new()
    };
    launch(app, app_id, url, is_browser)?;
    let cand = wait_window(app_id, &names, &before)?;
    // окно могло ещё «раскрываться» — дать ему встать
    std::thread::sleep(Duration::from_millis(250));
    let r = screen_rect(app, rect)?;
    let mut d = attach(cand.hwnd, owner, r);
    d.app_id = app_id.to_string();
    let st = dock_state_of(&d);
    log::info!("в панели: {} («{}»)", app_id, st.title);
    *DOCKED.lock() = Some(d);
    emit_changed(app);
    Ok(st)
}

pub fn set_bounds(app: &AppHandle, rect: Rect) -> Result<()> {
    let r = screen_rect(app, rect)?;
    if let Some(d) = DOCKED.lock().as_ref().filter(|d| d.visible) {
        unsafe {
            SetWindowPos(d.hwnd as HWND, HWND_TOP, r.0, r.1, r.2, r.3, SWP_NOACTIVATE);
        }
    }
    Ok(())
}

pub fn hide(app: &AppHandle) {
    let changed = {
        let mut g = DOCKED.lock();
        match g.as_mut() {
            Some(d) if d.visible => {
                unsafe { ShowWindow(d.hwnd as HWND, SW_HIDE) };
                d.visible = false;
                true
            }
            _ => false,
        }
    };
    if let Some(w) = app.get_webview_window("game") {
        if let Ok(h) = w.hwnd() {
            winfocus::force_foreground(h.0 as HWND);
        }
    }
    if changed {
        emit_changed(app);
    }
}

/// Вернуть окно на рабочий стол в исходном виде.
pub fn release(app: &AppHandle) {
    let taken = DOCKED.lock().take();
    if let Some(d) = taken {
        detach(&d, true);
        log::info!("отстыковано: {}", d.app_id);
        emit_changed(app);
    }
}

/// Следит, не закрылось ли пристыкованное окно само (или не спряталось в трей).
pub fn spawn_watcher(app: AppHandle) {
    std::thread::Builder::new()
        .name("dock-watch".into())
        .spawn(move || {
          let mut last_title = String::new();
          loop {
            std::thread::sleep(Duration::from_millis(700));
            let (gone, title) = {
                let g = DOCKED.lock();
                match g.as_ref() {
                    Some(d) => {
                        let h = d.hwnd as HWND;
                        let gone = unsafe { IsWindow(h) == 0 || (d.visible && IsWindowVisible(h) == 0) };
                        (gone, if gone { String::new() } else { title_of(h) })
                    }
                    None => (false, String::new()),
                }
            };
            // заголовок (вкладка браузера, канал Discord) поменялся — обновить шапку панели
            if !gone && title != last_title {
                let changed = !last_title.is_empty() && !title.is_empty();
                last_title = title;
                if changed {
                    emit_changed(&app);
                }
            }
            if gone {
                last_title.clear();
                let taken = DOCKED.lock().take();
                if let Some(d) = taken {
                    // окно ещё живо (ушло в трей) — вернуть ему нормальный вид, не показывая
                    detach(&d, false);
                }
                emit_changed(&app);
            }
          }
        })
        .expect("не удалось запустить поток стыковки");
}
