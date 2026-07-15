/*  PI FRAMES — Booking backend (Google Apps Script)
 *  ---------------------------------------------------------------
 *  This script turns a Google Sheet into a tiny booking API:
 *    • GET  ?action=availability&from=YYYY-MM-DD&to=YYYY-MM-DD
 *         → returns which time slots are already taken/held per day
 *    • POST {name,email,phone,type,date,time,location,message}
 *         → records a new booking request (status "pending") and
 *           emails Chase a notification
 *
 *  Follow SETUP-GUIDE.md to deploy. You only edit the CONFIG block.
 */

// ======================= CONFIG =======================
const CONFIG = {
  // Where request notifications are sent:
  NOTIFY_EMAIL: 'chase.solomon@gmail.com',

  // Business name used in emails:
  BUSINESS: 'PI Frames',

  // The time slots you offer on a normal working day.
  // Guests pick ONE of these. Edit freely (label is what they see).
  // The `start`/`end` (24-hour "HH:MM") are used ONLY for Google Calendar
  // events — they set how long the calendar block is. The website still just
  // shows the label. If you don't use Calendar, start/end are ignored.
  SLOTS: [
    { id: 'morning',   label: 'Morning · 8:00–11:00',        start: '08:00', end: '11:00' },
    { id: 'midday',    label: 'Midday · 11:30–14:30',        start: '11:30', end: '14:30' },
    { id: 'afternoon', label: 'Afternoon · 15:00–18:00',     start: '15:00', end: '18:00' },
    { id: 'goldenhr',  label: 'Golden hour · sunset session', start: '17:00', end: '19:00' },
  ],

  // Weekdays you do NOT work (0=Sun … 6=Sat). Example [0] = closed Sundays.
  // These days show as "unavailable" automatically. Leave [] to allow all.
  CLOSED_WEEKDAYS: [],

  // A booking that is only "pending" still holds the slot for this many
  // hours before it is auto-released (so a slot isn't blocked forever by
  // someone who never confirmed). Set 0 to hold pending slots indefinitely.
  PENDING_HOLD_HOURS: 72,

  // -------------------- GOOGLE CALENDAR --------------------
  // Link this booking system to your real Google Calendar.
  // Leave CALENDAR_ID as 'primary' to use your main calendar (the one for the
  // Google account that owns this script). Or paste a specific calendar's ID
  // (Google Calendar → that calendar's Settings → "Integrate calendar" →
  // "Calendar ID", looks like "...@group.calendar.google.com").
  CALENDAR_ID: 'primary',

  // (1) WRITE: when a booking comes in, also create an event on your calendar.
  //     true  = yes, put confirmed/held sessions on my calendar
  //     false = don't touch my calendar on new bookings
  CALENDAR_CREATE_EVENTS: true,

  // Only create the calendar event once you CONFIRM the booking (recommended),
  // rather than the moment a request arrives. If false, an event is created
  // immediately for every pending request and removed if you decline.
  CALENDAR_ONLY_WHEN_CONFIRMED: true,

  // Prefix for event titles created on your calendar.
  CALENDAR_EVENT_PREFIX: '📸 Shoot',

  // (2) READ: let events ALREADY on your calendar block out website slots, so
  //     you don't have to also type busy days into the "Blocked" sheet.
  //     true  = a matching calendar event makes that slot show as taken online
  //     false = ignore my calendar when working out availability
  CALENDAR_BLOCKS_AVAILABILITY: true,

  // When reading (2), an all-day event blocks the WHOLE day. A timed event
  // blocks any slot whose time overlaps it. Events whose title contains any
  // word in this list are IGNORED for blocking (so a "Tentative" or "Personal
  // reminder" note doesn't close a slot). Case-insensitive. Leave [] to block
  // on every event.
  CALENDAR_IGNORE_TITLES_WITH: ['tentative', 'free', 'available'],
};
// ===================== END CONFIG =====================


const SHEET_BOOKINGS = 'Bookings';
const SHEET_BLOCKED   = 'Blocked';   // manual day/slot blocks you control
const HEADERS = ['Timestamp','Status','Date','Slot','Name','Email','Phone','Type','Location','Message','Ref'];

