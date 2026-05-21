const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { open } = window.__TAURI__.dialog;

const $ = (id) => document.getElementById(id);

const els = {
  inputDir: $("input-dir"),
  outputDir: $("output-dir"),
  pickInput: $("pick-input"),
  pickOutput: $("pick-output"),
  scanStats: $("scan-stats"),
  modeTabs: document.querySelectorAll(".mode-tab"),
  modeQuality: $("mode-quality"),
  modeTargetSize: $("mode-target_size"),
  modePercentage: $("mode-percentage"),
  quality: $("quality"),
  qualityVal: $("quality-val"),
  sizeMax: $("size-max"),
  sizeMin: $("size-min"),
  percent: $("percent"),
  percentVal: $("percent-val"),
  parallel: $("parallel"),
  recursive: $("recursive"),
  skipExisting: $("skip-existing"),
  losslessPng: $("lossless-png"),
  convertBtn: $("convert-btn"),
  statusLine: $("status-line"),
  progressCard: $("progress-card"),
  progressText: $("progress-text"),
  progressPct: $("progress-pct"),
  barFill: $("bar-fill"),
  lastFile: $("last-file"),
  summaryCard: $("summary-card"),
  sOk: $("s-ok"),
  sSkip: $("s-skip"),
  sFail: $("s-fail"),
  sSrc: $("s-src"),
  sDst: $("s-dst"),
  sSaved: $("s-saved"),
  failDetails: $("fail-details"),
  failList: $("fail-list"),
};

let currentMode = "quality";

