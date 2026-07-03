import os
import io
import csv
from datetime import datetime, timezone
from typing import Optional, Annotated, List

from fastapi import FastAPI, APIRouter, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from pathlib import Path
from pydantic import BaseModel, Field, BeforeValidator
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId

from idoceo import parse_idoceo

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="SwipeNoten")
api = APIRouter(prefix="/api")

PyObjectId = Annotated[str, BeforeValidator(str)]

GRADE_SYSTEMS = {
    "grades_1_6": ["1+", "1", "1-", "2+", "2", "2-", "3+", "3",
                   "3-", "4+", "4", "4-", "5+", "5", "5-", "6"],
    "points_0_15": ["15", "14", "13", "12", "11", "10", "9", "8",
                    "7", "6", "5", "4", "3", "2", "1", "0"],
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- Models ----------
class SchoolClass(BaseModel):
    id: Optional[PyObjectId] = Field(default=None, alias="_id")
    idoceo_nid: str
    name: str
    grade_system: str = "grades_1_6"
    created_at: str = Field(default_factory=now_iso)

    class Config:
        populate_by_name = True


class Student(BaseModel):
    id: Optional[PyObjectId] = Field(default=None, alias="_id")
    class_id: str
    idoceo_sid: str
    first_name: str
    last_name: str
    order: int = 0
    photo: Optional[str] = None
    created_at: str = Field(default_factory=now_iso)

    class Config:
        populate_by_name = True


class GradeSystemUpdate(BaseModel):
    grade_system: str


class SessionCreate(BaseModel):
    class_id: str
    title: Optional[str] = None
    weight: Optional[float] = 1.0
    date: Optional[str] = None
    category: Optional[str] = "sonstige"


class GradeIn(BaseModel):
    student_id: str
    value: str


# ---------- Helpers ----------
def class_out(doc: dict, student_count: int = 0) -> dict:
    return {
        "id": str(doc["_id"]),
        "idoceo_nid": doc.get("idoceo_nid", ""),
        "name": doc.get("name", ""),
        "grade_system": doc.get("grade_system", "grades_1_6"),
        "student_count": student_count,
        "created_at": doc.get("created_at"),
    }


def student_out(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "class_id": doc.get("class_id"),
        "idoceo_sid": doc.get("idoceo_sid"),
        "first_name": doc.get("first_name", ""),
        "last_name": doc.get("last_name", ""),
        "order": doc.get("order", 0),
        "photo": doc.get("photo"),
    }


# ---------- Routes ----------
@api.get("/")
async def root():
    return {"app": "SwipeNoten", "status": "ok"}


@api.get("/grade-systems")
async def grade_systems():
    return GRADE_SYSTEMS


@api.post("/import/peek")
async def import_peek(file: UploadFile = File(...), password: str = Form("test")):
    raw = await file.read()
    try:
        parsed = parse_idoceo(raw, password)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Datei ungültig: {exc}")
    nid = parsed["class"]["idoceo_nid"]
    existing = await db.classes.find_one({"idoceo_nid": nid})
    return {
        "nid": nid,
        "name": parsed["class"]["name"],
        "exists": existing is not None,
        "grade_system": (existing or {}).get("grade_system"),
        "student_count": len(parsed["students"]),
    }


@api.post("/import/idoceo")
async def import_idoceo(file: UploadFile = File(...), password: str = Form("test"),
                        grade_system: str = Form("grades_1_6")):
    raw = await file.read()
    try:
        parsed = parse_idoceo(raw, password)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Import fehlgeschlagen: {exc}")

    cinfo = parsed["class"]
    nid = cinfo["idoceo_nid"]
    gs = grade_system if grade_system in GRADE_SYSTEMS else "grades_1_6"

    existing = await db.classes.find_one({"idoceo_nid": nid})
    new_class = existing is None
    if new_class:
        cls = SchoolClass(idoceo_nid=nid, name=cinfo["name"], grade_system=gs)
        res = await db.classes.insert_one(cls.model_dump(exclude={"id"}, by_alias=False))
        class_id = str(res.inserted_id)
    else:
        class_id = str(existing["_id"])
        # keep latest name
        if existing.get("name") != cinfo["name"]:
            await db.classes.update_one({"_id": existing["_id"]},
                                        {"$set": {"name": cinfo["name"]}})

    added = 0
    updated = 0
    for s in parsed["students"]:
        found = await db.students.find_one({"class_id": class_id,
                                            "idoceo_sid": s["idoceo_sid"]})
        if found is None:
            doc = Student(class_id=class_id, idoceo_sid=s["idoceo_sid"],
                          first_name=s["first_name"], last_name=s["last_name"],
                          order=s["order"], photo=s["photo"])
            await db.students.insert_one(doc.model_dump(exclude={"id"}, by_alias=False))
            added += 1
        else:
            update = {"first_name": s["first_name"], "last_name": s["last_name"],
                      "order": s["order"]}
            if s["photo"]:
                update["photo"] = s["photo"]
            await db.students.update_one({"_id": found["_id"]}, {"$set": update})
            updated += 1

    total = await db.students.count_documents({"class_id": class_id})
    return {
        "class_id": class_id,
        "class_name": cinfo["name"],
        "new_class": new_class,
        "added_students": added,
        "updated_students": updated,
        "total_students": total,
    }


@api.get("/classes")
async def list_classes():
    out = []
    async for c in db.classes.find().sort("created_at", -1):
        cid = str(c["_id"])
        count = await db.students.count_documents({"class_id": cid})
        klausur = await db.sessions.count_documents({"class_id": cid, "category": "klausur"})
        sonstige = await db.sessions.count_documents({"class_id": cid, "category": {"$ne": "klausur"}})
        out.append({**class_out(c, count), "session_count": sonstige + klausur,
                    "sonstige_count": sonstige, "klausur_count": klausur})
    return out


@api.get("/classes/{class_id}")
async def get_class(class_id: str):
    c = await db.classes.find_one({"_id": ObjectId(class_id)})
    if not c:
        raise HTTPException(404, "Klasse nicht gefunden")
    students = []
    async for s in db.students.find({"class_id": class_id}).sort("order", 1):
        students.append(student_out(s))
    klausur = await db.sessions.count_documents({"class_id": class_id, "category": "klausur"})
    sonstige = await db.sessions.count_documents({"class_id": class_id, "category": {"$ne": "klausur"}})
    return {**class_out(c, len(students)), "session_count": sonstige + klausur,
            "sonstige_count": sonstige, "klausur_count": klausur, "students": students}


@api.put("/classes/{class_id}/grade-system")
async def set_grade_system(class_id: str, body: GradeSystemUpdate):
    if body.grade_system not in GRADE_SYSTEMS:
        raise HTTPException(400, "Unbekanntes Notensystem")
    res = await db.classes.update_one({"_id": ObjectId(class_id)},
                                      {"$set": {"grade_system": body.grade_system}})
    if res.matched_count == 0:
        raise HTTPException(404, "Klasse nicht gefunden")
    return {"ok": True, "grade_system": body.grade_system}


@api.delete("/classes/{class_id}")
async def delete_class(class_id: str):
    await db.students.delete_many({"class_id": class_id})
    sessions = db.sessions.find({"class_id": class_id})
    async for s in sessions:
        await db.grades.delete_many({"session_id": str(s["_id"])})
    await db.sessions.delete_many({"class_id": class_id})
    await db.classes.delete_one({"_id": ObjectId(class_id)})
    return {"ok": True}


@api.get("/classes/{class_id}/export.csv")
async def export_class_csv(class_id: str):
    cls = await db.classes.find_one({"_id": ObjectId(class_id)})
    if not cls:
        raise HTTPException(404, "Klasse nicht gefunden")

    sessions = [s async for s in db.sessions.find({"class_id": class_id}).sort("created_at", 1)]
    # group: sonstige first, then klausuren
    sessions.sort(key=lambda s: (s.get("category") == "klausur", s.get("created_at", "")))

    # build unique column headers from session dates
    headers = []  # list of (session_id, label)
    seen = {}
    for s in sessions:
        title = s.get("title", "") or "Bewertung"
        date = s.get("date", "")
        weight = s.get("weight", 1.0)
        w = int(weight) if float(weight).is_integer() else weight
        cat = "Klausur" if s.get("category") == "klausur" else "SoLe"
        base = f"[{cat}] {title} {date} (x{w})"
        seen[base] = seen.get(base, 0) + 1
        label = base if seen[base] == 1 else f"{base} #{seen[base]}"
        headers.append((str(s["_id"]), label))

    grademap = {}  # (session_id, student_id) -> value
    for sid, _label in headers:
        async for g in db.grades.find({"session_id": sid}):
            grademap[(sid, g["student_id"])] = g["value"]

    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=",")
    writer.writerow(["Vorname", "Nachname"] + [h[1] for h in headers])
    async for st in db.students.find({"class_id": class_id}).sort("order", 1):
        sid = str(st["_id"])
        row = [grademap.get((h[0], sid), "") for h in headers]
        if not any(row):
            continue
        writer.writerow([st.get("first_name", ""), st.get("last_name", "")] + row)

    buf.seek(0)
    cname = cls.get("name", "Klasse").replace(" ", "_")
    today = datetime.now(timezone.utc).strftime("%d-%m-%Y")
    fname = f"{cname}_alle_Bewertungen_{today}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@api.delete("/classes/{class_id}/sessions")
