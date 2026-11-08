//! Optional ffmpeg features: stitch clips into one MP4, grab keyframes for the director.

use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};
use tokio::process::Command;

const FFMPEG_BIN: &str = if cfg!(windows) {
    "ffmpeg.exe"
} else {
    "ffmpeg"
};

pub async fn find_ffmpeg(override_path: Option<&str>) -> Option<PathBuf> {
    if let Some(p) = override_path.filter(|p| !p.is_empty()) {
        let p = PathBuf::from(p);
        return p.is_file().then_some(p);
    }
    let mut c: Vec<PathBuf> = vec![
        "/opt/homebrew/bin/ffmpeg".into(),
        "/usr/local/bin/ffmpeg".into(),
        "/usr/bin/ffmpeg".into(),
    ];
    // winget puts its shims here; a running app doesn't see PATH updates made after it started.
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        c.push(
            PathBuf::from(local)
                .join("Microsoft")
                .join("WinGet")
                .join("Links")
                .join(FFMPEG_BIN),
        );
    }
    if let Some(path) = std::env::var_os("PATH") {
        c.extend(std::env::split_paths(&path).map(|d| d.join(FFMPEG_BIN)));
    }
    c.into_iter().find(|p| p.is_file())
}

/// Package manager we can run without admin rights: Homebrew (macOS, Linuxbrew) or winget (Windows).
fn package_manager() -> Option<(PathBuf, Vec<&'static str>)> {
    if cfg!(windows) {
        let mut c: Vec<PathBuf> = Vec::new();
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            c.push(
                PathBuf::from(local)
                    .join("Microsoft")
                    .join("WindowsApps")
                    .join("winget.exe"),
            );
        }
        if let Some(path) = std::env::var_os("PATH") {
            c.extend(std::env::split_paths(&path).map(|d| d.join("winget.exe")));
        }
        let args = vec![
            "install",
            "--id",
            "Gyan.FFmpeg",
            "-e",
            "--silent",
            "--accept-package-agreements",
            "--accept-source-agreements",
        ];
        return c.into_iter().find(|p| p.is_file()).map(|p| (p, args));
    }
    let mut c: Vec<PathBuf> = vec![
        "/opt/homebrew/bin/brew".into(),
        "/usr/local/bin/brew".into(),
        "/home/linuxbrew/.linuxbrew/bin/brew".into(),
    ];
    if let Some(path) = std::env::var_os("PATH") {
        c.extend(std::env::split_paths(&path).map(|d| d.join("brew")));
    }
    c.into_iter()
        .find(|p| p.is_file())
        .map(|p| (p, vec!["install", "ffmpeg"]))
}

fn install_hint() -> &'static str {
    if cfg!(target_os = "macos") {
        "Homebrew not found. Install it from https://brew.sh, then try again (or run: brew install ffmpeg)."
    } else if cfg!(windows) {
        "winget not found. Install \"App Installer\" from the Microsoft Store, or download ffmpeg from ffmpeg.org."
    } else {
        "Install ffmpeg with your package manager (e.g. sudo apt install ffmpeg), then check again."
    }
}

/// Install ffmpeg with the system package manager. Can take a few minutes.
pub async fn install_ffmpeg() -> AppResult<PathBuf> {
    let (pm, args) = package_manager().ok_or_else(|| AppError::Other(install_hint().into()))?;
    let o = Command::new(&pm)
        .args(&args)
        .env("HOMEBREW_NO_AUTO_UPDATE", "1")
        .env("HOMEBREW_NO_ENV_HINTS", "1")
        .stdin(std::process::Stdio::null())
        .output()
        .await?;
    if !o.status.success() {
        let err = String::from_utf8_lossy(&o.stderr);
        let out = String::from_utf8_lossy(&o.stdout);
        let last = err
            .lines()
            .chain(out.lines())
            .filter(|l| !l.trim().is_empty())
            .last()
            .unwrap_or("unknown error");
        return Err(AppError::Other(format!("ffmpeg install failed: {last}")));
    }
    find_ffmpeg(None).await.ok_or_else(|| {
        AppError::Other(
            "Install finished but ffmpeg wasn't found. Restart the app and check again.".into(),
        )
    })
}

/// Build ffmpeg args that normalise every clip to the first clip's size (letterboxed), 30 fps,
/// and concatenate them. Clips without audio get silence of the same length so concat works.
pub fn concat_args(clips: &[Clip], width: u32, height: u32, out: &Path) -> Vec<String> {
    let mut a: Vec<String> = vec![
        "-y".into(),
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
    ];
    for c in clips {
        a.push("-i".into());
        a.push(c.path.to_string_lossy().into());
    }
    let n = clips.len();
    let mut f = String::new();
    for (i, c) in clips.iter().enumerate() {
        f.push_str(&format!(
            "[{i}:v]scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[v{i}];"
        ));
        if c.has_audio {
            f.push_str(&format!(
                "[{i}:a]aresample=48000,aformat=channel_layouts=stereo[a{i}];"
            ));
        } else {
            f.push_str(&format!(
                "anullsrc=r=48000:cl=stereo,atrim=0:{:.3}[a{i}];",
                c.duration.max(0.04)
            ));
        }
    }
    for i in 0..n {
        f.push_str(&format!("[v{i}][a{i}]"));
    }
    f.push_str(&format!("concat=n={n}:v=1:a=1[v][a]"));
    a.extend([
        "-filter_complex".into(),
        f,
        "-map".into(),
        "[v]".into(),
        "-map".into(),
        "[a]".into(),
    ]);
    a.extend(
        [
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
        ]
        .map(String::from),
    );
    a.push(out.to_string_lossy().into());
    a
}

