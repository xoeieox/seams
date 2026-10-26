// seams-launcher - the Tauri 2 native window around the loopback launcher (eom/launcher).
//
// Contract (launcher-as-app ruling, Erah 2026-10-26 16:11 PDT - "like Kyma"):
//   * the window shows the SAME PWA the browser gets: http://127.0.0.1:PORT (default 4173)
//     served by server.mjs, same-origin proxy to node-one. One codebase, zero fork.
//   * the app brings up its own node: on startup we spawn `node launch.mjs` unless the
//     port is already answered (a server we did not start is never ours to stop), and on
//     window close we SIGTERM then SIGKILL exactly what we spawned - the same reap
//     discipline launch.mjs holds for its own children.
//   * no node? the window shows an honest 'Node.js required' panel (never a blank white
//     webview), matching the README ladder of truth.
//   * loopback only: this shell dials nothing but 127.0.0.1 and fetches nothing external.
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{http::Response, Manager, Url, WebviewUrl, WebviewWindowBuilder};

const TITLE: &str = "Seams Launcher";
const WIDTH: f64 = 380.0; // the 2a shape from the design pass
const HEIGHT: f64 = 640.0;
const MIN_WIDTH: f64 = 360.0; // not resizable below 360
const MIN_HEIGHT: f64 = 560.0;
const DEFAULT_PORT: u16 = 4173;
const REAP_GRACE: Duration = Duration::from_secs(3);
const PORT_DEADLINE: Duration = Duration::from_secs(10);

/// Only the child THIS process spawned. Servers started by anyone else stay theirs.
struct Sidecar(Mutex<Option<Child>>);

fn port_up(p: u16) -> bool {
    TcpStream::connect_timeout(
        &SocketAddr::from((Ipv4Addr::LOCALHOST, p)),
        Duration::from_millis(250),
    )
    .is_ok()
}

fn node_present() -> bool {
    Command::new("node")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Locate launch.mjs: explicit SEAMS_LAUNCHER_DIR wins; else walk up from the exe
/// (dev builds live under tauri/src-tauri/target/...) and from the cwd (a built .app
/// launched from inside the checkout). The bundled-runtime tier (November) replaces
/// this ladder with packaged resources; v0 is honest about running from a checkout.
fn launch_mjs() -> Option<(PathBuf, PathBuf)> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(d) = std::env::var("SEAMS_LAUNCHER_DIR") {
        roots.push(PathBuf::from(d));
    }
    if let Ok(exe) = std::env::current_exe() {
        roots.extend(exe.ancestors().map(PathBuf::from));
    }
    if let Ok(cwd) = std::env::current_dir() {
        roots.extend(cwd.ancestors().map(PathBuf::from));
    }
    for r in roots {
        for cand in [r.join("launch.mjs"), r.join("eom/launcher/launch.mjs")] {
            if cand.is_file() {
                let dir = cand.parent().map(Path::to_path_buf).unwrap_or_else(|| r.clone());
                return Some((dir, cand));
            }
        }
    }
    None
}

fn spawn_sidecar(dir: &Path, mjs: &Path) -> std::io::Result<Child> {
    Command::new("node")
        .arg(mjs)
        .current_dir(dir)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
}

/// SIGTERM first (launch.mjs reaps its own children on SIGTERM), SIGKILL after a grace.
/// A child that already exited (the port-busy reuse path) is left alone - it owns nothing.
fn reap(state: &tauri::AppHandle) {
    let Some(sidecar) = state.try_state::<Sidecar>() else {
        return;
    };
    let Ok(mut guard) = sidecar.0.lock() else { return };
    let Some(mut child) = guard.take() else { return };
    if matches!(child.try_wait(), Ok(Some(_)) | Err(_)) {
        return;
    }
    let pid = child.id().to_string();
    let _ = Command::new("kill").args(["-TERM", &pid]).status();
    let deadline = Instant::now() + REAP_GRACE;
    while !matches!(child.try_wait(), Ok(Some(_))) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(100));
    }
    if !matches!(child.try_wait(), Ok(Some(_))) {
        let _ = Command::new("kill").args(["-KILL", &pid]).status();
        let _ = child.wait();
    }
}

// The honest failure panels, served by the seams:// custom protocol: a missing node
// can never produce a blank white window - no server, no devUrl, still a real page.
// (Styling mirrors the shipped theme token #18191b; static text only.)
const PANEL_CSS: &str = "body{background:#18191b;color:#e8e6e3;font:15px/1.6 system-ui,sans-serif;margin:0;padding:40px 28px}h1{font-size:19px;margin:0 0 14px}code{background:#24262b;padding:2px 6px;border-radius:4px}.dim{color:#9a9894}.card{border:1px solid #2c2e33;border-radius:10px;padding:18px 20px}";

