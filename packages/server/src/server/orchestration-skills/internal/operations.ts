import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentSkillSelection } from "@getpaseo/protocol/messages";
import { removeSkill, syncSkills } from "./sync.js";

export type SkillsState = "not-installed" | "up-to-date" | "drift";

export type SkillOp =
  | { kind: "add"; name: string }
  | { kind: "update"; name: string }
  | { kind: "delete"; name: string };

/** What the user asked to have installed. `all` follows the bundle as it grows. */
export type SkillSelection = AgentSkillSelection;

export interface SkillsStatus {
  state: SkillsState;
  ops: SkillOp[];
  /** Every skill the bundle currently ships, sorted. The selectable catalog. */
  available: string[];
  /**
   * Managed skills with a directory in at least one agent home, sorted. An `add`
   * op means "missing from every target".
   */
  installed: string[];
}

export interface SkillTargets {
  sourceDir: string;
  agentsDir: string;
  claudeDir: string;
  codexDir: string;
}

// Names the bundle used to ship. They are never selectable, but every scan still
// covers them so an older install's copies get cleaned up.
export const LEGACY_SKILL_NAMES = [
  "paseo-chat",
  "paseo-epic",
  "paseo-orchestrate",
  "paseo-orchestrator",
] as const;

type TargetSkills = Set<string>;

/**
 * The bundle directory is the catalog. Reading it instead of a hardcoded list is
 * what makes `all` pick up skills added in a later release with no code change.
 */
async function listBundledSkills(sourceDir: string): Promise<string[]> {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareStrings);
}

/** Every name Paseo owns on disk: what it ships now plus what it used to ship. */
function managedSkillNames(available: readonly string[]): string[] {
  return [...new Set([...available, ...LEGACY_SKILL_NAMES])].sort(compareStrings);
}

/** The names a convergence may manage. */
export async function listManagedSkillNames(sourceDir: string): Promise<string[]> {
  return managedSkillNames(await listBundledSkills(sourceDir));
}

function resolveDesiredSkills(
  selection: SkillSelection,
  available: readonly string[],
): Set<string> {
  if (selection.mode === "all") return new Set(available);
  const chosen = new Set(selection.skills);
  return new Set(available.filter((name) => chosen.has(name)));
}

async function findInstalledSkills(
  rootDir: string,
  names: readonly string[],
): Promise<TargetSkills> {
  const out: TargetSkills = new Set();
  for (const name of names) {
    const stat = await fs.stat(path.join(rootDir, name)).catch(() => null);
    if (stat?.isDirectory()) out.add(name);
  }
  return out;
}

function diff(
  disks: readonly TargetSkills[],
  names: readonly string[],
  desired: ReadonlySet<string>,
): SkillOp[] {
  const ops: SkillOp[] = [];
  for (const name of names) {
    const installed = disks.some((disk) => disk.has(name));
    if (desired.has(name)) {
      if (!installed) ops.push({ kind: "add", name });
    } else if (installed) {
      ops.push({ kind: "delete", name });
    }
  }
  ops.sort((a, b) => compareStrings(a.name, b.name));
  return ops;
}

function hasInstalledPaseoSkill(disks: readonly TargetSkills[]): boolean {
  return disks.some((disk) => disk.size > 0);
}

function installedSkillNames(disks: readonly TargetSkills[], names: readonly string[]): string[] {
  return names.filter((name) => disks.some((disk) => disk.has(name)));
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

async function isInstalledAnywhere(targets: SkillTargets, name: string): Promise<boolean> {
  const stats = await Promise.all(
    [targets.agentsDir, targets.claudeDir, targets.codexDir].map((rootDir) =>
      fs.stat(path.join(rootDir, name)).catch(() => null),
    ),
  );
  return stats.some((stat) => stat?.isDirectory());
}

export async function getSkillsStatus(
  targets: SkillTargets,
  selection: SkillSelection,
): Promise<SkillsStatus> {
  const available = await listBundledSkills(targets.sourceDir);
  const names = managedSkillNames(available);
  const [agentsDisk, claudeDisk, codexDisk] = await Promise.all([
    findInstalledSkills(targets.agentsDir, names),
    findInstalledSkills(targets.claudeDir, names),
    findInstalledSkills(targets.codexDir, names),
  ]);
  const disks = [agentsDisk, claudeDisk, codexDisk];
  const ops = diff(disks, names, resolveDesiredSkills(selection, available));
  const installed = installedSkillNames(disks, names);

  if (!hasInstalledPaseoSkill(disks)) return { state: "not-installed", ops, available, installed };
  if (ops.length === 0) return { state: "up-to-date", ops, available, installed };
  return { state: "drift", ops, available, installed };
}

async function applySkills(
  targets: SkillTargets,
  selection: SkillSelection,
  initialStatus?: SkillsStatus,
): Promise<SkillsStatus> {
  const status = initialStatus ?? (await getSkillsStatus(targets, selection));

  const writes: string[] = [];
  for (const op of status.ops) {
    if (op.kind === "update") {
      writes.push(op.name);
      continue;
    }
    if (op.kind !== "add") continue;
    if (!(await isInstalledAnywhere(targets, op.name))) writes.push(op.name);
  }
  if (writes.length > 0) {
    await syncSkills({
      sourceDir: targets.sourceDir,
      agentsDir: targets.agentsDir,
      claudeDir: targets.claudeDir,
      codexDir: targets.codexDir,
      skillNames: writes,
    });
  }

  for (const op of status.ops) {
    if (op.kind !== "delete") continue;
    await removeSkill(op.name, {
      agentsDir: targets.agentsDir,
      claudeDir: targets.claudeDir,
      codexDir: targets.codexDir,
    });
  }

  return getSkillsStatus(targets, selection);
}

export async function installSkills(
  targets: SkillTargets,
  selection: SkillSelection,
  /** Apply exactly this plan instead of rescanning, so a confirmed plan is the applied plan. */
  plan?: SkillsStatus,
): Promise<SkillsStatus> {
  return applySkills(targets, selection, plan);
}

export async function updateSkills(
  targets: SkillTargets,
  selection: SkillSelection,
): Promise<SkillsStatus> {
  const status = await getSkillsStatus(targets, selection);
  return applySkills(targets, selection, nonDestructivePlan(status));
}

function nonDestructivePlan(status: SkillsStatus): SkillsStatus {
  return { ...status, ops: status.ops.filter((op) => op.kind !== "delete") };
}

export async function autoUpdateInstalledSkills(
  targets: SkillTargets,
  selection: SkillSelection,
): Promise<SkillsStatus> {
  const status = await getSkillsStatus(targets, selection);
  if (status.state !== "drift") return status;
  // Automatic maintenance may install absent selected names, but it never
  // rewrites an existing same-named directory or removes user files.
  return applySkills(targets, selection, nonDestructivePlan(status));
}

export async function uninstallSkills(
  targets: SkillTargets,
  selection: SkillSelection,
): Promise<SkillsStatus> {
  const available = await listBundledSkills(targets.sourceDir);
  for (const name of managedSkillNames(available)) {
    await removeSkill(name, {
      agentsDir: targets.agentsDir,
      claudeDir: targets.claudeDir,
      codexDir: targets.codexDir,
    });
  }
  return getSkillsStatus(targets, selection);
}
