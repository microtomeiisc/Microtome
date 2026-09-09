/* Histopathology Facility — frontend logic backed by Supabase.
   The publishable key is safe to expose in this browser client; all data
   access is protected by Supabase RLS policies in supabase/schema.sql. */

const SUPABASE_CONFIG = window.SUPABASE_CONFIG || {};
let db = null;
let realtimeChannel = null;
const state = {
  instruments: [],
  specimenTypes: [],
  sopDocuments: [],
  userForm: null,
  contacts: [],
  weekDays: [],
  selectedInstrument: null,
  selectedDate: null,
  selectedSlot: null,
  availability: {},
  availabilityChecked: false,
  myEmail: "",
  bookingWindowOpen: false,
  bookingWindowMessage: "",
};

const $ = (sel) => document.querySelector(sel);

function getClient() {
  if (db) return db;
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    throw new Error("Supabase browser client is unavailable. Check the CDN script in index.html.");
  }
  if (!SUPABASE_CONFIG.url || !SUPABASE_CONFIG.publishableKey) {
    throw new Error("Supabase configuration is missing. Set SUPABASE_CONFIG.url and SUPABASE_CONFIG.publishableKey.");
  }
  db = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.publishableKey);
  return db;
}

async function ensureAnonymousAuth() {
  const client = getClient();
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw new Error(`Supabase authentication failed: ${sessionError.message}`);
  if (sessionData.session) return;
  const { error } = await client.auth.signInAnonymously();
  if (error) {
    throw new Error(`Anonymous Supabase authentication is unavailable: ${error.message}`);
  }
}

