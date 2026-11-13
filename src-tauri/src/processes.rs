//! Аккуратное закрытие программ, запущенных хабом в текущей учётке.

use std::collections::HashSet;
use windows_sys::Win32::Foundation::{HWND, LPARAM};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindow, GetWindowThreadProcessId, IsWindowVisible, PostMessageW, GW_OWNER,
    WM_CLOSE,
};

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

/// Послать WM_CLOSE видимым окнам этих процессов — как «крестик».
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
