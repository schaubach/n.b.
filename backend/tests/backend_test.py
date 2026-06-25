"""SwipeNoten backend regression tests.

Covers: idoceo import (and idempotent merge), classes CRUD,
grade-system switch, sessions, grades upsert/delete, CSV export.
"""
import os
import re
import pytest
import requests
from datetime import datetime

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else None
if not BASE_URL:
    # local fallback when run inside the container
    BASE_URL = "http://localhost:8001"

API = f"{BASE_URL}/api"
SAMPLE = "/app/tests/sample.idoceo"


@pytest.fixture(scope="session")
def s():
    return requests.Session()


@pytest.fixture(scope="session")
def imported_class(s):
    """Import sample once and return class info (first import outcome)."""
    with open(SAMPLE, "rb") as f:
        r = s.post(f"{API}/import/idoceo",
                   files={"file": ("sample.idoceo", f, "application/octet-stream")},
                   data={"password": "test"})
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Health ----------
def test_root(s):
    r = s.get(f"{API}/")
    assert r.status_code == 200
    assert r.json().get("status") == "ok"


def test_grade_systems(s):
    r = s.get(f"{API}/grade-systems")
    assert r.status_code == 200
    js = r.json()
    assert "grades_1_6" in js and "points_0_15" in js
    assert len(js["grades_1_6"]) == 16 and len(js["points_0_15"]) == 16


# ---------- Import ----------
def test_import_creates_or_updates_medu2(imported_class):
    js = imported_class
    assert js["class_name"] == "Medu2"
    assert js["total_students"] == 21
    # new_class can be False if class already exists (prior manual tests). Accept both.
    assert isinstance(js["new_class"], bool)
    assert "class_id" in js


def test_import_idempotent(s, imported_class):
    """Re-import same file -> 0 added, 21 updated, new_class False."""
    with open(SAMPLE, "rb") as f:
        r = s.post(f"{API}/import/idoceo",
                   files={"file": ("sample.idoceo", f, "application/octet-stream")},
                   data={"password": "test"})
    assert r.status_code == 200
    js = r.json()
    assert js["new_class"] is False
    assert js["added_students"] == 0
    assert js["updated_students"] == 21
    assert js["total_students"] == 21
    assert js["class_id"] == imported_class["class_id"]


def test_import_wrong_password(s):
    with open(SAMPLE, "rb") as f:
        r = s.post(f"{API}/import/idoceo",
                   files={"file": ("sample.idoceo", f, "application/octet-stream")},
                   data={"password": "wrong"})
    assert r.status_code == 400


# ---------- Classes ----------
def test_list_classes_contains_medu2(s, imported_class):
    r = s.get(f"{API}/classes")
    assert r.status_code == 200
    classes = r.json()
    medu2 = next((c for c in classes if c["id"] == imported_class["class_id"]), None)
    assert medu2 is not None
    assert medu2["name"] == "Medu2"
    assert medu2["student_count"] == 21
    assert medu2["grade_system"] in ("grades_1_6", "points_0_15")


def test_get_class_students_have_one_photo(s, imported_class):
    cid = imported_class["class_id"]
    r = s.get(f"{API}/classes/{cid}")
    assert r.status_code == 200
    data = r.json()
    assert len(data["students"]) == 21
    with_photo = [st for st in data["students"] if st.get("photo")]
    assert len(with_photo) == 1
    assert with_photo[0]["photo"].startswith("data:image/")


def test_set_grade_system_valid(s, imported_class):
    cid = imported_class["class_id"]
    r = s.put(f"{API}/classes/{cid}/grade-system", json={"grade_system": "points_0_15"})
    assert r.status_code == 200
    assert r.json()["grade_system"] == "points_0_15"
    # verify persisted
    r2 = s.get(f"{API}/classes/{cid}")
    assert r2.json()["grade_system"] == "points_0_15"
    # switch back
    s.put(f"{API}/classes/{cid}/grade-system", json={"grade_system": "grades_1_6"})


