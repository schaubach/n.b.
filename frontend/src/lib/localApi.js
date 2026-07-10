import { getState, mutateState, replaceState } from "./cryptoStore";
import { GRADE_SYSTEMS } from "./grades";
import { parseClassCsv } from "./csvImport";
import {
  allGradeScales,
  evaluatePercent,
  findGradeScale,
  gradeScaleCsv,
  normalizeExamGradeValue,
  parseGradeScaleCsv,
  pointsNeededForBetter,
} from "./gradeScales";

function id() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function nowIso() {
  return new Date().toISOString();
}

function todayDe() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function normalizeBackupIntervalDays(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 7;
  return Math.min(365, Math.max(1, parsed));
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.response = { status, data: { detail: message } };
  throw error;
}

function normalizePath(url) {
  const raw = String(url || "");
  const path = raw.split("?")[0].replace(/^\/api/, "");
  return path || "/";
}

function sourceIdForClassName(name) {
  return `csv:${String(name || "").trim().toLowerCase()}`;
}

function classOut(state, cls) {
  const classId = cls.id;
  const studentCount = state.students.filter((student) => student.class_id === classId).length;
  const sessions = state.sessions.filter((session) => session.class_id === classId);
  const klausur = sessions.filter((session) => session.category === "klausur").length;
  const sonstige = sessions.length - klausur;
  const scales = gradeScalesForState(state);
  const gradeScale = findGradeScale(scales, cls.grade_scale_id || "MEDA");
  return {
    id: cls.id,
    source_id: cls.source_id || sourceIdForClassName(cls.name),
    name: cls.name || "",
    grade_system: cls.grade_system || "grades_1_6",
    grade_scale_id: gradeScale?.id || "MEDA",
    grade_scale_name: gradeScale?.name || "MEDA",
    created_at: cls.created_at,
    student_count: studentCount,
    photo_count: state.students.filter((student) => student.class_id === classId && student.photo).length,
    session_count: sessions.length,
    sonstige_count: sonstige,
    klausur_count: klausur,
  };
}

function compareStudents(a, b) {
  const last = String(a.last_name || "").localeCompare(String(b.last_name || ""), "de", { sensitivity: "base" });
  if (last !== 0) return last;
  const first = String(a.first_name || "").localeCompare(String(b.first_name || ""), "de", { sensitivity: "base" });
  if (first !== 0) return first;
  return (a.order || 0) - (b.order || 0);
}
function studentOut(student) {
  return {
    id: student.id,
    class_id: student.class_id,
    source_key: student.source_key || student.csv_key || "",
    first_name: student.first_name || "",
    last_name: student.last_name || "",
    order: student.order || 0,
    email: student.email || "",
    photo: student.photo || null,
    inactive: !!student.inactive,
    inactive_at: student.inactive_at || null,
  };
}

function findClass(state, classId) {
  const cls = state.classes.find((item) => item.id === classId);
  if (!cls) httpError("Klasse nicht gefunden", 404);
  return cls;
}

function findSession(state, sessionId) {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) httpError("Bewertungsrunde nicht gefunden", 404);
  return session;
}

function findStudent(state, studentId) {
  const student = state.students.find((item) => item.id === studentId);
  if (!student) httpError("Lernende*r nicht gefunden", 404);
  return student;
}

async function parseCsvForm(formData) {
  const file = formData.get("file");
  if (!file || !file.text) httpError("Keine CSV-Datei uebergeben.");
  const fallback = String(file.name || "Klasse").replace(/\.[^.]+$/, "") || "Klasse";
  try {
    return parseClassCsv(await file.text(), fallback);
  } catch (error) {
    httpError(`CSV ungueltig: ${error.message || error}`);
  }
}

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function gradeScalesForState(state) {
  return allGradeScales(state.grade_scales, state.hidden_grade_scales);
}

function hideGradeScale(state, scaleId) {
  state.hidden_grade_scales = Array.from(new Set([...(state.hidden_grade_scales || []), scaleId]));
}

function unhideGradeScale(state, scaleId) {
  state.hidden_grade_scales = (state.hidden_grade_scales || []).filter((id) => id !== scaleId);
}

function pointSessionFor(state, sessionId) {
  state.point_sessions = state.point_sessions || [];
  let record = state.point_sessions.find((item) => item.session_id === sessionId);
  if (!record) {
    record = { session_id: sessionId, columns: [], entries: [] };
    state.point_sessions.push(record);
  }
  return record;
}

