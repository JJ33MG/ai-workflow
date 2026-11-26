// Etsy Stats / Ads upload on the overview: files (dragged or chosen) and a note go to the marketing agent.
import { $, api, toast } from "./core.js";

let files = [];

function show() {
  $("stats-files").textContent = files.length ? files.map((f) => `📎 ${f.name}`).join("  ") : "of sleep bestanden hierheen";
}

function add(list) {
  for (const file of list) {
    if (file.size > 20 * 1024 * 1024) continue;
    const reader = new FileReader();
    reader.onload = () => {
      files.push({ name: file.name, type: file.type, data: String(reader.result).split(",")[1] ?? "" });
      show();
    };
    reader.readAsDataURL(file);
  }
}

export function renderStatsUpload(d) {
  const s = d?.etsyStats;
  $("stats-last").textContent = s
    ? `Laatst verwerkt: ${s.period} (geüpload ${new Date(s.uploadedAt).toLocaleDateString("nl-NL")}). ${(s.facts ?? []).join(" ")}`
    : "Nog niets geüpload.";
}

export function initStatsUpload() {
  const drop = $("stats-drop");
  $("stats-pick").addEventListener("click", () => $("stats-file").click());
  $("stats-file").addEventListener("change", (e) => {
    add(e.target.files);
    e.target.value = "";
  });
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("drag-over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag-over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("drag-over");
    if (e.dataTransfer?.files?.length) add(e.dataTransfer.files);
  });
  $("stats-send").addEventListener("click", async (e) => {
    const button = e.currentTarget;
    const note = $("stats-note").value.trim();
    if (!files.length && !note) return toast("Kies een bestand of schrijf een notitie");
    button.disabled = true;
    button.textContent = "Bezig… (tot een minuut)";
    try {
      const res = await api("/api/marketing/etsy-stats", { method: "POST", body: JSON.stringify({ attachments: files, note }) });
      toast(res.message);
      files = [];
      $("stats-note").value = "";
      show();
      $("stats-last").textContent = `Laatst verwerkt: ${res.stats.period}. ${(res.stats.facts ?? []).join(" ")}`;
    } catch (err) {
      toast(`Mislukt: ${err.message}`);
    } finally {
      button.disabled = false;
      button.textContent = "Verwerken";
    }
  });
}
