import React, { useLayoutEffect, useRef, useState } from "react";
import { gradeColorClasses, initials } from "../lib/grades";
import "./SeatPlanOverview.css";

export function seatTrackWeights(rows, columns, cells) {
  return {
    rows: Array.from({ length: rows }, (_, row) => cells.slice(row * columns, (row + 1) * columns).some(Boolean) ? 1 : 0.2),
    columns: Array.from({ length: columns }, (_, column) => cells.some((id, index) => id && index % columns === column) ? 1 : 0.2),
  };
}

const tracks = (weights) => weights.map((weight) => `minmax(0, ${weight}fr)`).join(" ");

export default function SeatPlanOverview({ rows, columns, cells, studentsById, csvOnlyStudents, systemId, onStudent, assessmentBorder }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(800);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const weights = seatTrackWeights(rows, columns, cells);
  const extraColumns = Math.max(2, Math.min(8, Math.floor(width / 120)));
  const groups = [
    { title: "Nur in der IServ-Gruppenliste", students: csvOnlyStudents, tone: "border-amber-400" },
  ].filter((group) => group.students.length);
  const groupRows = groups.map((group) => Math.ceil(group.students.length / extraColumns));
  const renderStudent = (student) => <OverviewTile student={student} systemId={systemId} onClick={() => onStudent(student)} border={student ? assessmentBorder(student) : ""} />;
  return (
    <div ref={ref} className="seat-overview" data-testid="seat-plan-overview" style={{ gridTemplateRows: tracks([weights.rows.reduce((a, b) => a + b, 0), ...groupRows.map((count) => count + 0.3)]) }}>
      <div className="seat-overview-grid" style={{ gridTemplateColumns: tracks(weights.columns), gridTemplateRows: tracks(weights.rows) }}>
        {cells.map((studentId, index) => <React.Fragment key={index}>{renderStudent(studentsById.get(studentId))}</React.Fragment>)}
      </div>
      {groups.map((group, index) => (
        <section key={group.title} className={`seat-overview-group border-t-2 ${group.tone}`}>
          <h2 className="truncate text-xs font-bold text-stone-600" title={group.title}>{group.title}</h2>
          <div className="seat-overview-grid" style={{ gridTemplateColumns: `repeat(${extraColumns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${groupRows[index]}, minmax(0, 1fr))` }}>
            {group.students.map((student) => <React.Fragment key={student.id}>{renderStudent(student)}</React.Fragment>)}
          </div>
        </section>
      ))}
    </div>
  );
}

function OverviewTile({ student, systemId, onClick, border }) {
  if (!student) return <div className="seat-overview-empty" aria-label="Freier Platz" />;
  const name = `${student.first_name} ${student.last_name}`;
  return (
    <button type="button" onClick={onClick} aria-label={name} title={[name, student.additional_info].filter(Boolean).join("\n")} data-testid={`overview-student-${student.id}`} className={`seat-overview-tile bg-white text-stone-900 ${border} ${student.inactive ? "opacity-60 grayscale" : ""}`}>
      <div className="seat-overview-content">
        <div className="seat-overview-photo">
          {student.photo ? <img src={student.photo} alt="" /> : <span>{initials(student.first_name, student.last_name)}</span>}
        </div>
        <div className="seat-overview-caption">
          <span className="seat-overview-name">{student.first_name} <strong>{student.last_name}</strong></span>
          {student.grade && <span className={`seat-overview-grade ${gradeColorClasses(student.grade, systemId)}`}>{student.grade}</span>}
        </div>
        {student.additional_info && <span className="seat-overview-info">{student.additional_info}</span>}
      </div>
    </button>
  );
}