async def delete_class_sessions(class_id: str):
    """Deletes all grading rounds (sessions) + grades of a class. Students stay."""
    count = 0
    async for s in db.sessions.find({"class_id": class_id}):
        await db.grades.delete_many({"session_id": str(s["_id"])})
        count += 1
    await db.sessions.delete_many({"class_id": class_id})
    return {"ok": True, "deleted_sessions": count}


@api.post("/sessions")
async def create_session(body: SessionCreate):
    c = await db.classes.find_one({"_id": ObjectId(body.class_id)})
    if not c:
        raise HTTPException(404, "Klasse nicht gefunden")
    now = datetime.now(timezone.utc)
    title = (body.title or "").strip() or "mündliche Mitarbeit"
    date = (body.date or "").strip() or now.strftime("%d.%m.%Y")
    weight = body.weight if body.weight is not None else 1.0
    category = "klausur" if body.category == "klausur" else "sonstige"
    doc = {
        "class_id": body.class_id,
        "title": title,
        "date": date,
        "weight": weight,
        "category": category,
        "created_at": now.isoformat(),
    }
    res = await db.sessions.insert_one(doc)
    doc.pop("_id", None)
    return {"id": str(res.inserted_id), **doc}


@api.get("/sessions")
async def list_sessions(class_id: Optional[str] = None):
    q = {"class_id": class_id} if class_id else {}
    out = []
    async for s in db.sessions.find(q).sort("created_at", -1):
        graded = await db.grades.count_documents({"session_id": str(s["_id"])})
        out.append({"id": str(s["_id"]), "class_id": s["class_id"],
                    "title": s["title"], "date": s["date"],
                    "weight": s.get("weight", 1.0),
                    "category": s.get("category", "sonstige"),
                    "created_at": s["created_at"], "graded_count": graded})
    return out