function pointSummary(state, session, studentId) {
  const record = (state.point_sessions || []).find((item) => item.session_id === session.id);
  if (!record) return null;
  const max = (record.columns || []).reduce((sum, column) => sum + (Number(column.max_points) || 0), 0);
  const studentEntries = (record.entries || []).filter((entry) => entry.student_id === studentId);
  const achieved = studentEntries.reduce((sum, entry) => sum + (Number(entry.points) || 0), 0);
  if (!studentEntries.length || !(max > 0)) return { achieved: studentEntries.length ? achieved : null, max, percent: null, calculated_value: "" };
  const scales = gradeScalesForState(state);
  const scale = session.point_scale_override || findGradeScale(scales, session.grade_scale_id);
  const percent = achieved / max * 100;
  const evaluated = evaluatePercent(percent, scale, session.grade_system, session);
  const better = pointsNeededForBetter(achieved, max, scale, evaluated.rowIndex, session.grade_system, session);
  return { achieved, max, percent, calculated_value: evaluated.value, calculated_raw_value: evaluated.rawValue || evaluated.value, better };
}

function recalculatePointGrades(state, session) {
  const record = pointSessionFor(state, session.id);
  const students = state.students.filter((student) => student.class_id === session.class_id);
  for (const student of students) {
    const summary = pointSummary(state, session, student.id);
    const value = summary?.calculated_value || "";
    const calculated = summary?.calculated_raw_value || value;
    let grade = state.grades.find((item) => item.session_id === session.id && item.student_id === student.id);
    if (!value) {
      if (grade) state.grades = state.grades.filter((item) => item !== grade);
      continue;
    }
    if (!grade) {
      grade = { id: id(), session_id: session.id, student_id: student.id, value, calculated_value: calculated, manual_override: false, updated_at: nowIso() };
      state.grades.push(grade);
    } else {
      grade.calculated_value = calculated;
      if (!grade.manual_override) grade.value = value;
      grade.updated_at = nowIso();
    }
  }
  return record;
}

function classCsvBlob(state, classId) {
  const cls = findClass(state, classId);
  const sessions = state.sessions
    .filter((session) => session.class_id === classId)
    .sort((a, b) => {
      const group = (session) => session.category === "klausur" ? 2 : (session.sl_type === "written" ? 1 : 0);
      const dateKey = (session) => {
        const match = String(session.date || "").match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
        return match ? Number(`${match[3]}${match[2].padStart(2, "0")}${match[1].padStart(2, "0")}`) : Number.MAX_SAFE_INTEGER;
      };
      return group(a) - group(b) || dateKey(a) - dateKey(b) || String(a.created_at || "").localeCompare(String(b.created_at || ""));
    });

  const seen = new Map();
  const headers = sessions.map((session) => {
    const title = session.title || "Bewertung";
    const date = session.date || "";
    const weight = session.weight ?? 1;
    const weightLabel = Number.isInteger(Number(weight)) ? String(Number(weight)) : String(weight);
    const category = session.category === "klausur" ? "Klausur" : (session.sl_type === "written" ? "SL schriftl." : "SL mündl.");
    const base = `[${category}] ${title} ${date} (x${weightLabel})`;
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return { sessionId: session.id, label: count === 1 ? base : `${base} #${count}` };
  });

  const lines = [["Vorname", "Nachname", ...headers.map((h) => h.label)].map(csvEscape).join(",")];
  const students = state.students.filter((student) => student.class_id === classId).sort(compareStudents);
  for (const student of students) {
    const row = headers.map((header) => {
      const grade = state.grades.find((item) => item.session_id === header.sessionId && item.student_id === student.id);
      return grade?.value || "";
    });
    if (!row.some(Boolean)) continue;
    lines.push([student.first_name || "", student.last_name || "", ...row].map(csvEscape).join(","));
  }

  return new Blob(["\ufeff", lines.join("\n")], { type: "text/csv;charset=utf-8" });
}

