"""
In-memory data store for the IISc Histopathology Facility booking system.
Swap this module for a real database (SQLite/Postgres) in production —
the API layer in app.py only talks to the functions defined here.
"""
from datetime import date, timedelta
import itertools

_id_counter = itertools.count(1000)

INSTRUMENTS = [
    {"id": "leica-tissue-processor", "name": "Leica Tissue Processor",
     "tagline": "Automated tissue processing", "icon": "processor",
     "sop": "sop-tissue-processing-unit.pdf"},
    {"id": "leica-embedding", "name": "Leica Tissue Embedding Station",
     "tagline": "Paraffin embedding", "icon": "embedding",
     "sop": "sop-tissue-embedding-station.pdf"},
    {"id": "leica-microtome", "name": "Leica Microtome",
     "tagline": "Rotary microtome", "icon": "microtome",
     "sop": "sop-microtome.pdf"},
    {"id": "medimeas-microtome", "name": "Medimeas Microtome",
     "tagline": "Rotary microtome", "icon": "microtome",
     "sop": "sop-microtome.pdf"},
    {"id": "medimeas-cryostat", "name": "Medimeas Cryostat",
     "tagline": "Cryosectioning", "icon": "cryostat",
     "sop": "sop-cryostat.pdf"},
    {"id": "leica-vibratome", "name": "Leica Vibratome",
     "tagline": "Vibratome sectioning", "icon": "vibratome",
     "sop": "sop-vibratome.pdf"},
    {"id": "zeiss-slide-scanner", "name": "Zeiss Slide Scanner",
     "tagline": "Digital slide scanning", "icon": "scanner",
     "sop": "sop-slide-scanner.pdf"},
    {"id": "vision-embedding", "name": "Vision Embedding Station",
     "tagline": "Embedding station", "icon": "embedding",
     "sop": "sop-tissue-embedding-station.pdf"},
    {"id": "vision-processing", "name": "Vision Tissue Processing Unit",
     "tagline": "Tissue processing", "icon": "processor",
     "sop": "sop-tissue-processing-unit.pdf"},
    {"id": "vision-stainer", "name": "Vision Slide Stainer",
     "tagline": "Automated slide staining", "icon": "stainer",
     "sop": "sop-slide-stainer.pdf"},
]

# Protocol Documents list — the 7 SOPs, one per instrument type, shown in the
# Guidelines / Forms & Downloads area regardless of which specific unit a
# lab owns (e.g. both microtomes share the microtome SOP).
SOP_DOCUMENTS = [
    {"title": "Tissue Processing Unit", "file": "sop-tissue-processing-unit.pdf",
     "sop_no": "LAB-HISTO-01"},
    {"title": "Tissue Embedding Station", "file": "sop-tissue-embedding-station.pdf",
     "sop_no": "LAB-HISTO-02"},
    {"title": "Microtome", "file": "sop-microtome.pdf", "sop_no": "LAB-HISTO-03"},
    {"title": "Cryostat", "file": "sop-cryostat.pdf", "sop_no": "LAB-HISTO-04"},
    {"title": "Vibratome", "file": "sop-vibratome.pdf", "sop_no": "LAB-HISTO-05"},
    {"title": "Slide Scanner", "file": "sop-slide-scanner.pdf", "sop_no": "LAB-HISTO-06"},
    {"title": "Slide Stainer", "file": "sop-slide-stainer.pdf", "sop_no": "LAB-HISTO-07"},
]

# The single, common User Form (facility-use / booking form) attached below
# the slot-selection table — one file, used for every instrument.
USER_FORM = {"title": "Facility User Form", "file": "user-form.pdf"}

# Facility contacts shown in "Contact Support".
CONTACTS = [
    {"role": "TA Incharge", "name": "Keerthana H S", "phone": "7975911869",
     "email": "keerthana@iisc.ac.in"},
    {"role": "Faculty Incharge", "name": "Prof. Srimonta Gayen", "phone": "08022933677",
     "email": "srimonta@iisc.ac.in"},
]

SPECIMEN_TYPES = [
    "Formalin-fixed paraffin-embedded (FFPE)",
    "Fresh-frozen tissue",
    "Resin-embedded block",
    "Cell pellet / smear",
    "Other (specify in notes)",
]

TIME_SLOTS = ["09:00 - 11:00", "11:00 - 13:00", "14:00 - 16:00", "16:00 - 18:00"]

WEEK_START = date(2025, 6, 23)  # Monday of the sample week shown in the template
WEEK_DAYS = [WEEK_START + timedelta(days=i) for i in range(7)]  # Mon..Sun

