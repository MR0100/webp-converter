#!/usr/bin/env bash
#
# convert-to-webp.sh
# Bulk-convert images to WebP using Google's cwebp encoder.
# Designed for converting thousands of high-quality images efficiently.
#
# Usage: ./convert-to-webp.sh [options] <input-dir> [output-dir]
# Run with --help for full options.

set -euo pipefail

# ---------- Defaults ----------
QUALITY=80
RECURSIVE=true
PARALLEL_JOBS=4
LOSSLESS=false
SKIP_EXISTING=true
DELETE_ORIGINALS=false
INPUT_DIR=""
OUTPUT_DIR=""

# ---------- Colors ----------
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_BLUE=$'\033[34m'
else
  C_RESET=""; C_BOLD=""; C_DIM=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_BLUE=""
fi

usage() {
  cat <<EOF
${C_BOLD}convert-to-webp.sh${C_RESET} — Bulk convert images to WebP.

${C_BOLD}USAGE${C_RESET}
  ./convert-to-webp.sh [options] <input-dir> [output-dir]

${C_BOLD}OPTIONS${C_RESET}
  -q, --quality N        Quality 0-100 (default: 80). Higher = larger file, better quality.
  -j, --jobs N           Parallel conversions (default: 4). Try 8 on fast machines.
  -l, --lossless         Use lossless compression (great for PNG with transparency).
  -n, --no-recursive     Only convert images in the top-level folder.
  -f, --force            Overwrite existing .webp files (default: skip).
  -d, --delete-originals Delete source images after successful conversion. Use with care.
  -h, --help             Show this help.

${C_BOLD}EXAMPLES${C_RESET}
  ./convert-to-webp.sh ./photos
  ./convert-to-webp.sh -q 85 -j 8 ./photos ./photos-webp
  ./convert-to-webp.sh --lossless ./logos ./logos-webp

${C_BOLD}SUPPORTED INPUT FORMATS${C_RESET}
  .jpg .jpeg .png .tif .tiff .bmp
EOF
}

# ---------- Parse args ----------
while [[ $# -gt 0 ]]; do
  case "$1" in
    -q|--quality)        QUALITY="$2"; shift 2 ;;
    -j|--jobs)           PARALLEL_JOBS="$2"; shift 2 ;;
    -l|--lossless)       LOSSLESS=true; shift ;;
    -n|--no-recursive)   RECURSIVE=false; shift ;;
    -f|--force)          SKIP_EXISTING=false; shift ;;
    -d|--delete-originals) DELETE_ORIGINALS=true; shift ;;
    -h|--help)           usage; exit 0 ;;
    -*) echo "${C_RED}Unknown option: $1${C_RESET}" >&2; usage; exit 1 ;;
    *)
      if [ -z "$INPUT_DIR" ]; then INPUT_DIR="$1"
      elif [ -z "$OUTPUT_DIR" ]; then OUTPUT_DIR="$1"
      else echo "${C_RED}Too many arguments${C_RESET}" >&2; exit 1
      fi
      shift ;;
  esac
done

# ---------- Validate ----------
if [ -z "$INPUT_DIR" ]; then
  echo "${C_RED}Error: input directory is required.${C_RESET}" >&2
  usage; exit 1
fi
if [ ! -d "$INPUT_DIR" ]; then
  echo "${C_RED}Error: '$INPUT_DIR' is not a directory.${C_RESET}" >&2; exit 1
fi
if ! command -v cwebp >/dev/null 2>&1; then
  echo "${C_RED}Error: cwebp not found.${C_RESET}" >&2
  echo "Install it:"
  echo "  macOS:        brew install webp"
  echo "  Ubuntu/Debian: sudo apt install webp"
  echo "  Windows:      Download from https://developers.google.com/speed/webp/download"
  exit 1
fi
if ! [[ "$QUALITY" =~ ^[0-9]+$ ]] || [ "$QUALITY" -lt 0 ] || [ "$QUALITY" -gt 100 ]; then
  echo "${C_RED}Error: quality must be an integer between 0 and 100.${C_RESET}" >&2; exit 1
fi

INPUT_DIR="${INPUT_DIR%/}"
[ -z "$OUTPUT_DIR" ] && OUTPUT_DIR="${INPUT_DIR}-webp"
OUTPUT_DIR="${OUTPUT_DIR%/}"
mkdir -p "$OUTPUT_DIR"

# ---------- Banner ----------
echo "${C_BOLD}${C_BLUE}WebP Bulk Converter${C_RESET}"
echo "${C_DIM}--------------------------------${C_RESET}"
echo "Input:           $INPUT_DIR"
echo "Output:          $OUTPUT_DIR"
echo "Quality:         $QUALITY $( [ "$LOSSLESS" = true ] && echo "(lossless mode)" )"
echo "Parallel jobs:   $PARALLEL_JOBS"
echo "Recursive:       $RECURSIVE"
echo "Skip existing:   $SKIP_EXISTING"
echo "Delete sources:  $DELETE_ORIGINALS"
echo ""

# ---------- Find files ----------
FIND_DEPTH=()
[ "$RECURSIVE" = false ] && FIND_DEPTH=(-maxdepth 1)

