import { getInkLibState, deductInkStock } from "./db.js";

let _inkState = null;

export async function loadInkState() {
  _inkState = await getInkLibState();
  return _inkState;
}

export function getInkState() { return _inkState; }

// Returns all inks with a low-stock flag
export function getAllInks() {
  if (!_inkState) return [];
  const inks = [];

  (_inkState.pantone ?? []).forEach((ink, i) => {
    inks.push({
      type: "pantone", index: i,
      code: ink.code, name: ink.name ?? ink.code,
      weight: ink.weight ?? 0, threshold: ink.reorder ?? 500,
      low: (ink.weight ?? 0) <= (ink.reorder ?? 500),
      shelf: ink.shelf ?? "",
    });
  });

  (_inkState.rio ?? []).forEach((ink, i) => {
    inks.push({
      type: "rio", index: i,
      code: ink.code ?? ink.name, name: ink.name,
      weight: ink.weight ?? 0, threshold: ink.reorder ?? 1000,
      low: (ink.weight ?? 0) <= (ink.reorder ?? 1000),
      shelf: ink.shelf ?? "",
    });
  });

  (_inkState.base ?? []).forEach((ink, i) => {
    const threshold = ink.reorder ?? 2500;
    inks.push({
      type: "base", index: i,
      code: ink.name, name: ink.name,
      weight: ink.weight ?? ink.current ?? 0, threshold,
      low: (ink.weight ?? ink.current ?? 0) <= threshold,
      shelf: "",
    });
  });

  return inks;
}

// Render an ink picker for the "Inks Mixed" stage
export function renderInkPicker(container, jobColours, onSave) {
  loadInkState().then(() => {
    const inks = getAllInks();
    const pantoneInks = inks.filter(i => i.type === "pantone");
    const rioInks     = inks.filter(i => i.type === "rio");
    const baseInks    = inks.filter(i => i.type === "base");

    container.innerHTML = `
      <div class="ink-picker">
        <h3 class="ink-picker-title">Log Inks Used</h3>
        <p class="ink-picker-sub">
          Job colours: <strong>${jobColours || "—"}</strong>
        </p>

        <div class="ink-section">
          <div class="ink-section-header">Pantone / Custom</div>
          <div class="ink-search-wrap">
            <input type="text" id="ink-search" class="ink-search" placeholder="Search Pantone code or name…">
          </div>
          <div class="ink-list" id="pantone-list">
            ${renderInkRows(pantoneInks)}
          </div>
        </div>

        <div class="ink-section">
          <div class="ink-section-header">Rio Colours</div>
          <div class="ink-list">
            ${renderInkRows(rioInks)}
          </div>
        </div>

        <div class="ink-section">
          <div class="ink-section-header">Base Inks</div>
          <div class="ink-list">
            ${renderInkRows(baseInks)}
          </div>
        </div>

        <button class="btn btn-primary ink-save-btn" id="ink-save">
          Save & Deduct Stock
        </button>
      </div>
    `;

    // Search filter for pantone
    document.getElementById("ink-search").addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      document.querySelectorAll("#pantone-list .ink-row").forEach(row => {
        const text = row.dataset.search ?? "";
        row.style.display = text.includes(q) ? "" : "none";
      });
    });

    // Save button
    document.getElementById("ink-save").addEventListener("click", async () => {
      const selected = [];
      container.querySelectorAll(".ink-amount-input").forEach(input => {
        const val = parseFloat(input.value);
        if (val > 0) {
          selected.push({
            type: input.dataset.type,
            index: parseInt(input.dataset.index),
            code: input.dataset.code,
            name: input.dataset.name,
            amount: val,
          });
        }
      });
      if (selected.length === 0) {
        alert("Enter an amount for at least one ink.");
        return;
      }
      try {
        await deductInkStock(selected.map(s => ({ type: s.type, index: s.index, amount: s.amount })));
        onSave(selected);
      } catch (e) {
        alert("Failed to deduct stock: " + e.message);
      }
    });
  });
}

function renderInkRows(inks) {
  if (!inks.length) return '<p class="ink-empty">None found</p>';
  return inks.map(ink => `
    <div class="ink-row${ink.low ? " ink-low" : ""}" data-search="${(ink.code + " " + ink.name).toLowerCase()}">
      <div class="ink-row-info">
        <span class="ink-code">${ink.code}</span>
        <span class="ink-name">${ink.name !== ink.code ? ink.name : ""}</span>
        ${ink.low ? '<span class="ink-low-badge">LOW</span>' : ""}
        <span class="ink-weight">${gramsFmt(ink.weight)}</span>
      </div>
      <div class="ink-row-input">
        <input
          type="number" min="0" step="50"
          class="ink-amount-input"
          placeholder="g used"
          data-type="${ink.type}"
          data-index="${ink.index}"
          data-code="${ink.code}"
          data-name="${ink.name}"
        >
        <span class="ink-unit">g</span>
      </div>
    </div>
  `).join("");
}

// Check which inks are low that appear in a job's colour list
export function checkLowInks(jobColourNotes) {
  if (!_inkState || !jobColourNotes) return [];
  const notes = jobColourNotes.toLowerCase();
  return getAllInks().filter(ink =>
    ink.low && (
      notes.includes(ink.code.toLowerCase()) ||
      notes.includes((ink.name ?? "").toLowerCase())
    )
  );
}

function gramsFmt(g) {
  if (g >= 1000) return (g / 1000).toFixed(1) + "kg";
  return (g ?? 0) + "g";
}
