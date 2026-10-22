import { ipcMain } from "electron";
import { executeSkillRepositoryJob } from "./execute.js";

export function registerSkillRepositoryIpc(): void {
  ipcMain.handle("paseo:skill-repository:execute", async (_event, raw: unknown) =>
    executeSkillRepositoryJob(raw),
  );
}
