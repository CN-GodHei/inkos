const MODEL_SELECTION_KEY = "inkos.chat.model-selection";

export interface SavedModelSelection {
  readonly model: string | null;
  readonly service: string | null;
}

function hasLocalStorage(): boolean {
  return typeof globalThis !== "undefined"
    && typeof globalThis.localStorage !== "undefined"
    && typeof globalThis.localStorage.getItem === "function";
}

export function loadSavedModelSelection(): SavedModelSelection {
  if (!hasLocalStorage()) return { model: null, service: null };
  try {
    const raw = globalThis.localStorage.getItem(MODEL_SELECTION_KEY);
    if (!raw) return { model: null, service: null };
    const parsed = JSON.parse(raw) as Partial<SavedModelSelection>;
    return {
      model: typeof parsed.model === "string" ? parsed.model : null,
      service: typeof parsed.service === "string" ? parsed.service : null,
    };
  } catch {
    return { model: null, service: null };
  }
}

export function saveModelSelection(model: string, service: string): void {
  if (!hasLocalStorage()) return;
  try {
    globalThis.localStorage.setItem(
      MODEL_SELECTION_KEY,
      JSON.stringify({ model, service }),
    );
  } catch {
    // Persistence is best-effort; a blocked storage must not break chat.
  }
}

export function clearSavedModelSelection(): void {
  if (!hasLocalStorage()) return;
  try {
    globalThis.localStorage.removeItem(MODEL_SELECTION_KEY);
  } catch {
    // best-effort
  }
}