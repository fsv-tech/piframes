# PI Frames — Booking system setup (about 10 minutes, one time)

Your website has a live booking calendar. Guests pick an open date and time, and
their request lands in a Google Sheet you control. Until you do the steps below,
the calendar still works but shows *every* future day as open and sends requests
to WhatsApp/email instead of recording them.

You need: a Google account (the one for `chase.solomon@gmail.com` is perfect).

---

## Step 1 — Make the booking spreadsheet
1. Go to **https://sheets.google.com** and create a **Blank spreadsheet**.
2. Name it something like **"PI Frames Bookings"**.

## Step 2 — Add the script
1. In that spreadsheet's menu: **Extensions → Apps Script**.
2. Delete whatever code is in the editor.
3. Open the file **`booking-backend/Code.gs`** from your website folder, copy
   *everything*, and paste it into the Apps Script editor.
4. Click the **💾 Save** icon.

## Step 3 — Create the sheet tabs
1. In the Apps Script editor, in the function dropdown at the top, choose **`setup`**.
2. Click **▶ Run**.
3. The first time, Google asks you to allow permissions:
   - Click **Review permissions** → choose your Google account.
   - You'll see "Google hasn't verified this app" — click **Advanced → Go to
     (your project name)** → **Allow**. (This is normal; it's *your* script.)
4. Switch back to the spreadsheet — you'll now see two tabs: **Bookings** and
   **Blocked**.

## Step 4 — Publish it as a web app
1. In Apps Script, click **Deploy → New deployment**.
2. Click the ⚙️ gear next to "Select type" → **Web app**.
3. Set:
   - **Description:** anything (e.g. "PI Frames booking API")
   - **Execute as:** **Me**
   - **Who has access:** **Anyone**   ← important, so the website can reach it
4. Click **Deploy**, approve permissions again if asked.
5. Copy the **Web app URL** it gives you (ends in `/exec`).

## Step 5 — Connect the website
1. Open **`build.py`** in your website folder.
2. Near the top find this line:
   ```
   BOOKING_API_URL = ""
   ```
   Paste your URL between the quotes, e.g.:
   ```
   BOOKING_API_URL = "https://script.google.com/macros/s/AKfy..../exec"
   ```
3. Re-run the build (`python3 build.py`) **or**, if you can't run Python, open
   **`bookings.html`** directly, find `apiUrl: ""` near the bottom and paste the
   URL there instead: `apiUrl: "https://script.google.com/macros/s/.../exec"`.
4. Re-upload `bookings.html` (and `js/booking.js`) to your site.

Done — the calendar is now live and reads/writes your spreadsheet.

---

## Optional — Link it to your Google Calendar

Your booking script can talk to your real Google Calendar directly — no extra
accounts, API keys or fees, because the script already runs under your Google
account. It works two ways and you can use either or both (switches live in the
**CALENDAR** part of the `CONFIG` block at the top of `Code.gs`):

**A) New bookings appear on your calendar** (`CALENDAR_CREATE_EVENTS: true`)
- When a booking is **confirmed**, an event is added to your calendar with the
  client's name, type, location and notes, timed to the slot they chose.
- By default this happens only when you set a row's **Status** to `confirmed`
  (`CALENDAR_ONLY_WHEN_CONFIRMED: true`). Set that to `false` if you'd rather an
  event appear the moment a request arrives (it's removed again if you decline).
- Setting a booking to `declined` or `cancelled` deletes its calendar event.

**B) Your calendar blocks out website slots** (`CALENDAR_BLOCKS_AVAILABILITY: true`)
- Any event already on your calendar makes the overlapping slot show as taken
  online — so a wedding already in your calendar automatically closes that day,
  without you also adding it to the **Blocked** tab.
- All-day events block the whole day; timed events block only the slots they
  overlap. Events whose title contains `tentative`, `free` or `available` are
  ignored (change this list in `CALENDAR_IGNORE_TITLES_WITH`).

### Turning it on (one time)
1. In `Code.gs`, look at the **CALENDAR** settings in `CONFIG`:
   - Leave `CALENDAR_ID: 'primary'` to use your main calendar, **or** paste a
     specific calendar's ID (Google Calendar → that calendar → *Settings* →
     *Integrate calendar* → **Calendar ID**).
   - The `true/false` switches above are already set to sensible defaults.
   - Each slot in `SLOTS` now has a `start`/`end` time — adjust if your real
     session times differ (these set how long the calendar event lasts).
2. In the Apps Script editor, run the **`installTriggers`** function once
   (function dropdown → `installTriggers` → ▶ Run). Approve the new permission
   request — this is Google asking to let *your* script manage *your* calendar.
   (If you already ran `setup` after adding this, it's done — `setup` calls it.)
3. **Re-deploy** so the running web app picks up the changes:
   **Deploy → Manage deployments → ✏️ edit → Version: New version → Deploy.**

That's it. Test it: put an event on your calendar for a day/time, open your
booking page, and that slot should show as unavailable. Then confirm a test
booking in the sheet and watch the event appear on your calendar.

> A new **CalEventId** column will appear on the Bookings tab — that's just where
> the script remembers which calendar event belongs to which booking so it can
> update or remove it later. You can ignore it.

---

## Using it day to day (all from your phone)

Install the **Google Sheets** app and open "PI Frames Bookings".

**When a request comes in**
- You get an email, and a new row appears on the **Bookings** tab with
  **Status = pending**. The slot is automatically held so no one else can take it.
- To confirm: change that row's **Status** cell to **`confirmed`**.
- To turn it down: change **Status** to **`declined`** (this frees the slot again).
- `cancelled` also frees the slot.

**Blocking your own dates** (holidays, personal days, already-booked-elsewhere)
- Go to the **Blocked** tab.
- To block a whole day: put the date in column A (format `2026-08-14`) and write
  `ALL` in column B.
- To block just one time on a day: put the date in A and the slot id in B — the
  slot ids are `morning`, `midday`, `afternoon`, `goldenhr`.
- Those dates/slots immediately show as unavailable on the website.

**Changing your time slots or working days**
- In Apps Script, edit the **CONFIG** block at the top of `Code.gs`:
  - `SLOTS` — the times you offer (change labels or add/remove).
  - `CLOSED_WEEKDAYS` — e.g. `[0]` to close Sundays (0=Sun … 6=Sat).
  - `PENDING_HOLD_HOURS` — how long an unconfirmed request holds a slot (default 72h).
- After editing, **Deploy → Manage deployments → ✏️ edit → Version: New version → Deploy**.
- If you change the slot labels/ids, also update the matching `FALLBACK_SLOTS`
  list near the top of `js/booking.js` so the offline fallback stays in sync.

---

## Good to know
- **Free.** Google Apps Script and Sheets cost nothing at this volume.
- **Double-bookings are prevented.** If two people try the same slot at once, only
  the first goes through; the second sees "that slot was just taken."
- **If the server is ever unreachable**, the form automatically falls back to
  opening WhatsApp with the request pre-filled, so you never lose an enquiry.
- **Privacy:** requests live only in your private Google Sheet. Nobody browsing the
  site can see who else has booked — they only see which *slots* are taken.
- The email address for notifications is set in `Code.gs` (`NOTIFY_EMAIL`) — already
  `chase.solomon@gmail.com`.