function importParsedCsv(state, parsed, gradeSystem, gradeScaleId = "MEDA") {
  const results = [];
  for (const incomingClass of parsed.classes) {
    const sourceId = sourceIdForClassName(incomingClass.name);
    let cls = state.classes.find((item) => (item.source_id || sourceIdForClassName(item.name)) === sourceId);
    const isNew = !cls;
    if (!cls) {
      cls = {
        id: id(),
        source_id: sourceId,
        name: incomingClass.name,
        grade_system: GRADE_SYSTEMS[gradeSystem] ? gradeSystem : "grades_1_6",
        grade_scale_id: gradeScaleId || "MEDA",
        created_at: nowIso(),
      };
      state.classes.push(cls);
    } else {
      cls.name = incomingClass.name;
      cls.source_id = sourceId;
    }

    let added = 0;
    let updated = 0;
    let reactivated = 0;
    let inactive = 0;
    const importedKeys = new Set();
    const importedStudentIds = new Set();
    for (const incoming of incomingClass.students) {
      const sourceKey = incoming.source_key || incoming.csv_key;
      const legacySourceKey = incoming.legacy_source_key || sourceKey;
      const candidateKeys = new Set([sourceKey, legacySourceKey].filter(Boolean));
      let student = state.students.find((item) => item.class_id === cls.id && !importedStudentIds.has(item.id) && candidateKeys.has(item.source_key || item.csv_key));
      if (!student && incoming.email) {
        student = state.students.find((item) => item.class_id === cls.id && !importedStudentIds.has(item.id) && !item.inactive && item.email && item.email.toLowerCase() === incoming.email.toLowerCase());
      }
      if (!student) {
        student = {
          id: id(),
          class_id: cls.id,
          source_key: sourceKey,
          first_name: incoming.first_name,
          last_name: incoming.last_name,
          order: incoming.order,
          email: incoming.email || "",
          photo: null,
          inactive: false,
          inactive_at: null,
          created_at: nowIso(),
        };
        state.students.push(student);
        added += 1;
      } else {
        if (student.inactive) reactivated += 1;
        student.source_key = sourceKey;
        student.first_name = incoming.first_name;
        student.last_name = incoming.last_name;
        student.order = incoming.order;
        student.email = incoming.email || student.email || "";
        student.inactive = false;
        student.inactive_at = null;
        updated += 1;
      }
      importedKeys.add(student.source_key || sourceKey);
      importedStudentIds.add(student.id);
    }

    for (const student of state.students.filter((item) => item.class_id === cls.id)) {
      if (!importedKeys.has(student.source_key || student.csv_key || "")) {
        if (!student.inactive) {
          student.inactive = true;
          student.inactive_at = nowIso();
        }
        inactive += 1;
      }
    }

    results.push({
      class_id: cls.id,
      class_name: cls.name,
      new_class: isNew,
      added_students: added,
      updated_students: updated,
      reactivated_students: reactivated,
      inactive_students: inactive,
      total_students: state.students.filter((student) => student.class_id === cls.id).length,
    });
  }
  return results;
}

