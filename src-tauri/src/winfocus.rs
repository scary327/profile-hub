//! Передний план окон. Windows не даёт процессу забрать фокус, если последний ввод
//! был не его (у нас ввод приходит с геймпада по HID, а не через клавиатуру/мышь),
//! поэтому SetForegroundWindow сам по себе часто не срабатывает и игра остаётся активной —
//! тогда геймпадом управляются сразу и игра, и меню. Решение: временно присоединить
//! поток к потоку активного окна (AttachThreadInput).

use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, GetAncestor, GetForegroundWindow, GetWindowThreadProcessId, IsIconic,
    SetForegroundWindow, ShowWindow, GA_ROOTOWNER, SW_RESTORE, SW_SHOW,
};

pub fn hwnd_from(raw: isize) -> HWND {
    raw as HWND
}

/// Сделать окно активным даже если сейчас активна другая программа (игра).
pub fn force_foreground(hwnd: HWND) {
    unsafe {
        let fg = GetForegroundWindow();
        if fg == hwnd {
            return;
        }
        let me = GetCurrentThreadId();
        let fg_thread = if fg.is_null() { 0 } else { GetWindowThreadProcessId(fg, std::ptr::null_mut()) };
        let attached = fg_thread != 0 && fg_thread != me && AttachThreadInput(me, fg_thread, 1) != 0;
        ShowWindow(hwnd, if IsIconic(hwnd) != 0 { SW_RESTORE } else { SW_SHOW });
        BringWindowToTop(hwnd);
        SetForegroundWindow(hwnd);
        if attached {
            AttachThreadInput(me, fg_thread, 0);
        }
    }
}

/// Активно окно `root` или окно, которым оно владеет (например, пристыкованный Discord).
pub fn is_foreground_tree(root: HWND) -> bool {
    unsafe {
        let fg = GetForegroundWindow();
        if fg.is_null() {
            return false;
        }
        fg == root || GetAncestor(fg, GA_ROOTOWNER) == root
    }
}