/** Entry point for GET requests (availability lookups). */
function doGet(e) {
  try {
    const action = (e.parameter.action || 'availability');
    if (action === 'availability') {
      return json_(getAvailability_(e.parameter.from, e.parameter.to));
    }
    if (action === 'slots') {
      return json_({ slots: CONFIG.SLOTS });
    }
    return json_({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/** Entry point for POST requests (new booking). */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents || '{}');
    const res = createBooking_(data);
    return json_(res);
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/** Build the availability map for a date range. */
function getAvailability_(from, to) {
  const sheet = getSheet_(SHEET_BOOKINGS);
  const rows = sheet.getDataRange().getValues();
  const idx = headerIndex_(rows[0]);

  const now = Date.now();
  const holdMs = CONFIG.PENDING_HOLD_HOURS * 3600 * 1000;

  // taken[date] = Set(slotId) that are unavailable
  const taken = {};
  const add = (date, slot) => {
    if (!date || !slot) return;
    (taken[date] = taken[date] || {})[slot] = true;
  };

  for (let r = 1; r < rows.length; r++) {
    const status = String(rows[r][idx.Status] || '').toLowerCase();
    const date = normDate_(rows[r][idx.Date]);
    const slot = String(rows[r][idx.Slot] || '');
    if (!date) continue;
    if (status === 'cancelled' || status === 'declined') continue;
    if (status === 'pending' && holdMs > 0) {
      const ts = new Date(rows[r][idx.Timestamp]).getTime();
      if (isFinite(ts) && (now - ts) > holdMs) continue; // expired hold
    }
    add(date, slot); // confirmed OR still-held pending both block the slot
  }

  // manual blocks (whole days or specific slots) from the Blocked sheet
  const blocked = getSheet_(SHEET_BLOCKED).getDataRange().getValues();
  for (let r = 1; r < blocked.length; r++) {
    const date = normDate_(blocked[r][0]);
    const slot = String(blocked[r][1] || '').trim();
    if (!date) continue;
    if (!slot || slot.toUpperCase() === 'ALL') {
      CONFIG.SLOTS.forEach(s => add(date, s.id));
    } else {
      add(date, slot);
    }
  }

  // busy times pulled straight from your real Google Calendar
  if (CONFIG.CALENDAR_BLOCKS_AVAILABILITY && from && to) {
    applyCalendarBlocks_(from, to, add);
  }

  return {
    ok: true,
    from: from || null,
    to: to || null,
    slots: CONFIG.SLOTS,
    closedWeekdays: CONFIG.CLOSED_WEEKDAYS,
    taken: taken,
  };
}

/** Validate + record a new booking, hold the slot, notify Chase. */
function createBooking_(d) {
  const required = ['name', 'email', 'date', 'slot'];
  for (const k of required) {
    if (!d[k] || String(d[k]).trim() === '') {
      return { ok: false, error: 'Missing ' + k };
    }
  }
  const date = normDate_(d.date);
  if (!date) return { ok: false, error: 'Bad date' };
  const slotId = String(d.slot);
  if (!CONFIG.SLOTS.some(s => s.id === slotId)) {
    return { ok: false, error: 'Unknown slot' };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000); // prevent two people grabbing the same slot at once
  try {
    // re-check the slot is still free
    const avail = getAvailability_(date, date);
    if (avail.taken[date] && avail.taken[date][slotId]) {
      return { ok: false, error: 'slot_taken',
               message: 'Sorry — that slot was just taken. Please pick another.' };
    }

    const sheet = getSheet_(SHEET_BOOKINGS);
    const ref = 'PF-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd') +
                '-' + Math.floor(1000 + Math.random() * 9000);
    const slotLabel = (CONFIG.SLOTS.find(s => s.id === slotId) || {}).label || slotId;

    sheet.appendRow([
      new Date(),               // Timestamp
      'pending',                // Status  (you change to confirmed/declined)
      date,                     // Date
      slotId,                   // Slot
      String(d.name).trim(),
      String(d.email).trim(),
      String(d.phone || '').trim(),
      String(d.type || '').trim(),
      String(d.location || '').trim(),
      String(d.message || '').trim(),
      ref,
    ]);

    // If configured to add events immediately (not only on confirm), do it now.
    if (CONFIG.CALENDAR_CREATE_EVENTS && !CONFIG.CALENDAR_ONLY_WHEN_CONFIRMED) {
      const rowObj = {
        Date: date, Slot: slotId, Ref: ref,
        Name: String(d.name).trim(), Email: String(d.email).trim(),
        Phone: String(d.phone || '').trim(), Type: String(d.type || '').trim(),
        Location: String(d.location || '').trim(), Message: String(d.message || '').trim(),
      };
      const id = upsertCalendarEvent_(rowObj);
      if (id) {
        const eventIdCol = ensureEventIdColumn_(sheet, sheet.getDataRange().getValues()[0]);
        sheet.getRange(sheet.getLastRow(), eventIdCol).setValue(id);
      }
    }

    notify_(d, date, slotLabel, ref);
    return { ok: true, ref: ref,
             message: 'Request received — your slot is held. Chase will confirm by email shortly.' };
  } finally {
    lock.releaseLock();
  }
}

// ================= GOOGLE CALENDAR: READ =================
/** Resolve the configured calendar (falls back to default/primary). */
function getCalendar_() {
  try {
    if (!CONFIG.CALENDAR_ID || CONFIG.CALENDAR_ID === 'primary') {
      return CalendarApp.getDefaultCalendar();
    }
    return CalendarApp.getCalendarById(CONFIG.CALENDAR_ID) || CalendarApp.getDefaultCalendar();
  } catch (err) {
    console.warn('calendar lookup failed: ' + err);
    return null;
  }
}

/** Turn "HH:MM" on a given yyyy-MM-dd into a Date in the script's timezone. */
function slotDateTime_(dateStr, hhmm) {
  const tz = Session.getScriptTimeZone();
  // Build in local time via the calendar-friendly parser
  const parts = String(hhmm || '00:00').split(':');
  const d = new Date(dateStr + 'T00:00:00');
  d.setHours(parseInt(parts[0], 10) || 0, parseInt(parts[1], 10) || 0, 0, 0);
  return d;
}

/** Look at real calendar events between from..to and block overlapping slots. */
function applyCalendarBlocks_(from, to, add) {
  const cal = getCalendar_();
  if (!cal) return;

  const ignore = (CONFIG.CALENDAR_IGNORE_TITLES_WITH || []).map(s => String(s).toLowerCase());
  const rangeStart = new Date(from + 'T00:00:00');
  const rangeEnd   = new Date(to   + 'T23:59:59');

  let events;
  try {
    events = cal.getEvents(rangeStart, rangeEnd);
  } catch (err) {
    console.warn('getEvents failed: ' + err);
    return;
  }

  events.forEach(ev => {
    const title = (ev.getTitle() || '').toLowerCase();
    if (ignore.length && ignore.some(w => w && title.indexOf(w) !== -1)) return;

    // Don't let our OWN booking events double-count (they already come from the sheet)
    if (title.indexOf(String(CONFIG.CALENDAR_EVENT_PREFIX || '📸 shoot').toLowerCase()) !== -1) return;

    const day = Utilities.formatDate(ev.getStartTime(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

    if (ev.isAllDayEvent()) {
      // all-day event blocks every slot that day (can span multiple days)
      let d = new Date(ev.getAllDayStartDate());
      const end = ev.getAllDayEndDate ? new Date(ev.getAllDayEndDate()) : new Date(d.getTime() + 86400000);
      while (d < end) {
        const ds = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        CONFIG.SLOTS.forEach(s => add(ds, s.id));
        d = new Date(d.getTime() + 86400000);
      }
      return;
    }

    // timed event: block any slot whose window overlaps the event
    const evStart = ev.getStartTime().getTime();
    const evEnd   = ev.getEndTime().getTime();
    CONFIG.SLOTS.forEach(s => {
      const sStart = slotDateTime_(day, s.start || '00:00').getTime();
      const sEnd   = slotDateTime_(day, s.end   || '23:59').getTime();
      if (evStart < sEnd && evEnd > sStart) add(day, s.id); // overlap
    });
  });
}

// ================= GOOGLE CALENDAR: WRITE ================
/** Create (or update) a calendar event for a booking row. Returns event id. */
function upsertCalendarEvent_(rowObj) {
  if (!CONFIG.CALENDAR_CREATE_EVENTS) return '';
  const cal = getCalendar_();
  if (!cal) return '';

  const slot = CONFIG.SLOTS.find(s => s.id === rowObj.Slot);
  if (!slot) return '';

  const start = slotDateTime_(rowObj.Date, slot.start || '09:00');
  const end   = slotDateTime_(rowObj.Date, slot.end   || '10:00');
  const title = `${CONFIG.CALENDAR_EVENT_PREFIX} — ${rowObj.Type || 'Session'} · ${rowObj.Name}`;
  const desc  =
    `PI Frames booking ${rowObj.Ref}\n\n` +
    `Client:   ${rowObj.Name}\n` +
    `Email:    ${rowObj.Email}\n` +
    `Phone:    ${rowObj.Phone || '—'}\n` +
    `Type:     ${rowObj.Type || '—'}\n` +
    `Slot:     ${slot.label}\n` +
    `Location: ${rowObj.Location || '—'}\n\n` +
    `Notes:\n${rowObj.Message || '—'}`;

  const options = { description: desc };
  if (rowObj.Location) options.location = rowObj.Location;

  try {
    const ev = cal.createEvent(title, start, end, options);
    return ev.getId();
  } catch (err) {
    console.warn('createEvent failed: ' + err);
    return '';
  }
}

/** Remove a booking's calendar event if we have its id. */
function deleteCalendarEvent_(eventId) {
  if (!eventId) return;
  const cal = getCalendar_();
  if (!cal) return;
  try {
    const ev = cal.getEventById(eventId);
    if (ev) ev.deleteEvent();
  } catch (err) {
    console.warn('deleteEvent failed: ' + err);
  }
}

/**
 * Runs automatically whenever you edit the sheet. Watches the Status column:
 *   → set to "confirmed"  : creates the calendar event (if not already there)
 *   → set to "declined"/"cancelled" : removes the calendar event
 * Requires the one-time installable trigger (run installTriggers once).
 */
function onStatusEdit(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (sh.getName() !== SHEET_BOOKINGS) return;

    const rows = sh.getDataRange().getValues();
    const idx = headerIndex_(rows[0]);
    const statusCol = idx.Status + 1;         // 1-based
    if (e.range.getColumn() !== statusCol) return;

    const r = e.range.getRow();
    if (r === 1) return;                      // header
    const row = rows[r - 1];
    const rowObj = rowToObj_(row, idx);
    const status = String(rowObj.Status || '').toLowerCase();

    // Ensure there's a place to remember the event id (extra column at the end)
    const eventIdCol = ensureEventIdColumn_(sh, rows[0]);
    const existingId = sh.getRange(r, eventIdCol).getValue();

    if (status === 'confirmed') {
      if (!existingId) {
        const id = upsertCalendarEvent_(rowObj);
        if (id) sh.getRange(r, eventIdCol).setValue(id);
      }
    } else if (status === 'declined' || status === 'cancelled') {
      if (existingId) {
        deleteCalendarEvent_(existingId);
        sh.getRange(r, eventIdCol).setValue('');
      }
    }
  } catch (err) {
    console.warn('onStatusEdit failed: ' + err);
  }
}

/** Make sure a "CalEventId" column exists; return its 1-based index. */
function ensureEventIdColumn_(sh, headerRow) {
  let col = headerRow.indexOf('CalEventId');
  if (col === -1) {
    col = headerRow.length;                   // append at end
    sh.getRange(1, col + 1).setValue('CalEventId');
  }
  return col + 1;
}

function rowToObj_(row, idx) {
  const o = {};
  HEADERS.forEach(h => { o[h] = row[idx[h]]; });
  o.Date = normDate_(o.Date);
  return o;
}

/** Email Chase about a new request. */
function notify_(d, date, slotLabel, ref) {
  try {
    const subject = `New booking request — ${d.type || 'session'} on ${date} (${ref})`;
    const body =
      `New request via piframes.co.za\n\n` +
      `Ref:       ${ref}\n` +
      `Date:      ${date}\n` +
      `Slot:      ${slotLabel}\n` +
      `Type:      ${d.type || '—'}\n` +
      `Name:      ${d.name}\n` +
      `Email:     ${d.email}\n` +
      `Phone:     ${d.phone || '—'}\n` +
      `Location:  ${d.location || '—'}\n\n` +
      `Message:\n${d.message || '—'}\n\n` +
      `——\nOpen the Bookings sheet to confirm or decline. ` +
      `The slot is held until you set the Status.`;
    MailApp.sendEmail(CONFIG.NOTIFY_EMAIL, subject, body, { replyTo: d.email });
  } catch (err) {
    // never fail the booking just because the email hiccuped
    console.warn('notify failed: ' + err);
  }
}

// ---------------- sheet helpers ----------------
function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (name === SHEET_BOOKINGS) sh.appendRow(HEADERS);
    if (name === SHEET_BLOCKED)  sh.appendRow(['Date (YYYY-MM-DD)', 'Slot id or ALL', 'Note']);
  }
  if (name === SHEET_BOOKINGS && sh.getLastRow() === 0) sh.appendRow(HEADERS);
  return sh;
}

function headerIndex_(headerRow) {
  const map = {};
  HEADERS.forEach(h => { map[h] = headerRow.indexOf(h); });
  // fall back to fixed positions if headers were renamed
  HEADERS.forEach((h, i) => { if (map[h] < 0) map[h] = i; });
  return map;
}

function normDate_(v) {
  if (!v) return '';
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor to create the sheets + headers. */
function setup() {
  getSheet_(SHEET_BOOKINGS);
  getSheet_(SHEET_BLOCKED);
  installTriggers();   // also wire up the Status → Calendar automation
  SpreadsheetApp.getActiveSpreadsheet().toast('Sheets + calendar trigger ready. Now Deploy → Web app.');
}

/**
 * Run ONCE to enable the calendar automation (creating an event when you set a
 * booking to "confirmed"). This installs an on-edit trigger — needed because
 * the calendar service can't be called from a plain onEdit(e). Safe to run
 * again; it won't create duplicates.
 */
function installTriggers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const existing = ScriptApp.getProjectTriggers();
  const already = existing.some(t => t.getHandlerFunction() === 'onStatusEdit');
  if (!already) {
    ScriptApp.newTrigger('onStatusEdit')
      .forSpreadsheet(ss)
      .onEdit()
      .create();
  }
}