async function get(url) {
  const path = normalizePath(url);
  const state = await getState();

  if (path === "/") return { data: { app: "n.b.", status: "ok", storage: "local-encrypted" } };
  if (path === "/backup/state") return { data: { state: JSON.parse(JSON.stringify(state)) } };
  if (path === "/grade-systems") return { data: GRADE_SYSTEMS };
  if (path === "/grade-scales") return { data: gradeScalesForState(state) };
  const sessionPoints = path.match(/^\/sessions\/([^/]+)\/points$/);
  if (sessionPoints) {
    const session = findSession(state, sessionPoints[1]);
    const cls = findClass(state, session.class_id);
    const record = pointSessionFor(state, session.id);
    const scales = gradeScalesForState(state);
    const scale = session.point_scale_override || findGradeScale(scales, session.grade_scale_id || cls.grade_scale_id || "MEDA");
    const students = state.students.filter((student) => student.class_id === cls.id).sort(compareStudents).map((student) => {
      const grade = state.grades.find((item) => item.session_id === session.id && item.student_id === student.id);
      return { ...studentOut(student), grade: grade?.value || "", calculated_value: grade?.calculated_value || "", manual_override: !!grade?.manual_override, point_summary: pointSummary(state, session, student.id) };
    });
    return { data: { session: { ...session, class_name: cls.name || "", grade_system: cls.grade_system || "grades_1_6", grade_scale_id: session.grade_scale_id || scale.id }, students, columns: record.columns || [], entries: record.entries || [], grade_scales: scales, grade_scale: scale } };
  }

  if (path === "/teacher-config") {
    const config = state.teacher_config || {};
    return { data: {
      name: config.name || "",
      email: config.email || "",
      password: config.password || "",
      mail_backend_host: config.mail_backend_host || "",
      backup_interval_days: normalizeBackupIntervalDays(config.backup_interval_days),
      mail_backend_pre_shared_key: config.mail_backend_pre_shared_key || "",
      backend_identity_public_key: config.backend_identity_public_key || "",
    } };
  }
  if (path === "/classes") {
    const data = state.classes
      .slice()
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
      .map((cls) => classOut(state, cls));
    return { data };
  }

  const classExport = path.match(/^\/classes\/([^/]+)\/export\.csv$/);
  if (classExport) return { data: classCsvBlob(state, classExport[1]) };


  const classGradebook = path.match(/^\/classes\/([^/]+)\/gradebook$/);
  if (classGradebook) {
    const cls = findClass(state, classGradebook[1]);
    const students = state.students
      .filter((student) => student.class_id === cls.id)
      .sort(compareStudents)
      .map(studentOut);
    const sessions = state.sessions
      .filter((session) => session.class_id === cls.id)
      .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
      .map((session) => ({
        id: session.id,
        class_id: session.class_id,
        title: session.title,
        date: session.date,
        weight: session.weight ?? 1,
        category: session.category || "sonstige",
        sl_type: session.category === "klausur" ? null : (session.sl_type === "written" ? "written" : "oral"),
        points_mode: !!session.points_mode,
        grade_scale_id: session.grade_scale_id || cls.grade_scale_id || "MEDA",
        created_at: session.created_at,
      }));
    const sessionIds = new Set(sessions.map((session) => session.id));
    const grades = state.grades
      .filter((grade) => sessionIds.has(grade.session_id))
      .map((grade) => ({ session_id: grade.session_id, student_id: grade.student_id, value: grade.value, calculated_value: grade.calculated_value || "", manual_override: !!grade.manual_override }));
    const average_overrides = (state.gradebook_overrides || [])
      .filter((override) => override.class_id === cls.id)
      .map((override) => ({ student_id: override.student_id, column: override.column, value: override.value }));
    const average_weights = (state.gradebook_weights || [])
      .filter((item) => item.class_id === cls.id)
      .map((item) => ({ column: item.column, weight: item.weight }));
    return {
      data: {
        class_id: cls.id,
        class_name: cls.name || "",
        grade_system: cls.grade_system || "grades_1_6",
        grade_scale_id: cls.grade_scale_id || "MEDA",
        grade_scales: gradeScalesForState(state),
        students,
        sessions,
        grades,
        average_overrides,
        average_weights,
      },
    };
  }
  const classOne = path.match(/^\/classes\/([^/]+)$/);
  if (classOne) {
    const cls = findClass(state, classOne[1]);
    const students = state.students
      .filter((student) => student.class_id === cls.id)
      .sort(compareStudents)
      .map(studentOut);
    return { data: { ...classOut(state, cls), students } };
  }

  const sessionOne = path.match(/^\/sessions\/([^/]+)$/);
  if (sessionOne) {
    const session = findSession(state, sessionOne[1]);
    const cls = findClass(state, session.class_id);
    const students = state.students
      .filter((student) => student.class_id === session.class_id)
      .sort(compareStudents)
      .map((student) => {
        const grade = state.grades.find((item) => item.session_id === session.id && item.student_id === student.id);
        return { ...studentOut(student), grade: grade?.value || null };
      });
    return {
      data: {
        id: session.id,
        class_id: session.class_id,
        title: session.title,
        date: session.date,
        weight: session.weight ?? 1,
        category: session.category || "sonstige",
        sl_type: session.category === "klausur" ? null : (session.sl_type === "written" ? "written" : "oral"),
        points_mode: !!session.points_mode,
        grade_scale_id: session.grade_scale_id || cls.grade_scale_id || "MEDA",
        created_at: session.created_at,
        students,
        class_name: cls.name || "",
        grade_system: cls.grade_system || "grades_1_6",
      },
    };
  }


  if (path === "/mail/gradebook") {
    httpError("SMTP-Versand ist in dieser Browser/iPad-Version nicht direkt möglich. Dafür braucht die App einen nativen Mail-Bridge-Teil oder einen lokalen Backend-Prozess im Schulnetz.", 501);
  }

  if (path === "/sessions") {
    const params = new URLSearchParams(String(url).split("?")[1] || "");
    const classId = params.get("class_id");
    const sessions = state.sessions.filter((session) => !classId || session.class_id === classId);
    return { data: sessions.slice().sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))) };
  }

  httpError(`Unbekannter lokaler GET-Endpunkt: ${path}`, 404);
}

