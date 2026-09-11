"""
IISc Histopathology Facility — Booking API
Run with:  python app.py
Serves a JSON REST API on http://localhost:5000/api/*
and also serves the static frontend (../static) at http://localhost:5000/

Endpoints
---------
GET    /api/instruments                  -> list of instruments (each includes its SOP filename)
GET    /api/sop-documents                 -> list of the 7 instrument SOPs (title, sop_no, file)
GET    /api/user-form                     -> the single, common facility User Form (title, file)
GET    /api/contacts                      -> facility contacts (role, name, phone, email)
GET    /api/specimen-types                -> list of specimen type options
GET    /api/week                          -> the 7 dates of the current booking week
GET    /api/availability/<instrument_id>  -> {date: {slot: "available"|"booked"}}
GET    /api/booking-window                -> {"open": bool, "message": str}
GET    /api/bookings?email=<email>        -> list bookings (optionally filtered by email)
POST   /api/bookings                      -> create a booking
        body: {user, pi_name, phone, email, institution, specimen_type,
                instrument_id, date, slot, form_filename}
DELETE /api/bookings/<booking_id>         -> cancel a booking
"""
from flask import Flask, jsonify, request, send_from_directory, session
from pathlib import Path
import hmac
import os
from functools import wraps

import requests
import data

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="")
app.secret_key = os.environ.get("SECRET_KEY", "local-development-secret")


def _supabase_request(method, path, **kwargs):
    supabase_url = os.environ.get("SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_role_key:
        raise RuntimeError("Supabase admin credentials are not configured on the server.")
    headers = {
        "apikey": service_role_key,
        "Authorization": f"Bearer {service_role_key}",
        **kwargs.pop("headers", {}),
    }
    response = requests.request(
        method,
        f"{supabase_url.rstrip('/')}/rest/v1/{path}",
        headers=headers,
        timeout=15,
        **kwargs,
    )
    response.raise_for_status()
    return response


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("admin_authenticated"):
            return jsonify({"error": "Admin authentication required."}), 401
        return view(*args, **kwargs)
    return wrapped


# ---------- Frontend ----------
@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.post("/api/admin-auth")
def admin_auth():
    configured_password = os.environ.get("ADMIN_PASSWORD")
    if not configured_password:
        return jsonify({"error": "Admin password is not configured on the server."}), 503

    payload = request.get_json(silent=True) or {}
    supplied_password = payload.get("password", "")
    if not isinstance(supplied_password, str) or not hmac.compare_digest(
        supplied_password, configured_password
    ):
        return jsonify({"error": "Incorrect password."}), 401
    session["admin_authenticated"] = True
    return jsonify({"authenticated": True})


@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


# ---------- API ----------
@app.get("/api/instruments")
def instruments():
    return jsonify(data.get_instruments())


@app.get("/api/sop-documents")
def sop_documents():
    return jsonify(data.get_sop_documents())


@app.get("/api/user-form")
def user_form():
    return jsonify(data.get_user_form())


@app.get("/api/contacts")
def contacts():
    return jsonify(data.get_contacts())


@app.get("/api/specimen-types")
def specimen_types():
    return jsonify(data.get_specimen_types())


@app.get("/api/week")
def week():
    return jsonify(data.get_week_days())


@app.get("/api/availability/<instrument_id>")
def availability(instrument_id):
    return jsonify(data.get_availability(instrument_id))


@app.get("/api/booking-window")
def booking_window():
    open_now = data.is_booking_window_open()
    msg = ("Booking window is open — book any available slot until "
           "Sunday 11:00 AM." if open_now else
           "Booking window is closed. Opens Friday 12:00 PM, closes "
           "Sunday 11:00 AM, for the upcoming week.")
    return jsonify({"open": open_now, "message": msg})


@app.get("/api/bookings")
def bookings():
    email = request.args.get("email")
    return jsonify(data.list_bookings(email))


@app.get("/api/admin/bookings")
@admin_required
def admin_bookings():
    try:
        response = _supabase_request(
            "GET",
            "bookings?select=*&order=date.asc,slot.asc",
        )
    except (requests.RequestException, RuntimeError) as error:
        return jsonify({"error": f"Could not load Supabase bookings: {error}"}), 502

    return jsonify([
        {
            **booking,
            "user": booking["user_name"],
        }
        for booking in response.json()
    ])


@app.patch("/api/admin/bookings/<booking_id>")
@admin_required
def admin_update_booking(booking_id):
    payload = request.get_json(silent=True) or {}
    update = {
        "user_name": payload.get("user", "").strip(),
        "pi_name": payload.get("pi_name", "").strip(),
        "phone": payload.get("phone", "").strip(),
        "email": payload.get("email", "").strip(),
        "institution": payload.get("institution", "").strip(),
        "specimen_type": payload.get("specimen_type", "").strip(),
        "instrument_id": payload.get("instrument_id", "").strip(),
        "date": payload.get("date", "").strip(),
        "slot": payload.get("slot", "").strip(),
        "form_filename": payload.get("form_filename", "").strip(),
    }
    if any(not value for value in update.values()):
        return jsonify({"error": "All booking fields are required."}), 400
    try:
        response = _supabase_request(
            "PATCH",
            f"bookings?booking_id=eq.{booking_id}",
            json=update,
            headers={"Prefer": "return=representation"},
        )
    except (requests.RequestException, RuntimeError) as error:
        return jsonify({"error": f"Could not update Supabase booking: {error}"}), 502
    if not response.json():
        return jsonify({"error": "Booking not found."}), 404
    return jsonify(response.json()[0])


@app.delete("/api/admin/bookings/<booking_id>")
@admin_required
def admin_delete_booking(booking_id):
    try:
        response = _supabase_request(
            "DELETE",
            f"bookings?booking_id=eq.{booking_id}",
            headers={"Prefer": "return=representation"},
        )
    except (requests.RequestException, RuntimeError) as error:
        return jsonify({"error": f"Could not delete Supabase booking: {error}"}), 502
    if not response.json():
        return jsonify({"error": "Booking not found."}), 404
    return jsonify({"cancelled": booking_id})


@app.post("/api/bookings")
def make_booking():
    payload = request.get_json(force=True, silent=True) or {}
    record, error = data.create_booking(payload)
    if error:
        return jsonify({"error": error}), 409
    return jsonify(record), 201


@app.delete("/api/bookings/<booking_id>")
def remove_booking(booking_id):
    ok = data.cancel_booking(booking_id)
    if not ok:
        return jsonify({"error": "Booking not found"}), 404
    return jsonify({"cancelled": booking_id})


if __name__ == "__main__":
    app.run(debug=False, port=5000)
