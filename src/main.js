const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const { open } = window.__TAURI__.dialog;

const $ = (id) => document.getElementById(id);

const els = {
  inputDir: $("input-dir"),
  outputDir: $("output-dir"),
  pickInput: $("pick-input"),
  pickOutput: $("pick-output"),
  quality: $("quality"),
  qualityVal: $("quality-val"),
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

els.quality.addEventListener("input", () => {
  els.qualityVal.textContent = els.quality.value;
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
  try {
    const n = await invoke("scan", {
      inputDir: els.inputDir.value,
      recursive: els.recursive.checked,
    });
    setStatus(n === 0 ? "No supported images found in this folder." : `Found ${n} image${n === 1 ? "" : "s"}.`);
  } catch (e) {
    setStatus(String(e), true);
  }
}

els.recursive.addEventListener("change", autoScan);

let unlistenProgress = null;

els.convertBtn.addEventListener("click", async () => {
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
      const tag = last.status === "ok" ? "✓" : last.status === "skip" ? "↷" : "✗";
      els.lastFile.textContent = `${tag} ${basename(last.source)}`;
    }
  });

  try {
    const summary = await invoke("convert", {
      options: {
        input_dir: els.inputDir.value,
        output_dir: els.outputDir.value,
        quality: parseInt(els.quality.value, 10),
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
