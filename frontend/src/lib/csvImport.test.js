import { parseClassCsv } from "./csvImport";

test("parses exported class list CSV with semicolons and quoted names", () => {
  const parsed = parseClassCsv(`Gruppe;Nachname;Vorname\nKlasse.MEDU1;Liu;Zhang\nKlasse.MEDU1;\"El Bey\";Karim\nKlasse.MEDU1;Rupprecht;\"Mia Maxima\"`);

  expect(parsed.classes).toHaveLength(1);
  expect(parsed.classes[0].name).toBe("Klasse.MEDU1");
  expect(parsed.classes[0].students).toEqual([
    expect.objectContaining({ first_name: "Zhang", last_name: "Liu", order: 0 }),
    expect.objectContaining({ first_name: "Karim", last_name: "El Bey", order: 1 }),
    expect.objectContaining({ first_name: "Mia Maxima", last_name: "Rupprecht", order: 2 }),
  ]);
});

test("creates one class per Gruppe value", () => {
  const parsed = parseClassCsv(`Gruppe;Nachname;Vorname\nA;Alpha;Ada\nB;Beta;Ben`);

  expect(parsed.classes.map((cls) => cls.name)).toEqual(["A", "B"]);
});


test("builds learner mail addresses from IServ account column", () => {
  const parsed = parseClassCsv("Gruppe;Nachname;Vorname;Account\nKlasse.MEDO1;Bata;Anas;bataa");

  expect(parsed.classes[0].students[0]).toEqual(expect.objectContaining({
    first_name: "Anas",
    last_name: "Bata",
    email: "bataa@rbbk-do.de",
  }));
});

test("uses account-based source keys and keeps legacy name keys for reimports", () => {
  const parsed = parseClassCsv("Gruppe;Nachname;Vorname;Account\nKlasse.MEDO1;Bata;Anas;bataa");
  const student = parsed.classes[0].students[0];

  expect(student.source_key).toBe("klasse.medo1::account::bataa");
  expect(student.legacy_source_key).toBe("klasse.medo1::bata::anas");
});
