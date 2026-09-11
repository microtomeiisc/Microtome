const API = "/api";
const state = { bookings: [], instruments: [], week: [], specimenTypes: [], editing: null };
const $ = (selector) => document.querySelector(selector);
const slots = ["09:00 - 11:00", "11:00 - 13:00", "14:00 - 16:00", "16:00 - 18:00"];

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  setTimeout(() => element.classList.remove("show"), 2600);
}
function fmtDay(iso) {
  const date = new Date(`${iso}T00:00:00`);
  return { dow: date.toLocaleDateString(undefined, { weekday: "short" }), dom: date.getDate(), mon: date.toLocaleDateString(undefined, { month: "short" }) };
}
function instrumentName(id) { return state.instruments.find((item) => item.id === id)?.name || id; }
function setSelectOptions(selector, values, selected) {
  $(selector).innerHTML = values.map((value) => `<option value="${value}" ${value === selected ? "selected" : ""}>${value}</option>`).join("");
}

async function loadPortal() {
  const [bookings, instruments, week, specimenTypes] = await Promise.all([
    fetch(`${API}/bookings`).then((response) => response.json()),
    fetch(`${API}/instruments`).then((response) => response.json()),
    fetch(`${API}/week`).then((response) => response.json()),
    fetch(`${API}/specimen-types`).then((response) => response.json()),
  ]);
  state.bookings = bookings;
  state.instruments = instruments;
  state.week = week.slice(0, 6);
  state.specimenTypes = specimenTypes;
  $("#admin-instrument-filter").innerHTML = `<option value="all">All instruments</option>${instruments.map((item) => `<option value="${item.id}">${item.name}</option>`).join("")}`;
  renderPortal();
}

function renderPortal() {
  const query = $("#admin-search").value.trim().toLowerCase();
  const instrument = $("#admin-instrument-filter").value;
  const bookings = state.bookings.filter((booking) => {
    const textMatch = !query || [booking.booking_id, booking.user, booking.pi_name, booking.email].some((value) => (value || "").toLowerCase().includes(query));
    return textMatch && (instrument === "all" || booking.instrument_id === instrument);
  });
  $("#admin-total").textContent = state.bookings.length;
  $("#admin-upcoming").textContent = state.bookings.filter((booking) => booking.date >= state.week[0]).length;
  $("#admin-users").textContent = new Set(state.bookings.map((booking) => booking.email)).size;
  $("#admin-in-use").textContent = new Set(state.bookings.map((booking) => booking.instrument_id)).size;
  $("#admin-bookings-table").innerHTML = bookings.length ? bookings.map((booking) => {
    const day = fmtDay(booking.date);
    const formAction = booking.form_filename?.startsWith(`${booking.booking_id}_`) ? `<a class="admin-form-download" href="${API}/admin/bookings/${booking.booking_id}/user-form" download>User Form</a>` : `<span class="admin-form-missing">No upload</span>`;
    return `<tr><td><span class="booking-id">${booking.booking_id}</span><span class="table-sub">${booking.email}</span></td><td><span class="table-main">${booking.user}</span><span class="table-sub">PI: ${booking.pi_name}</span></td><td>${instrumentName(booking.instrument_id)}</td><td><span class="table-main">${day.dow}, ${day.dom} ${day.mon}</span><span class="table-sub">${booking.slot}</span></td><td><span class="admin-status">${booking.status || "booked"}</span></td><td>${formAction}</td><td class="action-cell"><button class="admin-edit" data-id="${booking.booking_id}">Edit</button><button class="admin-action" data-id="${booking.booking_id}">Cancel</button></td></tr>`;
  }).join("") : `<tr><td colspan="7" class="empty-state">No bookings match these filters.</td></tr>`;
  $("#admin-utilization").innerHTML = state.instruments.map((item) => {
    const count = state.bookings.filter((booking) => booking.instrument_id === item.id).length;
    const max = Math.max(...state.instruments.map((candidate) => state.bookings.filter((booking) => booking.instrument_id === candidate.id).length), 1);
    return `<div class="util-row"><span>${item.name}</span><strong>${count}</strong><div class="util-track"><div class="util-fill" style="width:${count / max * 100}%"></div></div></div>`;
  }).join("");
  document.querySelectorAll(".admin-edit").forEach((button) => button.addEventListener("click", () => openEdit(button.dataset.id)));
  document.querySelectorAll(".admin-action").forEach((button) => button.addEventListener("click", () => cancelBooking(button.dataset.id)));
}

function openEdit(id) {
  const booking = state.bookings.find((item) => item.booking_id === id);
  if (!booking) return;
  state.editing = booking;
  $("#edit-booking-id").textContent = booking.booking_id;
  $("#edit-user").value = booking.user;
  $("#edit-pi").value = booking.pi_name;
  $("#edit-phone").value = booking.phone;
  $("#edit-email").value = booking.email;
  $("#edit-institution").value = booking.institution || "";
  $("#edit-specimen").value = booking.specimen_type;
  $("#edit-form-file").value = booking.form_filename;
  setSelectOptions("#edit-instrument", state.instruments.map((item) => item.id), booking.instrument_id);
  setSelectOptions("#edit-date", state.week, booking.date);
  setSelectOptions("#edit-slot", slots, booking.slot);
  $("#edit-error").hidden = true;
  $("#edit-backdrop").classList.add("show");
}
function closeEdit() { $("#edit-backdrop").classList.remove("show"); }

async function saveBooking(event) {
  event.preventDefault();
  const payload = { user: $("#edit-user").value.trim(), pi_name: $("#edit-pi").value.trim(), phone: $("#edit-phone").value.trim(), email: $("#edit-email").value.trim(), institution: $("#edit-institution").value.trim(), specimen_type: $("#edit-specimen").value.trim(), form_filename: $("#edit-form-file").value.trim(), instrument_id: $("#edit-instrument").value, date: $("#edit-date").value, slot: $("#edit-slot").value };
  const response = await fetch(`${API}/admin/bookings/${state.editing.booking_id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!response.ok) { $("#edit-error").textContent = (await response.json()).error || "Could not update booking."; $("#edit-error").hidden = false; return; }
  closeEdit(); toast("Booking updated."); await loadPortal();
}
async function cancelBooking(id) {
  if (!window.confirm(`Cancel ${id}? This cannot be undone.`)) return;
  const response = await fetch(`${API}/admin/bookings/${id}`, { method: "DELETE" });
  if (response.ok) { toast("Booking cancelled."); await loadPortal(); } else toast("Could not cancel booking.");
}

async function unlock(event) {
  event.preventDefault();
  const response = await fetch(`${API}/admin-auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: $("#admin-password").value }) });
  if (!response.ok) { $("#login-error").hidden = false; return; }
  $("#login-card").hidden = true;
  $("#portal-content").hidden = false;
  loadPortal().catch(() => toast("Could not load booking data."));
}

$("#login-form").addEventListener("submit", unlock);
$("#admin-refresh").addEventListener("click", loadPortal);
$("#admin-search").addEventListener("input", renderPortal);
$("#admin-instrument-filter").addEventListener("change", renderPortal);
$("#edit-form").addEventListener("submit", saveBooking);
$("#edit-cancel").addEventListener("click", closeEdit);
$("#edit-backdrop").addEventListener("click", (event) => { if (event.target.id === "edit-backdrop") closeEdit(); });
