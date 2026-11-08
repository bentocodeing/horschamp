//! Higgsfield REST client. The key lives only inside this struct; it is never logged,
//! never put in a URL, and never sent to the presigned upload host.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::time::Duration;

pub const DEFAULT_BASE: &str = "https://api.higgsfield.ai";

#[derive(Clone)]
pub struct HfClient {
    http: reqwest::Client,
    base: String,
    key: String,
}

impl std::fmt::Debug for HfClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HfClient")
            .field("base", &self.base)
            .field("key", &"<redacted>")
            .finish()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SubmitResponse {
    pub request_id: String,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub status_url: Option<String>,
    #[serde(default)]
    pub cancel_url: Option<String>,
    #[serde(default)]
    pub expires_after: Option<u64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RemoteStatus {
    Queued,
    InProgress,
    Completed,
    Failed,
    Nsfw,
    Canceled,
    NotReady,
}

impl RemoteStatus {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "queued" => Self::Queued,
            "in_progress" | "running" | "processing" => Self::InProgress,
            "completed" | "succeeded" => Self::Completed,
            "failed" | "error" => Self::Failed,
            "nsfw" => Self::Nsfw,
            "canceled" | "cancelled" => Self::Canceled,
            "not_ready" => Self::NotReady,
            _ => return None,
        })
    }
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Failed | Self::Nsfw | Self::Canceled
        )
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct OutputFile {
    pub url: String,
    pub kind: String, // image | video | audio | file
}

#[derive(Debug, Clone, Serialize)]
pub struct StatusResponse {
    pub status: RemoteStatus,
    pub error: Option<String>,
    pub outputs: Vec<OutputFile>,
    pub raw: Value,
}

impl StatusResponse {
    pub fn from_json(v: Value) -> AppResult<Self> {
        let s = v.get("status").and_then(Value::as_str).unwrap_or("");
        let status = RemoteStatus::parse(s)
            .ok_or_else(|| AppError::Other(format!("unknown status '{s}'")))?;
        let error = match v.get("error") {
            Some(Value::String(s)) => Some(s.clone()),
            Some(Value::Null) | None => None,
            Some(other) => Some(other.to_string()),
        };
        Ok(Self {
            status,
            error,
            outputs: extract_outputs(&v),
            raw: v,
        })
    }
}

/// Collect output URLs from the status body (`images[]`, `video`, `videos[]`, `audio`, `audios[]`,
/// plus extra artifacts). Also handles the webhook-style `payload` wrapper.
pub fn extract_outputs(v: &Value) -> Vec<OutputFile> {
    let src = v.get("payload").filter(|p| p.is_object()).unwrap_or(v);
    let mut out = Vec::new();
    let mut add = |val: Option<&Value>, kind: &str| {
        let push_one = |out: &mut Vec<OutputFile>, x: &Value| {
            let url = x.get("url").and_then(Value::as_str).or_else(|| x.as_str());
            if let Some(u) = url {
                if !out.iter().any(|o: &OutputFile| o.url == u) {
                    out.push(OutputFile {
                        url: u.to_string(),
                        kind: kind.to_string(),
                    });
                }
            }
        };
        match val {
            Some(Value::Array(a)) => a.iter().for_each(|x| push_one(&mut out, x)),
            Some(x @ Value::Object(_)) | Some(x @ Value::String(_)) => push_one(&mut out, x),
            _ => {}
        }
    };
    add(src.get("images"), "image");
    add(src.get("image"), "image");
    add(src.get("video"), "video");
    add(src.get("videos"), "video");
    add(src.get("audio"), "audio");
    add(src.get("audios"), "audio");
    for k in ["zip", "mov", "jsx", "fbx", "ply"] {
        add(src.get(k), "file");
    }
    out
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadTicket {
    pub public_url: String,
    pub upload_url: String,
    #[serde(default)]
    pub upload_headers: Map<String, Value>,
}

fn detail_text(v: &Value) -> String {
    match v.get("detail") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Object(o)) => o
            .get("message")
            .and_then(Value::as_str)
            .map(String::from)
            .unwrap_or_else(|| Value::Object(o.clone()).to_string()),
        Some(Value::Array(a)) => a
            .iter()
            .map(|e| {
                let loc = e.get("loc").and_then(Value::as_array).map(|l| {
                    l.iter()
                        .filter_map(|x| {
                            x.as_str().map(String::from).or_else(|| Some(x.to_string()))
                        })
                        .collect::<Vec<_>>()
                        .join(".")
                });
                let msg = e.get("msg").and_then(Value::as_str).unwrap_or("invalid");
                match loc {
                    Some(l) => format!("{l}: {msg}"),
                    None => msg.to_string(),
                }
            })
            .collect::<Vec<_>>()
            .join("; "),
        Some(other) => other.to_string(),
        None => v.to_string(),
    }
}

