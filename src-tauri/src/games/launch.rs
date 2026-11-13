//! Launching games.
//!
//! * `Uri` targets go through the real `ShellExecuteW("open")` (declared here via a
//!   direct `shell32` import because windows-sys' `Win32_UI_Shell` feature is not enabled).
//!   This is exactly what Explorer does for `steam://`, `uplay://` etc.: no console window,
//!   no cmd.exe quoting pitfalls with `&` in Epic URIs, no extra process.
//!   If it fails we fall back to `rundll32 url.dll,FileProtocolHandler <uri>`.
//! * `Exe` targets are spawned directly with `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`,
//!   cwd set, stdio nulled, not awaited. If the exe requires elevation (error 740),
//!   we retry with `ShellExecuteW`, which shows the UAC prompt.

use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};

use anyhow::{bail, Context};

use super::util::split_args;
use crate::models::LaunchTarget;

const DETACHED_PROCESS: u32 = 0x0000_0008;
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const ERROR_ELEVATION_REQUIRED: i32 = 740;
const SW_SHOWNORMAL: i32 = 1;

#[link(name = "shell32")]
extern "system" {
    fn ShellExecuteW(
        hwnd: *mut core::ffi::c_void,
        operation: *const u16,
        file: *const u16,
        parameters: *const u16,
        directory: *const u16,
        show_cmd: i32,
    ) -> *mut core::ffi::c_void;
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// ShellExecuteW "open". Returns Err with the ShellExecute code on failure.
fn shell_open(file: &str, params: Option<&str>, dir: Option<&str>) -> anyhow::Result<()> {
    let op = wide("open");
    let f = wide(file);
    let p = params.filter(|p| !p.is_empty()).map(wide);
    let d = dir.filter(|d| !d.is_empty()).map(wide);
    // SAFETY: all pointers are valid NUL-terminated UTF-16 buffers (or null) that outlive the call.
    let r = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            op.as_ptr(),
            f.as_ptr(),
            p.as_ref().map_or(std::ptr::null(), |v| v.as_ptr()),
            d.as_ref().map_or(std::ptr::null(), |v| v.as_ptr()),
            SW_SHOWNORMAL,
        )
    } as isize;
    if r > 32 {
        Ok(())
    } else {
        bail!("ShellExecuteW({file}) failed with code {r}")
    }
}

fn open_uri(uri: &str) -> anyhow::Result<()> {
    match shell_open(uri, None, None) {
        Ok(()) => Ok(()),
        Err(e) => {
            log::warn!("{e}; falling back to rundll32");
            Command::new("rundll32.exe")
                .arg("url.dll,FileProtocolHandler")
                .arg(uri)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .with_context(|| format!("cannot open {uri}"))?;
            Ok(())
        }
    }
}

fn spawn_exe(path: &str, args: &str, cwd: Option<&str>) -> anyhow::Result<()> {
    if !Path::new(path).is_file() {
        bail!("executable not found: {path}");
    }
    let cwd = cwd
        .filter(|c| !c.is_empty() && Path::new(c).is_dir())
        .map(str::to_string)
        .or_else(|| Path::new(path).parent().map(|p| p.to_string_lossy().into_owned()));
    let mut cmd = Command::new(path);
    cmd.args(split_args(args))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    if let Some(c) = &cwd {
        cmd.current_dir(c);
    }
    match cmd.spawn() {
        Ok(_child) => Ok(()), // dropped without waiting: process keeps running
        Err(e) if e.raw_os_error() == Some(ERROR_ELEVATION_REQUIRED) => {
            log::info!("{path} requires elevation, using ShellExecute");
            shell_open(path, Some(args), cwd.as_deref())
        }
        Err(e) => Err(e).with_context(|| format!("cannot start {path}")),
    }
}

/// Launch a game target (ShellExecute for Uri, spawn for Exe with cwd, detached, no console window).
pub fn launch(target: &LaunchTarget) -> anyhow::Result<()> {
    match target {
        LaunchTarget::Uri { uri } => open_uri(uri),
        LaunchTarget::Exe { path, args, cwd } => spawn_exe(path, args, cwd.as_deref()),
    }
}
