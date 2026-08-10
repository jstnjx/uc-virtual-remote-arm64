import { expect, test } from "vitest";
import { reactive, ref } from "vue";
import { deepClone, useDataHelper } from "../src/composables/dataHelper";
const { updateExistingObjectKeys, objectsDeepEqual } = useDataHelper();

///////////////////////////////////////////////////////////////////////////////
// deepClone tests
///////////////////////////////////////////////////////////////////////////////

test("deepClone: plain values, preserving undefined and Date/Map/Set", () => {
  const source = {
    a: 1,
    b: undefined,
    when: new Date("2020-01-02T03:04:05.000Z"),
    map: new Map([["k", 1]]),
    set: new Set([1, 2]),
    list: [{ x: 1 }],
  };
  const copy = deepClone(source);

  expect(copy).toEqual(source);
  expect("b" in copy).toBe(true);
  expect(copy.when).toBeInstanceOf(Date);
  expect(copy.map).toBeInstanceOf(Map);
  expect(copy.set).toBeInstanceOf(Set);
  expect(copy.list).not.toBe(source.list);
  expect(copy.list[0]).not.toBe(source.list[0]);
});

test("deepClone: strips a top-level reactive proxy", () => {
  const source = reactive({ a: 1, nested: { b: 2 } });
  const copy = deepClone(source);

  expect(copy).toEqual({ a: 1, nested: { b: 2 } });
  copy.nested.b = 99;
  expect(source.nested.b).toBe(2);
});

// The real-world failure: a plain object assembled from reactive store data
// holds a proxy in a nested property (CommandSelect builds `{ cmd, entity }`
// with `entity` read off the reactive activity). `toRaw` on the outer value
// does not reach it, and `structuredClone` throws DataCloneError on any Proxy.
test("deepClone: strips reactive proxies held in nested properties", () => {
  const store = reactive({
    included_entities: [{ entity_id: "media_player.tv", name: { en: "TV" } }],
  });
  const command = {
    id: "media_player.tv:on",
    cmd: { cmd_id: "on", name: { en: "On" } },
    entity: store.included_entities[0],
  };

  const copy = deepClone(command);

  expect(copy).toEqual({
    id: "media_player.tv:on",
    cmd: { cmd_id: "on", name: { en: "On" } },
    entity: { entity_id: "media_player.tv", name: { en: "TV" } },
  });
  copy.entity.name.en = "changed";
  expect(store.included_entities[0].name.en).toBe("TV");
});

test("deepClone: strips reactive proxies nested inside arrays", () => {
  const store = reactive({ item: { size: { width: 1 } } });
  const list = [{ wrapped: store.item }];

  const copy = deepClone(list);

  expect(copy).toEqual([{ wrapped: { size: { width: 1 } } }]);
  copy[0].wrapped.size.width = 4;
  expect(store.item.size.width).toBe(1);
});

test("deepClone: unwraps refs held in nested properties", () => {
  const inner = ref({ value_holder: 1 });
  const source = { nested: { list: [inner.value] } };

  const copy = deepClone(source);

  expect(copy).toEqual({ nested: { list: [{ value_holder: 1 }] } });
});

test("deepClone: survives cyclic structures", () => {
  const source: Record<string, unknown> = { a: 1 };
  source.self = source;

  const copy = deepClone(source) as Record<string, unknown>;

  expect(copy.a).toBe(1);
  expect(copy.self).toBe(copy);
});

///////////////////////////////////////////////////////////////////////////////
// updateExistingObjectKeys basic tests
///////////////////////////////////////////////////////////////////////////////

test("updates existing keys", () => {
  const target = { a: 1, b: 2 };
  const updates = { b: 3 };
  const result = updateExistingObjectKeys(target, updates);
  expect(result).toEqual({ a: 1, b: 3 });
});

test("recursively updates nested objects", () => {
  const target = { a: { x: 1, y: 2 }, b: 5 };
  const updates = { a: { y: 99 } };
  const result = updateExistingObjectKeys(target, updates);
  expect(result).toEqual({ a: { x: 1, y: 99 }, b: 5 });
});

///////////////////////////////////////////////////////////////////////////////
// updateExistingObjectKeys add mode tests
///////////////////////////////////////////////////////////////////////////////

test("adds new keys when add=true", () => {
  const target = { a: 1 };
  const updates = { b: 2 };
  const result = updateExistingObjectKeys(target, updates, true);
  expect(result).toEqual({ a: 1, b: 2 });
});

test("does not add new keys when add=false", () => {
  const target = { a: 1 };
  const updates = { b: 2 };
  const result = updateExistingObjectKeys(target, updates, false);
  expect(result).toEqual({ a: 1 });
});

///////////////////////////////////////////////////////////////////////////////
// updateExistingObjectKeys edge case tests
///////////////////////////////////////////////////////////////////////////////

test("ignores null or undefined target", () => {
  expect(updateExistingObjectKeys(null as any, { a: 1 })).toBeNull();
  expect(updateExistingObjectKeys(undefined as any, { a: 1 })).toBeUndefined();
});

test("ignores null or undefined updates", () => {
  const target = { a: 1 };
  expect(updateExistingObjectKeys(target, null as any)).toEqual({ a: 1 });
  expect(updateExistingObjectKeys(target, undefined as any)).toEqual({ a: 1 });
});

test("handles nested null values correctly", () => {
  const target = { a: { b: 1 } };
  const updates = { a: null };
  const result = updateExistingObjectKeys(target, updates);
  expect(result).toEqual({ a: null });
});

test("deep-copies added nested objects (add=true) rather than sharing refs", () => {
  const nested = { x: 1 };
  const target: Record<string, unknown> = {};
  const updates = { a: nested };
  const result = updateExistingObjectKeys(target, updates, true) as {
    a: { x: number };
  };
  expect(result).toEqual({ a: { x: 1 } });
  // Mutating the source must not leak into the copied branch.
  nested.x = 99;
  expect(result.a.x).toBe(1);
});

///////////////////////////////////////////////////////////////////////////////
// objectsDeepEqual tests
///////////////////////////////////////////////////////////////////////////////

test("objectsDeepEqual: equal primitives and identical refs", () => {
  expect(objectsDeepEqual(1, 1)).toBe(true);
  expect(objectsDeepEqual("a", "a")).toBe(true);
  const ref = { a: 1 };
  expect(objectsDeepEqual(ref, ref)).toBe(true);
});

test("objectsDeepEqual: deep structural equality", () => {
  expect(objectsDeepEqual({ a: { b: [1, 2] } }, { a: { b: [1, 2] } })).toBe(
    true,
  );
});

test("objectsDeepEqual: differing values and key counts", () => {
  expect(objectsDeepEqual({ a: 1 }, { a: 2 })).toBe(false);
  expect(objectsDeepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  expect(objectsDeepEqual({ a: 1 }, { b: 1 })).toBe(false);
});

test("objectsDeepEqual: null vs object and primitive vs object", () => {
  expect(objectsDeepEqual(null, { a: 1 })).toBe(false);
  expect(objectsDeepEqual({ a: 1 }, null)).toBe(false);
  expect(objectsDeepEqual(1, { a: 1 })).toBe(false);
  expect(objectsDeepEqual(null, null)).toBe(true);
});
