import { getInkLibState, deductInkStock } from "./db.js";

// A pot is LOW when its reorder flag is set (boolean in ink-library) or its weight is at
// or below this. Tune here.
const LOW_THRESHOLD_G = 500;

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

  // Field shapes per ink-library (actions.js): pantone {id, code, weight, loc, reorder:bool},
  // rio {id, name, openWeight, loc} (no weight, no reorder), base {id, name, weight, loc,
  // reorder:bool}. Pots are addressed by stable id, never array index.
  (_inkState.pantone ?? []).forEach((ink) => {
    const weight = ink.weight ?? 0;
    inks.push({
      type: "pantone", id: ink.id,
      code: ink.code, name: ink.name ?? ink.code,
      weight,
      low: ink.reorder === true || weight <= LOW_THRESHOLD_G,
      shelf: ink.loc ?? "",
    });
  });

  (_inkState.rio ?? []).forEach((ink) => {
    const weight = ink.openWeight ?? 0;
    inks.push({
      type: "rio", id: ink.id,
      code: ink.code ?? ink.name, name: ink.name,
      weight,
      low: ink.reorder === true || weight <= LOW_THRESHOLD_G,
      shelf: ink.loc ?? "",
    });
  });

  (_inkState.base ?? []).forEach((ink) => {
    const weight = ink.weight ?? ink.current ?? 0;
    inks.push({
      type: "base", id: ink.id,
      code: ink.name, name: ink.name,
      weight,
      low: ink.reorder === true || weight <= LOW_THRESHOLD_G,
      shelf: ink.loc ?? "",
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
            id: input.dataset.id,
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
        const skipped = await deductInkStock(selected.map(s => ({ type: s.type, id: s.id, amount: s.amount })));
        // Pots deleted/combined on the floor since the picker loaded: not deducted, not
        // logged on the job — tell the user instead of guessing.
        const applied = selected.filter(s => !skipped.some(k => k.type === s.type && k.id === s.id));
        if (skipped.length) {
          const names = selected
            .filter(s => skipped.some(k => k.type === s.type && k.id === s.id))
            .map(s => s.code || s.name).join(", ");
          alert(`Not deducted — these pots are no longer in the ink library (deleted or combined): ${names}.\n\nReopen this stage to see the current list.`);
        }
        if (applied.length) onSave(applied);
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
          data-id="${ink.id ?? ""}"
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
  return getAllInks().filter(ink => {
    if (!ink.low) return false;
    // Empty strings must never match — "".includes("") is true for everything.
    const code = (ink.code ?? "").toLowerCase();
    const name = (ink.name ?? "").toLowerCase();
    return (code !== "" && notes.includes(code)) || (name !== "" && notes.includes(name));
  });
}

function gramsFmt(g) {
  if (g >= 1000) return (g / 1000).toFixed(1) + "kg";
  return (g ?? 0) + "g";
}
