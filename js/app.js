// ---------------------------------------------------------------------------
// UI logic — form handling, validation, table rendering and totals.
// ---------------------------------------------------------------------------

import {
  isConfigured,
  subscribeExpenses,
  addExpense,
  updateExpense,
  deleteExpense,
} from "./db.js";

const CURRENCY = "Rs";
const CATEGORIES = ["Food", "Travel", "Shopping", "Bills", "Other"];

// ---------- Element references ----------
const $ = (id) => document.getElementById(id);
const form = $("expenseForm");
const fields = {
  title: $("title"),
  amount: $("amount"),
  category: $("category"),
  date: $("date"),
};
const addBtn = $("addBtn");
const tbody = $("expenseBody");
const emptyState = $("emptyState");
const errorState = $("errorState");
const filterSelect = $("filter");

let expenses = []; // latest data from Firestore
let editingId = null; // id of the expense being edited, or null when adding

// ---------- Helpers ----------
function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatMoney(value) {
  const n = Math.round(Number(value) * 100) / 100;
  const hasDecimals = Math.abs(n % 1) > 0;
  return `${CURRENCY} ${n.toLocaleString("en-US", {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

// "2026-09-29" -> "29 Sep 2026" (parsed manually so time zones can't shift the day)
function formatDate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]} ${y}`;
}

let toastTimer;
function toast(message, type = "ok") {
  const el = $("toast");
  el.textContent = message;
  el.dataset.type = type;
  el.dataset.show = "true";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.dataset.show = "false"), 2600);
}

function setStatus(state, text) {
  const el = $("status");
  el.dataset.state = state;
  $("statusText").textContent = text;
}

// ---------- Validation ----------
function setFieldError(name, message) {
  const field = fields[name].closest(".field");
  field.dataset.invalid = message ? "true" : "false";
  $(`${name}Error`).textContent = message || "";
}

function validate() {
  const title = fields.title.value.trim();
  const amount = Number(fields.amount.value);
  const category = fields.category.value;
  const date = fields.date.value;
  let ok = true;

  if (!title) { setFieldError("title", "Enter a title for this expense."); ok = false; }
  else setFieldError("title", "");

  if (!fields.amount.value || !(amount > 0)) { setFieldError("amount", "Enter an amount greater than 0."); ok = false; }
  else setFieldError("amount", "");

  if (!CATEGORIES.includes(category)) { setFieldError("category", "Choose a category."); ok = false; }
  else setFieldError("category", "");

  if (!date) { setFieldError("date", "Pick a date."); ok = false; }
  else setFieldError("date", "");

  return ok ? { title, amount: Math.round(amount * 100) / 100, category, date } : null;
}

// ---------- Rendering ----------
function render() {
  // Totals always reflect every saved expense, not just the filtered rows.
  const count = expenses.length;
  const total = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  $("totalCount").textContent = count.toLocaleString("en-US");
  $("totalAmount").textContent = formatMoney(total);

  // Top category hint
  const byCat = {};
  expenses.forEach((e) => (byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount || 0)));
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
  $("topCategory").textContent = top
    ? `Highest: ${top[0]} (${formatMoney(top[1])})`
    : "No expenses yet";

  // Table rows
  const filter = filterSelect.value;
  const rows = filter === "All" ? expenses : expenses.filter((e) => e.category === filter);

  tbody.replaceChildren(...rows.map(buildRow));
  $("exportBtn").disabled = rows.length === 0;
  renderBreakdown(byCat, total);

  const isEmpty = rows.length === 0;
  emptyState.hidden = !isEmpty;
  if (isEmpty) {
    emptyState.querySelector(".empty__title").textContent =
      count === 0 ? "No expenses yet" : `No ${filter.toLowerCase()} expenses`;
    emptyState.querySelector(".empty__text").textContent =
      count === 0
        ? "Fill in the form above and choose Add expense to record your first one."
        : "Choose a different category to see other expenses.";
  }
}

function renderBreakdown(byCat, total) {
  const card = $("breakdownCard");
  card.hidden = total <= 0;
  if (total <= 0) return;

  const items = CATEGORIES.map((name) => [name, byCat[name] || 0])
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1]);

  $("bars").replaceChildren(
    ...items.map(([name, amount]) => {
      const pct = (amount / total) * 100;
      const li = document.createElement("li");

      const top = document.createElement("div");
      top.className = "bar__top";
      const label = document.createElement("span");
      label.className = "bar__name";
      label.textContent = name;
      const val = document.createElement("span");
      val.className = "bar__val";
      const strong = document.createElement("strong");
      strong.textContent = formatMoney(amount);
      val.append(strong, ` · ${pct.toFixed(pct < 10 && pct > 0 ? 1 : 0)}%`);
      top.append(label, val);

      const track = document.createElement("div");
      track.className = "bar__track";
      track.setAttribute("role", "img");
      track.setAttribute("aria-label", `${name}: ${pct.toFixed(0)} percent`);
      const fill = document.createElement("div");
      fill.className = `bar__fill bar__fill--${name}`;
      fill.style.width = `${pct}%`;
      track.append(fill);

      li.append(top, track);
      return li;
    })
  );
}