function humanBytes(b) {
  if (!Number.isFinite(b)) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function basename(p) {
  if (!p) return "";
  const norm = p.replace(/\\/g, "/");
  return norm.substring(norm.lastIndexOf("/") + 1);
}

function refreshConvertBtn() {
  els.convertBtn.disabled = !els.inputDir.value || !els.outputDir.value;
}

function setStatus(msg, isError) {
  els.statusLine.textContent = msg || "";
  els.statusLine.classList.toggle("error", !!isError);
}

function setMode(mode) {
  currentMode = mode;
  els.modeTabs.forEach((t) => t.classList.toggle("active", t.dataset.mode === mode));
  els.modeQuality.classList.toggle("hidden", mode !== "quality");
  els.modeTargetSize.classList.toggle("hidden", mode !== "target_size");
  els.modePercentage.classList.toggle("hidden", mode !== "percentage");
}

els.modeTabs.forEach((tab) => {
  tab.addEventListener("click", () => setMode(tab.dataset.mode));
});

els.quality.addEventListener("input", () => {
  els.qualityVal.textContent = els.quality.value;
});

els.percent.addEventListener("input", () => {
  els.percentVal.textContent = els.percent.value;
});

els.pickInput.addEventListener("click", async () => {
  const selected = await open({ directory: true, multiple: false, title: "Pick input folder" });
  if (selected) {
    els.inputDir.value = selected;
    if (!els.outputDir.value) {
      els.outputDir.value = `${selected}-webp`;
    }
    refreshConvertBtn();
    autoScan();
  }
});

els.pickOutput.addEventListener("click", async () => {
  const selected = await open({ directory: true, multiple: false, title: "Pick output folder" });
  if (selected) {
    els.outputDir.value = selected;
    refreshConvertBtn();
  }
});

async function autoScan() {
  if (!els.inputDir.value) return;
  els.scanStats.textContent = "Scanning…";
  try {
    const r = await invoke("scan", {
      inputDir: els.inputDir.value,
      recursive: els.recursive.checked,
    });
    if (r.count === 0) {
      els.scanStats.textContent = "No supported images found in this folder.";
      setStatus("");
      return;
    }
    els.scanStats.textContent =
      `${r.count} file${r.count === 1 ? "" : "s"} · ` +
      `smallest ${humanBytes(r.min_bytes)} · ` +
      `largest ${humanBytes(r.max_bytes)} · ` +
      `median ${humanBytes(r.median_bytes)} · ` +
      `total ${humanBytes(r.total_bytes)}`;
    setStatus("");
  } catch (e) {
    els.scanStats.textContent = "";
    setStatus(String(e), true);
  }
}

els.recursive.addEventListener("change", autoScan);

function buildCompression() {
  if (currentMode === "quality") {
    return { mode: "quality", quality: parseInt(els.quality.value, 10) };
  }
  if (currentMode === "target_size") {
    const maxKb = parseInt(els.sizeMax.value, 10);
    const minRaw = els.sizeMin.value.trim();
    const minKb = minRaw === "" ? null : parseInt(minRaw, 10);
    if (!Number.isFinite(maxKb) || maxKb <= 0) {
      throw new Error("Max size must be a positive number of KB.");
    }
    if (minKb !== null && (!Number.isFinite(minKb) || minKb < 0)) {
      throw new Error("Min size must be a non-negative number of KB.");
    }
    if (minKb !== null && minKb >= maxKb) {
      throw new Error("Min size must be less than max size.");
    }
    return {
      mode: "target_size",
      max_bytes: maxKb * 1024,
      min_bytes: minKb === null ? null : minKb * 1024,
    };
  }
  if (currentMode === "percentage") {
    return { mode: "percentage", percent: parseInt(els.percent.value, 10) };
  }
  throw new Error(`Unknown mode: ${currentMode}`);
}

let unlistenProgress = null;

els.convertBtn.addEventListener("click", async () => {
  let compression;
  try {
    compression = buildCompression();
  } catch (e) {
    setStatus(e.message, true);
    return;
  }

  els.convertBtn.disabled = true;
  els.pickInput.disabled = true;
  els.pickOutput.disabled = true;
  els.summaryCard.classList.add("hidden");
  els.progressCard.classList.remove("hidden");
  els.progressText.textContent = "0 / 0";
  els.progressPct.textContent = "0%";
  els.barFill.style.width = "0%";
  els.lastFile.textContent = "";
  setStatus("Converting…");

  if (unlistenProgress) { unlistenProgress(); unlistenProgress = null; }
  unlistenProgress = await listen("convert:progress", (ev) => {
    const { done, total, last } = ev.payload;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    els.progressText.textContent = `${done} / ${total}`;
    els.progressPct.textContent = `${pct}%`;
    els.barFill.style.width = `${pct}%`;
    if (last) {
      let tag = "✓";
      if (last.status === "skip") tag = "↷";
      else if (last.status === "fail") tag = "✗";
      else if (last.action === "preserved") tag = "✓";
      const note = last.action === "preserved" ? " (preserved)" : "";
      els.lastFile.textContent = `${tag} ${basename(last.source)}${note}`;
    }
  });

  try {
    const summary = await invoke("convert", {
      options: {
        input_dir: els.inputDir.value,
        output_dir: els.outputDir.value,
        compression,
        parallel: parseInt(els.parallel.value, 10),
        recursive: els.recursive.checked,
        skip_existing: els.skipExisting.checked,
        force_lossless_png: els.losslessPng.checked,
      },
    });
    showSummary(summary);
    setStatus("");
  } catch (e) {
    setStatus(String(e), true);
  } finally {
    if (unlistenProgress) { unlistenProgress(); unlistenProgress = null; }
    els.convertBtn.disabled = false;
    els.pickInput.disabled = false;
    els.pickOutput.disabled = false;
    refreshConvertBtn();
  }
});

function showSummary(s) {
  els.sOk.textContent = s.converted;
  els.sSkip.textContent = s.skipped;
  els.sFail.textContent = s.failed;
  els.sSrc.textContent = humanBytes(s.source_total_bytes);
  els.sDst.textContent = humanBytes(s.dest_total_bytes);
  const saved = Math.max(0, s.source_total_bytes - s.dest_total_bytes);
  const pct = s.source_total_bytes > 0
    ? ((1 - s.dest_total_bytes / s.source_total_bytes) * 100).toFixed(1)
    : "0.0";
  els.sSaved.textContent = `${humanBytes(saved)} (${pct}%)`;

  if (s.failed_files && s.failed_files.length > 0) {
    els.failList.innerHTML = "";
    for (const f of s.failed_files) {
      const li = document.createElement("li");
      li.textContent = f;
      els.failList.appendChild(li);
    }
    els.failDetails.classList.remove("hidden");
  } else {
    els.failDetails.classList.add("hidden");
  }

  els.summaryCard.classList.remove("hidden");
}
