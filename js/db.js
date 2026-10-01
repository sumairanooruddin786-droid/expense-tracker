// ---------------------------------------------------------------------------
// Data layer — the only file that talks to Firebase Firestore.
// The UI (app.js) imports these four functions and never touches Firebase.
// ---------------------------------------------------------------------------

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const COLLECTION = "expenses";

export const isConfigured = !Object.values(firebaseConfig).some((v) =>
  String(v).includes("YOUR_")
);

let db = null;
if (isConfigured) {
  db = getFirestore(initializeApp(firebaseConfig));
}

/**
 * Listen to all expenses in real time (newest date first).
 * @param {(items: Array) => void} onData   called on every change
 * @param {(err: Error) => void} onError    called if the listener fails
 * @returns {() => void} unsubscribe function
 */
export function subscribeExpenses(onData, onError) {
  if (!db) {
    onError(new Error("Firebase is not configured. Update js/firebase-config.js."));
    return () => {};
  }
  const q = query(collection(db, COLLECTION), orderBy("date", "desc"));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
}

/** Save one expense document to Firestore. */
export async function addExpense({ title, amount, category, date }) {
  if (!db) throw new Error("Firebase is not configured.");
  return addDoc(collection(db, COLLECTION), {
    title,
    amount,
    category,
    date, // stored as "YYYY-MM-DD" so it sorts correctly as text
    createdAt: serverTimestamp(),
  });
}

/** Update the editable fields of one expense (createdAt is left untouched). */
export async function updateExpense(id, { title, amount, category, date }) {
  if (!db) throw new Error("Firebase is not configured.");
  return updateDoc(doc(db, COLLECTION, id), { title, amount, category, date });
}

/** Delete one expense document by its id. */
export async function deleteExpense(id) {
  if (!db) throw new Error("Firebase is not configured.");
  return deleteDoc(doc(db, COLLECTION, id));
}
