use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::ShellExt;
use tokio::sync::Semaphore;
use walkdir::WalkDir;

const SUPPORTED_EXTS: &[&str] = &["jpg", "jpeg", "png", "tif", "tiff", "bmp"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConvertOptions {
    pub input_dir: String,
    pub output_dir: String,
    pub quality: u8,
    pub parallel: usize,
    pub recursive: bool,
    pub skip_existing: bool,
    pub force_lossless_png: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileResult {
    pub status: String,
    pub source: String,
    pub source_size: u64,
    pub dest_size: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConvertSummary {
    pub total: usize,
    pub converted: usize,
    pub skipped: usize,
    pub failed: usize,
    pub source_total_bytes: u64,
    pub dest_total_bytes: u64,
    pub failed_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ProgressEvent {
    done: usize,
    total: usize,
    last: FileResult,
}

fn has_supported_ext(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| SUPPORTED_EXTS.iter().any(|s| s.eq_ignore_ascii_case(e)))
        .unwrap_or(false)
}

fn is_png(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("png"))
        .unwrap_or(false)
}

fn collect_images(input: &Path, recursive: bool) -> Vec<PathBuf> {
    let walker = if recursive {
        WalkDir::new(input)
    } else {
        WalkDir::new(input).max_depth(1)
    };

    walker
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .filter(|p| has_supported_ext(p))
        .collect()
}

async fn convert_one(
    app: AppHandle,
    src: PathBuf,
    input_root: PathBuf,
    output_root: PathBuf,
    quality: u8,
    skip_existing: bool,
    force_lossless_png: bool,
) -> FileResult {
    let rel = src.strip_prefix(&input_root).unwrap_or(&src).to_path_buf();
    let mut dst = output_root.join(&rel);
    dst.set_extension("webp");

    if let Some(parent) = dst.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return FileResult {
                status: "fail".into(),
                source: src.display().to_string(),
                source_size: 0,
                dest_size: 0,
                error: Some(format!("mkdir failed: {e}")),
            };
        }
    }

    if skip_existing && dst.exists() {
        return FileResult {
            status: "skip".into(),
            source: src.display().to_string(),
            source_size: 0,
            dest_size: 0,
            error: None,
        };
    }

    let use_lossless = force_lossless_png && is_png(&src);
    let q = quality.to_string();
    let src_str = src.display().to_string();
    let dst_str = dst.display().to_string();

    let mut args: Vec<String> = vec!["-quiet".into()];
    if use_lossless {
        args.push("-lossless".into());
    }
    args.push("-q".into());
    args.push(q);
    args.push(src_str.clone());
    args.push("-o".into());
    args.push(dst_str.clone());

    let sidecar = match app.shell().sidecar("cwebp") {
        Ok(c) => c,
        Err(e) => {
            return FileResult {
                status: "fail".into(),
                source: src_str,
                source_size: 0,
                dest_size: 0,
                error: Some(format!("sidecar resolve failed: {e}")),
            };
        }
    };

    let output = sidecar.args(&args).output().await;

    match output {
        Ok(out) if out.status.success() => {
            let source_size = std::fs::metadata(&src).map(|m| m.len()).unwrap_or(0);
            let dest_size = std::fs::metadata(&dst).map(|m| m.len()).unwrap_or(0);
            FileResult {
                status: "ok".into(),
                source: src_str,
                source_size,
                dest_size,
                error: None,
            }
        }
        Ok(out) => {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            FileResult {
                status: "fail".into(),
                source: src_str,
                source_size: 0,
                dest_size: 0,
                error: Some(if stderr.is_empty() {
                    format!("cwebp exited with status {:?}", out.status.code())
                } else {
                    stderr
                }),
            }
        }
        Err(e) => FileResult {
            status: "fail".into(),
            source: src_str,
            source_size: 0,
            dest_size: 0,
            error: Some(format!("spawn failed: {e}")),
        },
    }
}

#[tauri::command]
async fn scan(input_dir: String, recursive: bool) -> Result<usize, String> {
    let p = PathBuf::from(&input_dir);
    if !p.is_dir() {
        return Err(format!("Not a directory: {input_dir}"));
    }
    Ok(collect_images(&p, recursive).len())
}

#[tauri::command]
async fn convert(app: AppHandle, options: ConvertOptions) -> Result<ConvertSummary, String> {
    let input_root = PathBuf::from(&options.input_dir);
    let output_root = PathBuf::from(&options.output_dir);

    if !input_root.is_dir() {
        return Err(format!("Input is not a directory: {}", options.input_dir));
    }
    std::fs::create_dir_all(&output_root)
        .map_err(|e| format!("Could not create output dir: {e}"))?;

    let files = collect_images(&input_root, options.recursive);
    let total = files.len();
    if total == 0 {
        return Ok(ConvertSummary {
            total: 0,
            converted: 0,
            skipped: 0,
            failed: 0,
            source_total_bytes: 0,
            dest_total_bytes: 0,
            failed_files: vec![],
        });
    }

    let parallel = options.parallel.max(1).min(32);
    let sem = Arc::new(Semaphore::new(parallel));
    let done = Arc::new(AtomicUsize::new(0));

    let mut handles = Vec::with_capacity(total);
    for src in files {
        let app_h = app.clone();
        let sem_c = sem.clone();
        let done_c = done.clone();
        let input_root_c = input_root.clone();
        let output_root_c = output_root.clone();
        let quality = options.quality;
        let skip_existing = options.skip_existing;
        let force_lossless_png = options.force_lossless_png;

        let h = tokio::spawn(async move {
            let _permit = sem_c.acquire_owned().await.expect("semaphore");
            let result = convert_one(
                app_h.clone(),
                src,
                input_root_c,
                output_root_c,
                quality,
                skip_existing,
                force_lossless_png,
            )
            .await;

            let n = done_c.fetch_add(1, Ordering::SeqCst) + 1;
            let _ = app_h.emit(
                "convert:progress",
                ProgressEvent {
                    done: n,
                    total,
                    last: result.clone(),
                },
            );
            result
        });
        handles.push(h);
    }

    let mut summary = ConvertSummary {
        total,
        converted: 0,
        skipped: 0,
        failed: 0,
        source_total_bytes: 0,
        dest_total_bytes: 0,
        failed_files: vec![],
    };

    for h in handles {
        match h.await {
            Ok(r) => match r.status.as_str() {
                "ok" => {
                    summary.converted += 1;
                    summary.source_total_bytes += r.source_size;
                    summary.dest_total_bytes += r.dest_size;
                }
                "skip" => summary.skipped += 1,
                _ => {
                    summary.failed += 1;
                    summary.failed_files.push(r.source);
                }
            },
            Err(e) => {
                summary.failed += 1;
                summary.failed_files.push(format!("<join error: {e}>"));
            }
        }
    }

    Ok(summary)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![scan, convert])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
