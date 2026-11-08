//! Model registry: parses models.json and validates request params against each model's input schema.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Registry {
    #[serde(default)]
    pub generated_at: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    pub models: Vec<Model>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Model {
    pub id: String,
    pub name: String,
    pub category: String,
    #[serde(default)]
    pub description: String,
    pub inputs: Vec<Input>,
    #[serde(default)]
    pub output: Option<Output>,
    #[serde(default)]
    pub cost: Option<Cost>,
    #[serde(default)]
    pub source_url: Option<String>,
    #[serde(default)]
    pub verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Output {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub format: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Cost {
    #[serde(default)]
    pub usd: Option<f64>,
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Input {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub default: Value,
    #[serde(default)]
    pub description: String,
    #[serde(default, rename = "enum", skip_serializing_if = "Option::is_none")]
    pub enum_values: Option<Vec<Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(default, rename = "maxLength", skip_serializing_if = "Option::is_none")]
    pub max_length: Option<usize>,
    #[serde(default, rename = "minItems", skip_serializing_if = "Option::is_none")]
    pub min_items: Option<usize>,
    #[serde(default, rename = "maxItems", skip_serializing_if = "Option::is_none")]
    pub max_items: Option<usize>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<String>,
}

impl Input {
    fn base_type(&self) -> &str {
        self.kind.split('/').next().unwrap_or("string")
    }
    fn nullable(&self) -> bool {
        self.kind.ends_with("/null")
    }
    /// True for inputs that take uploaded media URLs.
    pub fn is_media(&self) -> bool {
        let n = self.name.as_str();
        self.format.as_deref() == Some("uri") && n != "link_url"
            || matches!(
                n,
                "image_urls" | "video_urls" | "audio_urls" | "input_images" | "image_reference_url"
            )
    }
}

/// One validation problem, keyed by param name so the UI can highlight it.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Issue {
    pub param: String,
    pub message: String,
}

/// Attachment placeholders the director may use before files are uploaded, e.g. "@pack.png".
pub fn is_placeholder(v: &str) -> bool {
    v.starts_with('@') && v.len() > 1
}

impl Registry {
    pub fn parse(json: &str) -> AppResult<Registry> {
        let r: Registry = serde_json::from_str(json)?;
        if r.models.is_empty() {
            return Err(AppError::Other("models.json has no models".into()));
        }
        Ok(r)
    }

    pub fn get(&self, id: &str) -> Option<&Model> {
        self.models.iter().find(|m| m.id == id)
    }

    /// Short catalog for the director's system prompt.
    pub fn compact_catalog(&self) -> String {
        let mut out = String::new();
        for m in &self.models {
            let params: Vec<String> = m
                .inputs
                .iter()
                .map(|i| {
                    let mut s =
                        format!("{}{}:{}", i.name, if i.required { "*" } else { "" }, i.kind);
                    if let Some(e) = &i.enum_values {
                        let vals: Vec<String> = e
                            .iter()
                            .map(|v| v.to_string().trim_matches('"').to_string())
                            .collect();
                        s.push_str(&format!("[{}]", vals.join("|")));
                    }
                    if let (Some(a), Some(b)) = (i.min, i.max) {
                        s.push_str(&format!("({a}..{b})"));
                    }
                    s
                })
                .collect();
            out.push_str(&format!(
                "- {} | {} | {} | {}\n",
                m.id,
                m.name,
                m.category,
                params.join(", ")
            ));
        }
        out
    }
}

/// Validate params for a model. `allow_placeholders` lets media fields hold "@file" references
/// (used for director shots before uploads happen).
pub fn validate(
    model: &Model,
    params: &Map<String, Value>,
    allow_placeholders: bool,
) -> Vec<Issue> {
    let mut issues = Vec::new();
    let push = |issues: &mut Vec<Issue>, p: &str, m: String| {
        issues.push(Issue {
            param: p.into(),
            message: m,
        })
    };

    for key in params.keys() {
        if !model.inputs.iter().any(|i| &i.name == key) {
            push(
                &mut issues,
                key,
                format!("unknown parameter for {}", model.id),
            );
        }
    }

    for input in &model.inputs {
        let v = params.get(&input.name);
        let missing = matches!(v, None | Some(Value::Null))
            || matches!(v, Some(Value::String(s)) if s.is_empty() && input.required);
        if missing {
            if input.required {
                push(&mut issues, &input.name, "is required".into());
            }
            continue;
        }
        let v = v.unwrap();
        if v.is_null() && input.nullable() {
            continue;
        }
        check_value(input, v, allow_placeholders, &mut issues);
    }
    issues
}

fn check_value(input: &Input, v: &Value, allow_placeholders: bool, issues: &mut Vec<Issue>) {
    let name = &input.name;
    let mut err = |m: String| {
        issues.push(Issue {
            param: name.clone(),
            message: m,
        })
    };
    match input.base_type() {
        "string" => {
            let Some(s) = v.as_str() else {
                return err("must be a string".into());
            };
            if let Some(max) = input.max_length {
                if s.chars().count() > max {
                    err(format!("must be at most {max} characters"));
                }
            }
            if input.format.as_deref() == Some("uri") && !s.is_empty() {
                let ok = s.starts_with("https://")
                    || s.starts_with("http://")
                    || (allow_placeholders && is_placeholder(s));
                if !ok {
                    err("must be a URL".into());
                }
            }
            if input.format.as_deref() == Some("uuid") && uuid::Uuid::parse_str(s).is_err() {
                err("must be a UUID".into());
            }
        }
        "integer" => match v.as_f64() {
            Some(n) if n.fract() == 0.0 => range(input, n, &mut err),
            _ => err("must be a whole number".into()),
        },
        "number" => match v.as_f64() {
            Some(n) => range(input, n, &mut err),
            None => err("must be a number".into()),
        },
        "boolean" => {
            if !v.is_boolean() {
                err("must be true or false".into());
            }
        }
        "array" => {
            let Some(a) = v.as_array() else {
                return err("must be a list".into());
            };
            if let Some(min) = input.min_items {
                if a.len() < min {
                    err(format!("needs at least {min} items"));
                }
            }
            if let Some(max) = input.max_items {
                if a.len() > max {
                    err(format!("allows at most {max} items"));
                }
            }
            if input.is_media() {
                for item in a {
                    let ok = item.as_str().is_some_and(|s| {
                        s.starts_with("http") || (allow_placeholders && is_placeholder(s))
                    });
                    if !ok {
                        err("items must be URLs".into());
                        break;
                    }
                }
            }
        }
        "object" => {
            if !v.is_object() {
                err("must be an object".into());
            }
        }
        _ => {}
    }
    if let Some(allowed) = &input.enum_values {
        if !allowed.iter().any(|a| a == v) {
            let vals: Vec<String> = allowed.iter().map(|a| a.to_string()).collect();
            issues.push(Issue {
                param: name.clone(),
                message: format!("must be one of {}", vals.join(", ")),
            });
        }
    }
}

fn range(input: &Input, n: f64, err: &mut impl FnMut(String)) {
    if let Some(min) = input.min {
        if n < min {
            err(format!("must be ≥ {min}"));
        }
    }
    if let Some(max) = input.max {
        if n > max {
            err(format!("must be ≤ {max}"));
        }
    }
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct RegistryDiff {
    pub added: Vec<String>,
    pub removed: Vec<String>,
    /// Models whose inputs changed, with a short description per model.
    pub changed: Vec<(String, String)>,
}

/// Compare two registries so a refresh can show what changed before it is applied.
pub fn diff(old: &Registry, new: &Registry) -> RegistryDiff {
    let mut d = RegistryDiff::default();
    for m in &new.models {
        match old.get(&m.id) {
            None => d.added.push(m.id.clone()),
            Some(o) => {
                let names = |x: &Model| {
                    x.inputs
                        .iter()
                        .map(|i| i.name.clone())
                        .collect::<std::collections::BTreeSet<_>>()
                };
                let (on, nn) = (names(o), names(m));
                let mut parts = Vec::new();
                let plus: Vec<_> = nn.difference(&on).cloned().collect();
                let minus: Vec<_> = on.difference(&nn).cloned().collect();
                if !plus.is_empty() {
                    parts.push(format!("+{}", plus.join(", +")));
                }
                if !minus.is_empty() {
                    parts.push(format!("-{}", minus.join(", -")));
                }
                for i in &m.inputs {
                    if let Some(oi) = o.inputs.iter().find(|x| x.name == i.name) {
                        if serde_json::to_value(oi).ok() != serde_json::to_value(i).ok() {
                            parts.push(format!("~{}", i.name));
                        }
                    }
                }
                if !parts.is_empty() {
                    d.changed.push((m.id.clone(), parts.join(" ")));
                }
            }
        }
    }
    for m in &old.models {
        if new.get(&m.id).is_none() {
            d.removed.push(m.id.clone());
        }
    }
    d
}

/// Drop nulls so we only send what the user set.
pub fn clean_body(params: &Map<String, Value>) -> Map<String, Value> {
    params
        .iter()
        .filter(|(_, v)| !v.is_null())
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn bundled() -> Registry {
        Registry::parse(include_str!("../../models.json")).expect("bundled models.json parses")
    }

    #[test]
    fn parses_bundled_registry() {
        let r = bundled();
        assert!(r.models.len() >= 80);
        let m = r.get("kling-video/v3.0/pro/image-to-video").unwrap();
        let img = m.inputs.iter().find(|i| i.name == "image_url").unwrap();
        assert!(img.required && img.is_media());
        let dur = m.inputs.iter().find(|i| i.name == "duration").unwrap();
        assert_eq!((dur.min, dur.max), (Some(3.0), Some(15.0)));
        assert!(r
            .compact_catalog()
            .contains("kling-video/v3.0/pro/image-to-video"));
    }

    #[test]
    fn every_model_has_unique_id_and_typed_inputs() {
        let r = bundled();
        let mut ids = std::collections::HashSet::new();
        for m in &r.models {
            assert!(ids.insert(&m.id), "duplicate {}", m.id);
            for i in &m.inputs {
                assert!(!i.kind.is_empty());
            }
        }
    }

    #[test]
    fn validates_params() {
        let r = bundled();
        let m = r.get("kling-video/v3.0/pro/image-to-video").unwrap();
        let ok = json!({"image_url":"https://x/y.png","duration":5,"sound":"off","prompt":"hi"});
        assert!(validate(m, ok.as_object().unwrap(), false).is_empty());

        let bad = json!({"duration":99,"sound":"loud","cfg_scale":"x","nope":1});
        let issues = validate(m, bad.as_object().unwrap(), false);
        let names: Vec<&str> = issues.iter().map(|i| i.param.as_str()).collect();
        for p in ["image_url", "duration", "sound", "cfg_scale", "nope"] {
            assert!(names.contains(&p), "expected issue for {p}: {issues:?}");
        }
    }

    #[test]
    fn placeholders_only_when_allowed() {
        let r = bundled();
        let m = r.get("kling-video/v3.0/pro/image-to-video").unwrap();
        let p = json!({"image_url":"@pack.png"});
        assert!(validate(m, p.as_object().unwrap(), true).is_empty());
        assert!(!validate(m, p.as_object().unwrap(), false).is_empty());
    }

    #[test]
    fn diffs_registries() {
        let old = bundled();
        let mut new = old.clone();
        new.models.retain(|m| m.id != "z-image/turbo");
        let k = new
            .models
            .iter_mut()
            .find(|m| m.id == "kling-video/v3.0/pro/image-to-video")
            .unwrap();
        k.inputs.retain(|i| i.name != "sound");
        k.inputs
            .iter_mut()
            .find(|i| i.name == "duration")
            .unwrap()
            .max = Some(20.0);
        let mut extra = new.models[0].clone();
        extra.id = "new/model".into();
        new.models.push(extra);
        let d = diff(&old, &new);
        assert_eq!(d.added, vec!["new/model"]);
        assert_eq!(d.removed, vec!["z-image/turbo"]);
        assert_eq!(d.changed.len(), 1);
        assert!(d.changed[0].1.contains("-sound") && d.changed[0].1.contains("~duration"));
        assert_eq!(diff(&old, &old), RegistryDiff::default());
    }

    #[test]
    fn rejects_empty_registry() {
        assert!(Registry::parse(r#"{"models":[]}"#).is_err());
        assert!(Registry::parse("not json").is_err());
    }
}