/// Map an HTTP error response to an AppError.
pub fn map_error(status: u16, body: &str, retry_after: Option<u64>) -> AppError {
    let v: Value =
        serde_json::from_str(body).unwrap_or(Value::String(body.chars().take(300).collect()));
    match status {
        401 => AppError::Unauthorized,
        403 => AppError::InsufficientBalance,
        429 => {
            let secs = retry_after
                .or_else(|| {
                    v.pointer("/detail/retry_after_seconds")
                        .and_then(Value::as_u64)
                })
                .unwrap_or(30);
            AppError::QueueFull(secs)
        }
        423 | 503 => AppError::ModelBlocked(status),
        _ => AppError::Api {
            status,
            detail: if v.is_string() {
                v.as_str().unwrap().to_string()
            } else {
                detail_text(&v)
            },
        },
    }
}

impl HfClient {
    pub fn new(key: String) -> Self {
        Self::with_base(key, DEFAULT_BASE.to_string())
    }

    pub fn with_base(key: String, base: String) -> Self {
        let http = reqwest::Client::builder()
            .user_agent(concat!("horschamp/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(120))
            .build()
            .expect("http client");
        Self {
            http,
            base: base.trim_end_matches('/').to_string(),
            key,
        }
    }

    fn auth(&self) -> String {
        format!("Key {}", self.key)
    }

    fn url(&self, path: &str) -> String {
        format!("{}/{}", self.base, path.trim_start_matches('/'))
    }

    async fn send_json(&self, req: reqwest::RequestBuilder) -> AppResult<Value> {
        let resp = req.header("Authorization", self.auth()).send().await?;
        let status = resp.status().as_u16();
        let retry_after = resp
            .headers()
            .get("retry-after")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.parse().ok());
        let text = resp.text().await?;
        if !(200..300).contains(&status) {
            return Err(map_error(status, &text, retry_after));
        }
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }
        Ok(serde_json::from_str(&text)?)
    }

    pub async fn submit(
        &self,
        model_id: &str,
        body: &Map<String, Value>,
        idempotency_key: &str,
    ) -> AppResult<SubmitResponse> {
        let req = self
            .http
            .post(self.url(model_id))
            .header("Idempotency-Key", idempotency_key)
            .json(body);
        let v = self.send_json(req).await?;
        Ok(serde_json::from_value(v)?)
    }

    pub async fn status(&self, request_id: &str) -> AppResult<StatusResponse> {
        let v = self
            .send_json(
                self.http
                    .get(self.url(&format!("requests/{request_id}/status"))),
            )
            .await?;
        StatusResponse::from_json(v)
    }

    /// Returns Ok(true) if canceled, Ok(false) if it already started (400).
    pub async fn cancel(&self, request_id: &str) -> AppResult<bool> {
        match self
            .send_json(
                self.http
                    .post(self.url(&format!("requests/{request_id}/cancel"))),
            )
            .await
        {
            Ok(_) => Ok(true),
            Err(AppError::Api { status: 400, .. }) => Ok(false),
            Err(e) => Err(e),
        }
    }

    pub async fn delete_request(&self, request_id: &str) -> AppResult<()> {
        self.send_json(
            self.http
                .delete(self.url(&format!("requests/{request_id}"))),
        )
        .await
        .map(|_| ())
    }

    /// Price estimate in USD for the given body.
    pub async fn estimate(&self, model_id: &str, body: &Map<String, Value>) -> AppResult<f64> {
        let v = self
            .send_json(
                self.http
                    .post(self.url(&format!("estimate/{model_id}")))
                    .json(body),
            )
            .await?;
        let usd = v
            .get("usd")
            .ok_or_else(|| AppError::Other("estimate response had no usd".into()))?;
        usd.as_f64()
            .or_else(|| usd.as_str().and_then(|s| s.parse().ok()))
            .ok_or_else(|| AppError::Other("estimate usd is not a number".into()))
    }

    /// `GET /models/usage`. Range must be ≤31 days. Returns the raw JSON.
    pub async fn usage(&self, start: &str, end: &str) -> AppResult<Value> {
        let req = self.http.get(self.url("models/usage")).query(&[
            ("start", start),
            ("end", end),
            ("timeframe", "day"),
            ("expand", "time_series"),
            ("limit", "100"),
        ]);
        self.send_json(req).await
    }

