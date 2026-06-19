import { updateJob } from "./db.js";
import {
  arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const WORKER_URL = "https://anchor-end-enquiry-handler.anchorendscreenprinting.workers.dev";

let _uploadedUrl = null;

// ── Uploadcare loader ─────────────────────────────────────────────────────────

async function _ensureUploadcare() {
  if (window.uploadcare) return;
  window.UPLOADCARE_PUBLIC_KEY = "8319962167fc10bc57db";
  window.UPLOADCARE_LIVE = false; // don't auto-scan DOM
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://ucarecdn.com/libs/widget/3.x/uploadcare.full.min.js";
    s.charset = "utf-8";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load Uploadcare widget"));
    document.head.appendChild(s);
  });
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function showMockupModal(job, onSent) {
  try {
    await _ensureUploadcare();
  } catch {
    alert("Could not load the image uploader. Please check your internet connection and try again.");
    return;
  }

  _uploadedUrl = job.mockup?.imageUrl ?? null;

  const modalEl = document.getElementById("modal");
  const firstName = (job.customerName ?? "").split(" ")[0] || "there";
  const refLabel  = job.quoteRef ? ` — ${job.quoteRef}` : "";
  const defaultSubject = `Your mockup is ready for approval${refLabel}`;
  const defaultMessage =
    `Hi ${firstName},\n\nYour mockup is ready to review. Please click the button in this email to approve it or let us know if you'd like any changes.\n\nIf you have any questions, just reply to this email.\n\nThanks,\nAnchor End Studios`;

  modalEl.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop"></div>
    <div class="modal-box">
      <div class="modal-header">
        <h2>Send Mockup</h2>
        <button class="modal-close" id="modal-close">✕</button>
      </div>
      <div class="modal-body">

        <div class="form-section-title">Mockup image</div>
        <div class="uploadcare-wrap" id="uc-wrap">
          <input type="hidden" role="uploadcare-uploader"
                 data-public-key="8319962167fc10bc57db"
                 data-images-only="true"
                 data-crop="disabled"
                 id="uc-input">
        </div>
        ${_uploadedUrl ? `
          <div class="mockup-preview-row">
            <img class="mockup-thumb" src="${_esc(_uploadedUrl)}" alt="Current mockup">
            <span class="mockup-thumb-label">Previously uploaded — upload a new file to replace</span>
          </div>` : ""}

        <div class="form-section-title" style="margin-top:16px">Print notes (shown to client)</div>
        <div class="form-field full">
          <textarea id="mockup-notes" rows="2" placeholder="e.g. PMS 286 C, Pantone Cool Grey 7 · Front chest placement">${_esc(job.inkColours ? "Ink colours: " + job.inkColours : "")}</textarea>
        </div>

        <div class="form-section-title">Email</div>
        <div class="form-row">
          <div class="form-field">
            <label>To</label>
            <input type="email" id="mockup-to" value="${_esc(job.customerEmail ?? "")}" placeholder="client@example.com">
          </div>
        </div>
        <div class="form-field full">
          <label>Subject</label>
          <input type="text" id="mockup-subject" value="${_esc(defaultSubject)}">
        </div>
        <div class="form-field full">
          <label>Message</label>
          <textarea id="mockup-message" rows="6">${_esc(defaultMessage)}</textarea>
        </div>

        <div id="mockup-status" style="display:none;color:var(--green);font-size:13px;margin-top:8px;"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="modal-cancel">Cancel</button>
        <button class="btn btn-ghost" id="mockup-mailto-btn">Open in email app</button>
        <button class="btn btn-primary" id="mockup-send-btn">Send via Anchor End →</button>
      </div>
    </div>
  `;

  modalEl.classList.remove("hidden");

  const close = () => {
    modalEl.classList.add("hidden");
    modalEl.innerHTML = "";
    _uploadedUrl = null;
  };

  document.getElementById("modal-close").addEventListener("click", close);
  document.getElementById("modal-cancel").addEventListener("click", close);
  document.getElementById("modal-backdrop").addEventListener("click", close);

  // Initialise Uploadcare widget on the hidden input
  const widget = uploadcare.Widget("#uc-input");
  widget.onUploadComplete(info => {
    _uploadedUrl = info.cdnUrl;
    const wrap = document.getElementById("uc-wrap");
    if (wrap) {
      const existing = wrap.querySelector(".mockup-preview-row");
      if (existing) existing.remove();
      const preview = document.createElement("div");
      preview.className = "mockup-preview-row";
      preview.innerHTML = `<img class="mockup-thumb" src="${_esc(info.cdnUrl)}" alt="Uploaded mockup">
        <span class="mockup-thumb-label">Uploaded</span>`;
      wrap.appendChild(preview);
    }
  });

  // ── Send via Anchor End ───────────────────────────────────────────────────

  document.getElementById("mockup-send-btn").addEventListener("click", async () => {
    const to      = document.getElementById("mockup-to").value.trim();
    const subject = document.getElementById("mockup-subject").value.trim();
    const message = document.getElementById("mockup-message").value.trim();
    const notes   = document.getElementById("mockup-notes").value.trim();

    if (!_uploadedUrl) { alert("Please upload a mockup image first."); return; }
    if (!to) { alert("Please enter a recipient email address."); return; }

    const btn = document.getElementById("mockup-send-btn");
    const status = document.getElementById("mockup-status");
    btn.disabled = true;
    btn.textContent = "Sending…";

    try {
      const res = await fetch(`${WORKER_URL}/send-mockup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId:        job.id,
          to, subject, message, notes,
          mockupUrl:    _uploadedUrl,
          customerName: job.customerName ?? "",
          quoteRef:     job.quoteRef ?? "",
          sendEmail:    true,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Send failed");

      // Append send log entry to job doc
      await updateJob(job.id, {
        mockupSendLog: arrayUnion({
          sentTo:   to,
          sentAt:   data.sentAt || new Date().toISOString(),
          token:    data.token,
          imageUrl: _uploadedUrl,
          via:      "email",
        }),
      });

      status.style.display = "block";
      status.textContent = "✓ Sent — the client will receive an email with the approval link.";
      btn.textContent = "Sent ✓";

      setTimeout(() => { close(); onSent?.(); }, 1400);
    } catch (err) {
      alert("Failed to send: " + err.message);
      btn.disabled = false;
      btn.textContent = "Send via Anchor End →";
    }
  });

  // ── Open in email app ─────────────────────────────────────────────────────

  document.getElementById("mockup-mailto-btn").addEventListener("click", async () => {
    const to      = document.getElementById("mockup-to").value.trim();
    const subject = document.getElementById("mockup-subject").value.trim();
    const message = document.getElementById("mockup-message").value.trim();
    const notes   = document.getElementById("mockup-notes").value.trim();

    if (!_uploadedUrl) { alert("Please upload a mockup image first."); return; }

    const btn = document.getElementById("mockup-mailto-btn");
    btn.disabled = true;
    btn.textContent = "Creating link…";

    try {
      const res = await fetch(`${WORKER_URL}/send-mockup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId:        job.id,
          to, subject, message: "", notes,
          mockupUrl:    _uploadedUrl,
          customerName: job.customerName ?? "",
          quoteRef:     job.quoteRef ?? "",
          sendEmail:    false,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to create approval link");

      const approvalUrl = data.approvalUrl
        || `https://anchor-production.netlify.app/approval.html?token=${data.token}`;

      const mailtoBody = message
        + "\n\nReview and approve your mockup here:\n" + approvalUrl
        + "\n\n(No account needed — just click the link to approve or request changes.)";

      window.location.href =
        `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(mailtoBody)}`;

      await updateJob(job.id, {
        mockupSendLog: arrayUnion({
          sentTo:   to,
          sentAt:   data.sentAt || new Date().toISOString(),
          token:    data.token,
          imageUrl: _uploadedUrl,
          via:      "mailto",
        }),
      });

      setTimeout(() => { close(); onSent?.(); }, 800);
    } catch (err) {
      alert("Failed: " + err.message);
      btn.disabled = false;
      btn.textContent = "Open in email app";
    }
  });
}

// ── Private helpers ───────────────────────────────────────────────────────────

function _esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