async function post(url, body) {
  const path = normalizePath(url);

  if (path === "/backup/restore-state") {
    await replaceState(body.state || {});
    return { data: { ok: true } };
  }

  if (path === "/backup/mark-sent") {
    return mutateState((state) => {
      state.backup_meta = { ...(state.backup_meta || {}), last_backup_sent_at: body.sent_at || nowIso(), last_backup_size: body.size || 0 };
      return { data: { ok: true, backup_meta: state.backup_meta } };
    });
  }

  if (path === "/teacher-config") {
    return mutateState((state) => {
      const email = String(body.email || "").trim().toLowerCase();
      state.teacher_config = {
        name: String(body.name || "").trim(),
        email,
        password: String(body.password || ""),
        mail_backend_host: String(body.mail_backend_host || "").trim(),
        backup_interval_days: normalizeBackupIntervalDays(body.backup_interval_days),
        mail_backend_pre_shared_key: String(body.mail_backend_pre_shared_key || "").trim(),
        backend_identity_public_key: String(body.backend_identity_public_key || "").trim(),
        updated_at: nowIso(),
      };
      return { data: {
        ok: true,
        name: state.teacher_config.name,
        email: state.teacher_config.email,
        mail_backend_host: state.teacher_config.mail_backend_host,
        backup_interval_days: state.teacher_config.backup_interval_days,
        mail_backend_pre_shared_key: state.teacher_config.mail_backend_pre_shared_key,
        backend_identity_public_key: state.teacher_config.backend_identity_public_key,
      } };
    });
  }

  if (path === "/grade-scales") {
    return mutateState((state) => {
      const parsed = parseGradeScaleCsv(body.csv || "", body.name || "Skala");
      state.grade_scales = (state.grade_scales || []).filter((scale) => scale.id !== parsed.id);
      unhideGradeScale(state, parsed.id);
      state.grade_scales.push(parsed);
      return { data: { ok: true, scale: parsed, scales: gradeScalesForState(state) } };
    });
  }

  if (path === "/import/peek") {
    const parsed = await parseCsvForm(body);
    const state = await getState();
    const classes = parsed.classes.map((cls) => {
      const sourceId = sourceIdForClassName(cls.name);
      const existing = state.classes.find((item) => (item.source_id || sourceIdForClassName(item.name)) === sourceId);
      return {
        name: cls.name,
        exists: !!existing,
        grade_system: existing?.grade_system,
        student_count: cls.students.length,
      };
    });
    return { data: { classes, any_new: classes.some((cls) => !cls.exists) } };
  }

  if (path === "/import/csv") {
    const parsed = await parseCsvForm(body);
    const gradeSystem = body.get("grade_system") || "grades_1_6";
    const gradeScaleId = body.get("grade_scale_id") || "MEDA";
    return mutateState((state) => {
      const results = importParsedCsv(state, parsed, gradeSystem, gradeScaleId);
      const totals = results.reduce((acc, item) => ({
        added_students: acc.added_students + item.added_students,
        updated_students: acc.updated_students + item.updated_students,
        reactivated_students: acc.reactivated_students + (item.reactivated_students || 0),
        inactive_students: acc.inactive_students + (item.inactive_students || 0),
        total_students: acc.total_students + item.total_students,
      }), { added_students: 0, updated_students: 0, reactivated_students: 0, inactive_students: 0, total_students: 0 });
      return {
        data: {
          class_id: results[0]?.class_id,
          class_name: results.length === 1 ? results[0].class_name : `${results.length} Klassen`,
          new_class: results.some((item) => item.new_class),
          class_count: results.length,
          results,
          ...totals,
        },
      };
    });
  }

  if (path === "/sessions") {
    return mutateState((state) => {
      const cls = findClass(state, body.class_id);
      const session = {
        id: id(),
        class_id: cls.id,
        title: (body.title || "").trim() || "muendliche Mitarbeit",
        date: (body.date || "").trim() || todayDe(),
        weight: body.weight ?? 1,
        category: body.category === "klausur" ? "klausur" : "sonstige",
        sl_type: body.category === "klausur" ? null : (body.sl_type === "written" ? "written" : "oral"),
        points_mode: !!body.points_mode,
        grade_scale_id: body.grade_scale_id || cls.grade_scale_id || "MEDA",
        created_at: nowIso(),
      };
      state.sessions.push(session);
      return { data: session };
    });
  }

  const gradePost = path.match(/^\/sessions\/([^/]+)\/grades$/);
  if (gradePost) {
    return mutateState((state) => {
      const session = findSession(state, gradePost[1]);
      const student = state.students.find((item) => item.id === body.student_id && item.class_id === session.class_id);
      if (!student) httpError("Lernende*r nicht gefunden", 404);
      const cls = findClass(state, session.class_id);
      const value = normalizeExamGradeValue(body.value, session, cls.grade_system);
      const calculatedValue = normalizeExamGradeValue(body.calculated_value || "", session, cls.grade_system);
      let grade = state.grades.find((item) => item.session_id === session.id && item.student_id === student.id);
      if (!grade) {
        grade = { id: id(), session_id: session.id, student_id: student.id, value, calculated_value: calculatedValue, manual_override: !!body.manual_override, updated_at: nowIso() };
        state.grades.push(grade);
      } else {
        grade.value = value;
        if (body.calculated_value !== undefined) grade.calculated_value = calculatedValue;
        if (body.manual_override !== undefined) grade.manual_override = !!body.manual_override;
        grade.updated_at = nowIso();
      }
      return { data: { ok: true } };
    });
  }

  httpError(`Unbekannter lokaler POST-Endpunkt: ${path}`, 404);
}

