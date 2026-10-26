// Seams Launcher - native window binary. All logic lives in lib.rs (app_lib::run),
// per the Tauri 2 convention so the same core can back mobile targets later.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    app_lib::run()
}
