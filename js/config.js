// Firebase config — shared with ink library (ink-stock-318c0)
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCSnbQhjLvdwDNg9mTKaOW1gWvVUx8zmws",
  authDomain: "ink-stock-318c0.firebaseapp.com",
  projectId: "ink-stock-318c0",
  storageBucket: "ink-stock-318c0.firebasestorage.app",
  messagingSenderId: "177496902657",
  appId: "1:177496902657:web:03eeb24700ed29e5da8400",
};

export const PINS = {
  Joel:   "5335",
  Enzo:   "5335",
  Morys:  "7284",
  Kris:   "4916",
  Pietro: "3751",
  Joe:    "1234",
};

export const ADMINS = ["Joel", "Enzo"];

export const STAGES = [
  { id: 0,  key: "quote_accepted",       label: "Quote Accepted",        worker: "any" },
  { id: 1,  key: "invoice_sent",         label: "Invoice Sent",          worker: "any" },
  { id: 2,  key: "garments_ordered",     label: "Garments Ordered",      worker: "any" },
  { id: 3,  key: "artwork_received",     label: "Artwork Received",      worker: "any" },
  { id: 4,  key: "artwork_separated",    label: "Artwork Separated",     worker: "any" },
  { id: 5,  key: "screens_made",         label: "Screens Made",          worker: "any" },
  { id: 6,  key: "inks_mixed",           label: "Inks Mixed",            worker: "any" },
  { id: 7,  key: "garments_received",    label: "Garments Received",     worker: "any" },
  { id: 8,  key: "garments_printed",     label: "Garments Printed",      worker: "any" },
  { id: 9,  key: "final_count",          label: "Final Count",           worker: "any" },
  { id: 10, key: "dispatched",           label: "Dispatched / Collected", worker: "any" },
  { id: 11, key: "payment_received",     label: "Payment Received",      worker: "any" },
];

// Stage colours for the pipeline UI
export const STAGE_COLOURS = [
  "#6366f1", // quote_accepted   — indigo
  "#8b5cf6", // invoice_sent     — violet
  "#f59e0b", // garments_ordered — amber
  "#3b82f6", // artwork_received — blue
  "#06b6d4", // artwork_separated— cyan
  "#8b5cf6", // screens_made     — purple
  "#f97316", // inks_mixed       — orange
  "#84cc16", // garments_received— lime
  "#22c55e", // garments_printed — green
  "#14b8a6", // final_count      — teal
  "#10b981", // dispatched       — emerald
  "#6ee7b7", // payment_received — light green
];

// Ink library Firestore path (read-only for integration)
export const INK_LIB_DOC = { collection: "inklib", doc: "state" };
