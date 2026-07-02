import { createJob, updateJob, deleteJob, getJob, watchJobs, createNotification, createRecipeRequest, closeRecipeRequests } from "./db.js";
import { session } from "./auth.js";
import { STAGES, STAGE_COLOURS } from "./config.js";
import { renderInkChecklist, checkLowInks, loadInkState } from "./ink.js";
import { showMockupModal } from "./mockup.js";

// ── Anchor End HQ (Mockup Maker) deploy URL ───────────────────────────────────
// The "Open in Mockup Maker" button deep-links to HQ with ?job=<this job's id>.
const HQ_URL = "https://anchorendhq.netlify.app";

let _jobs = [];
let _customers = [];
let _onJobsChange = null;

export function setCustomers(c) { _customers = c; }

export function initJobs(onChange) {
  _onJobsChange = onChange;
  return watchJobs((jobs) => {
    _jobs = jobs;
    onChange(jobs);
  });
}

export function getJobs() { return _jobs; }

// ── Parse quote JSON from calculator ─────────────────────────────────────────
export function parseQuoteJson(raw) {
  try {
    const q = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      customerName:    q.customer_name ?? q.customerName ?? "",
      customerEmail:   q.customer_email ?? q.customerEmail ?? "",
      customerPhone:   q.customer_phone ?? q.customerPhone ?? "",
      garmentType:     q.garment_type ?? q.garmentType ?? q.run?.garment_type ?? "",
      garmentColour:   q.garment_colour ?? q.garmentColour ?? "",
      quantity:        q.quantity ?? q.run?.qty ?? 0,
      sizes:           q.sizes ?? { S: 0, M: 0, L: 0, XL: 0, XXL: 0 },
      colours:         q.colours ?? q.run?.colours ?? q.run?.positions?.length ?? 1,
      locations:       q.locations ?? q.run?.positions?.length ?? 1,
      positions:       q.positions ?? q.run?.positions ?? [],
      quoteRef:        q.quote_ref ?? q.quoteRef ?? "",
      quoteValue:      q.total ?? q.value ?? q.quote_value ?? 0,
      notes:           q.notes ?? q.quote_notes ?? "",
      inkColours:      q.ink_colours ?? q.inkColours ?? "",
    };
  } catch { return null; }
}

// ── Create a new job ──────────────────────────────────────────────────────────
export async function submitCreateJob(formData) {
  const screenCount = (formData.colours || 1) * (formData.locations || 1);
  const job = {
    ...formData,
    screenCount,
    stage: 0,
    stageHistory: [{
      stage: 0, label: STAGES[0].label,
      by: session.user, at: new Date().toISOString(),
    }],
    inkUsage: [],
    garmentCounts: { expected: formData.quantity || 0, received: 0, printed: 0, final: 0 },
    createdBy: session.user,
    active: true,
  };
  const ref = await createJob(job);
  return ref.id;
}

// ── Advance a job to the next stage ──────────────────────────────────────────
export async function advanceStage(jobId, extraData = {}) {
  const job = await getJob(jobId);
  if (!job) throw new Error("Job not found");
  if (job.stage >= STAGES.length - 1) throw new Error("Already at final stage");

  const nextStage = job.stage + 1;
  const historyEntry = {
    stage: nextStage, label: STAGES[nextStage].label,
    by: session.user, at: new Date().toISOString(),
  };

  await updateJob(jobId, {
    stage: nextStage,
    stageHistory: [...(job.stageHistory ?? []), historyEntry],
    ...extraData,
  });

  await createNotification({
    jobId,
    jobRef: job.quoteRef || jobId,
    customerName: job.customerName,
    stage: nextStage,
    stageLabel: STAGES[nextStage].label,
    by: session.user,
    type: "stage_advance",
  });

  return nextStage;
}

// ── Move a job back one stage (admin only, floor at stage 1) ─────────────────
// Mirror of advanceStage: same stageHistory entry shape, label annotated so the
// audit trail shows it was a reversal, not a re-advance.
export async function backStage(jobId) {
  const job = await getJob(jobId);
  if (!job) throw new Error("Job not found");
  if (job.stage <= 1) throw new Error("Can't go back further than " + STAGES[1].label);

  const prevStage = job.stage - 1;
  const historyEntry = {
    stage: prevStage, label: STAGES[prevStage].label + " (moved back)",
    by: session.user, at: new Date().toISOString(),
  };

  await updateJob(jobId, {
    stage: prevStage,
    stageHistory: [...(job.stageHistory ?? []), historyEntry],
  });

  return prevStage;
}

