# Histopathology Facility — Instrument Booking System

A booking dashboard for a histopathology core facility (tissue processing,
sectioning, staining, imaging), built to match the provided IISc template.

## Structure

```
histopath-booking/
├── backend/              Optional legacy Python (Flask) demo API
├── supabase/
│   └── schema.sql        Supabase tables, seed metadata, RLS and RPCs
└── static/               Plain HTML / CSS / JS frontend (framework-free)
    ├── index.html
    ├── css/style.css
    ├── js/app.js         Supabase browser client and booking UI
    └── docs/             Instrument SOP and facility-form PDFs
```

The static folder has no build step and talks directly to Supabase. The Flask
backend is retained for the original local/demo API, but is not used by
`static/index.html`.

## Supabase setup and deployment

1. Open the Supabase project and run [`supabase/schema.sql`](supabase/schema.sql)
   in the SQL editor (or apply it with the Supabase CLI).
2. Under **Authentication → Providers**, enable **Anonymous Sign-Ins**.
   Visitors are signed in anonymously before metadata or booking access; the
   UI reports a clear error if anonymous auth is unavailable.
3. Deploy `static/` to GitHub Pages, S3, Nginx, or another static host.
   `static/index.html` loads `@supabase/supabase-js@2` from jsDelivr and
   contains the supplied project URL and publishable key.
4. Add the deployed URL under **Authentication → URL Configuration** if
   required by the project.

Only the publishable/anonymous key belongs in browser code. Never use a
Supabase service-role key in `index.html` or `app.js`. RLS lets an anonymous
user read only their own bookings and cancel only their own future booking.
Availability and aggregate statistics use security-definer RPCs that expose
only slot status/counts, not other users' booking records. The unique
instrument/date/slot constraint and booking-window trigger enforce these rules
server-side; the client-side booking-window check is only an early UX check.
Realtime booking events refresh availability, statistics, and the user's list.

The static frontend can still be previewed through Flask:

```bash
cd backend
pip install -r requirements.txt
python app.py
```

Then open **http://localhost:5000**. The page still uses Supabase, so the
project must be configured as above even when Flask serves the files.

## Render deployment

This repository includes [`render.yaml`](render.yaml) for a Render Web Service.
Create a new Blueprint from the GitHub repository, or create a Python Web
Service manually with these settings:

| Setting | Value |
|---|---|
| Root Directory | `backend` |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `gunicorn app:app --bind 0.0.0.0:$PORT` |
| Health Check Path | `/health` |

After deployment, open the Render URL and verify `/health` returns
`{"status":"ok"}`. The frontend still requires the Supabase project and
anonymous sign-ins described above. The legacy Flask booking store is
in-memory, so use the Supabase deployment path for persistent production
bookings.

The administrator login is available at `/adminportal.html` and from the
**Admin Login** link in the main page header. Set these Render environment
variables before using it:

| Variable | Purpose |
|---|---|
| `ADMIN_PASSWORD` | Password required by the admin login form |
| `SECRET_KEY` | Random value used to protect Flask sessions |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key, stored only in Render |

The service-role key must never be placed in `static/` or exposed to the
browser. The admin portal uses it only through the protected Flask endpoints
under `/api/admin/bookings`, which read and modify the real Supabase
`public.bookings` table.

## Booking behavior

The database computes the upcoming Monday-Sunday booking week using
Asia/Kolkata time. Booking is open Friday 12:00 PM through Sunday 11:59 AM.
The UI shows Monday-Saturday, while the database trigger validates the week,
window, authenticated anonymous owner, valid instrument/specimen, and unique
slot. CRUD operations are performed through the Supabase browser client.

The seven SOP PDFs and the common facility user form remain static assets under
`static/docs/`; their metadata is seeded by the migration.

## Notes

- `backend/data.py` is an in-memory legacy/demo API and is not part of the
  Supabase production deployment path.
- For a quick design-only preview without Python or Supabase, see
  `histopath-facility-preview.html` if present in your checkout.
