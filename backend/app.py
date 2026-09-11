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
from flask import Flask, jsonify, request, send_from_directory
from pathlib import Path
import data

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="")


# ---------- Frontend ----------
@app.get("/health")
def health():
    return jsonify({"status": "ok"})


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
