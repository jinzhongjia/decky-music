//! ncm-provider:网易云 provider。ncm-api-rs 作库,包一层 UDS + NDJSON server。
//!
//! bridge 作 server,provider 启动后连入 `--socket <path>`。协议与 qq-provider 对齐:
//! 命令 set_credential / login / search / song_url;登录是长流程,以 login 事件上报。
//! 网易云免费歌匿名即可播(登录仅为 VIP/高音质);cookie 由 bridge 注入,provider 无状态。

use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use ncm_api_rs::{create_client, ApiClient, Query};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::{mpsc, Mutex};

mod logging;
use logging::log_json;

type Out = mpsc::UnboundedSender<String>;

#[derive(Deserialize)]
struct Cmd {
    cmd: String,
    id: Option<String>,
    keyword: Option<String>,
    cred: Option<Value>,
}

struct State {
    client: ApiClient, // create_client(None),cookie 走 Query 逐次覆盖
    cookie: Mutex<Option<String>>,
}

impl State {
    async fn cookie(&self) -> Option<String> {
        self.cookie.lock().await.clone()
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let socket = arg("--socket").expect("--socket <path> required");
    let stream = UnixStream::connect(&socket).await?;
    let (rd, mut wr) = stream.into_split();
    let mut lines = BufReader::new(rd).lines();

    let state = Arc::new(State {
        client: create_client(None),
        cookie: Mutex::new(None),
    });
    let debug = std::env::var("DECKY_MUSIC_DEBUG").is_ok(); // release 下不发 debug

    // 单一写出:命令响应 + 事件汇到这里串行写回,避免并发写乱帧
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
    tokio::spawn(async move {
        while let Some(line) = out_rx.recv().await {
            if wr.write_all(line.as_bytes()).await.is_err()
                || wr.write_all(b"\n").await.is_err()
                || wr.flush().await.is_err()
            {
                break;
            }
        }
    });

    // NDJSON:每条一行 {json}\n
    while let Some(line) = lines.next_line().await? {
        let cmd: Cmd = match serde_json::from_str(&line) {
            Ok(c) => c,
            Err(_) => continue,
        };
        if debug {
            let _ = out_tx.send(log_json("debug", "cmd", &cmd.cmd));
        }
        match cmd.cmd.as_str() {
            "set_credential" => {
                let ck = cmd
                    .cred
                    .as_ref()
                    .and_then(|c| c["cookie"].as_str())
                    .map(String::from);
                let msg = if ck.is_some() { "injected" } else { "cleared" };
                *state.cookie.lock().await = ck;
                let _ = out_tx.send(log_json("info", "credential", msg));
                let _ = out_tx.send(r#"{"ok":true}"#.to_string());
            }
            "login" => {
                // 长流程:后台跑,QR 与状态经 login 事件上报;命令本身即刻返 ok
                let (st, tx) = (state.clone(), out_tx.clone());
                tokio::spawn(async move { login_flow(st, tx).await });
                let _ = out_tx.send(r#"{"ok":true}"#.to_string());
            }
            "search" => {
                let _ = out_tx.send(search(&state, cmd.keyword.as_deref().unwrap_or("")).await);
            }
            "song_url" => {
                let _ =
                    out_tx.send(song_url(&state, cmd.id.as_deref().unwrap_or(""), &out_tx).await);
            }
            _ => {
                let _ = out_tx.send(r#"{"ok":false,"msg":"unknown cmd"}"#.to_string());
            }
        }
    }
    Ok(())
}

async fn search(state: &State, keyword: &str) -> String {
    let mut q = Query::new()
        .param("keywords", keyword)
        .param("type", "1")
        .param("limit", "30");
    if let Some(c) = state.cookie().await {
        q = q.cookie(&c);
    }
    match state.client.cloudsearch(&q).await {
        Ok(r) => {
            let songs: Vec<Value> = r.body["result"]["songs"]
                .as_array()
                .map(|arr| arr.iter().map(song_brief).collect())
                .unwrap_or_default();
            json!({ "ok": true, "songs": songs }).to_string()
        }
        Err(e) => json!({ "ok": false, "msg": e.to_string() }).to_string(),
    }
}

fn song_brief(s: &Value) -> Value {
    let singer = s["ar"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| x["name"].as_str())
                .collect::<Vec<_>>()
                .join(" / ")
        })
        .unwrap_or_default();
    json!({
        "mid": s["id"].as_i64().map(|i| i.to_string()).unwrap_or_default(),
        "name": s["name"].as_str().unwrap_or(""),
        "singer": singer,
        "media_mid": "",
    })
}

async fn song_url(state: &State, id: &str, tx: &Out) -> String {
    let mut q = Query::new().param("id", id).param("level", "standard");
    if let Some(c) = state.cookie().await {
        q = q.cookie(&c);
    }
    match state.client.song_url_v1(&q).await {
        Ok(r) => {
            // 不记 URL(含限时 vkey)
            match r.body["data"][0]["url"].as_str() {
                Some(url) if !url.is_empty() => json!({ "ok": true, "url": url }).to_string(),
                _ => {
                    let _ = tx.send(log_json(
                        "warn",
                        "song_url",
                        &format!("no url id={id} (VIP/无版权)"),
                    ));
                    json!({ "ok": false, "msg": "无可播 URL(无版权/需 VIP)" }).to_string()
                }
            }
        }
        Err(e) => json!({ "ok": false, "msg": e.to_string() }).to_string(),
    }
}

// ---- 扫码登录 ----

fn emit(tx: &Out, status: &str, extra: Value) {
    let mut obj = json!({ "ev": "login", "status": status });
    if let Value::Object(m) = extra {
        for (k, v) in m {
            obj[k] = v;
        }
    }
    let _ = tx.send(obj.to_string());
}

async fn login_flow(state: Arc<State>, tx: Out) {
    // 1. 取 unikey
    let key = match state.client.login_qr_key(&Query::new()).await {
        Ok(r) => r.body["unikey"].as_str().unwrap_or("").to_string(),
        Err(e) => return login_fail(&tx, &e.to_string()),
    };
    if key.is_empty() {
        return login_fail(&tx, "empty unikey");
    }
    // 2. 生成二维码 URL(库只给 qrurl,不出图)
    let qrurl = match state
        .client
        .login_qr_create(&Query::new().param("key", &key))
        .await
    {
        Ok(r) => r.body["data"]["qrurl"].as_str().unwrap_or("").to_string(),
        Err(e) => return login_fail(&tx, &e.to_string()),
    };
    // 3. 本地渲染二维码 → base64 SVG → 发给 UI
    match make_qr(&qrurl) {
        Ok(b64) => emit(
            &tx,
            "qrcode",
            json!({ "qr": b64, "mimetype": "image/svg+xml" }),
        ),
        Err(e) => return login_fail(&tx, &format!("qr render: {e}")),
    }
    // 4. 轮询扫码状态:800 过期 / 801 待扫 / 802 已扫 / 803 成功
    loop {
        tokio::time::sleep(Duration::from_secs(2)).await;
        let r = match state
            .client
            .login_qr_check(&Query::new().param("key", &key))
            .await
        {
            Ok(r) => r,
            Err(e) => return login_fail(&tx, &e.to_string()),
        };
        match r.body["code"].as_i64().unwrap_or(0) {
            803 => {
                // Set-Cookie 列表 → "name=value; name=value"(create_client / Query.cookie 用)
                let cookie = r
                    .cookie
                    .iter()
                    .filter_map(|c| c.split(';').next())
                    .collect::<Vec<_>>()
                    .join("; ");
                *state.cookie.lock().await = Some(cookie.clone());
                emit(&tx, "done", json!({ "cred": { "cookie": cookie } }));
                return;
            }
            800 => return emit(&tx, "timeout", json!({})),
            802 => emit(&tx, "scanned", json!({})),
            _ => emit(&tx, "waiting", json!({})),
        }
    }
}

fn login_fail(tx: &Out, err: &str) {
    let _ = tx.send(log_json("error", "login", err));
    emit(tx, "timeout", json!({})); // 对 UI 统一报可重试
}

fn make_qr(url: &str) -> Result<String, Box<dyn std::error::Error>> {
    let code = qrcode::QrCode::new(url.as_bytes())?;
    let svg = code
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(200, 200)
        .build();
    Ok(base64::engine::general_purpose::STANDARD.encode(svg))
}

fn arg(flag: &str) -> Option<String> {
    let mut args = std::env::args();
    while let Some(a) = args.next() {
        if a == flag {
            return args.next();
        }
    }
    None
}
