import AsyncStorage from "@react-native-async-storage/async-storage";
import { readValidatedJson } from "@/storage/validated-storage";
import { mergeStoredEdits, parseStoredValue } from "@/storage/persisted-value";
import {
  FormPreferencesSchema,
  StoredFormPreferencesSchema,
  type FormPreferences,
} from "./preferences";

export const CREATE_AGENT_PREFERENCES_STORAGE_KEY = "@paseo:create-agent-preferences";

export interface CreateAgentPreferenceStorage {
  read(): Promise<unknown>;
  write(preferences: FormPreferences): Promise<void>;
}

export class AsyncStorageCreateAgentPreferenceStorage implements CreateAgentPreferenceStorage {
  async read(): Promise<unknown> {
    return readValidatedJson(
      AsyncStorage,
      CREATE_AGENT_PREFERENCES_STORAGE_KEY,
      StoredFormPreferencesSchema,
    );
  }

  async write(preferences: FormPreferences): Promise<void> {
    const result = FormPreferencesSchema.safeParse(preferences);
    if (!result.success) {
      throw new Error(`Invalid preferences for ${CREATE_AGENT_PREFERENCES_STORAGE_KEY}`);
    }
    const raw = await AsyncStorage.getItem(CREATE_AGENT_PREFERENCES_STORAGE_KEY);
    let next: unknown = result.data;
    if (raw !== null) {
      let decoded: unknown;
      try {
        decoded = JSON.parse(raw);
      } catch {
        throw new Error(
          `Cannot read saved ${CREATE_AGENT_PREFERENCES_STORAGE_KEY}; original data was retained`,
        );
      }
      const previous = parseStoredValue(
        StoredFormPreferencesSchema,
        decoded,
        CREATE_AGENT_PREFERENCES_STORAGE_KEY,
      );
      next = mergeStoredEdits(decoded, previous, result.data);
    }
    await AsyncStorage.setItem(CREATE_AGENT_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
  }
}