function requireResult(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

function showConnectionError(err) {
  console.error("Supabase connection error", err);
  toast(`Supabase unavailable: ${err.message}`);
  $("#banner-title").textContent = "Booking service unavailable";
  $("#banner-sub").textContent = err.message;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}

function fmtDay(iso) {
  const d = new Date(iso + "T00:00:00");
  return { dow: d.toLocaleDateString(undefined, { weekday: "short" }), dom: d.getDate(), mon: d.toLocaleDateString(undefined, { month: "short" }) };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

async function loadInitial() {
  const client = getClient();
  await ensureAnonymousAuth();
  const [instruments, context, specimenTypes, sopDocuments, userForm, contacts] = await Promise.all([
    client.from("instruments").select("id,name,tagline,icon,sop").order("sort_order"),
    client.rpc("get_booking_context"),
    client.from("specimen_types").select("name").order("sort_order"),
    client.from("sop_documents").select("title,file,sop_no").order("sort_order"),
    client.from("facility_settings").select("value").eq("key", "user_form").single(),
    client.from("facility_contacts").select("role,name,phone,email").order("sort_order"),
  ].map((request, index) => request.then((result) => requireResult(result, ["instruments", "booking context", "specimen types", "SOP documents", "user form", "contacts"][index]))));
  state.instruments = instruments;
  state.weekDays = context.week_days;
  state.bookingWindowOpen = context.open;
  state.bookingWindowMessage = context.message;
  state.specimenTypes = specimenTypes.map((item) => item.name);
  state.sopDocuments = sopDocuments;
  state.userForm = userForm.value;
  state.contacts = contacts;
  if (!instruments.length || !state.weekDays.length) throw new Error("Supabase metadata is incomplete.");
  state.selectedInstrument = instruments[0].id;
  state.selectedDate = state.weekDays[4]; // default to Friday, like the template
  renderInstruments();
  renderDays();
  await refreshAvailability(); // fetches THIS instrument's own calendar, then renders slots
  renderWeekRange();
  renderBookingPanel();
  refreshBookingWindow();
  await Promise.all([refreshStats(), refreshMyBookings()]);
  renderSopList();
  renderUserForm();
  renderContacts();
  subscribeToBookingChanges();
}

function renderWeekRange() {
  if (!state.weekDays.length) return;
  const a = fmtDay(state.weekDays[0]);
  const b = fmtDay(state.weekDays[5]);
  $("#week-range").textContent = `${a.dom} ${a.mon} – ${b.dom} ${b.mon} ${new Date(state.weekDays[0]).getFullYear()}`;
}

function renderDays() {
  const el = $("#days");
  el.innerHTML = "";
  state.weekDays.slice(0, 6).forEach((iso) => {
    // Mon–Sat: the bookable week
    const { dow, dom } = fmtDay(iso);
    const btn = document.createElement("div");
    btn.className = "day-btn" + (iso === state.selectedDate ? " active" : "");
    btn.innerHTML = `${dow}<b>${dom}</b>`;
    btn.onclick = () => {
      state.selectedDate = iso;
      state.availabilityChecked = false;
      renderDays();
      renderSlotsTable();
      renderBookingPanel();
    };
    el.appendChild(btn);
  });
}

const ICONS = { processor: "\u2699\uFE0F", embedding: "\u{1F9CA}", microtome: "\u{1F52C}", cryostat: "\u2744\uFE0F", vibratome: "\u{1F30A}", scanner: "\u{1F5A5}\uFE0F", stainer: "\u{1F9EA}" };

function renderInstruments() {
  const el = $("#instrument-list");
  el.innerHTML = "";
  state.instruments.forEach((inst) => {
    const row = document.createElement("div");
    row.className = "instrument-item" + (inst.id === state.selectedInstrument ? " active" : "");
    row.innerHTML = `
      <span class="instrument-radio"></span>
      <span class="instrument-ic">${ICONS[inst.icon] || "\u{1F9EA}"}</span>
      <span>
        <div class="instrument-name">${inst.name}</div>
        <div class="instrument-tag">${inst.tagline}</div>
      </span>
      <a class="instrument-sop-link" href="docs/${inst.sop}" target="_blank" rel="noopener">View SOP</a>`;
    row.addEventListener("click", async (e) => {
      if (e.target.closest(".instrument-sop-link")) return; // let the SOP link open normally
      state.selectedInstrument = inst.id;
      state.selectedSlot = null;
      state.availabilityChecked = false;
      renderInstruments();
      await refreshAvailability(); // pulls THIS instrument's slots, then re-renders the slots panel
      renderBookingPanel();
    });
    el.appendChild(row);
  });
}

async function refreshAvailability() {
  // Each instrument has its own independent calendar.
  const client = getClient();
  const result = await client.rpc("get_booking_availability", {
    p_instrument_id: state.selectedInstrument,
    p_week_start: state.weekDays[0],
  });
  const rows = requireResult(result, "Could not load availability");
  state.availability = {};
  rows.forEach((row) => {
    if (!state.availability[row.date]) state.availability[row.date] = {};
    state.availability[row.date][row.slot] = row.status;
  });
  const inst = state.instruments.find((i) => i.id === state.selectedInstrument);
  $("#slots-inst-name").textContent = inst ? inst.name : "";
  renderSlotsTable();
}

function renderSlotsTable() {
  const el = $("#slots-table");
  const days = state.weekDays.slice(0, 6); // Mon–Sat
  const slots = ["09:00 - 11:00", "11:00 - 13:00", "14:00 - 16:00", "16:00 - 18:00"];

  let html = `<div class="slot-row head"><div class="slot-cell">Time</div>${days
    .map((d) => {
      const { dow, dom } = fmtDay(d);
      return `<div class="slot-cell">${dow} ${dom}</div>`;
    })
    .join("")}</div>`;

  slots.forEach((slot) => {
    html += `<div class="slot-row"><div class="slot-cell">${slot.replace(" - ", " – ")}</div>`;
    days.forEach((d) => {
      const status = state.availability[d]?.[slot] || "available";
      const isSel = d === state.selectedDate && slot === state.selectedSlot;
      html += `<div class="slot-cell"><div class="pill ${status}${isSel ? " selected" : ""}" data-date="${d}" data-slot="${slot}">${status === "booked" ? "Booked" : "Available"}</div></div>`;
    });
    html += `</div>`;
  });

  el.innerHTML = html;

  el.querySelectorAll(".pill.available").forEach((pill) => {
    pill.addEventListener("click", () => {
      state.selectedDate = pill.dataset.date;
      state.selectedSlot = pill.dataset.slot;
      state.availabilityChecked = false;
      renderDays();
      renderSlotsTable();
      renderBookingPanel();
    });
  });
}

function renderBookingPanel() {
  const inst = state.instruments.find((i) => i.id === state.selectedInstrument);
  $("#sel-instrument").textContent = inst ? inst.name : "—";

  const { dow, dom, mon } = state.selectedDate ? fmtDay(state.selectedDate) : {};
  $("#sel-date").textContent = state.selectedDate ? `${dom} ${mon} (${dow})` : "—";

  const slotSelect = $("#sel-slot");
  const slots = ["09:00 - 11:00", "11:00 - 13:00", "14:00 - 16:00", "16:00 - 18:00"];
  slotSelect.innerHTML = slots.map((s) => `<option value="${s}" ${s === state.selectedSlot ? "selected" : ""}>${s}</option>`).join("");
  if (!state.selectedSlot) state.selectedSlot = slots[0];
  slotSelect.onchange = () => {
    state.selectedSlot = slotSelect.value;
    state.availabilityChecked = false;
    $("#avail-status").hidden = true;
    $("#btn-book").disabled = true;
  };

  const specimenSelect = $("#f-specimen");
  if (!specimenSelect.options.length) {
    specimenSelect.innerHTML = state.specimenTypes.map((t) => `<option value="${t}">${t}</option>`).join("");
  }

  $("#avail-status").hidden = true;
  $("#btn-book").disabled = true;
}

async function refreshBookingWindow() {
  const banner = $("#window-banner");
  banner.classList.toggle("open", state.bookingWindowOpen);
  $("#banner-title").textContent = state.bookingWindowOpen
    ? "Booking window is open."
    : "Booking Window: Friday 12:00 PM – Sunday 11:59 AM (for the upcoming week).";
  $("#banner-sub").textContent = state.bookingWindowMessage;
}

async function refreshStats() {
  const result = await getClient().rpc("get_booking_stats", { p_week_start: state.weekDays[0] });
  const stats = requireResult(result, "Could not load booking statistics");
  $("#stat-bookings").textContent = stats.total;
  $("#stat-users").textContent = stats.users;
  $("#stat-pending").textContent = stats.pending;
  $("#stat-completed").textContent = stats.completed;
}

async function refreshMyBookings() {
  let query = getClient().from("bookings").select("*").order("date", { ascending: true }).order("slot", { ascending: true });
  if (state.myEmail) query = query.eq("email", state.myEmail);
  const bookings = requireResult(await query, "Could not load your bookings");
  const list = state.myEmail ? bookings : bookings.slice(-3).reverse();
  const el = $("#my-bookings");
  if (!list.length) {
    el.innerHTML = `<div class="empty-state">No bookings yet. Book a slot above and it will show up here.</div>`;
    return;
  }
  el.innerHTML = list
    .slice()
    .reverse()
    .map((b) => {
      const inst = state.instruments.find((i) => i.id === b.instrument_id);
      const { dow, dom, mon } = fmtDay(b.date);
      return `<div class="booking-row">
        <div class="b-main">
          <span class="b-id">${b.booking_id}</span>
          <span class="b-meta">${escapeHtml(inst ? inst.name : b.instrument_id)} · ${dow} ${dom} ${mon}, ${escapeHtml(b.slot)} · ${escapeHtml(b.user_name)}</span>
        </div>
        <button class="btn-cancel" data-id="${b.booking_id}">Cancel</button>
      </div>`;
    })
    .join("");
  el.querySelectorAll(".btn-cancel").forEach((btn) => {
    btn.addEventListener("click", async () => {
    const result = await getClient().from("bookings").delete().eq("booking_id", btn.dataset.id).select("booking_id");
    if (!result.error && result.data?.length) {
      toast("Booking cancelled.");
      await Promise.all([refreshAvailability(), refreshMyBookings(), refreshStats()]);
    } else {
      toast(result.error?.message || "Could not cancel that booking.");
    }
    });
  });
}

function renderSopList() {
  const el = $("#sop-list");
  el.innerHTML = state.sopDocuments
    .map(
      (doc) => `<div class="sop-item">
        <div class="sop-no">${doc.sop_no}</div>
        <div class="sop-title">${doc.title}</div>
        <div class="sop-actions">
          <a class="btn-view" href="docs/${doc.file}" target="_blank" rel="noopener">View</a>
          <a class="btn-download-ic" href="docs/${doc.file}" download title="Download">&#8681;</a>
        </div>
      </div>`
    )
    .join("");
}

function renderUserForm() {
  if (!state.userForm) return;
  $("#user-form-title").textContent = state.userForm.title;
  const href = `docs/${state.userForm.file}`;
  $("#user-form-view").href = href;
  $("#user-form-view").addEventListener("click", (e) => {
    e.preventDefault();
    $("#user-form-frame").src = href;
    $("#user-form-modal-backdrop").classList.add("show");
  });
  $("#user-form-download").href = href;
}

function renderContacts() {
  const el = $("#contact-list");
  el.innerHTML = state.contacts
    .map(
      (c) => `<div class="contact-item">
        <div class="contact-role">${c.role}</div>
        <div class="contact-name">${c.name}</div>
        <div class="contact-detail">&#9742; <a href="tel:${c.phone}">${c.phone}</a></div>
        <div class="contact-detail">&#9993; <a href="mailto:${c.email}">${c.email}</a></div>
      </div>`
    )
    .join("");
}

function showModal(bookingId) {
  $("#modal-booking-id").textContent = bookingId;
  $("#modal-backdrop").classList.add("show");
}
function hideModal() {
  $("#modal-backdrop").classList.remove("show");
}

function validateForm() {
  const required = {
    "User name": $("#f-user").value.trim(),
    "PI name": $("#f-pi").value.trim(),
    "Phone number": $("#f-phone").value.trim(),
    "Email ID": $("#f-email").value.trim(),
    "Specimen type": $("#f-specimen").value,
  };
  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (!$("#f-form").files.length) missing.push("Attached User Form");
  return missing;
}

function wireBookingButtons() {
  $("#btn-check").addEventListener("click", () => {
    if (!state.bookingWindowOpen) {
      toast("The booking window is currently closed.");
      return;
    }
    const status = state.availability[state.selectedDate]?.[state.selectedSlot] || "available";
    const box = $("#avail-status");
    box.hidden = false;
    if (status === "booked") {
      box.className = "status-box no";
      box.textContent = "This slot is already booked for this instrument. Please choose another.";
      $("#btn-book").disabled = true;
    } else {
      box.className = "status-box ok";
      box.textContent = "Slot available. Fill in your details above and confirm.";
      $("#btn-book").disabled = false;
      state.availabilityChecked = true;
    }
  });

  $("#btn-book").addEventListener("click", async () => {
    if (!state.availabilityChecked || !state.bookingWindowOpen) {
      toast("The booking window is currently closed or the slot was not checked.");
      return;
    }
    const missing = validateForm();
    if (missing.length) {
      toast("Missing: " + missing.join(", "));
      return;
    }
    const email = $("#f-email").value.trim();
    const result = await getClient().from("bookings").insert({
      user_name: $("#f-user").value.trim(),
      pi_name: $("#f-pi").value.trim(),
      phone: $("#f-phone").value.trim(),
      email,
      institution: $("#f-institution").value.trim(),
      specimen_type: $("#f-specimen").value,
      instrument_id: state.selectedInstrument,
      date: state.selectedDate,
      slot: state.selectedSlot,
      form_filename: $("#f-form").files[0].name,
    }).select("*").single();
    if (!result.error) {
      const record = result.data;
      state.myEmail = email;
      state.availabilityChecked = false;
      await refreshAvailability();
      renderBookingPanel();
      await Promise.all([refreshStats(), refreshMyBookings()]);
      showModal(record.booking_id);
    } else {
      toast(result.error.message || "Could not book this slot.");
      await refreshAvailability();
      renderBookingPanel();
    }
  });

  $("#modal-close").addEventListener("click", hideModal);
  $("#modal-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "modal-backdrop") hideModal();
  });

  $("#contact-support-link").addEventListener("click", (e) => {
    e.preventDefault();
    $("#contact-modal-backdrop").classList.add("show");
  });
  $("#contact-modal-close").addEventListener("click", () => {
    $("#contact-modal-backdrop").classList.remove("show");
  });
  $("#contact-modal-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "contact-modal-backdrop") $("#contact-modal-backdrop").classList.remove("show");
  });

  const closeUserFormModal = () => {
    $("#user-form-modal-backdrop").classList.remove("show");
    $("#user-form-frame").removeAttribute("src");
  };
  $("#user-form-modal-close").addEventListener("click", closeUserFormModal);
  $("#user-form-modal-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "user-form-modal-backdrop") closeUserFormModal();
  });
}

function subscribeToBookingChanges() {
  if (realtimeChannel) return;
  realtimeChannel = getClient()
    .channel("bookings-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, async () => {
      try {
        await Promise.all([refreshAvailability(), refreshStats(), refreshMyBookings()]);
      } catch (err) {
        console.warn("Could not refresh after a realtime booking change.", err);
      }
    })
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR") {
        console.error("Supabase realtime is unavailable. Refresh the page to see booking changes.");
      }
    });
}

document.addEventListener("DOMContentLoaded", () => {
  wireBookingButtons();
  loadInitial().catch((err) => {
    showConnectionError(err);
  });
});
