const MIN_MATCH_SCORE = 0.66;
const DEFAULT_COLUMNS = 4;

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value) {
  return normalize(value).split(/\s+/).filter((token) => token.length > 1).sort();
}

function levenshtein(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const old = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diagonal = old;
    }
  }
  return previous[b.length];
}

function stringSimilarity(a, b) {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  return 1 - levenshtein(left, right) / Math.max(left.length, right.length);
}

export function nameSimilarity(student, candidate) {
  const expected = tokens(`${student.first_name || ""} ${student.last_name || ""}`);
  const actual = tokens(candidate);
  if (!expected.length || !actual.length) return 0;
  const sortedScore = stringSimilarity(expected.join(" "), actual.join(" "));
  const tokenScore = expected.reduce((sum, expectedToken) => {
    const best = actual.reduce((value, actualToken) => Math.max(value, stringSimilarity(expectedToken, actualToken)), 0);
    return sum + best;
  }, 0) / expected.length;
  const lengthPenalty = Math.max(0, Math.abs(expected.length - actual.length) * 0.08);
  return Math.max(0, sortedScore * 0.62 + tokenScore * 0.38 - lengthPenalty);
}

function center(item) {
  return {
    x: Number(item.x || 0) + Number(item.width || 0) / 2,
    y: Number(item.y || 0) + Number(item.height || 0) / 2,
  };
}

function candidateGroups(page) {
  const useful = (page.items || [])
    .map((item, index) => ({ ...item, index, str: String(item.str || "").trim(), ...center(item) }))
    .filter((item) => normalize(item.str).length >= 2);
  const groups = [];
  const seen = new Set();
  const add = (items) => {
    const ordered = items.slice().sort((a, b) => a.y - b.y || a.x - b.x);
    const key = ordered.map((item) => item.index).join(":");
    if (seen.has(key)) return;
    seen.add(key);
    const minX = Math.min(...ordered.map((item) => item.x - Number(item.width || 0) / 2));
    const maxX = Math.max(...ordered.map((item) => item.x + Number(item.width || 0) / 2));
    const minY = Math.min(...ordered.map((item) => item.y - Number(item.height || 0) / 2));
    const maxY = Math.max(...ordered.map((item) => item.y + Number(item.height || 0) / 2));
    groups.push({
      text: ordered.map((item) => item.str).join(" "),
      itemIds: ordered.map((item) => item.index),
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
    });
  };
  useful.forEach((item) => add([item]));
  useful.forEach((first, firstIndex) => {
    const nearby = useful.slice(firstIndex + 1).filter((other) => (
      Math.abs(first.x - other.x) <= page.width * 0.085
      && Math.abs(first.y - other.y) <= page.height * 0.085
    )).slice(0, 8);
    nearby.forEach((second, secondIndex) => {
      add([first, second]);
      nearby.slice(secondIndex + 1).forEach((third) => {
        const xs = [first.x, second.x, third.x];
        const ys = [first.y, second.y, third.y];
        if (Math.max(...xs) - Math.min(...xs) <= page.width * 0.13 && Math.max(...ys) - Math.min(...ys) <= page.height * 0.1) {
          add([first, second, third]);
        }
      });
    });
  });
  return groups;
}

function matchStudents(page, students) {
  const candidates = candidateGroups(page);
  const possibilities = [];
  students.forEach((student) => {
    candidates.forEach((candidate, candidateIndex) => {
      const score = nameSimilarity(student, candidate.text);
      if (score >= MIN_MATCH_SCORE) possibilities.push({ student, candidate, candidateIndex, score });
    });
  });
  possibilities.sort((a, b) => b.score - a.score);
  const usedStudents = new Set();
  const usedItems = new Set();
  const matches = [];
  possibilities.forEach((possibility) => {
    if (usedStudents.has(possibility.student.id)) return;
    if (possibility.candidate.itemIds.some((itemId) => usedItems.has(itemId))) return;
    usedStudents.add(possibility.student.id);
    possibility.candidate.itemIds.forEach((itemId) => usedItems.add(itemId));
    matches.push({
      student_id: possibility.student.id,
      x: possibility.candidate.x,
      y: possibility.candidate.y,
      score: possibility.score,
      text: possibility.candidate.text,
      itemIds: possibility.candidate.itemIds,
    });
  });
  return matches;
}

function cluster(values, tolerance) {
  const clusters = [];
  values.slice().sort((a, b) => a - b).forEach((value) => {
    const current = clusters[clusters.length - 1];
    if (!current || Math.abs(value - current.average) > tolerance) {
      clusters.push({ values: [value], average: value });
    } else {
      current.values.push(value);
      current.average = current.values.reduce((sum, item) => sum + item, 0) / current.values.length;
    }
  });
  return clusters;
}