#[derive(Debug, Clone)]
pub struct Clip {
    pub path: PathBuf,
    pub width: u32,
    pub height: u32,
    pub has_audio: bool,
    pub duration: f64,
}

pub fn parse_probe(path: &Path, stderr: &str) -> AppResult<Clip> {
    let mut wh = None;
    let mut audio = false;
    let mut duration = 0.0;
    for line in stderr.lines() {
        let l = line.trim();
        if let Some(rest) = l.strip_prefix("Duration: ") {
            let t = rest.split(',').next().unwrap_or("");
            let parts: Vec<f64> = t.split(':').filter_map(|x| x.trim().parse().ok()).collect();
            if parts.len() == 3 {
                duration = parts[0] * 3600.0 + parts[1] * 60.0 + parts[2];
            }
        }
        if l.contains("Video:") && wh.is_none() {
            for tok in l.split([',', ' ']) {
                if let Some((w, h)) = tok.split_once('x') {
                    if let (Ok(w), Ok(h)) = (w.parse::<u32>(), h.parse::<u32>()) {
                        if w >= 16 && h >= 16 {
                            wh = Some((w, h));
                            break;
                        }
                    }
                }
            }
        }
        if l.contains("Audio:") {
            audio = true;
        }
    }
    let (width, height) =
        wh.ok_or_else(|| AppError::Other(format!("{} has no video stream", path.display())))?;
    Ok(Clip {
        path: path.to_path_buf(),
        width,
        height,
        has_audio: audio,
        duration,
    })
}

async fn probe(ffmpeg: &Path, clip: &Path) -> AppResult<Clip> {
    // `ffmpeg -i` prints stream info to stderr, so we don't need ffprobe.
    let o = Command::new(ffmpeg)
        .arg("-hide_banner")
        .arg("-i")
        .arg(clip)
        .output()
        .await?;
    parse_probe(clip, &String::from_utf8_lossy(&o.stderr))
}

pub async fn export_timeline(ffmpeg: &Path, clips: &[PathBuf], out: &Path) -> AppResult<()> {
    if clips.is_empty() {
        return Err(AppError::Validation("Timeline is empty".into()));
    }
    let mut probed = Vec::new();
    for c in clips {
        probed.push(probe(ffmpeg, c).await?);
    }
    let (w, h) = (
        probed[0].width - probed[0].width % 2,
        probed[0].height - probed[0].height % 2,
    );
    let args = concat_args(&probed, w, h, out);
    let o = Command::new(ffmpeg).args(&args).output().await?;
    if !o.status.success() {
        let err = String::from_utf8_lossy(&o.stderr);
        return Err(AppError::Other(format!(
            "ffmpeg failed: {}",
            err.lines().last().unwrap_or("unknown error")
        )));
    }
    Ok(())
}

/// Extract `n` evenly spaced frames as JPEGs so the director can look at a video.
pub async fn keyframes(
    ffmpeg: &Path,
    clip: &Path,
    out_dir: &Path,
    n: u32,
) -> AppResult<Vec<PathBuf>> {
    tokio::fs::create_dir_all(out_dir).await?;
    let stem = clip.file_stem().and_then(|s| s.to_str()).unwrap_or("clip");
    let pattern = out_dir.join(format!("{stem}_%02d.jpg"));
    let o = Command::new(ffmpeg)
        .args(["-y", "-hide_banner", "-loglevel", "error", "-i"])
        .arg(clip)
        .args([
            "-vf",
            &format!("thumbnail=60,scale=768:-2"),
            "-frames:v",
            &n.to_string(),
            "-vsync",
            "vfr",
        ])
        .arg(&pattern)
        .output()
        .await?;
    if !o.status.success() {
        return Err(AppError::Other("could not extract frames".into()));
    }
    let mut v: Vec<PathBuf> = (1..=n)
        .map(|i| out_dir.join(format!("{stem}_{i:02}.jpg")))
        .filter(|p| p.is_file())
        .collect();
    v.sort();
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROBE: &str = "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'a.mp4':\n  Duration: 00:00:05.04, start: 0.000000, bitrate: 2000 kb/s\n  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], 1990 kb/s, 24 fps\n";

    #[test]
    fn parses_probe_output() {
        let c = parse_probe(Path::new("/a.mp4"), PROBE).unwrap();
        assert_eq!((c.width, c.height, c.has_audio), (1920, 1080, false));
        assert!((c.duration - 5.04).abs() < 1e-6);
        assert!(parse_probe(Path::new("/x"), "Duration: N/A").is_err());
    }

    #[test]
    fn concat_args_cover_all_clips() {
        let mk = |p: &str, a: bool| Clip {
            path: p.into(),
            width: 1280,
            height: 720,
            has_audio: a,
            duration: 5.0,
        };
        let a = concat_args(
            &[mk("/a.mp4", true), mk("/b.mp4", false)],
            1280,
            720,
            Path::new("/out.mp4"),
        );
        let f = a
            .iter()
            .position(|x| x == "-filter_complex")
            .map(|i| a[i + 1].clone())
            .unwrap();
        assert!(f.contains("[0:v]scale=1280:720"));
        assert!(f.contains("anullsrc=r=48000:cl=stereo,atrim=0:5.000[a1]"));
        assert!(f.ends_with("[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]"));
        assert_eq!(a.last().unwrap(), "/out.mp4");
        assert_eq!(a.iter().filter(|x| *x == "-i").count(), 2);
    }
}
