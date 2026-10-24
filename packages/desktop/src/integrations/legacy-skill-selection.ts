import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { z } from "zod";

type AgentSkillSelection = { mode: "all" } | { mode: "custom"; skills: string[] };

const LEGACY_FILENAME = "skill-selection.json";
const LegacyDocumentSchema = z.strictObject({
  version: z.literal(1).optional(),
  selection: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("all") }),
    z.strictObject({ mode: z.literal("custom"), skills: z.array(z.string()) }),
  ]),
});

function parseSelection(value: unknown): AgentSkillSelection | null {
  const result = LegacyDocumentSchema.safeParse(value);
  if (!result.success) {
    throw new Error("Cannot migrate skill-selection.json; original data was retained");
  }
  const { selection } = result.data;
  if (selection.mode === "all") return { mode: "all" };
  return {
    mode: "custom",
    skills: [...new Set(selection.skills.map((name) => name.trim()).filter(Boolean))].sort(),
  };
}

function legacyPath(): string {
  return path.join(app.getPath("userData"), LEGACY_FILENAME);
}

// COMPAT(desktopSkillSelectionMigration): added in v0.4.0; remove after 2027-02-16.
export async function readLegacySkillSelection(): Promise<AgentSkillSelection | null> {
  const raw = await readFile(legacyPath(), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (raw === null) return null;
  try {
    return parseSelection(JSON.parse(raw));
  } catch {
    throw new Error("Cannot migrate skill-selection.json; original data was retained");
  }
}

// COMPAT(desktopSkillSelectionMigration): added in v0.4.0; remove after 2027-02-16.
export async function deleteLegacySkillSelection(): Promise<void> {
  await rm(legacyPath(), { force: true });
}