function transformPoint(pdfjs, viewport, ctm, point) {
  return pdfjs.Util.applyTransform(
    pdfjs.Util.applyTransform(point, ctm),
    viewport.transform
  );
}

export function extractLineSegments(pdfjs, viewport, operatorList) {
  const lines = [];
  const stack = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const coordinateCount = new Map([
    [pdfjs.OPS.moveTo, 2],
    [pdfjs.OPS.lineTo, 2],
    [pdfjs.OPS.curveTo, 6],
    [pdfjs.OPS.curveTo2, 4],
    [pdfjs.OPS.curveTo3, 4],
    [pdfjs.OPS.rectangle, 4],
  ]);

  (operatorList.fnArray || []).forEach((fn, index) => {
    const args = operatorList.argsArray[index] || [];
    if (fn === pdfjs.OPS.save) {
      stack.push(ctm.slice());
      return;
    }
    if (fn === pdfjs.OPS.restore) {
      ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      return;
    }
    if (fn === pdfjs.OPS.transform) {
      ctm = pdfjs.Util.transform(ctm, Array.from(args));
      return;
    }
    if (fn !== pdfjs.OPS.constructPath) return;

    const pathOps = Array.from(args[0] || []);
    const coordinates = Array.from(args[1] || []);
    let cursor = 0;
    let current = null;
    let subpathStart = null;
    const addLine = (from, to) => {
      const first = transformPoint(pdfjs, viewport, ctm, from);
      const second = transformPoint(pdfjs, viewport, ctm, to);
      lines.push({ x1: first[0], y1: first[1], x2: second[0], y2: second[1] });
    };

    pathOps.forEach((pathOp) => {
      if (pathOp === pdfjs.OPS.moveTo) {
        current = [coordinates[cursor], coordinates[cursor + 1]];
        subpathStart = current;
        cursor += 2;
        return;
      }
      if (pathOp === pdfjs.OPS.lineTo) {
        const next = [coordinates[cursor], coordinates[cursor + 1]];
        if (current) addLine(current, next);
        current = next;
        cursor += 2;
        return;
      }
      if (pathOp === pdfjs.OPS.rectangle) {
        const [x, y, width, height] = coordinates.slice(cursor, cursor + 4);
        const corners = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
        corners.forEach((corner, cornerIndex) => addLine(corner, corners[(cornerIndex + 1) % corners.length]));
        current = corners[0];
        subpathStart = corners[0];
        cursor += 4;
        return;
      }
      if (pathOp === pdfjs.OPS.closePath) {
        if (current && subpathStart) addLine(current, subpathStart);
        current = subpathStart;
        return;
      }
      const count = coordinateCount.get(pathOp) || 0;
      if (count >= 2) current = [coordinates[cursor + count - 2], coordinates[cursor + count - 1]];
      cursor += count;
    });
  });
  return lines;
}

function groupObjects(items, matches, merge) {
  const groups = [];
  items.forEach((item) => {
    const group = groups.find((candidate) => matches(candidate, item));
    if (group) merge(group, item);
    else groups.push({ items: [item], ...item });
  });
  return groups;
}

function gridFromLines(page) {
  const vertical = (page.lines || []).map((line) => ({
    x: (Number(line.x1) + Number(line.x2)) / 2,
    y0: Math.min(Number(line.y1), Number(line.y2)),
    y1: Math.max(Number(line.y1), Number(line.y2)),
    dx: Math.abs(Number(line.x2) - Number(line.x1)),
  })).filter((line) => line.dx <= 2 && line.y1 - line.y0 >= page.height * 0.08);
  if (vertical.length < 3) return null;

  const rowGroups = groupObjects(
    vertical.slice().sort((a, b) => a.y0 - b.y0 || a.y1 - b.y1),
    (group, line) => Math.abs(group.y0 - line.y0) <= 2 && Math.abs(group.y1 - line.y1) <= 2,
    (group, line) => {
      group.items.push(line);
      group.y0 = group.items.reduce((sum, item) => sum + item.y0, 0) / group.items.length;
      group.y1 = group.items.reduce((sum, item) => sum + item.y1, 0) / group.items.length;
    }
  ).filter((group) => group.items.length >= 3);
  if (!rowGroups.length) return null;

  const xGroups = groupObjects(
    vertical.slice().sort((a, b) => a.x - b.x),
    (group, line) => Math.abs(group.x - line.x) <= 2,
    (group, line) => {
      group.items.push(line);
      group.x = group.items.reduce((sum, item) => sum + item.x, 0) / group.items.length;
    }
  );
  const minimumOccurrences = Math.max(1, Math.ceil(rowGroups.length / 2));
  const boundaries = xGroups.filter((group) => group.items.length >= minimumOccurrences).map((group) => group.x).sort((a, b) => a - b);
  if (boundaries.length < 3 || boundaries.length > 13) return null;
  const gaps = boundaries.slice(1).map((value, index) => value - boundaries[index]);
  const sortedGaps = gaps.slice().sort((a, b) => a - b);
  const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
  if (!(medianGap > 0) || gaps.some((gap) => Math.abs(gap - medianGap) > Math.max(2, medianGap * 0.18))) return null;

  return {
    boundaries,
    rows: rowGroups.map((group) => ({ y0: group.y0, y1: group.y1 })).sort((a, b) => a.y0 - b.y0),
  };
}

