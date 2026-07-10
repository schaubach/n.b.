const { webcrypto } = require("crypto");
const { TextDecoder, TextEncoder } = require("util");

global.TextDecoder = TextDecoder;
global.TextEncoder = TextEncoder;
global.crypto = webcrypto;

const { __backupTest } = require("./backup");

const decoder = new TextDecoder();
const readU16 = (bytes, offset) => bytes[offset] | (bytes[offset + 1] << 8);

test("creates password protected ZIP files that can be decrypted with the IServ password", () => {
  const zip = __backupTest.makeZip([{ name: "data/state.csv", data: "key,json\nclasses,[]" }], "iserv-password");

  expect(readU16(zip, 6) & 1).toBe(1);
  const files = __backupTest.unzipStored(zip, "iserv-password");

  expect(decoder.decode(files.get("data/state.csv"))).toBe("key,json\nclasses,[]");
  expect(() => __backupTest.unzipStored(zip, "wrong-password")).toThrow(/IServ-Passwort/);
});


test("adds one gradebook CSV per class to backup files", () => {
  const files = __backupTest.buildFilesFromState({
    classes: [{ id: "class-1", name: "BK A", grade_system: "grades_1_6", grade_scale_id: "MEDA" }],
    students: [
      { id: "student-2", class_id: "class-1", first_name: "Berta", last_name: "Beta", order: 2 },
      { id: "student-1", class_id: "class-1", first_name: "Ada", last_name: "Alpha", order: 1 },
    ],
    sessions: [
      { id: "session-1", class_id: "class-1", title: "Test", date: "01.07.2026", weight: 1, category: "klausur", created_at: "2026-07-01T10:00:00.000Z" },
    ],
    grades: [{ session_id: "session-1", student_id: "student-1", value: "2" }],
    gradebook_overrides: [],
    gradebook_weights: [],
    grade_scales: [],
  });

  const gradebook = files.find((file) => file.name === "notenstand/BK_A_Notenstand.csv");

  expect(gradebook).toBeTruthy();
  expect(gradebook.data).toContain("Vorname;Nachname;Klassenarbeit: Test 01.07.2026 (x1);KA gesamt;Endnote");
  expect(gradebook.data).toContain("Ada;Alpha;2;2;2");
  expect(gradebook.data.indexOf("Ada;Alpha")).toBeLessThan(gradebook.data.indexOf("Berta;Beta"));
});
