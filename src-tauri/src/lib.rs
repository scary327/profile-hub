mod browsers;
mod commands;
mod config;
mod core;
mod desktop;
mod gamepad;
mod games;
mod models;
mod processes;
mod util;
mod winusers;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::WindowEvent;

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Открыть хаб", true, None::<&str>)?;
    let game = MenuItem::with_id(app, "game", "Игровой режим", true, None::<&str>)?;
    let rescan = MenuItem::with_id(app, "rescan", "Найти браузеры заново", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &game, &rescan, &sep, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().expect("нет иконки"))
        .tooltip("Profile Hub")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| {
            let app = app.clone();
            match ev.id().as_ref() {
                "open" => core::show_hub(&app),
                "game" => {
                    std::thread::spawn(move || {
                        if let Err(e) = core::enter_game_mode(&app) {
                            log::error!("игровой режим: {e}");
                        }
                    });
                }
                "rescan" => {
                    commands::refresh_browsers(&app);
                    core::emit_state(&app);
                }
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = ev
            {
                core::toggle_hub(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            core::show_hub(app);
        }))
        .plugin(
            // лог в %LOCALAPPDATA%\tech.profilehub.app\logs
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(core::AppState::new())
        .setup(|app| {
            setup_tray(app)?;
            let handle = app.handle().clone();
            let failed = core::register_hotkeys(&handle);
            if !failed.is_empty() {
                log::warn!("не удалось занять хоткеи: {failed:?}");
            }
            // --autostart: запуск при входе в Windows (ключ Run, который ставит установщик)
            let at_sign_in = std::env::args().any(|a| a == "--autostart" || a == "--minimized");
            {
                let h = handle.clone();
                std::thread::spawn(move || core::on_session_start(&h, at_sign_in));
            }
            gamepad::spawn(handle.clone());
            // прогреть кэш игр в фоне
            std::thread::spawn(move || {
                core::games(&handle, false);
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // «крестик» прячет окно в трей, а не закрывает приложение
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::new_profile_template,
            commands::save_profile,
            commands::delete_profile,
            commands::switch_profile,
            commands::save_settings,
            commands::launch_browser,
            commands::launch_app,
            commands::close_profile_apps,
            commands::open_projects_dir,
            commands::list_projects,
            commands::create_project,
            commands::open_in_editor,
            commands::open_path,
            commands::list_games,
            commands::launch_game,
            commands::list_launchers,
            commands::launch_launcher,
            commands::add_manual_game,
            commands::remove_manual_game,
            commands::enter_game_mode,
            commands::exit_game_mode,
            commands::hide_hub,
            commands::quit_app,
            commands::debug_log,
            commands::get_gamepad_info,
            commands::create_windows_user,
            commands::link_current_user,
            commands::link_windows_user,
            commands::unlink_windows_user,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