function gridCellForPoint(grid, x, y) {
  const row = grid.rows.findIndex((candidate) => y >= candidate.y0 - 2 && y <= candidate.y1 + 2);
  const column = grid.boundaries.slice(0, -1).findIndex((boundary, index) => (
    x >= boundary - 2 && x <= grid.boundaries[index + 1] + 2
  ));
  return row >= 0 && column >= 0 ? { row, column, key: `${row}:${column}` } : null;
}

function gridCellTexts(page, grid) {
  const cells = new Map();
  (page.items || []).forEach((item) => {
    const text = String(item.str || "").trim();
    if (!/[A-Za-zÄÖÜäöüß]/.test(text)) return;
    const point = center(item);
    const position = gridCellForPoint(grid, point.x, point.y);
    if (!position) return;
    const current = cells.get(position.key) || { ...position, items: [] };
    current.items.push({ text, x: point.x, y: point.y });
    cells.set(position.key, current);
  });
  return Array.from(cells.values()).map((cell) => ({
    ...cell,
    text: cell.items.slice().sort((a, b) => a.y - b.y || a.x - b.x).map((item) => item.text).join(" ").trim(),
  })).filter((cell) => normalize(cell.text).length >= 2);
}

function inferColumns(matches, pages) {
  const normalizedX = matches.map((match) => match.x / pages[match.pageIndex].width);
  const centers = cluster(normalizedX, 0.022).map((item) => item.average);
  if (centers.length < 2) return { columns: DEFAULT_COLUMNS, origin: centers[0] || 0.125, step: 0.25 };
  const gaps = centers.slice(1).map((value, index) => value - centers[index]).filter((gap) => gap > 0.035);
  const step = Math.min(...gaps);
  const origin = Math.min(...centers);
  const columns = Math.max(2, Math.min(12, Math.round((Math.max(...centers) - origin) / step) + 1));
  return { columns, origin, step };
}

export function defaultSeatPlan(students, columns = DEFAULT_COLUMNS) {
  const safeColumns = Math.max(2, Math.min(8, Number(columns) || DEFAULT_COLUMNS));
  return {
    rows: Math.max(1, Math.ceil((students || []).length / safeColumns)),
    columns: safeColumns,
    seats: (students || []).map((student, index) => ({
      row: Math.floor(index / safeColumns),
      column: index % safeColumns,
      student_id: student.id,
    })),
  };
}

