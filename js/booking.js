/* PI FRAMES — booking calendar client
   Talks to the Google Apps Script backend (URL injected via window.PIFRAMES_BOOKING).
   Gracefully degrades to WhatsApp/email if the API isn't connected yet. */
(function () {
  "use strict";
  const CFG = window.PIFRAMES_BOOKING || {};
  const API = (CFG.apiUrl || "").trim();

  const $ = (s, c) => (c || document).querySelector(s);
  const grid   = $("#cal-grid");
  if (!grid) return; // not the bookings page

  const titleEl = $("#cal-title");
  const stateEl = $("#cal-state");
  const slotbox = $("#slotbox");
  const slotsEl = $("#slots");
  const slotDay = $("#slot-day");
  const prevBtn = $("#cal-prev");
  const nextBtn = $("#cal-next");
  const form    = $("#booking-form");
  const chosen  = $("#book-chosen");
  const chosenText = $("#chosen-text");
  const hiddenDate = $("#f-date");
  const hiddenSlot = $("#f-slot");
  const submitBtn = $("#book-submit");
  const hint    = $("#book-hint");
  const okEl    = $("#form-ok");

  const MONTHS = ["January","February","March","April","May","June",
                  "July","August","September","October","November","December"];
  const pad = n => String(n).padStart(2, "0");
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const todayStr = ymd(new Date());

  // Default slots (used if API is offline). Kept in sync with Code.gs CONFIG.SLOTS.
  const FALLBACK_SLOTS = [
    { id: "morning",   label: "Morning · 8:00–11:00" },
    { id: "midday",    label: "Midday · 11:30–14:30" },
    { id: "afternoon", label: "Afternoon · 15:00–18:00" },
    { id: "goldenhr",  label: "Golden hour · sunset session" },
  ];

  let view = new Date(); view.setDate(1);         // month being shown
  let slots = FALLBACK_SLOTS.slice();
  let closedWeekdays = [];
  let takenMap = {};                              // { 'YYYY-MM-DD': {slotId:true} }
  let availLoaded = false;
  let selDate = null, selSlot = null;

  const monthKey = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
  const loadedMonths = new Set();

  /* ---------- fetch availability for the visible month ---------- */
  async function loadMonth(d) {
    if (!API) {
      availLoaded = false;
      stateEl.classList.remove("err");
      stateEl.textContent = "Pick a date and time to send your request.";
      render();
      return;
    }
    const first = new Date(d.getFullYear(), d.getMonth(), 1);
    const last  = new Date(d.getFullYear(), d.getMonth()+1, 0);
    const key = monthKey(d);
    try {
      stateEl.classList.remove("err");
      if (!loadedMonths.has(key)) stateEl.textContent = "Loading availability…";
      const url = `${API}?action=availability&from=${ymd(first)}&to=${ymd(last)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!data || data.ok === false) throw new Error((data && data.error) || "bad response");
      if (Array.isArray(data.slots) && data.slots.length) slots = data.slots;
      closedWeekdays = data.closedWeekdays || [];
      // merge this month's taken info into the map
      Object.assign(takenMap, data.taken || {});
      loadedMonths.add(key);
      availLoaded = true;
      stateEl.textContent = "Pick an open date to see available times.";
    } catch (err) {
      availLoaded = false;
      stateEl.textContent = "Live availability isn't connected yet — you can still request a date below.";
    }
    render();
  }

  /* ---------- day status ---------- */
  // 'past' | 'closed' | 'full' | 'some' | 'open'  (or null for filler)
  function dayStatus(dateStr, weekday) {
    if (dateStr < todayStr) return "past";
    if (closedWeekdays.indexOf(weekday) !== -1) return "closed";
    if (!availLoaded) return "open"; // unknown → let them request
    const taken = takenMap[dateStr] || {};
    const takenCount = slots.filter(s => taken[s.id]).length;
    if (takenCount === 0) return "open";
    if (takenCount >= slots.length) return "full";
    return "some";
  }

  /* ---------- render the month grid ---------- */
  function render() {
    titleEl.textContent = `${MONTHS[view.getMonth()]} ${view.getFullYear()}`;
    grid.innerHTML = "";

    // Monday-first offset
    const firstDow = (new Date(view.getFullYear(), view.getMonth(), 1).getDay() + 6) % 7;
    for (let i = 0; i < firstDow; i++) {
      const f = document.createElement("div");
      f.className = "cal-day empty"; f.setAttribute("aria-hidden","true");
      grid.appendChild(f);
    }

    const days = new Date(view.getFullYear(), view.getMonth()+1, 0).getDate();
    for (let day = 1; day <= days; day++) {
      const dObj = new Date(view.getFullYear(), view.getMonth(), day);
      const dateStr = ymd(dObj);
      const wd = dObj.getDay();
      const status = dayStatus(dateStr, wd);

      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cal-day " + status;
      cell.dataset.date = dateStr;
      cell.setAttribute("role","gridcell");
      const openable = (status === "open" || status === "some");
      const label = `${MONTHS[view.getMonth()]} ${day}` +
        (status==="full" ? ", fully booked" : status==="past" ? ", past" :
         status==="closed" ? ", closed" : ", available");
      cell.setAttribute("aria-label", label);
      if (!openable) cell.setAttribute("aria-disabled","true");

      cell.innerHTML = `<span class="num">${day}</span>` +
        (openable ? '<span class="dot"></span>' : "");

      if (dateStr === selDate) cell.classList.add("selected");
      if (openable) cell.addEventListener("click", () => selectDay(dateStr, cell));
      grid.appendChild(cell);
    }

    // update prev button (can't go before current month)
    const thisMonth = new Date(); thisMonth.setDate(1);
    prevBtn.disabled = (view.getFullYear() === thisMonth.getFullYear() &&
                        view.getMonth() === thisMonth.getMonth());
  }

  /* ---------- pick a day → show slots ---------- */
  function selectDay(dateStr, cell) {
    selDate = dateStr; selSlot = null;
    grid.querySelectorAll(".cal-day.selected").forEach(c => c.classList.remove("selected"));
    if (cell) cell.classList.add("selected");

    const d = new Date(dateStr + "T00:00:00");
    const pretty = d.toLocaleDateString(undefined, { weekday:"long", month:"long", day:"numeric" });
    slotDay.textContent = "· " + pretty;

    const taken = takenMap[dateStr] || {};
    slotsEl.innerHTML = "";
    slots.forEach(s => {
      const isTaken = availLoaded && taken[s.id];
      const b = document.createElement("button");
      b.type = "button";
      b.className = "slot";
      b.dataset.slot = s.id;
      b.setAttribute("aria-pressed","false");
      if (isTaken) { b.disabled = true; }
      const parts = s.label.split("·");
      b.innerHTML = `${parts[0].trim()}` +
        (parts[1] ? `<span class="s-note">${isTaken ? "Booked" : parts[1].trim()}</span>`
                  : (isTaken ? `<span class="s-note">Booked</span>` : ""));
      if (!isTaken) b.addEventListener("click", () => selectSlot(s, b));
      slotsEl.appendChild(b);
    });

    slotbox.classList.add("show");
    slotbox.scrollIntoView({ behavior:"smooth", block:"nearest" });
  }

  /* ---------- pick a slot → arm the form ---------- */
  function selectSlot(slot, btn) {
    selSlot = slot;
    slotsEl.querySelectorAll(".slot").forEach(s => s.setAttribute("aria-pressed","false"));
    btn.setAttribute("aria-pressed","true");

    hiddenDate.value = selDate;
    hiddenSlot.value = slot.id;

    const d = new Date(selDate + "T00:00:00");
    const pretty = d.toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric" });
    chosenText.textContent = `${pretty} — ${slot.label}`;
    chosen.classList.add("show");
    submitBtn.textContent = "Request this slot";
    hint.textContent = "We'll hold this slot the moment you send.";
    okEl.classList.remove("show");
    chosen.scrollIntoView({ behavior:"smooth", block:"center" });
  }

  $("#chosen-change") && $("#chosen-change").addEventListener("click", () => {
    chosen.classList.remove("show");
    selSlot = null; hiddenSlot.value = "";
    slotsEl.querySelectorAll(".slot").forEach(s => s.setAttribute("aria-pressed","false"));
    hint.textContent = "Pick a date and time on the calendar first.";
    slotbox.scrollIntoView({ behavior:"smooth", block:"nearest" });
  });

  /* ---------- month nav ---------- */
  prevBtn.addEventListener("click", () => { view.setMonth(view.getMonth()-1); loadMonth(view); });
  nextBtn.addEventListener("click", () => { view.setMonth(view.getMonth()+1); loadMonth(view); });

  /* ---------- submit ---------- */
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    okEl.classList.remove("show","err");

    const val = id => (form.elements[id] ? form.elements[id].value.trim() : "");
    // require a slot choice
    if (!selDate || !selSlot) {
      hint.textContent = "Please pick a date and time on the calendar first.";
      slotbox.classList.contains("show")
        ? slotbox.scrollIntoView({ behavior:"smooth", block:"nearest" })
        : grid.scrollIntoView({ behavior:"smooth", block:"nearest" });
      return;
    }
    if (!form.reportValidity()) return;

    const payload = {
      name: val("name"), email: val("email"), phone: val("phone"),
      type: val("type"), location: val("location"), message: val("message"),
      date: selDate, slot: selSlot.id,
    };

    // No backend connected → fall back to WhatsApp with everything filled in.
    if (!API) return fallbackSend(payload);

    submitBtn.disabled = true;
    const original = submitBtn.textContent;
    submitBtn.textContent = "Sending…";
    try {
      const res = await fetch(API, {
        method: "POST",
        // text/plain avoids a CORS preflight against Apps Script
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data && data.ok) {
        okEl.textContent = (data.message || "Request received — your slot is held. Chase will confirm by email shortly.") +
                           (data.ref ? `  (Ref ${data.ref})` : "");
        okEl.classList.add("show");
        form.reset();
        chosen.classList.remove("show");
        // mark the slot as taken locally & refresh the picker
        (takenMap[selDate] = takenMap[selDate] || {})[selSlot.id] = true;
        const keep = selDate; selSlot = null; render();
        const cell = grid.querySelector(`.cal-day[data-date="${keep}"]`);
        if (cell && !cell.classList.contains("full")) selectDay(keep, cell);
        hint.textContent = "Pick another date and time on the calendar.";
      } else if (data && data.error === "slot_taken") {
        okEl.textContent = data.message || "Sorry — that slot was just taken. Please choose another.";
        okEl.classList.add("show","err");
        (takenMap[selDate] = takenMap[selDate] || {})[selSlot.id] = true;
        const cell = grid.querySelector(`.cal-day[data-date="${selDate}"]`);
        if (cell) selectDay(selDate, cell);
      } else {
        throw new Error((data && data.error) || "unknown");
      }
    } catch (err) {
      // network/backend failure → don't lose the enquiry, hand off to WhatsApp
      okEl.textContent = "Couldn't reach the booking server — opening WhatsApp so your request still gets through.";
      okEl.classList.add("show","err");
      fallbackSend(payload);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = original;
    }
  });

  /* ---------- WhatsApp/email fallback ---------- */
  function fallbackSend(p) {
    const slotLabel = (slots.find(s => s.id === p.slot) || {}).label || p.slot;
    const lines = [
      "Hi Chase, I'd like to book a session:",
      "", `Date: ${p.date}`, `Time: ${slotLabel}`, `Type: ${p.type || "—"}`,
      `Name: ${p.name}`, `Email: ${p.email}`, `Phone: ${p.phone || "—"}`,
      `Location: ${p.location || "—"}`, "", "About the shoot:", p.message || "—",
    ].join("\n");
    const wa = (CFG.wa || "").trim();
    if (wa) {
      const base = wa.replace(/\/$/, "");
      window.open(base + "?text=" + encodeURIComponent(lines), "_blank", "noopener");
    } else {
      window.location.href = "mailto:" + (CFG.email || "") +
        "?subject=" + encodeURIComponent(`Booking request — ${p.type||"session"} on ${p.date}`) +
        "&body=" + encodeURIComponent(lines);
    }
  }

  /* ---------- go ---------- */
  loadMonth(view);
})();