// ── Update garment counts ─────────────────────────────────────────────────────
export async function updateCounts(jobId, counts) {
  const job = await getJob(jobId);
  const updated = { ...job.garmentCounts, ...counts };
  await updateJob(jobId, { garmentCounts: updated });

  // Flag mismatch between expected and received
  if (counts.received != null && counts.received !== job.garmentCounts.expected) {
    await createNotification({
      jobId,
      jobRef: job.quoteRef || jobId,
      customerName: job.customerName,
      type: "count_mismatch",
      expected: job.garmentCounts.expected,
      received: counts.received,
      by: session.user,
    });
  }
}

// ── Render job board ──────────────────────────────────────────────────────────
export function renderBoard(jobs, container, onSelectJob) {
  loadInkState();
  const active = jobs.filter(j => j.active !== false);

  if (!active.length) {
    container.innerHTML = `<p class="empty-state">No active jobs. Create one to get started.</p>`;
    return;
  }

  // Group by stage
  const byStage = {};
  STAGES.forEach(s => { byStage[s.id] = []; });
  active.forEach(j => { (byStage[j.stage] = byStage[j.stage] ?? []).push(j); });

  container.innerHTML = `
    <div class="board-scroll">
      <div class="board-lanes">
        ${STAGES.map(s => `
          <div class="lane" data-stage="${s.id}">
            <div class="lane-header" style="border-top: 3px solid ${STAGE_COLOURS[s.id]}">
              <span class="lane-label">${s.label}</span>
              <span class="lane-count">${byStage[s.id].length}</span>
            </div>
            <div class="lane-cards">
              ${byStage[s.id].map(j => jobCard(j)).join("") || '<div class="lane-empty">—</div>'}
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `;

  container.querySelectorAll(".job-card").forEach(card => {
    card.addEventListener("click", () => {
      const job = active.find(j => j.id === card.dataset.id);
      if (job) onSelectJob(job);
    });
  });

  // Admin back-a-stage on the card — stopPropagation so the card click doesn't open detail
  container.querySelectorAll("[data-back-id]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const job = active.find(j => j.id === btn.dataset.backId);
      if (!job || job.stage <= 1) return;
      if (!confirm(`Move this job back to ${STAGES[job.stage - 1].label}?`)) return;
      try {
        await backStage(job.id);
      } catch (err) {
        alert("Couldn't move the job back: " + err.message);
      }
    });
  });
}

function jobCard(job) {
  const low = checkLowInks(job.inkColours ?? job.notes ?? "");
  const prep = Array.isArray(job.inkPrep) ? job.inkPrep : [];
  const prepDone = prep.filter(p => p.done).length;
  return `
    <div class="job-card" data-id="${job.id}">
      <div class="job-card-header">
        <span class="job-customer">${job.customerName}</span>
        ${job.quoteRef ? `<span class="job-ref">${job.quoteRef}</span>` : ""}
      </div>
      <div class="job-garment">${job.garmentType || "—"} × ${job.quantity || 0}</div>
      <div class="job-meta">
        <span>${job.colours ?? 1} col · ${job.screenCount ?? 1} screens</span>
        ${job.garmentColour ? `<span class="job-colour-dot" title="${job.garmentColour}">●</span>` : ""}
      </div>
      ${prep.length ? `<div class="job-ink-prep${prepDone === prep.length ? " done" : ""}">Inks prepped: ${prepDone}/${prep.length}</div>` : ""}
      ${low.length ? `<div class="job-ink-warn">⚠ Low ink: ${low.map(i => i.code).join(", ")}</div>` : ""}
      ${session.isAdmin && job.stage > 1 ? `<button class="btn-stage-back" data-back-id="${job.id}" title="Admin: move this job back one stage">← Back a stage</button>` : ""}
    </div>
  `;
}

// ── Render job detail ─────────────────────────────────────────────────────────
export function renderJobDetail(job, container, onUpdate) {
  const stage = STAGES[job.stage];
  const isLast = job.stage >= STAGES.length - 1;
  const isInkStage = job.stage === 6; // inks_mixed
  const isReceiveStage = job.stage === 7; // garments_received
  const gc = job.garmentCounts ?? {};

  container.innerHTML = `
    <div class="detail-wrap">
      <div class="detail-header">
        <div>
          <h2 class="detail-customer">${job.customerName}</h2>
          ${job.quoteRef ? `<span class="detail-ref">${job.quoteRef}</span>` : ""}
        </div>
        <div class="stage-badge" style="background:${STAGE_COLOURS[job.stage]}20;color:${STAGE_COLOURS[job.stage]};border:1px solid ${STAGE_COLOURS[job.stage]}40">
          ${stage.label}
        </div>
      </div>

      <!-- Customer -->
      <div class="detail-section">
        <h3 class="detail-section-title">Customer</h3>
        <div class="detail-grid">
          <div class="detail-field"><label>Email</label><span>${job.customerEmail || "—"}</span></div>
          <div class="detail-field"><label>Phone</label><span>${job.customerPhone || "—"}</span></div>
        </div>
      </div>

      <!-- Garment -->
      <div class="detail-section">
        <h3 class="detail-section-title">Garment</h3>
        <div class="detail-grid">
          <div class="detail-field"><label>Type</label><span>${job.garmentType || "—"}</span></div>
          <div class="detail-field"><label>Colour</label><span>${job.garmentColour || "—"}</span></div>
          <div class="detail-field"><label>Quantity</label><span>${job.quantity || 0}</span></div>
        </div>
        ${job.sizes ? `
          <div class="size-breakdown">
            ${["S","M","L","XL","XXL"].map(s => `
              <div class="size-cell">
                <span class="size-label">${s}</span>
                <span class="size-qty">${job.sizes[s] || 0}</span>
              </div>
            `).join("")}
          </div>
        ` : ""}
      </div>

      <!-- Print spec -->
      <div class="detail-section">
        <h3 class="detail-section-title">Print Specification</h3>
        <div class="detail-grid">
          <div class="detail-field"><label>Colours</label><span>${job.colours ?? 1}</span></div>
          <div class="detail-field"><label>Locations</label><span>${job.locations ?? 1}</span></div>
          <div class="detail-field"><label>Screens</label><span>${job.screenCount ?? "—"}</span></div>
        </div>
        ${(job.positions?.length) ? `
          <div class="positions-list">
            ${job.positions.map(p => `
              <div class="position-row">
                <span class="position-name">${p.name ?? p}</span>
                ${p.colours ? `<span class="position-colours">${p.colours} colour${p.colours !== 1 ? "s" : ""}</span>` : ""}
              </div>
            `).join("")}
          </div>
        ` : ""}
        ${job.inkColours ? `<div class="ink-colours-note">Ink colours: ${job.inkColours}</div>` : ""}
      </div>

      <!-- Mockup: send button (stage 1 only, no mockup sent yet or changes requested) -->
      ${job.stage === 1 ? `
        <div class="detail-section">
          <h3 class="detail-section-title">Mockup</h3>
          <p class="detail-helper">Build the proof in the Mockup Maker — it sends the approval email and saves the PDF here. Or upload an image and send it manually.</p>
          <a class="btn btn-primary" href="${HQ_URL}/?job=${job.id}" target="_blank" rel="noopener">Open in Mockup Maker →</a>
          <button class="btn btn-ghost" id="send-mockup-btn" style="margin-top:6px">Send a mockup image manually</button>
        </div>
      ` : ""}

      <!-- Mockup: approved or changes_requested panel -->
      ${job.mockup?.status === "approved" ? `
        <div class="detail-section">
          <h3 class="detail-section-title">Mockup</h3>
          <div class="mockup-approved-banner">
            ✓ Approved${job.mockup.approvedByClient ? ` by ${job.mockup.approvedByClient}` : " by client"}
            ${job.mockup.approvedAt ? ` · ${formatDate(job.mockup.approvedAt)}` : ""}
          </div>
          ${job.mockup.imageUrl ? `<img class="mockup-image" src="${job.mockup.imageUrl}" alt="Approved mockup">` : ""}
          ${job.mockup.notes ? `<div class="mockup-notes">${job.mockup.notes}</div>` : ""}
        </div>
      ` : job.mockup?.status === "changes_requested" ? `
        <div class="detail-section">
          <h3 class="detail-section-title">Mockup</h3>
          <div class="mockup-changes-banner">
            ↩ Changes requested${job.mockup.changesRequestedBy ? ` by ${job.mockup.changesRequestedBy}` : ""}
            ${job.mockup.changesRequestedAt ? ` · ${formatDate(job.mockup.changesRequestedAt)}` : ""}
            ${job.mockup.clientMessage ? `<div class="mockup-changes-msg">"${job.mockup.clientMessage}"</div>` : ""}
          </div>
          ${job.mockup.imageUrl ? `<img class="mockup-image" src="${job.mockup.imageUrl}" alt="Mockup (changes requested)">` : ""}
          ${job.stage === 1 ? `<div style="margin-top:12px"><button class="btn btn-primary btn-sm" id="send-mockup-btn">Send revised mockup →</button></div>` : ""}
        </div>
      ` : ""}

      <!-- Mockup send log -->
      ${job.mockupSendLog?.length ? `
        <div class="detail-section">
          <h3 class="detail-section-title">Mockup send history</h3>
          <div class="send-log">
            ${job.mockupSendLog.map(e => `
              <div class="send-log-row">
                <span class="send-log-to">${e.sentTo ?? "—"}</span>
                <span class="send-log-meta">${e.via === "mailto" ? "via email app" : "via Anchor End"} · ${formatDate(e.sentAt)}</span>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}

      <!-- Checked against mockup (stage >= 2 with approved mockup) -->
      ${job.stage >= 2 && job.mockup?.status === "approved" ? `
        <div class="detail-section">
          <div class="mockup-check-row">
            <label class="mockup-check-label">
              <input type="checkbox" id="mockup-checked" ${job.mockup?.checkedBy ? "checked disabled" : ""}>
              Checked against mockup before printing
            </label>
            ${job.mockup?.checkedBy ? `
              <span class="mockup-check-meta">by ${job.mockup.checkedBy} · ${formatDate(job.mockup.checkedAt)}</span>
            ` : ""}
          </div>
        </div>
      ` : ""}

      <!-- Financials -->
      <div class="detail-section">
        <h3 class="detail-section-title">Quote</h3>
        <div class="detail-grid">
          <div class="detail-field"><label>Quote Ref</label><span>${job.quoteRef || "—"}</span></div>
          <div class="detail-field"><label>Value</label><span>${job.quoteValue ? "£" + Number(job.quoteValue).toFixed(2) : "—"}</span></div>
        </div>
      </div>

      <!-- Garment counts (visible from garments_received onwards) -->
      ${job.stage >= 7 ? `
        <div class="detail-section">
          <h3 class="detail-section-title">Garment Counts</h3>
          <div class="counts-grid">
            <div class="count-cell">
              <label>Expected</label><span>${gc.expected ?? 0}</span>
            </div>
            <div class="count-cell ${gc.received != null && gc.received !== gc.expected ? "count-mismatch" : ""}">
              <label>Received</label>
              ${isReceiveStage && session.isAdmin ? `
                <input type="number" class="count-input" id="count-received" value="${gc.received ?? 0}" min="0">
              ` : `<span>${gc.received ?? "—"}</span>`}
            </div>
            <div class="count-cell">
              <label>Printed</label>
              ${job.stage >= 8 ? `<span>${gc.printed ?? "—"}</span>` : "<span>—</span>"}
            </div>
            <div class="count-cell">
              <label>Final</label>
              ${job.stage >= 9 ? `<span>${gc.final ?? "—"}</span>` : "<span>—</span>"}
            </div>
          </div>
          ${gc.received != null && gc.received !== gc.expected ?
            `<div class="count-alert">⚠ Count mismatch: expected ${gc.expected}, received ${gc.received}</div>` : ""}
        </div>
      ` : ""}

      <!-- Ink usage log -->
      ${job.inkUsage?.length ? `
        <div class="detail-section">
          <h3 class="detail-section-title">Inks Used</h3>
          <div class="ink-usage-list">
            ${job.inkUsage.map(i => `
              <div class="ink-usage-row">
                <span class="ink-usage-code">${i.code}</span>
                <span class="ink-usage-name">${i.name}</span>
                <span class="ink-usage-amount">${i.amount}g</span>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}

      <!-- Stage history -->
      <div class="detail-section">
        <h3 class="detail-section-title">Stage History</h3>
        <div class="history-list">
          ${(job.stageHistory ?? []).map(h => `
            <div class="history-row">
              <span class="history-stage">${h.label}</span>
              <span class="history-by">${h.by}</span>
              <span class="history-at">${formatDate(h.at)}</span>
            </div>
          `).join("")}
        </div>
      </div>

      <!-- Notes -->
      ${job.notes ? `
        <div class="detail-section">
          <h3 class="detail-section-title">Notes</h3>
          <p class="detail-notes">${job.notes}</p>
        </div>
      ` : ""}

      <!-- Ink picker for Inks Mixed stage -->
      ${isInkStage ? `<div id="ink-picker-container" class="detail-section"></div>` : ""}

      <!-- Actions -->
      <div class="detail-actions">
        ${!isLast ? `
          <button class="btn btn-primary" id="advance-btn">
            → ${STAGES[job.stage + 1]?.label}
          </button>
        ` : `<div class="job-complete-badge">✓ Job Complete</div>`}
        ${session.isAdmin ? `
          ${job.stage > 1 ? `<button class="btn btn-ghost" id="back-stage-btn">← Back a stage</button>` : ""}
          <button class="btn btn-ghost" id="edit-job-btn">Edit</button>
          <button class="btn btn-danger" id="delete-job-btn">Delete</button>
        ` : ""}
      </div>
    </div>
  `;

  // Back a stage (admin) — wired BEFORE the ink-stage early return below so it also
  // works at Inks Mixed. Same confirm/behaviour as the board-card control; reuses backStage.
  document.getElementById("back-stage-btn")?.addEventListener("click", async () => {
    if (!confirm(`Move this job back to ${STAGES[job.stage - 1].label}?`)) return;
    try {
      await backStage(job.id);
      onUpdate();
    } catch (err) {
      alert("Couldn't move the job back: " + err.message);
    }
  });

  // Ink prep checklist at Inks Mixed stage — read-only against the ink library; ticks
  // persist on the job so partial prep survives reloads. Advance is gated on all ticks.
  if (isInkStage) {
    const inkContainer = document.getElementById("ink-picker-container");
    renderInkChecklist(inkContainer, job, session.user, {
      onPrepChange: async (inkPrep) => {
        await updateJob(job.id, { inkPrep });
        job.inkPrep = inkPrep;
      },
      onComplete: async () => {
        await advanceStage(job.id);
        onUpdate();
      },
      // "Needs recipe" → open a label request in hq_recipe_requests; unflagging or
      // ticking the colour as mixed closes any open request for this job+colour.
      onRecipeFlag: async (colour, flagged) => {
        if (flagged) {
          await createRecipeRequest({
            jobId: job.id,
            jobRef: job.quoteRef || job.id,
            customerName: job.customerName ?? "",
            colour,
            by: session.user,
          });
        } else {
          await closeRecipeRequests(job.id, colour, session.user);
        }
      },
    });
    document.getElementById("advance-btn")?.remove();
    return;
  }

  // Advance stage
  document.getElementById("advance-btn")?.addEventListener("click", async () => {
    try {
      let extra = {};

      // Capture received count at garments_received stage
      if (isReceiveStage) {
        const inp = document.getElementById("count-received");
        if (inp) extra = { garmentCounts: { ...gc, received: parseInt(inp.value) || 0 } };
      }

      await advanceStage(job.id, extra);
      onUpdate();
    } catch (e) {
      alert(e.message);
    }
  });

  if (session.isAdmin) {
    document.getElementById("edit-job-btn")?.addEventListener("click", () => {
      showJobForm(job, onUpdate);
    });
    document.getElementById("delete-job-btn")?.addEventListener("click", async () => {
      if (confirm(`Delete job for ${job.customerName}? This cannot be undone.`)) {
        await deleteJob(job.id);
        onUpdate();
      }
    });
  }

  // Send mockup button (stage 1 only)
  document.getElementById("send-mockup-btn")?.addEventListener("click", () => {
    showMockupModal(job, onUpdate);
  });

  // Checked against mockup checkbox
  document.getElementById("mockup-checked")?.addEventListener("change", async (e) => {
    if (e.target.checked) {
      e.target.disabled = true;
      try {
        await updateJob(job.id, {
          mockup: {
            ...job.mockup,
            checkedBy: session.user,
            checkedAt: new Date().toISOString(),
          },
        });
        onUpdate();
      } catch (err) {
        e.target.disabled = false;
        e.target.checked = false;
        alert("Failed to save: " + err.message);
      }
    }
  });
}

// ── Job create/edit form ──────────────────────────────────────────────────────
export function showJobForm(existing = null, onDone) {
  const modal = document.getElementById("modal");
  const isEdit = !!existing;
  const d = existing ?? {};

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop"></div>
    <div class="modal-box">
      <div class="modal-header">
        <h2>${isEdit ? "Edit Job" : "New Job"}</h2>
        <button class="modal-close" id="modal-close">✕</button>
      </div>
      <div class="modal-body">

        <div class="form-section-title">Customer</div>
        <div class="form-row">
          <div class="form-field">
            <label>Name *</label>
            <input type="text" id="f-customer-name" value="${d.customerName ?? ""}" required>
          </div>
          <div class="form-field">
            <label>Email</label>
            <input type="email" id="f-customer-email" value="${d.customerEmail ?? ""}">
          </div>
          <div class="form-field">
            <label>Phone</label>
            <input type="tel" id="f-customer-phone" value="${d.customerPhone ?? ""}">
          </div>
        </div>

        <div class="form-section-title">Garment</div>
        <div class="form-row">
          <div class="form-field">
            <label>Type *</label>
            <input type="text" id="f-garment-type" value="${d.garmentType ?? ""}" placeholder="e.g. Gildan 64000" required>
          </div>
          <div class="form-field">
            <label>Colour</label>
            <input type="text" id="f-garment-colour" value="${d.garmentColour ?? ""}" placeholder="e.g. Navy">
          </div>
          <div class="form-field">
            <label>Quantity *</label>
            <input type="number" id="f-quantity" value="${d.quantity ?? ""}" min="1" required>
          </div>
        </div>
        <div class="form-section-title">Size Breakdown</div>
        <div class="size-form-row">
          ${["S","M","L","XL","XXL"].map(s => `
            <div class="size-form-cell">
              <label>${s}</label>
              <input type="number" id="f-size-${s}" value="${d.sizes?.[s] ?? 0}" min="0">
            </div>
          `).join("")}
        </div>

        <div class="form-section-title">Print Specification</div>
        <div class="form-row">
          <div class="form-field">
            <label>Colour count *</label>
            <input type="number" id="f-colours" value="${d.colours ?? 1}" min="1" required>
          </div>
          <div class="form-field">
            <label>Locations *</label>
            <input type="number" id="f-locations" value="${d.locations ?? 1}" min="1" required>
          </div>
          <div class="form-field">
            <label>Ink colours / Pantones</label>
            <input type="text" id="f-ink-colours" value="${d.inkColours ?? ""}" placeholder="e.g. PMS 286, PMS 032">
          </div>
        </div>
        <div class="form-row">
          <div class="form-field full">
            <label>Print positions (one per line)</label>
            <textarea id="f-positions" rows="3" placeholder="Front — 2 colours\nBack — 1 colour">${(d.positions ?? []).map(p => typeof p === "string" ? p : `${p.name}${p.colours ? " — " + p.colours + " colour" + (p.colours > 1 ? "s" : "") : ""}`).join("\n")}</textarea>
          </div>
        </div>

        <div class="form-section-title">Quote</div>
        <div class="form-row">
          <div class="form-field">
            <label>Quote ref</label>
            <input type="text" id="f-quote-ref" value="${d.quoteRef ?? ""}">
          </div>
          <div class="form-field">
            <label>Value (£)</label>
            <input type="number" id="f-quote-value" value="${d.quoteValue ?? ""}" min="0" step="0.01">
          </div>
        </div>

        <div class="form-section-title">Or import from calculator JSON</div>
        <div class="form-field full">
          <textarea id="f-json-import" rows="3" placeholder="Paste quote JSON here and click Import…"></textarea>
        </div>
        <button type="button" class="btn btn-ghost" id="import-json-btn">Import JSON</button>

        <div class="form-field full" style="margin-top:12px">
          <label>Notes</label>
          <textarea id="f-notes" rows="3">${d.notes ?? ""}</textarea>
        </div>

      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="modal-cancel">Cancel</button>
        <button class="btn btn-primary" id="modal-save">${isEdit ? "Save Changes" : "Create Job"}</button>
      </div>
    </div>
  `;

  modal.classList.remove("hidden");

  const close = () => modal.classList.add("hidden");
  document.getElementById("modal-close").addEventListener("click", close);
  document.getElementById("modal-cancel").addEventListener("click", close);
  document.getElementById("modal-backdrop").addEventListener("click", close);

  // JSON import
  document.getElementById("import-json-btn").addEventListener("click", () => {
    const raw = document.getElementById("f-json-import").value.trim();
    if (!raw) return;
    const parsed = parseQuoteJson(raw);
    if (!parsed) { alert("Invalid JSON"); return; }
    document.getElementById("f-customer-name").value  = parsed.customerName;
    document.getElementById("f-customer-email").value = parsed.customerEmail;
    document.getElementById("f-customer-phone").value = parsed.customerPhone;
    document.getElementById("f-garment-type").value   = parsed.garmentType;
    document.getElementById("f-garment-colour").value = parsed.garmentColour;
    document.getElementById("f-quantity").value        = parsed.quantity;
    document.getElementById("f-colours").value         = parsed.colours;
    document.getElementById("f-locations").value       = parsed.locations;
    document.getElementById("f-ink-colours").value     = parsed.inkColours;
    document.getElementById("f-quote-ref").value       = parsed.quoteRef;
    document.getElementById("f-quote-value").value     = parsed.quoteValue;
    document.getElementById("f-notes").value           = parsed.notes;
    ["S","M","L","XL","XXL"].forEach(s => {
      document.getElementById(`f-size-${s}`).value = parsed.sizes?.[s] ?? 0;
    });
    document.getElementById("f-positions").value = (parsed.positions ?? [])
      .map(p => typeof p === "string" ? p : `${p.name}${p.colours ? " — " + p.colours + " colours" : ""}`)
      .join("\n");
  });

  // Save
  document.getElementById("modal-save").addEventListener("click", async () => {
    const customerName = document.getElementById("f-customer-name").value.trim();
    const garmentType  = document.getElementById("f-garment-type").value.trim();
    const quantity     = parseInt(document.getElementById("f-quantity").value) || 0;
    if (!customerName || !garmentType || !quantity) {
      alert("Customer name, garment type and quantity are required.");
      return;
    }
    const colours    = parseInt(document.getElementById("f-colours").value) || 1;
    const locations  = parseInt(document.getElementById("f-locations").value) || 1;
    const posRaw     = document.getElementById("f-positions").value.trim();
    const positions  = posRaw ? posRaw.split("\n").map(l => l.trim()).filter(Boolean) : [];
    const sizes      = {};
    ["S","M","L","XL","XXL"].forEach(s => {
      sizes[s] = parseInt(document.getElementById(`f-size-${s}`).value) || 0;
    });
    const data = {
      customerName,
      customerEmail:  document.getElementById("f-customer-email").value.trim(),
      customerPhone:  document.getElementById("f-customer-phone").value.trim(),
      garmentType,
      garmentColour:  document.getElementById("f-garment-colour").value.trim(),
      quantity,
      sizes,
      colours,
      locations,
      screenCount:    colours * locations,
      inkColours:     document.getElementById("f-ink-colours").value.trim(),
      positions,
      quoteRef:       document.getElementById("f-quote-ref").value.trim(),
      quoteValue:     parseFloat(document.getElementById("f-quote-value").value) || 0,
      notes:          document.getElementById("f-notes").value.trim(),
    };
    try {
      if (isEdit) {
        await updateJob(existing.id, data);
      } else {
        await submitCreateJob(data);
      }
      close();
      onDone?.();
    } catch (e) {
      alert("Failed to save: " + e.message);
    }
  });
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