def test_set_grade_system_invalid(s, imported_class):
    cid = imported_class["class_id"]
    r = s.put(f"{API}/classes/{cid}/grade-system", json={"grade_system": "bogus"})
    assert r.status_code == 400


# ---------- Sessions ----------
@pytest.fixture(scope="session")
def session_id(s, imported_class):
    r = s.post(f"{API}/sessions", json={"class_id": imported_class["class_id"]})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_create_session_format(s, imported_class):
    r = s.post(f"{API}/sessions", json={"class_id": imported_class["class_id"]})
    assert r.status_code == 200
    js = r.json()
    assert "id" in js
    assert re.match(r"\d{2}\.\d{2}\.\d{4}", js["date"])
    assert "Bewertung" in js["title"]


def test_get_session(s, session_id, imported_class):
    r = s.get(f"{API}/sessions/{session_id}")
    assert r.status_code == 200
    js = r.json()
    assert js["class_name"] == "Medu2"
    assert js["grade_system"] in ("grades_1_6", "points_0_15")
    assert len(js["students"]) == 21
    orders = [st["order"] for st in js["students"]]
    assert orders == sorted(orders)


# ---------- Grades ----------
def test_grade_upsert_and_persistence(s, session_id, imported_class):
    cid = imported_class["class_id"]
    cls = s.get(f"{API}/classes/{cid}").json()
    sid = cls["students"][0]["id"]

    # POST grade
    r1 = s.post(f"{API}/sessions/{session_id}/grades",
                json={"student_id": sid, "value": "2+"})
    assert r1.status_code == 200

    # Verify persisted
    sess = s.get(f"{API}/sessions/{session_id}").json()
    found = [st for st in sess["students"] if st["id"] == sid][0]
    assert found["grade"] == "2+"

    # Upsert (overwrite, should not create duplicate)
    r2 = s.post(f"{API}/sessions/{session_id}/grades",
                json={"student_id": sid, "value": "1"})
    assert r2.status_code == 200
    sess2 = s.get(f"{API}/sessions/{session_id}").json()
    graded = [st for st in sess2["students"] if st["id"] == sid]
    assert len(graded) == 1
    assert graded[0]["grade"] == "1"


def test_grade_delete(s, session_id, imported_class):
    cid = imported_class["class_id"]
    cls = s.get(f"{API}/classes/{cid}").json()
    sid = cls["students"][1]["id"]
    s.post(f"{API}/sessions/{session_id}/grades",
           json={"student_id": sid, "value": "3"})
    r = s.delete(f"{API}/sessions/{session_id}/grades/{sid}")
    assert r.status_code == 200
    sess = s.get(f"{API}/sessions/{session_id}").json()
    found = [st for st in sess["students"] if st["id"] == sid][0]
    assert found["grade"] is None


def _grade(s, session_id, student_id, value):
    r = s.post(f"{API}/sessions/{session_id}/grades",
               json={"student_id": student_id, "value": value})
    assert r.status_code == 200


# ---------- Single-session CSV export ----------
def test_csv_export_only_graded(s, session_id, imported_class):
    cid = imported_class["class_id"]
    cls = s.get(f"{API}/classes/{cid}").json()
    # grade first 3
    for i, st in enumerate(cls["students"][:3]):
        s.post(f"{API}/sessions/{session_id}/grades",
               json={"student_id": st["id"], "value": "2"})
    r = s.get(f"{API}/sessions/{session_id}/export.csv")
    assert r.status_code == 200
    assert "text/csv" in r.headers.get("Content-Type", "")
    assert "attachment" in r.headers.get("Content-Disposition", "")
    body = r.text.strip().splitlines()
    today = datetime.now().strftime("%d.%m.%Y")
    assert body[0] == f"Vorname,Nachname,{today}"
    # body rows count == number of grades present in this session
    sess = s.get(f"{API}/sessions/{session_id}").json()
    graded_count = sum(1 for st in sess["students"] if st["grade"])
    assert len(body) - 1 == graded_count