    pub async fn upload(&self, bytes: Vec<u8>, content_type: &str) -> AppResult<String> {
        let v = self
            .send_json(
                self.http
                    .post(self.url("files/generate-upload-url"))
                    .json(&serde_json::json!({"content_type": content_type})),
            )
            .await?;
        let t: UploadTicket = serde_json::from_value(v)?;
        // Presigned PUT: no Authorization header.
        let mut put = self.http.put(&t.upload_url).body(bytes);
        if t.upload_headers.is_empty() {
            put = put.header("Content-Type", content_type);
        }
        for (k, v) in &t.upload_headers {
            if let Some(s) = v.as_str() {
                put = put.header(k.as_str(), s);
            }
        }
        let resp = put.send().await?;
        if !resp.status().is_success() {
            let code = resp.status().as_u16();
            return Err(AppError::Api {
                status: code,
                detail: "upload to storage failed".into(),
            });
        }
        Ok(t.public_url)
    }

    /// Download an output URL (CDN, no auth).
    pub async fn download(&self, url: &str) -> AppResult<reqwest::Response> {
        let resp = self
            .http
            .get(url)
            .timeout(Duration::from_secs(600))
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(AppError::Api {
                status: resp.status().as_u16(),
                detail: "download failed".into(),
            });
        }
        Ok(resp)
    }
}