export function buildSeatPlanFromTextPages(pages, students) {
  const activeStudents = (students || []).filter((student) => !student.inactive);
  const activeStudentIds = new Set(activeStudents.map((student) => student.id));
  const pageMatches = (pages || []).map((page) => matchStudents(page, students));
  const allMatches = pageMatches.flatMap((matches, pageIndex) => matches.map((match) => ({ ...match, pageIndex })));
  const pageGrids = (pages || []).map(gridFromLines);
  const lineColumnCounts = pageGrids.filter(Boolean).map((grid) => grid.boundaries.length - 1);
  const lineColumns = lineColumnCounts.length
    ? lineColumnCounts.slice().sort((a, b) => lineColumnCounts.filter((value) => value === b).length - lineColumnCounts.filter((value) => value === a).length || b - a)[0]
    : null;
  if (!allMatches.length && !lineColumns) throw new Error("In der PDF konnten keine Namen oder Sitzplätze erkannt werden.");
  const inferredGrid = allMatches.length
    ? inferColumns(allMatches, pages)
    : { columns: lineColumns || DEFAULT_COLUMNS, origin: 0, step: 1 / (lineColumns || DEFAULT_COLUMNS) };
  const columns = lineColumns || inferredGrid.columns;
  const seats = [];
  const pageRowOffsets = [];
  let rowOffset = 0;
  pageMatches.forEach((matches, pageIndex) => {
    const page = pages[pageIndex];
    const lineGrid = pageGrids[pageIndex];
    pageRowOffsets[pageIndex] = rowOffset;
    if (lineGrid && lineGrid.boundaries.length - 1 === columns) {
      matches.filter((match) => activeStudentIds.has(match.student_id)).forEach((match) => {
        const position = gridCellForPoint(lineGrid, match.x, match.y);
        if (position) seats.push({ row: rowOffset + position.row, column: position.column, student_id: match.student_id, confidence: match.score });
      });
      rowOffset += lineGrid.rows.length;
      return;
    }
    if (!matches.length) return;
    const rowClusters = cluster(matches.map((match) => match.y / page.height), 0.065);
    matches.filter((match) => activeStudentIds.has(match.student_id)).forEach((match) => {
      const normalizedY = match.y / page.height;
      const row = rowOffset + rowClusters.reduce((best, rowCluster, index) => (
        Math.abs(rowCluster.average - normalizedY) < Math.abs(rowClusters[best].average - normalizedY) ? index : best
      ), 0);
      const normalizedX = match.x / page.width;
      const column = Math.max(0, Math.min(columns - 1, Math.round((normalizedX - inferredGrid.origin) / inferredGrid.step)));
      seats.push({ row, column, student_id: match.student_id, confidence: match.score });
    });
    rowOffset += rowClusters.length;
  });
  const occupied = new Map();
  const acceptedStudents = new Set();
  seats.sort((a, b) => b.confidence - a.confidence).forEach((seat) => {
    const key = `${seat.row}:${seat.column}`;
    if (!occupied.has(key) && !acceptedStudents.has(seat.student_id)) {
      occupied.set(key, seat);
      acceptedStudents.add(seat.student_id);
    }
  });
  const accepted = Array.from(occupied.values());
  const matchedIds = new Set(accepted.map((seat) => seat.student_id));
  const pdfOnlyEntries = [];
  pageGrids.forEach((grid, pageIndex) => {
    if (!grid || grid.boundaries.length - 1 !== columns) return;
    const matchedCells = new Set(pageMatches[pageIndex].map((match) => gridCellForPoint(grid, match.x, match.y)?.key).filter(Boolean));
    gridCellTexts(pages[pageIndex], grid).forEach((cell) => {
      if (!matchedCells.has(cell.key)) {
        pdfOnlyEntries.push({ name: cell.text, row: (pageRowOffsets[pageIndex] || 0) + cell.row, column: cell.column });
      }
    });
  });
  const uniquePdfOnly = [];
  const seenPdfNames = new Set();
  pdfOnlyEntries.forEach((entry) => {
    const key = `${normalize(entry.name)}:${entry.row}:${entry.column}`;
    if (!key || seenPdfNames.has(key)) return;
    seenPdfNames.add(key);
    uniquePdfOnly.push(entry);
  });
  const plan = {
    rows: Math.max(1, rowOffset),
    columns,
    seats: accepted.map(({ confidence, ...seat }) => seat),
  };
  return {
    ...plan,
    matched: matchedIds.size,
    unmatched: activeStudents.filter((student) => !matchedIds.has(student.id)).map((student) => student.id),
    pdf_only_entries: uniquePdfOnly,
    uncertain: accepted.filter((seat) => seat.confidence < 0.82).map((seat) => seat.student_id),
  };
}

export async function parseSeatPlanPdf(file, students) {
  if (!file) throw new Error("Bitte eine PDF-Datei auswählen.");
  if (file.type && file.type !== "application/pdf" && !String(file.name || "").toLowerCase().endsWith(".pdf")) {
    throw new Error("Der Sitzplan muss als PDF-Datei vorliegen.");
  }
  const [pdfjs, pdfjsWorker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
  ]);
  globalThis.pdfjsWorker = pdfjsWorker;
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
  });
  const document = await loadingTask.promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const [content, operatorList] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
    const items = content.items.map((item) => {
      const transform = pdfjs.Util.transform(viewport.transform, item.transform);
      const height = Math.max(1, Math.hypot(transform[2], transform[3]));
      return { str: item.str, x: transform[4], y: transform[5] - height, width: Math.abs(item.width || 0), height };
    });
    const lines = extractLineSegments(pdfjs, viewport, operatorList);
    pages.push({ width: viewport.width, height: viewport.height, items, lines });
  }
  await document.destroy();
  return buildSeatPlanFromTextPages(pages, students || []);
}
