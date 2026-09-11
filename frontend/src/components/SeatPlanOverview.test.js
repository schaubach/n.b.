import { seatTrackWeights } from "./SeatPlanOverview";

test("compresses empty aisles while preserving the seating grid", () => {
  const cells = ["a", null, "b", null, null, null, "c", null, "d"];
  expect(seatTrackWeights(3, 3, cells)).toEqual({ rows: [1, 0.2, 1], columns: [1, 0.2, 1] });
  expect(cells).toEqual(["a", null, "b", null, null, null, "c", null, "d"]);
});

test("keeps partially occupied tracks full size and handles empty plans", () => {
  expect(seatTrackWeights(2, 2, ["a", null, null, "b"])).toEqual({ rows: [1, 1], columns: [1, 1] });
  expect(seatTrackWeights(1, 2, [null, null])).toEqual({ rows: [0.2], columns: [0.2, 0.2] });
});
