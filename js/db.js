import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc,
  updateDoc, deleteDoc, onSnapshot, query, orderBy, where, serverTimestamp, arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { FIREBASE_CONFIG, INK_LIB_DOC } from "./config.js";

const app = initializeApp(FIREBASE_CONFIG);
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

// ── Ink library (read + deduct) ──────────────────────────────────────────────
export async function getInkLibState() {
  const snap = await getDoc(doc(db, INK_LIB_DOC.collection, INK_LIB_DOC.doc));
  return snap.exists() ? snap.data() : null;
}

export async function deductInkStock(updates) {
  // updates: [{ type: "pantone"|"rio"|"base", index, amount }]
  const snap = await getDoc(doc(db, INK_LIB_DOC.collection, INK_LIB_DOC.doc));
  if (!snap.exists()) throw new Error("Ink library not found");
  const state = snap.data();
  for (const u of updates) {
    const arr = state[u.type];
    if (arr && arr[u.index] != null) {
      arr[u.index].weight = Math.max(0, (arr[u.index].weight ?? 0) - u.amount);
    }
  }
  await setDoc(doc(db, INK_LIB_DOC.collection, INK_LIB_DOC.doc), state);
}