function buildRow(expense) {
  const tr = document.createElement("tr");
  if (expense.id === editingId) tr.className = "row--editing";

  const tdTitle = document.createElement("td");
  tdTitle.className = "cell-title";
  tdTitle.textContent = expense.title; // textContent: safe against HTML injection

  const tdCat = document.createElement("td");
  tdCat.className = "cell-cat";
  const pill = document.createElement("span");
  const cat = CATEGORIES.includes(expense.category) ? expense.category : "Other";
  pill.className = `pill pill--${cat}`;
  pill.textContent = cat;
  tdCat.append(pill);

  const tdDate = document.createElement("td");
  tdDate.className = "cell-date";
  tdDate.textContent = formatDate(expense.date);

  const tdAmount = document.createElement("td");
  tdAmount.className = "num cell-amount";
  tdAmount.textContent = formatMoney(expense.amount);

  const tdAct = document.createElement("td");
  tdAct.className = "act";
  const group = document.createElement("div");
  group.className = "act__group";

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "btn btn--edit";
  edit.textContent = "Edit";
  edit.setAttribute("aria-label", `Edit ${expense.title}`);
  edit.addEventListener("click", () => startEdit(expense));

  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn btn--danger";
  del.textContent = "Delete";
  del.setAttribute("aria-label", `Delete ${expense.title}`);
  del.addEventListener("click", () => onDelete(expense, del));

  group.append(edit, del);
  tdAct.append(group);

  tr.append(tdTitle, tdCat, tdDate, tdAmount, tdAct);
  return tr;
}

// ---------- Actions ----------
async function onSubmit(event) {
  event.preventDefault();
  const data = validate();
  if (!data) return;

  const isEdit = editingId !== null;
  addBtn.disabled = true;
  addBtn.querySelector(".btn__label").textContent = "Saving…";
  try {
    if (isEdit) {
      await updateExpense(editingId, data);
      stopEdit();
      toast("Changes saved");
    } else {
      await addExpense(data);
      form.reset();
      fields.date.value = todayISO();
      toast("Expense added");
      fields.title.focus();
    }
  } catch (err) {
    console.error(err);
    toast("Could not save the expense. Try again.", "error");
  } finally {
    addBtn.disabled = false;
    addBtn.querySelector(".btn__label").textContent = editingId !== null ? "Save changes" : "Add expense";
  }
}

function startEdit(expense) {
  editingId = expense.id;
  fields.title.value = expense.title;
  fields.amount.value = expense.amount;
  fields.category.value = CATEGORIES.includes(expense.category) ? expense.category : "Other";
  fields.date.value = expense.date;
  Object.keys(fields).forEach((n) => setFieldError(n, ""));

  $("formTitle").textContent = "Edit expense";
  addBtn.querySelector(".btn__label").textContent = "Save changes";
  $("editName").textContent = expense.title;
  $("editBar").hidden = false;
  form.closest(".card").classList.add("card--editing");
  form.scrollIntoView({ behavior: "smooth", block: "center" });
  fields.title.focus({ preventScroll: true });
  render();
}

function stopEdit() {
  editingId = null;
  form.reset();
  fields.date.value = todayISO();
  Object.keys(fields).forEach((n) => setFieldError(n, ""));
  $("formTitle").textContent = "Add a new expense";
  addBtn.querySelector(".btn__label").textContent = "Add expense";
  $("editBar").hidden = true;
  form.closest(".card").classList.remove("card--editing");
  render();
}

function exportCSV() {
  const filter = filterSelect.value;
  const rows = filter === "All" ? expenses : expenses.filter((e) => e.category === filter);
  const esc = (v) => {
    let t = String(v);
    if (/^[=+\-@]/.test(t)) t = "'" + t; // stop spreadsheet formula injection
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lines = [["Title", "Category", "Date", "Amount"].join(",")].concat(
    rows.map((e) => [esc(e.title), esc(e.category), esc(e.date), Number(e.amount).toFixed(2)].join(","))
  );
  const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `expenses-${todayISO()}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast(`Exported ${rows.length} expense${rows.length === 1 ? "" : "s"}`);
}

async function onDelete(expense, button) {
  const ok = window.confirm(`Delete "${expense.title}" (${formatMoney(expense.amount)})?`);
  if (!ok) return;
  button.disabled = true;
  try {
    await deleteExpense(expense.id);
    if (editingId === expense.id) stopEdit();
    toast("Expense deleted");
  } catch (err) {
    console.error(err);
    button.disabled = false;
    toast("Could not delete the expense. Try again.", "error");
  }
}

// ---------- Start ----------
function init() {
  fields.date.value = todayISO();
  form.addEventListener("submit", onSubmit);
  filterSelect.addEventListener("change", render);
  $("cancelBtn").addEventListener("click", stopEdit);
  $("exportBtn").addEventListener("click", exportCSV);

  // Clear a field's error as soon as the user edits it
  Object.keys(fields).forEach((name) =>
    fields[name].addEventListener("input", () => setFieldError(name, ""))
  );

  render();

  if (!isConfigured) {
    setStatus("error", "Not configured");
    errorState.hidden = false;
    emptyState.hidden = true;
    $("errorText").textContent = "Add your Firebase keys in js/firebase-config.js, then reload.";
    return;
  }

  subscribeExpenses(
    (items) => {
      expenses = items;
      errorState.hidden = true;
      setStatus("online", "Connected");
      render();
    },
    (err) => {
      console.error(err);
      setStatus("error", "Connection problem");
      errorState.hidden = false;
      emptyState.hidden = true;
      $("errorText").textContent =
        err.code === "permission-denied"
          ? "Firestore rules are blocking access. Publish the rules from firestore.rules."
          : "Check your Firebase configuration and internet connection, then reload.";
    }
  );
}

init();
