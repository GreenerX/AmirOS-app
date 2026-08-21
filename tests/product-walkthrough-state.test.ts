import { describe, expect, it } from "vitest";
import { PRODUCT_WALKTHROUGH_KEY, readProductWalkthrough, saveProductWalkthrough } from "../ui/src/product-walkthrough-state.js";

function memoryStorage(initial?: string) {
  let value = initial;
  return {
    getItem: () => value ?? null,
    setItem: (_key: string, next: string) => { value = next; },
  };
}

describe("product walkthrough state", () => {
  it("keeps an unfinished guide resumable across a restart", () => {
    const storage = memoryStorage();
    saveProductWalkthrough({ version: 1, step: 3, complete: false }, storage);

    expect(JSON.parse(storage.getItem(PRODUCT_WALKTHROUGH_KEY)!)).toEqual({ version: 1, step: 3, complete: false });
    expect(readProductWalkthrough(storage)).toEqual({ version: 1, step: 3, complete: false });
  });

  it("rejects malformed or obsolete saved state", () => {
    expect(readProductWalkthrough(memoryStorage("not json"))).toBeUndefined();
    expect(readProductWalkthrough(memoryStorage(JSON.stringify({ version: 2, step: 0, complete: false })))).toBeUndefined();
  });

  it("bounds persisted steps to the five real tour screens", () => {
    const storage = memoryStorage();
    saveProductWalkthrough({ version: 1, step: 99, complete: false }, storage);

    expect(readProductWalkthrough(storage)).toEqual({ version: 1, step: 4, complete: false });
  });
});
