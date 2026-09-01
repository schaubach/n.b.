import api from "./api";
import { APP_VERSION } from "../generated/appVersion";
import { syncBundledGradeScales } from "./bundledGradeScales";

jest.mock("./api", () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
}));

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

test("skips bundled scale loading when this app version was already synchronized", async () => {
  api.get.mockResolvedValue({ data: { version: APP_VERSION.version } });

  const result = await syncBundledGradeScales();

  expect(result).toMatchObject({ changed: false, skipped: true });
  expect(global.fetch).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});

test("loads indexed CSV files and synchronizes them for a new app version", async () => {
  api.get.mockResolvedValue({ data: { version: "older" } });
  global.fetch
    .mockResolvedValueOnce({ ok: true, json: async () => ["MEDA.csv", "IT.csv"] })
    .mockResolvedValueOnce({ ok: true, text: async () => "Note;Punkte;Prozent_ab\n1;14;90" })
    .mockResolvedValueOnce({ ok: true, text: async () => "Note;Punkte;Prozent_ab\n1+;15;95" });
  api.post.mockResolvedValue({ data: { changed: true } });

  const result = await syncBundledGradeScales();

  expect(result).toEqual({ changed: true });
  expect(api.post).toHaveBeenCalledWith("/grade-scales/sync-bundled", {
    version: APP_VERSION.version,
    scales: [
      { name: "MEDA", csv: "Note;Punkte;Prozent_ab\n1;14;90" },
      { name: "IT", csv: "Note;Punkte;Prozent_ab\n1+;15;95" },
    ],
  });
});
