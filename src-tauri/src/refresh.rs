//! Rebuild the model registry from docs.higgsfield.ai, from inside the app.
//! Mirrors `scripts/refresh-models.mjs`: each model page embeds its JSON schema.

use crate::error::{AppError, AppResult};
use crate::registry::Registry;
use futures_util::stream::{self, StreamExt};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

const DOCS: &str = "https://docs.higgsfield.ai";
const MAX_PAGES: usize = 400;
const CONCURRENCY: usize = 8;

async fn get(http: &reqwest::Client, url: &str) -> Option<String> {
    let r = http.get(url).send().await.ok()?;
    if !r.status().is_success() {
        return None;
    }
    r.text().await.ok()
}

/// Every `docs/models/….md` link in a markdown page, as absolute URLs.
pub fn links(md: &str) -> Vec<String> {
    let mut out = Vec::new();
    let needle = "docs/models/";
    let mut rest = md;
    while let Some(i) = rest.find(needle) {
        let tail = &rest[i..];
        let run: String = tail
            .chars()
            .take_while(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "._/-".contains(*c))
            .collect();
        if let Some(end) = run.rfind(".md") {
            out.push(format!("{DOCS}/{}", &run[..end + 3]));
        }
        rest = &tail[needle.len()..];
    }
    out
}

pub fn endpoint_id(md: &str) -> Option<String> {
    let i = md.find("**Endpoint ID:**")?;
    let tail = &md[i..];
    let a = tail.find('`')? + 1;
    let b = tail[a..].find('`')?;
    Some(tail[a..a + b].to_string())
}

pub fn schema_from(md: &str) -> Option<Value> {
    let i = md.find("Complete JSON schema")?;
    let lines: Vec<&str> = md[i..]
        .lines()
        .map(|l| l.strip_prefix("> ").or_else(|| l.strip_prefix('>')).unwrap_or(l))
        .collect();
    let start = lines.iter().position(|l| l.starts_with("```json"))?;
    let end = lines
        .iter()
        .enumerate()
        .position(|(k, l)| k > start && l.starts_with("```"))?;
    serde_json::from_str(&lines[start + 1..end].join("\n")).ok()
}

fn title(md: &str) -> Option<String> {
    let line = md.lines().find(|l| l.starts_with("# "))?;
    let t = line[2..].trim();
    Some(t.strip_suffix(" API").unwrap_or(t).trim().to_string())
}

fn type_of(p: &Value) -> String {
    match p.get("type") {
        Some(Value::String(s)) => return s.clone(),
        Some(Value::Array(a)) => {
            return a
                .iter()
                .filter_map(|v| v.as_str())
                .collect::<Vec<_>>()
                .join("/")
        }
        _ => {}
    }
    let alts = p
        .get("anyOf")
        .or_else(|| p.get("oneOf"))
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.get("type").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("/")
        })
        .unwrap_or_default();
    if alts.is_empty() {
        "string".into()
    } else {
        alts
    }
}

fn inputs_from(schema: &Value) -> Vec<Value> {
    let req: HashSet<&str> = schema
        .get("required")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();
    let Some(props) = schema.get("properties").and_then(|v| v.as_object()) else {
        return vec![];
    };
    props
        .iter()
        .map(|(name, p)| {
            // Merge the first non-null anyOf branch under the property itself, like the JS script.
            let mut src: Map<String, Value> = p
                .get("anyOf")
                .and_then(|v| v.as_array())
                .and_then(|a| {
                    a.iter().find(|x| {
                        x.get("type")
                            .and_then(|t| t.as_str())
                            .is_some_and(|t| t != "null")
                    })
                })
                .and_then(|v| v.as_object().cloned())
                .unwrap_or_default();
            if let Some(o) = p.as_object() {
                for (k, v) in o {
                    src.insert(k.clone(), v.clone());
                }
            }
            let mut out = Map::new();
            out.insert("name".into(), json!(name));
            out.insert("type".into(), json!(type_of(p)));
            out.insert("required".into(), json!(req.contains(name.as_str())));
            out.insert("default".into(), p.get("default").cloned().unwrap_or(Value::Null));
            let desc = p
                .get("description")
                .or_else(|| p.get("title"))
                .cloned()
                .unwrap_or(json!(""));
            out.insert("description".into(), desc);
            for (from, to) in [
                ("enum", "enum"),
                ("minimum", "min"),
                ("maximum", "max"),
                ("maxLength", "maxLength"),
                ("minItems", "minItems"),
                ("maxItems", "maxItems"),
                ("format", "format"),
            ] {
                if let Some(v) = src.get(from) {
                    out.insert(to.into(), v.clone());
                }
            }
            Value::Object(out)
        })
        .collect()
}

pub fn category(id: &str) -> &'static str {
    let any = |keys: &[&str]| keys.iter().any(|k| id.contains(k));
    if any(&["text-to-video", "t2v"]) {
        "text-to-video"
    } else if any(&[
        "image-to-video",
        "reference-to-video",
        "first-last",
        "image-reference",
        "motion-control",
    ]) {
        "image-to-video"
    } else if any(&[
        "video-edit",
        "video-extend",
        "video-reference",
        "motion-transfer",
        "restyle",
        "object-swap",
    ]) {
        "video-to-video"
    } else if any(&["image", "soul", "recraft", "ideogram", "z-image", "ads", "marketing"]) {
        "image"
    } else {
        "other"
    }
}

