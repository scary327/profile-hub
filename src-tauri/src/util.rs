//! Запуск процессов без консольного окна.

use anyhow::{Context, Result};
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const DETACHED_PROCESS: u32 = 0x0000_0008;
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

/// Разбить строку аргументов с учётом кавычек.
pub fn split_args(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut has = false;
    for c in s.chars() {
        match c {
            '"' => {
                in_quotes = !in_quotes;
                has = true;
            }
            c if c.is_whitespace() && !in_quotes => {
                if has {
                    out.push(std::mem::take(&mut cur));
                    has = false;
                }
            }
            c => {
                cur.push(c);
                has = true;
            }
        }
    }
    if has {
        out.push(cur);
    }
    out
}

/// Запустить программу отвязанно и вернуть PID.
/// .lnk/.bat/.cmd и прочие не-exe открываются через `cmd /C start`.
pub fn spawn_detached(path: &str, args: &[String], cwd: Option<&Path>) -> Result<u32> {
    let p = Path::new(path);
    let is_exe = p
        .extension()
        .map(|e| e.eq_ignore_ascii_case("exe"))
        .unwrap_or(false);

    let mut cmd = if is_exe {
        let mut c = Command::new(p);
        c.args(args);
        c.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
        c
    } else {
        let mut c = Command::new("cmd");
        c.arg("/C").arg("start").arg("").arg(path).args(args);
        c.creation_flags(CREATE_NO_WINDOW);
        c
    };
    let dir = cwd
        .map(|d| d.to_path_buf())
        .or_else(|| p.parent().map(|d| d.to_path_buf()))
        .filter(|d| d.is_dir());
    if let Some(d) = dir {
        cmd.current_dir(d);
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    let child = cmd
        .spawn()
        .with_context(|| format!("не удалось запустить {path}"))?;
    Ok(child.id())
}

/// Открыть папку/файл/URI в оболочке Windows.
pub fn shell_open(target: &str) -> Result<()> {
    Command::new("explorer.exe")
        .arg(target)
        .spawn()
        .with_context(|| format!("не удалось открыть {target}"))?;
    Ok(())
}

/// Открыть папку в VS Code, если он установлен, иначе в Проводнике.
pub fn open_in_editor(path: &str) -> Result<()> {
    let candidates = [
        dirs::data_local_dir().map(|d| d.join("Programs\\Microsoft VS Code\\Code.exe")),
        Some(std::path::PathBuf::from("C:\\Program Files\\Microsoft VS Code\\Code.exe")),
        dirs::data_local_dir().map(|d| d.join("Programs\\cursor\\Cursor.exe")),
    ];
    for c in candidates.into_iter().flatten() {
        if c.is_file() {
            spawn_detached(&c.to_string_lossy(), &[path.to_string()], None)?;
            return Ok(());
        }
    }
    // `code` в PATH (например, установка через scoop)
    let ok = Command::new("cmd")
        .args(["/C", "where", "code"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if ok {
        Command::new("cmd")
            .args(["/C", "code", path])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()?;
        return Ok(());
    }
    shell_open(path)
}

pub fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::split_args;

    #[test]
    fn splits_quoted() {
        assert_eq!(
            split_args(r#"-a "b c" d"#),
            vec!["-a".to_string(), "b c".into(), "d".into()]
        );
        assert!(split_args("   ").is_empty());
        assert_eq!(split_args(r#""""#), vec![String::new()]);
    }
}