async function put(url, body) {
  const path = normalizePath(url);

  const gradeScaleUpdate = path.match(/^\/grade-scales\/([^/]+)$/);
  if (gradeScaleUpdate) {
    return mutateState((state) => {
      const scales = gradeScalesForState(state);
      const current = scales.find((scale) => scale.id === gradeScaleUpdate[1]);
      if (!current) httpError("Notenskala nicht gefunden", 404);
      const name = String(body.name || "").trim();
      if (!name) httpError("Name darf nicht leer sein", 400);
      const parsed = parseGradeScaleCsv(gradeScaleCsv(current), name);
      state.grade_scales = (state.grade_scales || []).filter((scale) => scale.id !== current.id && scale.id !== parsed.id);
      if (current.id !== parsed.id) hideGradeScale(state, current.id);
      unhideGradeScale(state, parsed.id);
      state.grade_scales.push(parsed);
      state.classes.forEach((cls) => { if (cls.grade_scale_id === current.id) cls.grade_scale_id = parsed.id; });
      state.sessions.forEach((session) => { if (session.grade_scale_id === current.id) session.grade_scale_id = parsed.id; });
      return { data: { ok: true, scale: parsed, scales: gradeScalesForState(state) } };
    });
  }

  const sessionUpdate = path.match(/^\/sessions\/([^/]+)$/);
  if (sessionUpdate) {
    return mutateState((state) => {
      const session = findSession(state, sessionUpdate[1]);
      const title = String(body.title || "").trim();
      if (title) session.title = title;
      const date = String(body.date || "").trim();
      if (date) session.date = date;
      const weight = Number(body.weight);
      session.weight = weight > 0 ? weight : 1;
      if (session.category !== "klausur" && body.sl_type) {
        session.sl_type = body.sl_type === "written" ? "written" : "oral";
      }
      session.updated_at = nowIso();
      return {
        data: {
          id: session.id,
          class_id: session.class_id,
          title: session.title,
          date: session.date,
          weight: session.weight ?? 1,
          category: session.category || "sonstige",
          sl_type: session.category === "klausur" ? null : (session.sl_type === "written" ? "written" : "oral"),
          created_at: session.created_at,
        },
      };
    });
  }
  const pointsUpdate = path.match(/^\/sessions\/([^/]+)\/points$/);
  if (pointsUpdate) {
    return mutateState((state) => {
      const session = findSession(state, pointsUpdate[1]);
      const cls = findClass(state, session.class_id);
      session.points_mode = true;
      session.grade_scale_id = body.grade_scale_id || session.grade_scale_id || cls.grade_scale_id || "MEDA";
      if (body.scale_override) {
        session.point_scale_override = {
          ...body.scale_override,
          id: body.scale_override.id || session.grade_scale_id,
          name: body.scale_override.name || "Bewertungsskala",
          rows: (body.scale_override.rows || []).map((row) => ({ grade: String(row.grade || ""), points: String(row.points || ""), minPercent: Number(row.minPercent) || 0 })),
        };
      }
      const record = pointSessionFor(state, session.id);
      record.columns = (body.columns || []).map((column, index) => ({
        id: column.id || id(),
        title: column.title || `Aufgabe ${index + 1}`,
        max_points: Number(column.max_points) || 0,
      }));
      const validColumns = new Set(record.columns.map((column) => column.id));
      const validStudents = new Set(state.students.filter((student) => student.class_id === session.class_id).map((student) => student.id));
      record.entries = (body.entries || [])
        .filter((entry) => validColumns.has(entry.column_id) && validStudents.has(entry.student_id))
        .map((entry) => ({ student_id: entry.student_id, column_id: entry.column_id, points: Number(entry.points) || 0 }));
      recalculatePointGrades(state, session);
      return { data: { ok: true } };
    });
  }

  const gradeSystem = path.match(/^\/classes\/([^/]+)\/grade-system$/);
  if (gradeSystem) {
    return mutateState((state) => {
      const cls = findClass(state, gradeSystem[1]);
      if (!GRADE_SYSTEMS[body.grade_system]) httpError("Unbekanntes Notensystem");
      cls.grade_system = body.grade_system;
      return { data: { ok: true, grade_system: body.grade_system } };
    });
  }

  const gradebookWeights = path.match(/^\/classes\/([^/]+)\/gradebook-weights$/);
  if (gradebookWeights) {
    return mutateState((state) => {
      const cls = findClass(state, gradebookWeights[1]);
      const column = ["sl_oral", "sl_written"].includes(body.column) ? body.column : null;
      if (!column) httpError("Unbekannte Gewichtungsspalte", 400);
      const weight = Number(body.weight);
      if (!(weight > 0)) httpError("Gewichtung muss groesser als 0 sein", 400);
      state.gradebook_weights = state.gradebook_weights || [];
      state.gradebook_weights = state.gradebook_weights.filter((item) => !(item.class_id === cls.id && item.column === column));
      state.gradebook_weights.push({
        id: id(),
        class_id: cls.id,
        column,
        weight,
        updated_at: nowIso(),
      });
      return { data: { ok: true, column, weight } };
    });
  }

  const gradebookOverride = path.match(/^\/classes\/([^/]+)\/gradebook-overrides$/);
  if (gradebookOverride) {
    return mutateState((state) => {
      const cls = findClass(state, gradebookOverride[1]);
      const student = state.students.find((item) => item.id === body.student_id && item.class_id === cls.id);
      if (!student) httpError("Lernende*r nicht gefunden", 404);
      const column = ["sl_oral", "sl_written", "sl", "ka", "final"].includes(body.column) ? body.column : null;
      if (!column) httpError("Unbekannte Notenstand-Spalte", 400);
      const value = String(body.value || "").trim();
      state.gradebook_overrides = state.gradebook_overrides || [];
      state.gradebook_overrides = state.gradebook_overrides.filter((override) => !(override.class_id === cls.id && override.student_id === student.id && override.column === column));
      if (value) {
        state.gradebook_overrides.push({
          id: id(),
          class_id: cls.id,
          student_id: student.id,
          column,
          value,
          updated_at: nowIso(),
        });
      }
      return { data: { ok: true, value } };
    });
  }
  const studentPhoto = path.match(/^\/students\/([^/]+)\/photo$/);
  if (studentPhoto) {
    return mutateState((state) => {
      const student = findStudent(state, studentPhoto[1]);
      student.photo = body.photo || null;
      student.photo_updated_at = nowIso();
      return { data: { ok: true, student: studentOut(student) } };
    });
  }

  httpError(`Unbekannter lokaler PUT-Endpunkt: ${path}`, 404);
}

