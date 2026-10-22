import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

interface TabDisplayState {
  vertical: boolean;
  toggle(): void;
}
export const useTabDisplay = create<TabDisplayState>()(
  persist(
    (set) => ({ vertical: false, toggle: () => set((state) => ({ vertical: !state.vertical })) }),
    {
      name: "paseo:tab-display",
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, z.object({ vertical: z.boolean() })),
      partialize: (state) => ({ vertical: state.vertical }),
    },
  ),
);