# ---------- Multi-session aggregate (iteration 2) ----------
# These tests delete all sessions of the class, so they must run AFTER
# any test that depends on the session_id fixture (session-scoped).
def test_zz_session_count_aggregate_and_delete(s, imported_class):
    """End-to-end: create 2 sessions, grade different students, verify
    aggregated CSV header + rows, then DELETE /classes/<id>/sessions and
    verify session_count returns to 0 and CSV has only header row."""
    cid = imported_class["class_id"]

    # Start from a clean slate for this class
    r0 = s.delete(f"{API}/classes/{cid}/sessions")
    assert r0.status_code == 200
    assert r0.json()["ok"] is True

    cls = s.get(f"{API}/classes/{cid}").json()
    assert cls["session_count"] == 0
    students = cls["students"]

    # Create 2 sessions
    s1 = s.post(f"{API}/sessions", json={"class_id": cid}).json()["id"]
    s2 = s.post(f"{API}/sessions", json={"class_id": cid}).json()["id"]

    # Round 1: grade student 0 and 1
    _grade(s, s1, students[0]["id"], "1+")
    _grade(s, s1, students[1]["id"], "2")
    # Round 2: grade student 1 and 2 (overlap on student 1)
    _grade(s, s2, students[1]["id"], "3-")
    _grade(s, s2, students[2]["id"], "4")

    # session_count should now be 2 in both list and detail endpoints
    lst = s.get(f"{API}/classes").json()
    medu2 = next(c for c in lst if c["id"] == cid)
    assert medu2["session_count"] == 2

    detail = s.get(f"{API}/classes/{cid}").json()
    assert detail["session_count"] == 2

    # Aggregate CSV
    r = s.get(f"{API}/classes/{cid}/export.csv")
    assert r.status_code == 200
    assert "text/csv" in r.headers.get("Content-Type", "")
    lines = r.text.strip().splitlines()
    today = datetime.now().strftime("%d.%m.%Y")
    # Header: Vorname,Nachname,<today>,<today #2>   (both sessions created same day)
    assert lines[0] == f"Vorname,Nachname,{today},{today} #2"
    # Exactly 3 students have at least one grade -> 3 data rows
    assert len(lines) - 1 == 3

    # Build map { (vorname, nachname) -> [col1, col2] }
    rows = [ln.split(",") for ln in lines[1:]]
    by_name = {(r_[0], r_[1]): r_[2:] for r_ in rows}
    s0 = (students[0]["first_name"], students[0]["last_name"])
    s1n = (students[1]["first_name"], students[1]["last_name"])
    s2n = (students[2]["first_name"], students[2]["last_name"])
    assert by_name[s0] == ["1+", ""]
    assert by_name[s1n] == ["2", "3-"]
    assert by_name[s2n] == ["", "4"]

    # DELETE all sessions of the class
    rd = s.delete(f"{API}/classes/{cid}/sessions")
    assert rd.status_code == 200
    body = rd.json()
    assert body["ok"] is True
    assert body["deleted_sessions"] == 2

    # session_count back to 0; students still present
    cls2 = s.get(f"{API}/classes/{cid}").json()
    assert cls2["session_count"] == 0
    assert len(cls2["students"]) == 21

    # Aggregated CSV now has only header row
    r2 = s.get(f"{API}/classes/{cid}/export.csv")
    assert r2.status_code == 200
    lines2 = r2.text.strip().splitlines()
    assert lines2 == ["Vorname,Nachname"]


def test_zz_delete_sessions_when_none(s, imported_class):
    """Calling delete-sessions on a class with no sessions returns 0 and ok."""
    cid = imported_class["class_id"]
    # ensure empty
    s.delete(f"{API}/classes/{cid}/sessions")
    r = s.delete(f"{API}/classes/{cid}/sessions")
    assert r.status_code == 200
    assert r.json()["deleted_sessions"] == 0

