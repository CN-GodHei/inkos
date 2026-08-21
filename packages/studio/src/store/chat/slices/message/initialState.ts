import type { MessageState } from "../../types";
import { loadSavedModelSelection } from "../../model-persistence";

export const initialMessageState: MessageState = {
  sessions: {},
  sessionIdsByBook: {},
  activeSessionId: null,
  input: "",
  ...(() => {
    const saved = loadSavedModelSelection();
    return {
      selectedModel: saved.model,
      selectedService: saved.service,
    };
  })(),
};
