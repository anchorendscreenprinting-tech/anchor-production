import { createCustomer, updateCustomer, deleteCustomer, watchCustomers } from "./db.js";
import { session } from "./auth.js";

let _customers = [];

export function initCustomers(onChange) {
  return watchCustomers((customers) => {
    _customers = customers;
    onChange(customers);
  });
}

export function getCustomers() { return _customers; }

export function renderCustomerList(customers, jobs, container, onSelect) {
  if (!customers.length) {
    container.innerHTML = `<p class="empty-state">No customers yet.</p>`;
    return;
  }

  // Build spend totals from jobs
  const spend = {};
  const jobCount = {};
  jobs.forEach(j => {
    const key = j.customerName?.toLowerCase();
    if (!key) return;
    spend[key]    = (spend[key] ?? 0) + (j.quoteValue ?? 0);
    jobCount[key] = (jobCount[key] ?? 0) + 1;
  });

  container.innerHTML = `
    <div class="customer-grid">
      ${customers.map(c => `
        <div class="customer-card" data-id="${c.id}">
          <div class="customer-avatar">${(c.name ?? "?")[0].toUpperCase()}</div>
          <div class="customer-info">
            <div class="customer-name">${c.name}</div>
            <div class="customer-meta">${c.email ?? ""}${c.phone ? " · " + c.phone : ""}</div>
            <div class="customer-stats">
              ${jobCount[c.name?.toLowerCase()] ?? 0} job${jobCount[c.name?.toLowerCase()] !== 1 ? "s" : ""} ·
              £${(spend[c.name?.toLowerCase()] ?? 0).toFixed(2)} total
            </div>
          </div>
        </div>
      `).join("")}
    </div>
    ${session.isAdmin ? `<button class="btn btn-primary add-customer-btn" id="add-customer-btn">+ Add Customer</button>` : ""}
  `;

  container.querySelectorAll(".customer-card").forEach(card => {
    card.addEventListener("click", () => {
      const c = customers.find(x => x.id === card.dataset.id);
      if (c) onSelect(c, jobs.filter(j => j.customerName?.toLowerCase() === c.name?.toLowerCase()));
    });
  });

  if (session.isAdmin) {
    document.getElementById("add-customer-btn")?.addEventListener("click", () => showCustomerForm(null, () => {}));
  }
}

export function renderCustomerDetail(customer, jobs, container) {
  container.innerHTML = `
    <div class="detail-wrap">
      <div class="detail-header">
        <div>
          <h2 class="detail-customer">${customer.name}</h2>
          <div class="detail-meta">${customer.email ?? ""}${customer.phone ? " · " + customer.phone : ""}</div>
        </div>
        ${session.isAdmin ? `
          <div style="display:flex;gap:8px">
            <button class="btn btn-ghost" id="edit-customer-btn">Edit</button>
            <button class="btn btn-danger" id="del-customer-btn">Delete</button>
          </div>
        ` : ""}
      </div>

      <div class="detail-section">
        <h3 class="detail-section-title">Job History</h3>
        ${jobs.length ? `
          <div class="history-jobs">
            ${jobs.map(j => `
              <div class="history-job-row">
                <span class="history-job-ref">${j.quoteRef || "—"}</span>
                <span class="history-job-garment">${j.garmentType ?? ""} × ${j.quantity ?? 0}</span>
                <span class="history-job-stage">${j.stage != null ? ["Quote","Invoice","Gmnts Ord","Artwork Rcvd","Artwork Sep","Screens","Inks","Gmnts Rcvd","Printed","Final Cnt","Dispatched","Paid"][j.stage] ?? "—" : "—"}</span>
                <span class="history-job-value">${j.quoteValue ? "£" + Number(j.quoteValue).toFixed(2) : "—"}</span>
              </div>
            `).join("")}
          </div>
          <div class="customer-total">
            Total spend: <strong>£${jobs.reduce((s, j) => s + (j.quoteValue ?? 0), 0).toFixed(2)}</strong>
            across ${jobs.length} job${jobs.length !== 1 ? "s" : ""}
          </div>
        ` : `<p class="empty-state">No jobs yet.</p>`}
      </div>
    </div>
  `;

  if (session.isAdmin) {
    document.getElementById("edit-customer-btn")?.addEventListener("click", () => {
      showCustomerForm(customer, () => {});
    });
    document.getElementById("del-customer-btn")?.addEventListener("click", async () => {
      if (confirm(`Delete ${customer.name}?`)) {
        await deleteCustomer(customer.id);
      }
    });
  }
}

export function showCustomerForm(existing = null, onDone) {
  const modal = document.getElementById("modal");
  const isEdit = !!existing;
  const d = existing ?? {};
  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop"></div>
    <div class="modal-box modal-box--sm">
      <div class="modal-header">
        <h2>${isEdit ? "Edit Customer" : "New Customer"}</h2>
        <button class="modal-close" id="modal-close">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-field">
          <label>Name *</label>
          <input type="text" id="c-name" value="${d.name ?? ""}" required>
        </div>
        <div class="form-field">
          <label>Email</label>
          <input type="email" id="c-email" value="${d.email ?? ""}">
        </div>
        <div class="form-field">
          <label>Phone</label>
          <input type="tel" id="c-phone" value="${d.phone ?? ""}">
        </div>
        <div class="form-field">
          <label>Notes</label>
          <textarea id="c-notes" rows="3">${d.notes ?? ""}</textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="modal-cancel">Cancel</button>
        <button class="btn btn-primary" id="modal-save">${isEdit ? "Save" : "Create"}</button>
      </div>
    </div>
  `;
  modal.classList.remove("hidden");
  const close = () => modal.classList.add("hidden");
  document.getElementById("modal-close").addEventListener("click", close);
  document.getElementById("modal-cancel").addEventListener("click", close);
  document.getElementById("modal-backdrop").addEventListener("click", close);
  document.getElementById("modal-save").addEventListener("click", async () => {
    const name = document.getElementById("c-name").value.trim();
    if (!name) { alert("Name is required"); return; }
    const data = {
      name,
      email: document.getElementById("c-email").value.trim(),
      phone: document.getElementById("c-phone").value.trim(),
      notes: document.getElementById("c-notes").value.trim(),
    };
    if (isEdit) await updateCustomer(existing.id, data);
    else await createCustomer(data);
    close();
    onDone?.();
  });
}
