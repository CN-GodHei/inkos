import { create } from "zustand";
import type { ChatStore } from "./types";
import { initialChatState } from "./initialState";
import { createMessageSlice } from "./slices/message/action";
import { createCreateSlice } from "./slices/create/action";
import { syncSavedModelSelectionToServer } from "./model-persistence";

export const useChatStore = create<ChatStore>()((...a) => ({
  ...initialChatState,
  ...createMessageSlice(...a),
  ...createCreateSlice(...a),
}));

// Make the persisted chat model selection the server-wide default so pipeline
// operations (writing, imitation, spinoff, canon import) use the same model.
void syncSavedModelSelectionToServer();