# Bookings are independent per instrument: each instrument has its own
# calendar, so booking Instrument A for a date+slot has no effect on
# Instrument B's availability for that same date+slot.
_BOOKINGS = {}  # booking_id -> record


def _key(instrument_id, iso_date, slot):
    return f"{instrument_id}|{iso_date}|{slot}"


_SLOT_INDEX = {}  # _key(...) -> booking_id, for fast availability lookups


def _create(instrument_id, iso_date, slot, user, pi_name, phone, email, institution,
            specimen_type, form_filename):
    bid = next(_id_counter)
    record = {
        "booking_id": f"HP-{bid}",
        "instrument_id": instrument_id,
        "date": iso_date,
        "slot": slot,
        "user": user,
        "pi_name": pi_name,
        "phone": phone,
        "email": email,
        "institution": institution,
        "specimen_type": specimen_type,
        "form_filename": form_filename,
        "status": "booked",
    }
    _BOOKINGS[record["booking_id"]] = record
    _SLOT_INDEX[_key(instrument_id, iso_date, slot)] = record["booking_id"]
    return record


def seed():
    fri = WEEK_DAYS[4].isoformat()
    sat = WEEK_DAYS[5].isoformat()
    mon = WEEK_DAYS[0].isoformat()
    seed_data = [
        ("leica-tissue-processor", fri, "14:00 - 16:00", "M. Rao", "S. Chandrasekhar"),
        ("zeiss-slide-scanner", sat, "09:00 - 11:00", "P. Iyer", "N. Bhattacharya"),
        ("medimeas-cryostat", mon, "16:00 - 18:00", "S. Kulkarni", "A. Mukherjee"),
    ]
    for inst, iso_date, slot, user, pi in seed_data:
        _create(inst, iso_date, slot, user, pi, "9000000000",
                f"{user.replace(' ', '.').lower()}@iisc.ac.in",
                "Dept. of Biological Sciences", SPECIMEN_TYPES[0], "signed_user_form.pdf")


seed()


def get_instruments():
    return INSTRUMENTS


def get_sop_documents():
    return SOP_DOCUMENTS


def get_user_form():
    return USER_FORM


def get_contacts():
    return CONTACTS


def get_specimen_types():
    return SPECIMEN_TYPES


def get_week_days():
    return [d.isoformat() for d in WEEK_DAYS]


def get_availability(instrument_id):
    """Return {date_iso: {slot: status}} for ONE instrument's own calendar."""
    grid = {}
    for d in WEEK_DAYS:
        iso = d.isoformat()
        grid[iso] = {}
        for slot in TIME_SLOTS:
            grid[iso][slot] = "booked" if _key(instrument_id, iso, slot) in _SLOT_INDEX else "available"
    return grid


def is_booking_window_open(now=None):
    """Booking window: Friday 12:00 PM through Sunday 11:59 AM."""
    now = now or __import__("datetime").datetime.now()
    weekday = now.weekday()  # Mon=0 ... Sun=6
    if weekday == 4:  # Friday
        return now.hour >= 12
    if weekday == 5:  # Saturday
        return True
    if weekday == 6:  # Sunday
        return now.hour < 12
    return False


REQUIRED_FIELDS = ["user", "pi_name", "phone", "email", "specimen_type",
                    "instrument_id", "date", "slot", "form_filename"]


def create_booking(payload):
    missing = [f for f in REQUIRED_FIELDS if not payload.get(f)]
    if missing:
        return None, f"Missing required field(s): {', '.join(missing)}"

    instrument_id = payload["instrument_id"]
    iso_date = payload["date"]
    slot = payload["slot"]

    if instrument_id not in {i["id"] for i in INSTRUMENTS}:
        return None, "Unknown instrument."
    if iso_date not in {d.isoformat() for d in WEEK_DAYS}:
        return None, "Date is outside the current booking week."
    if slot not in TIME_SLOTS:
        return None, "Unknown time slot."
    if _key(instrument_id, iso_date, slot) in _SLOT_INDEX:
        return None, "That time slot for this instrument was just booked by someone else."

    record = _create(
        instrument_id, iso_date, slot,
        payload["user"], payload["pi_name"], payload["phone"], payload["email"],
        payload.get("institution", ""), payload["specimen_type"], payload["form_filename"],
    )
    return record, None


def list_bookings(email=None):
    vals = list(_BOOKINGS.values())
    if email:
        vals = [b for b in vals if b["email"].lower() == email.lower()]
    return sorted(vals, key=lambda b: (b["date"], b["slot"]))


def cancel_booking(booking_id):
    record = _BOOKINGS.pop(booking_id, None)
    if not record:
        return False
    _SLOT_INDEX.pop(_key(record["instrument_id"], record["date"], record["slot"]), None)
    return True
