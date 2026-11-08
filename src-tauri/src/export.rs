//! CSV export of job history, for keeping a spending record outside the app.

use crate::db::Job;
use std::collections::HashMap;

const HEADER: [&str; 12] = [
    "created_at",
    "finished_at",
    "project",
    "model",
    "category",
    "source",
    "status",
    "prompt",
    "estimate_usd",
    "charged_usd",
    "request_id",
    "job_id",
];

/// What the job cost: actual (or estimate) once completed, 0 when Higgsfield refunds it,
/// empty while it is still in flight. Matches the spending table and `Db::local_spend`.
fn charged(j: &Job) -> Option<f64> {
    match j.status.as_str() {
        "completed" => Some(j.cost_usd.or(j.est_usd).unwrap_or(0.0)),
        "failed" | "canceled" | "nsfw" => Some(0.0),
        _ => None,
    }
}

fn money(v: Option<f64>) -> String {
    v.map(|v| format!("{v:.4}")).unwrap_or_default()
}

/// Quote a field per RFC 4180. Text that a spreadsheet would run as a formula gets a
/// leading apostrophe, since prompts are free text.
fn field(s: &str) -> String {
    let s = if s.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{s}")
    } else {
        s.to_string()
    };
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s
    }
}

/// Build the CSV, oldest job first. `projects` maps project id to name.
pub fn jobs_csv(jobs: &[Job], projects: &HashMap<String, String>) -> String {
    let mut out = HEADER.join(",");
    out.push_str("\r\n");
    let mut jobs: Vec<&Job> = jobs.iter().collect();
    jobs.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    for j in jobs {
        let project = j
            .project_id
            .as_ref()
            .and_then(|id| projects.get(id))
            .map(String::as_str)
            .unwrap_or("");
        let row = [
            field(&j.created_at),
            field(j.finished_at.as_deref().unwrap_or("")),
            field(project),
            field(&j.model_name),
            field(&j.category),
            field(&j.source),
            field(&j.status),
            field(&j.prompt),
            money(j.est_usd),
            money(charged(j)),
            field(j.request_id.as_deref().unwrap_or("")),
            field(&j.id),
        ];
        out.push_str(&row.join(","));
        out.push_str("\r\n");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::sample_job;

    fn job(status: &str, est: Option<f64>, cost: Option<f64>, created: &str) -> Job {
        let mut j = sample_job("soul");
        j.status = status.into();
        j.est_usd = est;
        j.cost_usd = cost;
        j.created_at = created.into();
        j
    }

    #[test]
    fn charged_follows_status() {
        assert_eq!(
            charged(&job("completed", Some(0.1), Some(0.2), "")),
            Some(0.2)
        );
        assert_eq!(charged(&job("completed", Some(0.1), None, "")), Some(0.1));
        assert_eq!(charged(&job("failed", Some(0.1), None, "")), Some(0.0));
        assert_eq!(charged(&job("running", Some(0.1), None, "")), None);
    }

    #[test]
    fn escapes_and_orders_rows() {
        let mut a = job("completed", Some(0.094), None, "2026-11-02T00:00:00Z");
        a.prompt = "a \"red\" car, at night\nwide".into();
        a.project_id = Some("p1".into());
        let mut b = job("running", Some(0.5), None, "2026-11-01T00:00:00Z");
        b.prompt = "=HYPERLINK(\"x\")".into();
        let projects = HashMap::from([("p1".to_string(), "Promo".to_string())]);

        let csv = jobs_csv(&[a, b], &projects);
        let lines: Vec<&str> = csv.split("\r\n").collect();
        assert!(lines[0].starts_with("created_at,finished_at,project"));
        // Oldest first: the running job comes before the completed one.
        assert!(lines[1].starts_with("2026-11-01"));
        assert!(lines[1].contains(",\"'=HYPERLINK(\"\"x\"\")\","));
        assert!(lines[1].contains(",0.5000,,"));
        assert!(csv.contains(",Promo,"));
        assert!(csv.contains("\"a \"\"red\"\" car, at night\nwide\""));
        assert!(csv.contains(",0.0940,0.0940,"));
    }
}
