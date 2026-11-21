import { triggerDownload } from "./exportClass";

jest.mock("./api", () => ({ __esModule: true, default: {} }));

beforeEach(() => {
  jest.useFakeTimers();
  URL.createObjectURL = jest.fn(() => "blob:test-download");
  URL.revokeObjectURL = jest.fn();
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test.each([["application/pdf", "_blank"], ["text/csv", ""]])("downloads %s without replacing the vault for PDF previews", (type, target) => {
  const file = new File(["test"], type === "application/pdf" ? "Noten.pdf" : "Noten.csv", { type });
  let link;
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    link = this;
    expect(document.body.contains(this)).toBe(true);
  });
  triggerDownload(file);
  expect(link.download).toBe(file.name);
  expect(link.target).toBe(target);
  if (target) expect(link.rel).toBe("noopener noreferrer");
  expect(link.href).toBe("blob:test-download");
  expect(document.body.contains(link)).toBe(false);
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  jest.runOnlyPendingTimers();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-download");
});
