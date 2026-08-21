import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSavedModelSelection,
  loadSavedModelSelection,
  saveModelSelection,
} from "./model-persistence";

describe("chat model selection persistence", () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
    });
  });

  afterEach(() => {
    storage.clear();
    vi.unstubAllGlobals();
  });

  it("returns null selection when nothing was saved", () => {
    expect(loadSavedModelSelection()).toEqual({ model: null, service: null });
  });

  it("round-trips a saved model + service", () => {
    saveModelSelection("deepseek-v4-flash", "kkaiapi");
    expect(loadSavedModelSelection()).toEqual({
      model: "deepseek-v4-flash",
      service: "kkaiapi",
    });
  });

  it("overwrites the previous selection on save", () => {
    saveModelSelection("model-a", "svc-a");
    saveModelSelection("model-b", "svc-b");
    expect(loadSavedModelSelection()).toEqual({ model: "model-b", service: "svc-b" });
  });

  it("clears the saved selection", () => {
    saveModelSelection("model-a", "svc-a");
    clearSavedModelSelection();
    expect(loadSavedModelSelection()).toEqual({ model: null, service: null });
  });

  it("tolerates corrupt persisted JSON", () => {
    storage.set("inkos.chat.model-selection", "{ not valid json");
    expect(loadSavedModelSelection()).toEqual({ model: null, service: null });
  });

  it("tolerates missing localStorage entirely", () => {
    vi.unstubAllGlobals();
    expect(loadSavedModelSelection()).toEqual({ model: null, service: null });
    expect(() => saveModelSelection("m", "s")).not.toThrow();
  });
});