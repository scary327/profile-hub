//! Поиск и аккуратное закрытие процессов, принадлежащих профилю.

use std::collections::HashSet;
use std::path::Path;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use windows_sys::Win32::Foundation::{HWND, LPARAM};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindow, GetWindowThreadProcessId, IsWindowVisible, PostMessageW, GW_OWNER,
    WM_CLOSE,
};

/// Снимок процессов: PID + командная строка в нижнем регистре.
pub struct Snapshot(Vec<(u32, String)>);

impl Snapshot {
    pub fn take() -> Self {
        let mut sys = System::new();
        sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always),
        );
        Snapshot(
            sys.processes()
                .iter()
                .map(|(pid, p)| {
                    let cmd = p
                        .cmd()
                        .iter()
                        .map(|a| a.to_string_lossy())
                        .collect::<Vec<_>>()
                        .join(" ")
                        .to_lowercase();
                    (pid.as_u32(), cmd)
                })
                .collect(),
        )
    }

    /// PID'ы процессов профиля: живые из `tracked` + все, чья командная строка
    /// содержит папку данных профиля (браузеры с --user-data-dir / -profile).
    pub fn profile_pids(&self, profile_data_dir: &Path, tracked: &[u32]) -> HashSet<u32> {
        let needle = profile_data_dir.to_string_lossy().to_lowercase();
        self.0
            .iter()
            .filter(|(pid, cmd)| tracked.contains(pid) || cmd.contains(&needle))
            .map(|(pid, _)| *pid)
            .collect()
    }

    pub fn alive(&self, pid: u32) -> bool {
        self.0.iter().any(|(p, _)| *p == pid)
    }
}

struct EnumCtx<'a> {
    pids: &'a HashSet<u32>,
    windows: Vec<HWND>,
}

unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> i32 {
    // SAFETY: lparam — указатель на EnumCtx, живущий на стеке вызывающего на время EnumWindows.
    let ctx = unsafe { &mut *(lparam as *mut EnumCtx) };
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    let top_level = unsafe { GetWindow(hwnd, GW_OWNER) }.is_null();
    if ctx.pids.contains(&pid) && top_level && unsafe { IsWindowVisible(hwnd) } != 0 {
        ctx.windows.push(hwnd);
    }
    1
}

/// Послать WM_CLOSE всем видимым окнам верхнего уровня этих процессов —
/// как будто пользователь нажал «крестик» (браузеры сохранят сессию).
/// Возвращает число закрытых окон.
pub fn close_windows(pids: &HashSet<u32>) -> usize {
    if pids.is_empty() {
        return 0;
    }
    let mut ctx = EnumCtx { pids, windows: Vec::new() };
    unsafe {
        EnumWindows(Some(enum_proc), &mut ctx as *mut EnumCtx as LPARAM);
        for &w in &ctx.windows {
            PostMessageW(w, WM_CLOSE, 0, 0);
        }
    }
    ctx.windows.len()
}
