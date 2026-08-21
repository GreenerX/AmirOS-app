export const PRODUCT_WALKTHROUGH_KEY = "amiros.product-walkthrough.v1";

export type ProductWalkthroughState = {
  version: 1;
  step: number;
  complete: boolean;
};

export function readProductWalkthrough(storage: Pick<Storage, "getItem"> = window.localStorage): ProductWalkthroughState | undefined {
  try {
    const value = JSON.parse(storage.getItem(PRODUCT_WALKTHROUGH_KEY) || "null") as Partial<ProductWalkthroughState> | null;
    if (!value || value.version !== 1 || typeof value.step !== "number" || typeof value.complete !== "boolean") return undefined;
    return { version: 1, step: Math.max(0, Math.min(4, Math.floor(value.step))), complete: value.complete };
  } catch {
    return undefined;
  }
}

export function saveProductWalkthrough(state: ProductWalkthroughState, storage: Pick<Storage, "setItem"> = window.localStorage) {
  const step = Math.max(0, Math.min(4, Math.floor(state.step)));
  storage.setItem(PRODUCT_WALKTHROUGH_KEY, JSON.stringify({ ...state, step }));
}
