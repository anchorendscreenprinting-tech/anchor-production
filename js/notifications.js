import { watchNotifications, markNotificationRead } from "./db.js";
import { session } from "./auth.js";
import { STAGES } from "./config.js";

let _notifs = [];
let _unsubscribe = null;

export function initNotifications(onBadgeUpdate) {
  _unsubscribe = watchNotifications((notifs) => {
    _notifs = notifs;
    const unread = notifs.filter(n => !n.readBy?.includes(session.user)).length;
    onBadgeUpdate(unread);
  });
  return _unsubscribe;
}

export function renderNotifications(container) {
  const relevant = session.isAdmin
    ? _notifs
    : _notifs.filter(n => !n.readBy?.includes(session.user));

  if (!relevant.length) {
    container.innerHTML = `<p class="empty-state">No notifications.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="notif-list">
      ${relevant.map(n => {
        const unread = !n.readBy?.includes(session.user);
        return `
          <div class="notif-row${unread ? " notif-unread" : ""}" data-id="${n.id}">
            <div class="notif-icon">${notifIcon(n.type)}</div>
            <div class="notif-body">
              <div class="notif-title">${notifTitle(n)}</div>
              <div class="notif-detail">${notifDetail(n)}</div>
              <div class="notif-meta">By ${n.by} · ${timeAgo(n.createdAt)}</div>
            </div>
            ${unread ? `<button class="notif-read-btn" data-id="${n.id}">✓</button>` : ""}
          </div>
        `;
      }).join("")}
    </div>
  `;

  container.querySelectorAll(".notif-read-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      await markNotificationRead(btn.dataset.id, session.user);
    });
  });
}

function notifIcon(type) {
  return { stage_advance: "▶", count_mismatch: "⚠" }[type] ?? "•";
}

function notifTitle(n) {
  if (n.type === "stage_advance") return `${n.customerName} — advanced to ${n.stageLabel}`;
  if (n.type === "count_mismatch") return `${n.customerName} — garment count mismatch`;
  return "Notification";
}

function notifDetail(n) {
  if (n.type === "stage_advance") return `Job ${n.jobRef ?? ""}`;
  if (n.type === "count_mismatch") return `Expected ${n.expected}, received ${n.received}`;
  return "";
}

function timeAgo(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = Math.floor((Date.now() - d) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}
