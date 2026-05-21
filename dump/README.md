# Bulk WebP Converter

A small, fast script for converting thousands of images to WebP using Google's official `cwebp` encoder. Runs conversions in parallel, preserves your folder structure, skips files already converted, and reports how much space you saved.

## Why this approach?

For thousands of high-quality images, browser-based converters and online tools choke (RAM limits, tab crashes, upload times). `cwebp` is the official encoder from Google — it's the fastest and produces the best-quality WebP output, and it's been battle-tested for years. This script just wraps it with sane defaults, parallel processing, and a clean progress display.

## Features

- Converts JPG, JPEG, PNG, TIFF, and BMP to WebP
- Parallel processing (configurable, defaults to 4 workers)
- Preserves folder structure in the output directory
- Skips already-converted files by default (safe to re-run / resume)
- Lossless mode for logos, screenshots, or images with transparency
- Configurable quality (0–100)
- Optional source deletion after successful conversion
- Final report with total size, savings, and any failed files

## Requirements

### `cwebp` (Google's WebP encoder)

| OS | Install command |
|---|---|
| macOS | `brew install webp` |
| Ubuntu / Debian | `sudo apt install webp` |
| Fedora | `sudo dnf install libwebp-tools` |
| Arch | `sudo pacman -S libwebp` |
| Windows | Download the precompiled binary from [Google's WebP page](https://developers.google.com/speed/webp/download) and add it to your `PATH` |

Verify it works:

```bash
cwebp -version
```

### Shell environment

- **macOS / Linux:** works out of the box.
- **Windows:** run via **Git Bash** (comes with [Git for Windows](https://git-scm.com/download/win)) or **WSL** (Windows Subsystem for Linux). PowerShell won't work directly.

## Setup

1. Save `convert-to-webp.sh` somewhere convenient.
2. Make it executable:
   ```bash
   chmod +x convert-to-webp.sh
   ```

## Usage

```bash
./convert-to-webp.sh [options] <input-dir> [output-dir]
```

If you don't pass an output directory, the script creates one next to the input named `<input-dir>-webp`.

### Common examples

Convert a folder with defaults (quality 80, recursive, 4 parallel jobs):

```bash
./convert-to-webp.sh ./photos
```

Higher quality, faster (more parallel jobs on a fast machine):

```bash
./convert-to-webp.sh -q 85 -j 8 ./photos ./photos-webp
```

Lossless mode — ideal for PNG logos, UI screenshots, or anything with transparency:

```bash
./convert-to-webp.sh --lossless ./logos ./logos-webp
```

Top-level only (don't recurse into subfolders):

```bash
./convert-to-webp.sh --no-recursive ./photos
```

Re-run and overwrite existing `.webp` files:

```bash
./convert-to-webp.sh --force ./photos
```

Delete the original images after successful conversion (use with care, ideally on a copy):

```bash
./convert-to-webp.sh --delete-originals ./photos
```

### All options

| Flag | Description | Default |
|---|---|---|
| `-q, --quality N` | Quality 0–100. Higher = bigger file, better fidelity | `80` |
| `-j, --jobs N` | Number of parallel conversions | `4` |
| `-l, --lossless` | Use lossless compression | off |
| `-n, --no-recursive` | Only process the top-level folder | recursive |
| `-f, --force` | Overwrite existing `.webp` files | skip existing |
| `-d, --delete-originals` | Delete source images after successful conversion | off |
| `-h, --help` | Show help | — |

## Choosing a quality setting

A practical guide:

| Quality | Use case |
|---|---|
| 90–100 | Archival, print, or comparison work |
| 80–85 | **Recommended for web photos.** Visually near-lossless, ~25–35% of original JPG size |
| 70–75 | Aggressive web compression, thumbnails, hero backgrounds |
| < 70 | Visible artifacts in most photos — avoid unless size is critical |

For **PNG with transparency** (logos, icons, UI), use `--lossless` instead of tuning quality.

## Performance notes

- On a modern laptop, `-j 8` typically processes 50–150 images per second depending on input size.
- For very large batches (10,000+ files), run it overnight and check the summary in the morning. The script is safe to interrupt and re-run — already-converted files are skipped.
- If you're working with **RAW** files (CR2, NEF, ARW), `cwebp` won't read them directly. Convert to JPG or TIFF first using `dcraw` or your camera vendor's tool, then run this script.

## Output

While running:

```
Progress: 1247 / 5800
```

When done:

```
Done.
  Converted:  5793
  Skipped:    5 (already existed)
  Failed:     2

  Original size:   4.21 GB
  WebP size:       1.18 GB
  Saved:           3.03 GB (72.0%)
```

## Troubleshooting

**`cwebp: command not found`** — install `cwebp` from the table above and confirm it's on your `PATH` (`which cwebp`).

**Script fails immediately on Windows** — you're probably in CMD or PowerShell. Open Git Bash or a WSL terminal and run it from there.

**Some files fail with "decoding error"** — usually a corrupt source or an unsupported variant (e.g. a CMYK JPEG with an exotic profile). The summary lists every failure. Fix the source or convert it to standard sRGB JPEG first.

**Conversion looks slow** — bump `-j` up. On an 8-core machine, `-j 8` to `-j 12` is typical. Going beyond your core count rarely helps and can hurt.

**Want to verify quality before converting everything** — run on a small subfolder first at a few quality settings and compare:

```bash
./convert-to-webp.sh -q 80 ./sample ./sample-q80
./convert-to-webp.sh -q 85 ./sample ./sample-q85
./convert-to-webp.sh -q 90 ./sample ./sample-q90
```

Open the originals and outputs side-by-side and pick the lowest quality that still looks acceptable.

## License

Use freely. The script wraps Google's `cwebp` (BSD-licensed) — no dependencies beyond standard Unix tools (`find`, `xargs`, `awk`).