/// Crawl the docs and return a new registry as JSON text. Models that can't be found are kept.
pub async fn fetch_latest(current: &Registry) -> AppResult<String> {
    let http = reqwest::Client::builder()
        .user_agent("horschamp/refresh-models")
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| AppError::Other(e.to_string()))?;

    // Discover model pages (breadth first, a level at a time).
    let mut urls: HashSet<String> = current
        .models
        .iter()
        .filter_map(|m| m.source_url.clone())
        .collect();
    let mut seen: HashSet<String> = HashSet::new();
    let mut level = vec![format!("{DOCS}/docs/models.md")];
    while !level.is_empty() && seen.len() < MAX_PAGES {
        let todo: Vec<String> = level.drain(..).filter(|u| seen.insert(u.clone())).collect();
        let pages: Vec<(String, Option<String>)> = stream::iter(todo)
            .map(|u| {
                let http = http.clone();
                async move {
                    let md = get(&http, &u).await;
                    (u, md)
                }
            })
            .buffer_unordered(CONCURRENCY)
            .collect()
            .await;
        for (_, md) in pages {
            let Some(md) = md else { continue };
            let is_model = md.contains("Endpoint ID");
            for l in links(&md) {
                if seen.contains(&l) {
                    continue;
                }
                urls.insert(l.clone());
                // Category/family index pages link to more models.
                if !is_model || l.split('/').count() <= 6 {
                    level.push(l);
                }
            }
        }
    }
    if urls.is_empty() {
        return Err(AppError::Other("Couldn't reach docs.higgsfield.ai.".into()));
    }

    let by_id: HashMap<&str, &crate::registry::Model> =
        current.models.iter().map(|m| (m.id.as_str(), m)).collect();
    let pages: Vec<(String, Option<String>)> = stream::iter(urls)
        .map(|u| {
            let http = http.clone();
            async move {
                let md = get(&http, &u).await;
                (u, md)
            }
        })
        .buffer_unordered(CONCURRENCY)
        .collect()
        .await;

    let mut models: Vec<(String, Value)> = Vec::new();
    for (url, md) in pages {
        let Some(md) = md else { continue };
        let Some(id) = endpoint_id(&md) else { continue };
        let prev = by_id.get(id.as_str()).copied();
        let Some(schema) = schema_from(&md) else {
            if let Some(p) = prev {
                models.push((id, serde_json::to_value(p)?));
            }
            continue;
        };
        let cat = prev
            .map(|p| p.category.clone())
            .unwrap_or_else(|| category(&id).to_string());
        let name = title(&md)
            .or_else(|| prev.map(|p| p.name.clone()))
            .unwrap_or_else(|| id.clone());
        let output = prev
            .and_then(|p| p.output.as_ref())
            .map(serde_json::to_value)
            .transpose()?
            .unwrap_or_else(|| json!({ "type": if cat.contains("video") { "video" } else { "image" } }));
        let cost = prev
            .and_then(|p| p.cost.as_ref())
            .map(serde_json::to_value)
            .transpose()?
            .unwrap_or_else(|| json!({ "usd": null, "notes": "Use POST /estimate/{id}" }));
        models.push((
            id.clone(),
            json!({
                "id": id,
                "name": name,
                "category": cat,
                "endpoint": format!("POST https://api.higgsfield.ai/{id}"),
                "description": prev.map(|p| p.description.clone()).unwrap_or_default(),
                "inputs": inputs_from(&schema),
                "output": output,
                "cost": cost,
                "source_url": url,
                "verified": true,
            }),
        ));
    }
    // Keep models we couldn't find (e.g. Soul ID uses a different API) so nothing silently disappears.
    let found: HashSet<String> = models.iter().map(|(id, _)| id.clone()).collect();
    for m in &current.models {
        if !found.contains(&m.id) {
            models.push((m.id.clone(), serde_json::to_value(m)?));
        }
    }
    let mut unique: Vec<(String, Value)> = models
        .into_iter()
        .collect::<HashMap<_, _>>()
        .into_iter()
        .collect();
    unique.sort_by(|a, b| a.0.cmp(&b.0));

    if (found.len() as f64) < current.models.len() as f64 * 0.8 {
        return Err(AppError::Other(
            "Found far fewer models than before. The docs layout may have changed; kept the current list."
                .into(),
        ));
    }
    let text = serde_json::to_string_pretty(&json!({
        "generated_at": chrono::Utc::now().to_rfc3339(),
        "source": format!("{DOCS}/docs/models.md (crawled in app)"),
        "models": unique.into_iter().map(|(_, v)| v).collect::<Vec<_>>(),
    }))?;
    Registry::parse(&text)?;
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_model_page() {
        let md = "# Kling 3 API\n\nSee [other](/docs/models/kling/v3.md) and \
                  https://docs.higgsfield.ai/docs/models/veo/v3.md.\n\n**Endpoint ID:** `kling/v3/t2v`\n\n\
                  ## Complete JSON schema\n> ```json\n> {\"type\":\"object\",\"required\":[\"prompt\"],\
                  \"properties\":{\"prompt\":{\"type\":\"string\",\"maxLength\":10},\
                  \"duration\":{\"anyOf\":[{\"type\":\"integer\",\"minimum\":5,\"maximum\":10},{\"type\":\"null\"}]}}}\n> ```\n";
        assert_eq!(
            links(md),
            vec![
                format!("{DOCS}/docs/models/kling/v3.md"),
                format!("{DOCS}/docs/models/veo/v3.md")
            ]
        );
        assert_eq!(endpoint_id(md).as_deref(), Some("kling/v3/t2v"));
        assert_eq!(title(md).as_deref(), Some("Kling 3"));
        let inputs = inputs_from(&schema_from(md).unwrap());
        let d = inputs.iter().find(|i| i["name"] == "duration").unwrap();
        assert_eq!(d["type"], "integer/null");
        assert_eq!(d["min"], 5);
        assert_eq!(category("kling/v3/t2v"), "text-to-video");
    }
}
