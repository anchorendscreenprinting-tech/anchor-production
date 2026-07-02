import { initializeApp }                          from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc,
  updateDoc, deleteDoc, onSnapshot, query, orderBy, where, serverTimestamp, arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check.js";
import { FIREBASE_CONFIG, INK_LIB_DOC }           from "./config.js";

const app = initializeApp(FIREBASE_CONFIG);

// ── App Check — reCAPTCHA Enterprise. The shared key is an Enterprise key, so the
// client MUST use ReCaptchaEnterpriseProvider; ReCaptchaV3Provider 403s against it
// (it calls the classic exchangeRecaptchaV3Token endpoint). See CLAUDE.md gotcha. ──
initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider("6Ld4XjYtAAAAAEYX8id8iyw-18TnsujbLQ55yTuN"),
  isTokenAutoRefreshEnabled: true,
});

export const db = getFirestore(app);

// ── Collection refs ──────────────────────────────────────────────────────────
export const jobsCol      = () => collection(db, "production_jobs");
export const customersCol = () => collection(db, "production_customers");
export const notifsCol    = () => collection(db, "production_notifications");
export const jobDoc       = (id) => doc(db, "production_jobs", id);
export const customerDoc  = (id) => doc(db, "production_customers", id);
export const notifDoc     = (id) => doc(db, "production_notifications", id);

// ── Jobs ─────────────────────────────────────────────────────────────────────
export async function createJob(data) {
  return addDoc(jobsCol(), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
}

export async function updateJob(id, data) {
  return updateDoc(jobDoc(id), { ...data, updatedAt: serverTimestamp() });
}

export async function deleteJob(id) {
  return deleteDoc(jobDoc(id));
}

export async function getJob(id) {
  const snap = await getDoc(jobDoc(id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function watchJobs(callback) {
  const q = query(jobsCol(), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// ── Customers ────────────────────────────────────────────────────────────────
export async function createCustomer(data) {
  return addDoc(customersCol(), { ...data, createdAt: serverTimestamp() });
}

export async function updateCustomer(id, data) {
  return updateDoc(customerDoc(id), data);
}

export async function deleteCustomer(id) {
  return deleteDoc(customerDoc(id));
}

export async function getCustomers() {
  const snap = await getDocs(query(customersCol(), orderBy("name")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function watchCustomers(callback) {
  return onSnapshot(query(customersCol(), orderBy("name")), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// ── Notifications ────────────────────────────────────────────────────────────
export async function createNotification(data) {
  return addDoc(notifsCol(), { ...data, createdAt: serverTimestamp(), readBy: [] });
}

export function watchNotifications(callback) {
  const q = query(notifsCol(), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function markNotificationRead(notifId, userName) {
  return updateDoc(notifDoc(notifId), { readBy: arrayUnion(userName) });
}

// ── Recipe label requests (hq_recipe_requests) ───────────────────────────────
// One-way "make this pot sticker" notification to HQ: created when a colour is
// flagged in the Inks Mixed checklist, closed from HQ's Recipes inbox or auto-closed
// when the colour is ticked as mixed. Nothing travels back to production.
export const recipeReqsCol = () => collection(db, "hq_recipe_requests");

export async function createRecipeRequest(data) {
  return addDoc(recipeReqsCol(), { ...data, createdAt: serverTimestamp(), status: "open" });
}

// Close every open request for a job+colour (equality-only query — no composite index).
export async function closeRecipeRequests(jobId, colour, by) {
  const q = query(recipeReqsCol(),
    where("jobId", "==", jobId), where("colour", "==", colour), where("status", "==", "open"));
  const snap = await getDocs(q);
  await Promise.all(snap.docs.map(d =>
    updateDoc(d.ref, { status: "done", closedBy: by, closedAt: new Date().toISOString() })));
}

// ── Ink library (STRICTLY READ-ONLY) ─────────────────────────────────────────
// anchor-production must never write inklib/state — the floor app owns that doc
// (whole-doc last-writer-wins; see CLAUDE.md "Shared doc contract"). No write path
// exists here and none should be added.
export async function getInkLibState() {
  const snap = await getDoc(doc(db, INK_LIB_DOC.collection, INK_LIB_DOC.doc));
  return snap.exists() ? snap.data() : null;
}