# Build list of input files (null-delimited for safety with spaces/special chars)
TMP_LIST="$(mktemp)"
trap 'rm -f "$TMP_LIST"' EXIT

find "$INPUT_DIR" "${FIND_DEPTH[@]}" -type f \
  \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" \
     -o -iname "*.tif" -o -iname "*.tiff" -o -iname "*.bmp" \) \
  -print0 > "$TMP_LIST"

TOTAL=$(tr -cd '\0' < "$TMP_LIST" | wc -c | tr -d ' ')
if [ "$TOTAL" -eq 0 ]; then
  echo "${C_YELLOW}No images found in $INPUT_DIR${C_RESET}"; exit 0
fi
echo "Found ${C_BOLD}$TOTAL${C_RESET} image(s) to process."
echo ""

# ---------- Worker (called via xargs) ----------
convert_one() {
  local src="$1"
  local rel="${src#"$INPUT_DIR"/}"
  local dst_dir
  dst_dir="$OUTPUT_DIR/$(dirname "$rel")"
  mkdir -p "$dst_dir"
  local base
  base="$(basename "$src")"
  local stem="${base%.*}"
  local dst="$dst_dir/$stem.webp"

  if [ "$SKIP_EXISTING" = true ] && [ -f "$dst" ]; then
    echo "SKIP|$src|0|0"
    return 0
  fi

  local cwebp_args=(-quiet -q "$QUALITY")
  [ "$LOSSLESS" = true ] && cwebp_args=(-quiet -lossless -q "$QUALITY")

  if cwebp "${cwebp_args[@]}" "$src" -o "$dst" 2>/dev/null; then
    local src_size dst_size
    src_size=$(wc -c < "$src" | tr -d ' ')
    dst_size=$(wc -c < "$dst" | tr -d ' ')
    if [ "$DELETE_ORIGINALS" = true ]; then rm -f "$src"; fi
    echo "OK|$src|$src_size|$dst_size"
  else
    echo "FAIL|$src|0|0"
  fi
}

export -f convert_one
export INPUT_DIR OUTPUT_DIR QUALITY LOSSLESS SKIP_EXISTING DELETE_ORIGINALS

# ---------- Run in parallel ----------
RESULTS="$(mktemp)"
trap 'rm -f "$TMP_LIST" "$RESULTS"' EXIT

# xargs -0 reads null-delimited paths; -P sets parallel jobs; -I {} placeholder
xargs -0 -P "$PARALLEL_JOBS" -I {} bash -c 'convert_one "$@"' _ {} \
  < "$TMP_LIST" > "$RESULTS" &
XARGS_PID=$!

# ---------- Progress ----------
DONE=0
while kill -0 "$XARGS_PID" 2>/dev/null; do
  DONE=$(wc -l < "$RESULTS" | tr -d ' ')
  printf "\r${C_DIM}Progress:${C_RESET} %d / %d" "$DONE" "$TOTAL"
  sleep 0.5
done
wait "$XARGS_PID" || true
DONE=$(wc -l < "$RESULTS" | tr -d ' ')
printf "\r${C_DIM}Progress:${C_RESET} %d / %d\n\n" "$DONE" "$TOTAL"

# ---------- Summary ----------
OK=$(grep -c '^OK|'    "$RESULTS" || true)
SKIP=$(grep -c '^SKIP|' "$RESULTS" || true)
FAIL=$(grep -c '^FAIL|' "$RESULTS" || true)

SRC_TOTAL=$(awk -F'|' '$1=="OK"{s+=$3} END{print s+0}' "$RESULTS")
DST_TOTAL=$(awk -F'|' '$1=="OK"{s+=$4} END{print s+0}' "$RESULTS")

human() {
  local b=$1
  awk -v b="$b" 'BEGIN{
    u="B KB MB GB TB"; split(u,a," ");
    i=1; while(b>=1024 && i<5){b/=1024; i++} printf "%.2f %s", b, a[i]
  }'
}

echo "${C_BOLD}Done.${C_RESET}"
echo "  ${C_GREEN}Converted:${C_RESET}  $OK"
[ "$SKIP" -gt 0 ] && echo "  ${C_YELLOW}Skipped:${C_RESET}    $SKIP (already existed)"
[ "$FAIL" -gt 0 ] && echo "  ${C_RED}Failed:${C_RESET}     $FAIL"

if [ "$OK" -gt 0 ]; then
  SAVED=$(( SRC_TOTAL - DST_TOTAL ))
  PCT=$(awk -v s="$SRC_TOTAL" -v d="$DST_TOTAL" 'BEGIN{ if(s>0) printf "%.1f", (1 - d/s)*100; else print "0.0" }')
  echo ""
  echo "  Original size:   $(human "$SRC_TOTAL")"
  echo "  WebP size:       $(human "$DST_TOTAL")"
  echo "  ${C_BOLD}${C_GREEN}Saved:           $(human "$SAVED") ($PCT%)${C_RESET}"
fi

if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "${C_RED}Failed files:${C_RESET}"
  awk -F'|' '$1=="FAIL"{print "  " $2}' "$RESULTS"
fi