/// Sum spend from a `/models/usage` response. Tolerates both flat `results` and `time_series[].results`.
pub fn sum_usage(v: &Value) -> (f64, Vec<(String, f64)>) {
    let mut by_model: std::collections::BTreeMap<String, f64> = Default::default();
    let mut visit = |results: &Value| {
        if let Some(a) = results.as_array() {
            for r in a {
                let cost = r
                    .get("cost")
                    .and_then(|c| {
                        c.as_f64()
                            .or_else(|| c.as_str().and_then(|s| s.parse().ok()))
                    })
                    .unwrap_or(0.0);
                let model = r
                    .get("model")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_string();
                *by_model.entry(model).or_default() += cost;
            }
        }
    };
    if let Some(ts) = v.get("time_series").and_then(Value::as_array) {
        for bucket in ts {
            visit(bucket.get("results").unwrap_or(&Value::Null));
        }
    } else if let Some(r) = v.get("results") {
        visit(r);
    }
    let total = by_model.values().sum();
    (total, by_model.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use wiremock::matchers::{body_json, header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn client(server: &MockServer) -> HfClient {
        HfClient::with_base("kid:ksecret".into(), server.uri())
    }

    #[tokio::test]
    async fn submit_sends_auth_and_idempotency() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/higgsfield-ai/soul/v2/standard"))
            .and(header("Authorization", "Key kid:ksecret"))
            .and(header("Idempotency-Key", "idem-1"))
            .and(body_json(json!({"prompt":"lake"})))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "status":"queued","request_id":"r1","status_url":"u","cancel_url":"c","expires_after":604800})))
            .expect(1)
            .mount(&server)
            .await;
        let body = json!({"prompt":"lake"}).as_object().unwrap().clone();
        let r = client(&server)
            .submit("higgsfield-ai/soul/v2/standard", &body, "idem-1")
            .await
            .unwrap();
        assert_eq!(r.request_id, "r1");
        assert_eq!(r.expires_after, Some(604800));
    }

    #[tokio::test]
    async fn maps_error_codes() {
        let server = MockServer::start().await;
        Mock::given(path("/m401"))
            .respond_with(ResponseTemplate::new(401).set_body_json(json!({"detail":"bad"})))
            .mount(&server)
            .await;
        Mock::given(path("/m403"))
            .respond_with(ResponseTemplate::new(403).set_body_json(json!({"detail":"no money"})))
            .mount(&server)
            .await;
        Mock::given(path("/m429"))
            .respond_with(ResponseTemplate::new(429).set_body_json(
                json!({"detail":{"code":"account_queue_full","retry_after_seconds":12}}),
            ))
            .mount(&server)
            .await;
        Mock::given(path("/m422"))
            .respond_with(
                ResponseTemplate::new(422)
                    .set_body_json(json!({"detail":[{"loc":["body","duration"],"msg":"too big"}]})),
            )
            .mount(&server)
            .await;
        let c = client(&server);
        let b = Map::new();
        assert!(matches!(
            c.submit("m401", &b, "k").await,
            Err(AppError::Unauthorized)
        ));
        assert!(matches!(
            c.submit("m403", &b, "k").await,
            Err(AppError::InsufficientBalance)
        ));
        assert!(matches!(
            c.submit("m429", &b, "k").await,
            Err(AppError::QueueFull(12))
        ));
        match c.submit("m422", &b, "k").await {
            Err(AppError::Api {
                status: 422,
                detail,
            }) => assert_eq!(detail, "body.duration: too big"),
            other => panic!("{other:?}"),
        }
    }

    #[tokio::test]
    async fn retry_after_header_wins() {
        let server = MockServer::start().await;
        Mock::given(path("/q"))
            .respond_with(
                ResponseTemplate::new(429)
                    .insert_header("Retry-After", "7")
                    .set_body_string("busy"),
            )
            .mount(&server)
            .await;
        assert!(matches!(
            client(&server).submit("q", &Map::new(), "k").await,
            Err(AppError::QueueFull(7))
        ));
    }

    #[tokio::test]
    async fn status_parses_outputs() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/requests/r1/status"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "status":"completed","request_id":"r1","images":[{"url":"https://cdn/a.jpg"},{"url":"https://cdn/b.jpg"}]})))
            .mount(&server)
            .await;
        let s = client(&server).status("r1").await.unwrap();
        assert_eq!(s.status, RemoteStatus::Completed);
        assert_eq!(s.outputs.len(), 2);
        assert_eq!(s.outputs[0].kind, "image");
    }

    #[test]
    fn extracts_video_and_payload_outputs() {
        let v = json!({"status":"completed","video":{"url":"https://cdn/v.mp4"},"audios":[{"url":"https://cdn/a.wav"}]});
        let o = extract_outputs(&v);
        assert_eq!(
            o,
            vec![
                OutputFile {
                    url: "https://cdn/v.mp4".into(),
                    kind: "video".into()
                },
                OutputFile {
                    url: "https://cdn/a.wav".into(),
                    kind: "audio".into()
                },
            ]
        );
        let w = json!({"payload":{"images":[{"url":"https://cdn/x.png"}]}});
        assert_eq!(extract_outputs(&w).len(), 1);
    }

    #[test]
    fn statuses() {
        assert!(RemoteStatus::parse("canceled").unwrap().is_terminal());
        assert!(RemoteStatus::parse("nsfw").unwrap().is_terminal());
        assert!(!RemoteStatus::parse("in_progress").unwrap().is_terminal());
        assert!(RemoteStatus::parse("weird").is_none());
    }

    #[tokio::test]
    async fn cancel_after_start_returns_false() {
        let server = MockServer::start().await;
        Mock::given(path("/requests/a/cancel"))
            .respond_with(ResponseTemplate::new(202))
            .mount(&server)
            .await;
        Mock::given(path("/requests/b/cancel"))
            .respond_with(ResponseTemplate::new(400).set_body_json(json!({"detail":"started"})))
            .mount(&server)
            .await;
        let c = client(&server);
        assert!(c.cancel("a").await.unwrap());
        assert!(!c.cancel("b").await.unwrap());
    }

    #[tokio::test]
    async fn estimate_accepts_string_usd() {
        let server = MockServer::start().await;
        Mock::given(path("/estimate/m"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"usd":"0.094"})))
            .mount(&server)
            .await;
        assert_eq!(
            client(&server).estimate("m", &Map::new()).await.unwrap(),
            0.094
        );
    }

    #[tokio::test]
    async fn upload_puts_without_auth() {
        let server = MockServer::start().await;
        let put_url = format!("{}/presigned", server.uri());
        Mock::given(method("POST"))
            .and(path("/files/generate-upload-url"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "public_url":"https://cdn/in.png","upload_url":put_url,"upload_headers":{"Content-Type":"image/png"}})))
            .mount(&server)
            .await;
        Mock::given(method("PUT"))
            .and(path("/presigned"))
            .respond_with(ResponseTemplate::new(200))
            .expect(1)
            .mount(&server)
            .await;
        let url = client(&server)
            .upload(vec![1, 2, 3], "image/png")
            .await
            .unwrap();
        assert_eq!(url, "https://cdn/in.png");
        let reqs = server.received_requests().await.unwrap();
        let put = reqs.iter().find(|r| r.method.as_str() == "PUT").unwrap();
        assert!(
            put.headers.get("authorization").is_none(),
            "presigned PUT must not carry the API key"
        );
    }

    #[test]
    fn sums_usage() {
        let v = json!({"time_series":[{"results":[{"model":"a","cost":"1.50"},{"model":"b","cost":"0.25"}]},{"results":[{"model":"a","cost":"0.5"}]}]});
        let (total, by) = sum_usage(&v);
        assert!((total - 2.25).abs() < 1e-9);
        assert_eq!(by[0], ("a".into(), 2.0));
    }

    #[test]
    fn debug_redacts_key() {
        let c = HfClient::with_base("id:topsecret".into(), "http://x".into());
        assert!(!format!("{c:?}").contains("topsecret"));
    }
}