async function del(url) {
  const path = normalizePath(url);

  const studentPhoto = path.match(/^\/students\/([^/]+)\/photo$/);
  if (studentPhoto) {
    return mutateState((state) => {
      const student = findStudent(state, studentPhoto[1]);
      student.photo = null;
      student.photo_updated_at = nowIso();
      return { data: { ok: true } };
    });
  }

  const sessionDelete = path.match(/^\/sessions\/([^/]+)$/);
  if (sessionDelete) {
    return mutateState((state) => {
      const session = findSession(state, sessionDelete[1]);
      state.grades = state.grades.filter((grade) => grade.session_id !== session.id);
      state.point_sessions = (state.point_sessions || []).filter((item) => item.session_id !== session.id);
      state.sessions = state.sessions.filter((item) => item.id !== session.id);
      return { data: { ok: true } };
    });
  }

  const classSessions = path.match(/^\/classes\/([^/]+)\/sessions$/);
  if (classSessions) {
    return mutateState((state) => {
      const sessionIds = state.sessions.filter((session) => session.class_id === classSessions[1]).map((session) => session.id);
      state.grades = state.grades.filter((grade) => !sessionIds.includes(grade.session_id));
      state.sessions = state.sessions.filter((session) => session.class_id !== classSessions[1]);
      state.gradebook_overrides = (state.gradebook_overrides || []).filter((override) => override.class_id !== classSessions[1]);
      state.gradebook_weights = (state.gradebook_weights || []).filter((item) => item.class_id !== classSessions[1]);
      state.point_sessions = (state.point_sessions || []).filter((item) => !sessionIds.includes(item.session_id));
      return { data: { ok: true, deleted_sessions: sessionIds.length } };
    });
  }
  const classOne = path.match(/^\/classes\/([^/]+)$/);
  if (classOne) {
    return mutateState((state) => {
      const classId = classOne[1];
      const sessionIds = state.sessions.filter((session) => session.class_id === classId).map((session) => session.id);
      const studentIds = state.students.filter((student) => student.class_id === classId).map((student) => student.id);
      state.classes = state.classes.filter((cls) => cls.id !== classId);
      state.students = state.students.filter((student) => student.class_id !== classId);
      state.sessions = state.sessions.filter((session) => session.class_id !== classId);
      state.grades = state.grades.filter((grade) => !sessionIds.includes(grade.session_id) && !studentIds.includes(grade.student_id));
      state.gradebook_overrides = (state.gradebook_overrides || []).filter((override) => override.class_id !== classId && !studentIds.includes(override.student_id));
      state.gradebook_weights = (state.gradebook_weights || []).filter((item) => item.class_id !== classId);
      state.point_sessions = (state.point_sessions || []).filter((item) => !sessionIds.includes(item.session_id));
      return { data: { ok: true } };
    });
  }

  const gradeScaleDelete = path.match(/^\/grade-scales\/([^/]+)$/);
  if (gradeScaleDelete) {
    return mutateState((state) => {
      const scales = gradeScalesForState(state);
      const current = scales.find((scale) => scale.id === gradeScaleDelete[1]);
      if (!current) httpError("Notenskala nicht gefunden", 404);
      if (scales.length <= 1) httpError("Die letzte Notenskala kann nicht gelöscht werden.", 400);
      const fallback = scales.find((scale) => scale.id !== current.id) || scales[0];
      state.grade_scales = (state.grade_scales || []).filter((scale) => scale.id !== current.id);
      hideGradeScale(state, current.id);
      state.classes.forEach((cls) => { if (cls.grade_scale_id === current.id) cls.grade_scale_id = fallback.id; });
      state.sessions.forEach((session) => { if (session.grade_scale_id === current.id) session.grade_scale_id = fallback.id; });
      const nextScales = gradeScalesForState(state);
      return { data: { ok: true, selected: findGradeScale(nextScales, fallback.id), scales: nextScales } };
    });
  }

  const gradeDelete = path.match(/^\/sessions\/([^/]+)\/grades\/([^/]+)$/);
  if (gradeDelete) {
    return mutateState((state) => {
      state.grades = state.grades.filter((grade) => !(grade.session_id === gradeDelete[1] && grade.student_id === gradeDelete[2]));
      return { data: { ok: true } };
    });
  }

  httpError(`Unbekannter lokaler DELETE-Endpunkt: ${path}`, 404);
}

const api = { get, post, put, delete: del };
export default api;