const PANEL_NODE: &str = r#"<!doctype html><html><head><meta charset="utf-8"><title>Seams Launcher</title><style>body{background:#18191b;color:#e8e6e3;font:15px/1.6 system-ui,sans-serif;margin:0;padding:40px 28px}h1{font-size:19px;margin:0 0 14px}code{background:#24262b;padding:2px 6px;border-radius:4px}.dim{color:#9a9894}.card{border:1px solid #2c2e33;border-radius:10px;padding:18px 20px}</style></head><body><h1>Node.js required</h1><div class="card">
<p>The Seams Launcher runs on <strong>Node 18+</strong> - and on nothing else. Zero npm
runtime dependencies, no accounts, no network: everything stays on 127.0.0.1.</p>
<p>Install Node (nodejs.org, or your package manager), then relaunch.</p>
<p class="dim">No Node handy? The terminal rung still works: <code>cd eom/launcher &amp;&amp; node launch.mjs</code>,
then open the printed URL in any browser - the README's ladder of truth walks the rest.</p>
</div></body></html>"#;

const PANEL_STUCK: &str = r#"<!doctype html><html><head><meta charset="utf-8"><title>Seams Launcher</title><style>body{background:#18191b;color:#e8e6e3;font:15px/1.6 system-ui,sans-serif;margin:0;padding:40px 28px}h1{font-size:19px;margin:0 0 14px}code{background:#24262b;padding:2px 6px;border-radius:4px}.dim{color:#9a9894}.card{border:1px solid #2c2e33;border-radius:10px;padding:18px 20px}</style></head><body><h1>The launcher server did not answer</h1><div class="card">
<p>Node is installed, but nothing came up on <code>127.0.0.1</code> in time.</p>
<p>From the checkout: <code>cd eom/launcher &amp;&amp; node launch.mjs</code> - it prints exactly
what is wrong, and reuses anything already running.</p>
<p class="dim">If the launcher lives somewhere unusual, set <code>SEAMS_LAUNCHER_DIR</code>
to the directory holding launch.mjs and relaunch.</p>
</div></body></html>"#;

fn html_panel(body: &'static str) -> Response<Vec<u8>> {
    let mut resp = Response::new(body.as_bytes().to_vec());
    *resp.status_mut() = tauri::http::StatusCode::OK;
    resp.headers_mut().insert(
        tauri::http::header::CONTENT_TYPE,
        tauri::http::HeaderValue::from_static("text/html; charset=utf-8"),
    );
    resp
}

pub fn run() {
    tauri::Builder::default()
        .manage(Sidecar(Mutex::new(None)))
        // asynchronous variant: WKWebView requires the responder hop on macOS.
        .register_asynchronous_uri_scheme_protocol("seams", |_ctx, req, responder| {
            let body = if req.uri().path().contains("stuck") { PANEL_STUCK } else { PANEL_NODE };
            responder.respond(html_panel(body));
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let handle = window.app_handle().clone();
                reap(&handle);
            }
        })
        .setup(|app| {
            let p: u16 = std::env::var("PORT")
                .ok()
                .and_then(|v| v.trim().parse().ok())
                .unwrap_or(DEFAULT_PORT);
            let handle = app.handle().clone();
            let have_node = node_present();
            if !port_up(p) && have_node {
                if let Some((dir, mjs)) = launch_mjs() {
                    if let Ok(child) = spawn_sidecar(&dir, &mjs) {
                        if let Some(sidecar) = handle.try_state::<Sidecar>() {
                            if let Ok(mut guard) = sidecar.0.lock() {
                                *guard = Some(child);
                            }
                        }
                    }
                }
                let deadline = Instant::now() + PORT_DEADLINE;
                while !port_up(p) && Instant::now() < deadline {
                    std::thread::sleep(Duration::from_millis(150));
                }
            }
            let url = if port_up(p) {
                Url::parse(&format!("http://127.0.0.1:{p}/")).expect("loopback url parses")
            } else if have_node {
                Url::parse("seams://localhost/stuck").expect("static panel url parses")
            } else {
                Url::parse("seams://localhost/node-missing").expect("static panel url parses")
            };
            // v0: centered placement (the ruling allows it); bottom-right anchoring is
            // a noted next step, native decorations throughout.
            WebviewWindowBuilder::new(&handle, "main", WebviewUrl::External(url))
                .title(TITLE)
                .inner_size(WIDTH, HEIGHT)
                .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
                .resizable(true)
                .decorations(true)
                .center()
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Seams Launcher")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                reap(app);
            }
        });
}
