import { getInkLibState } from "./db.js";

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

// ── Mix-readiness checklist for the "Inks Mixed" stage ───────────────────────
// anchor-production is READ-ONLY on inklib/state: this shows the job's required
// colours against current stock so staff can prep ahead — mix or locate each colour,
// tick it off. It never writes to the ink library; actual stock movements are logged
// in the floor app. Ticks persist on the job (inkPrep on production_jobs) via the
// onPrepChange callback — jobs.js owns that write.

export function parseJobColours(inkColours) {
  return String(inkColours ?? "").split(/[,;\n/]+/).map(s => s.trim()).filter(Boolean);
}

// Loose display-aid match of a job colour ("PMS 286", "white") to pots in stock.
const _compact = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
function potsForColour(colour) {
  const c = _compact(String(colour).replace(/^\s*(pantone|pms)\s*/i, ""));
  if (!c) return [];
  return getAllInks().filter(ink => {
    const code = _compact(ink.code);
    const name = _compact(ink.name);
    return (code !== "" && (code.startsWith(c) || c.startsWith(code))) ||
           (name !== "" && (name.includes(c) || c.includes(name)));
  });
}

export function renderInkChecklist(container, job, user, { onPrepChange, onComplete, onRecipeFlag }) {
  loadInkState().then(() => {
    const colours = parseJobColours(job.inkColours);
    const existing = Array.isArray(job.inkPrep) ? job.inkPrep : [];
    // Rebuild from the job's colour list each time, carrying ticks over by colour text —
    // so an edited colour list adds/drops rows without losing existing ticks.
    const prep = colours.map(col => {
      const prev = existing.find(p => p.colour === col);
      return {
        colour: col, done: !!(prev && prev.done), by: prev?.by ?? null, at: prev?.at ?? null,
        recipeRequested: !!(prev && prev.recipeRequested),
      };
    });

    const render = () => {
      const allDone = prep.every(p => p.done);
      container.innerHTML = `
        <div class="ink-picker">
          <h3 class="ink-picker-title">Ink Prep</h3>
          <p class="ink-picker-sub">Tick each colour once it's mixed or located. Stock is read-only here — log actual usage in the Ink Library app.</p>
          ${prep.length ? prep.map((p, i) => {
            const pots = potsForColour(p.colour);
            const potRows = pots.length
              ? pots.map(potRow).join("")
              : '<p class="ink-empty">No pots in stock — needs mixing.</p>';
            return `
              <div class="ink-section${p.done ? " ink-prep-done" : ""}">
                <div class="ink-check-row">
                  <label class="ink-check-label">
                    <input type="checkbox" class="ink-check" data-i="${i}" ${p.done ? "checked" : ""}>
                    <span class="ink-check-colour">${p.colour}</span>
                  </label>
                  ${p.done && p.by ? `<span class="ink-check-by">✓ ${p.by}</span>` : ""}
                  ${!p.done ? `<button class="btn-recipe${p.recipeRequested ? " on" : ""}" data-ri="${i}" title="Ask HQ to print a recipe label for this pot">${p.recipeRequested ? "✓ Recipe requested" : "🏷 Needs recipe"}</button>` : ""}
                </div>
                <div class="ink-list">${potRows}</div>
              </div>`;
          }).join("") : '<p class="ink-empty">No ink colours listed on this job — nothing to prep.</p>'}
          <button class="btn btn-primary ink-save-btn" id="ink-advance" ${prep.length && !allDone ? "disabled" : ""}>
            ${prep.length && !allDone
              ? `Tick all ${prep.length} colour${prep.length > 1 ? "s" : ""} to advance`
              : "✓ Inks ready — advance stage"}
          </button>
        </div>
      `;

      container.querySelectorAll(".ink-check").forEach(cb => {
        cb.addEventListener("change", async (e) => {
          const p = prep[+e.target.dataset.i];
          p.done = e.target.checked;
          p.by = user;
          p.at = new Date().toISOString();
          if (p.done) p.recipeRequested = false; // mixed — a label request is no longer needed
          render();
          try {
            // Ticking mixed auto-closes any open recipe request for this job+colour,
            // including ones flagged from another device.
            if (p.done && onRecipeFlag) await onRecipeFlag(p.colour, false);
            await onPrepChange(prep.map(x => ({ ...x })));
          } catch (err) {
            alert("Couldn't save the tick — check your connection: " + err.message);
          }
        });
      });

      container.querySelectorAll(".btn-recipe").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          const p = prep[+e.currentTarget.dataset.ri];
          const flagged = !p.recipeRequested;
          p.recipeRequested = flagged;
          render();
          try {
            if (onRecipeFlag) await onRecipeFlag(p.colour, flagged);
            await onPrepChange(prep.map(x => ({ ...x })));
          } catch (err) {
            alert("Couldn't update the recipe request — check your connection: " + err.message);
          }
        });
      });

      document.getElementById("ink-advance")?.addEventListener("click", () => onComplete());
    };

    render();
  });
}

function potRow(ink) {
  return `
    <div class="ink-row${ink.low ? " ink-low" : ""}">
      <div class="ink-row-info">
        <span class="ink-code">${ink.code}</span>
        <span class="ink-name">${ink.name !== ink.code ? ink.name : ""}</span>
        ${ink.low ? '<span class="ink-low-badge">LOW</span>' : ""}
        <span class="ink-weight">${gramsFmt(ink.weight)}</span>
        ${ink.shelf ? `<span class="ink-shelf">${ink.shelf}</span>` : ""}
      </div>
    </div>
  `;
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