@api.post("/sessions/{session_id}/grades")
async def upsert_grade(session_id: str, body: GradeIn):
    s = await db.sessions.find_one({"_id": ObjectId(session_id)})
    if not s:
        raise HTTPException(404, "Bewertungsrunde nicht gefunden")
    await db.grades.update_one(
        {"session_id": session_id, "student_id": body.student_id},
        {"$set": {"session_id": session_id, "student_id": body.student_id,
                  "value": body.value, "updated_at": now_iso()}},
        upsert=True,
    )
    return {"ok": True}


@api.delete("/sessions/{session_id}/grades/{student_id}")
async def delete_grade(session_id: str, student_id: str):
    await db.grades.delete_one({"session_id": session_id, "student_id": student_id})
    return {"ok": True}


@api.get("/sessions/{session_id}")
async def get_session(session_id: str):
    s = await db.sessions.find_one({"_id": ObjectId(session_id)})
    if not s:
        raise HTTPException(404, "Bewertungsrunde nicht gefunden")
    grades = {}
    async for g in db.grades.find({"session_id": session_id}):
        grades[g["student_id"]] = g["value"]
    students = []
    async for st in db.students.find({"class_id": s["class_id"]}).sort("order", 1):
        students.append({**student_out(st), "grade": grades.get(str(st["_id"]))})
    cls = await db.classes.find_one({"_id": ObjectId(s["class_id"])})
    return {"id": str(s["_id"]), "class_id": s["class_id"], "title": s["title"],
            "date": s["date"], "weight": s.get("weight", 1.0),
            "category": s.get("category", "sonstige"), "students": students,
            "class_name": (cls or {}).get("name", ""),
            "grade_system": (cls or {}).get("grade_system", "grades_1_6")}


@api.get("/sessions/{session_id}/export.csv")
async def export_csv(session_id: str):
    s = await db.sessions.find_one({"_id": ObjectId(session_id)})
    if not s:
        raise HTTPException(404, "Bewertungsrunde nicht gefunden")
    grades = {}
    async for g in db.grades.find({"session_id": session_id}):
        grades[g["student_id"]] = g["value"]

    col = s["date"]
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=",")
    writer.writerow(["Vorname", "Nachname", col])
    async for st in db.students.find({"class_id": s["class_id"]}).sort("order", 1):
        val = grades.get(str(st["_id"]), "")
        if val == "":
            continue
        writer.writerow([st.get("first_name", ""), st.get("last_name", ""), val])

    buf.seek(0)
    cls = await db.classes.find_one({"_id": ObjectId(s["class_id"])})
    cname = (cls or {}).get("name", "Klasse").replace(" ", "_")
    fname = f"{cname}_{s['date'].replace('.', '-')}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
