import { expect, test, vi, beforeEach } from "vitest";

let getPaginationLimit: any;
let savePaginationLimit: any;
let hasPaginationLimit: any;
let mockGet: any;
let mockSet: any;

beforeEach(async () => {
  vi.resetModules();

  vi.doMock("../src/api/local", () => ({
    default: {
      getValue: vi.fn(),
      setValue: vi.fn(),
    },
  }));

  const storage = await import("../src/api/local");
  const mocked = storage.default as unknown as {
    getValue: ReturnType<typeof vi.fn>;
    setValue: ReturnType<typeof vi.fn>;
  };
  mockGet = mocked.getValue;
  mockSet = mocked.setValue;

  const listing = await import("../src/composables/listing");
  getPaginationLimit = listing.getPaginationLimit;
  savePaginationLimit = listing.savePaginationLimit;
  hasPaginationLimit = listing.hasPaginationLimit;
});

///////////////////////////////////////////////////////////////////////////////
// getPaginationLimit test
///////////////////////////////////////////////////////////////////////////////

test("returns default 20 when storage empty", () => {
  mockGet.mockReturnValue(null);
  expect(getPaginationLimit()).toBe(20);
});

test("reads primary pagination limit", () => {
  mockGet.mockReturnValue({ paginationLimit: 50 });
  expect(getPaginationLimit()).toBe(50);
});

test("reads secondary pagination limit when media=true", () => {
  mockGet.mockReturnValue({ paginationLimitSecondary: 7 });
  expect(getPaginationLimit(true)).toBe(7);
});

test("falls back to default when key missing", () => {
  mockGet.mockReturnValue({});
  expect(getPaginationLimit()).toBe(20);
});

///////////////////////////////////////////////////////////////////////////////
// savePaginationLimit test
///////////////////////////////////////////////////////////////////////////////

test("creates filter object when none exists", () => {
  mockGet.mockReturnValue(null);

  savePaginationLimit(25);

  expect(mockSet).toHaveBeenCalledWith("filters", {
    paginationLimit: 25,
  });
});

test("updates primary value and preserves others", () => {
  mockGet.mockReturnValue({ paginationLimitSecondary: 5 });

  savePaginationLimit(40);

  expect(mockSet).toHaveBeenCalledWith("filters", {
    paginationLimitSecondary: 5,
    paginationLimit: 40,
  });
});

test("updates secondary value when media=true", () => {
  mockGet.mockReturnValue({ paginationLimit: 10 });

  savePaginationLimit(3, true);

  expect(mockSet).toHaveBeenCalledWith("filters", {
    paginationLimit: 10,
    paginationLimitSecondary: 3,
  });
});

///////////////////////////////////////////////////////////////////////////////
// hasPaginationLimit test
///////////////////////////////////////////////////////////////////////////////

test("returns false when no filters exist", () => {
  mockGet.mockReturnValue(null);
  expect(hasPaginationLimit()).toBe(false);
});

test("returns false when key missing", () => {
  mockGet.mockReturnValue({});
  expect(hasPaginationLimit()).toBe(false);
});

test("returns true when primary exists", () => {
  mockGet.mockReturnValue({ paginationLimit: 10 });
  expect(hasPaginationLimit()).toBe(true);
});

test("returns true when secondary exists", () => {
  mockGet.mockReturnValue({ paginationLimitSecondary: 10 });
  expect(hasPaginationLimit(true)).toBe(true);
});
