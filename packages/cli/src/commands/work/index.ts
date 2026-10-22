import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { z } from "zod";
import {
  WorkCreateCardSchema,
  WorkCreateItemSchema,
  WorkUpdateCardSchema,
  WorkUpdateItemSchema,
  WorkListCardsSchema,
  WorkListItemsSchema,
  WorkListResultSchema,
  type WorkSelect,
  type WorkView,
} from "@getpaseo/protocol/work-objects";
import {
  withOutput,
  type CommandOptions,
  type OutputSchema,
  type SingleResult,
} from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { buildDaemonConnectionCommandError, connectToDaemon } from "../../utils/client.js";
import type { DaemonTarget } from "../../utils/daemon-target.js";

interface WorkOptions extends CommandOptions {
  daemonTarget: DaemonTarget;
  project?: string;
  input?: string;
  bodyFile?: string;
  file?: string;
  shared?: boolean;
  title?: string;
  body?: string;
  preset?: string;
  label?: string;
  goal?: string;
  basedOn?: string;
  viewerSource?: string;
  query?: string;
  archive?: string;
  order?: string;
  limit?: string;
  cursor?: string;
  sessionId?: string;
  sessionRelation?: string;
  startedAt?: string;
  endedAt?: string;
  archived?: boolean;
  completed?: boolean;
}
type WorkClient = Awaited<ReturnType<typeof connectToDaemon>>;
const FULL_SELECT: WorkSelect = [
  "timestamps",
  "touches",
  "sessions",
  "viewers",
  "progress",
  "metrics",
  "result",
  "config",
  "storage",
  "viewerEntries",
];
const schema: OutputSchema<unknown> = {
  idField: () => "",
  columns: [{ header: "WORK", field: (value) => JSON.stringify(value) }],
  renderHuman(result) {
    const listed = WorkListResultSchema.safeParse(result.data);
    if (!listed.success) return JSON.stringify(result.data, null, 2);
    const lines = listed.data.objects.map(
      (object) => `${object.id}\t${object.label}\t${object.title}`,
    );
    if (listed.data.nextCursor) lines.push(`Next cursor: ${listed.data.nextCursor}`);
    return ["ID\tTYPE\tTITLE", ...lines].join("\n");
  },
};

function command(parent: Command, name: string): Command {
  return addJsonAndDaemonHostOptions(
    parent.command(name).requiredOption("--project <project-id>", "Paseo project ID"),
  );
}
function mutationOptions(cmd: Command): Command {
  return cmd
    .option("--input <json-or-@file>", "Complete create/update input")
    .option("--title <text>")
    .option("--body <text>")
    .option("--body-file <path>")
    .option("--preset <preset>")
    .option("--label <label>")
    .option("--goal <name>")
    .option("--based-on <card>")
    .option("--viewer-source <card>")
    .option("--started-at <timestamp>")
    .option("--ended-at <timestamp>")
    .option("--archived")
    .option("--no-archived")
    .option("--completed")
    .option("--no-completed");
}
function listOptions(cmd: Command): Command {
  return cmd
    .option("--query <text>")
    .option("--label <label>")
    .option("--goal <name>")
    .option("--based-on <card>")
    .option("--session-id <agent>")
    .option("--session-relation <linked|touched|any>")
    .option("--archive <active|archived|all>")
    .option("--order <asc|desc>")
    .option("--limit <count>", "Read one page of this size")
    .option("--cursor <cursor>");
}
async function run(
  options: WorkOptions,
  execute: (client: WorkClient) => Promise<unknown>,
): Promise<SingleResult<unknown>> {
  const client = await connectToDaemon({ target: options.daemonTarget }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ target: options.daemonTarget, error });
  });
  try {
    if (!client.getLastServerInfoMessage()?.features?.works)
      throw new Error("Update the host to use Works");
    return { type: "single", data: await execute(client), schema };
  } finally {
    await client.close();
  }
}
async function input(options: WorkOptions): Promise<Record<string, unknown>> {
  let result: Record<string, unknown> = {};
  if (options.input) {
    const text = options.input.startsWith("@")
      ? await readFile(options.input.slice(1), "utf8")
      : options.input;
    result = z.record(z.string(), z.unknown()).parse(JSON.parse(text));
  }
  for (const key of [
    "title",
    "body",
    "preset",
    "label",
    "goal",
    "basedOn",
    "viewerSource",
    "startedAt",
    "endedAt",
    "archived",
  ] as const) {
    if (options[key] !== undefined) result[key] = options[key];
  }
  if (options.bodyFile) result.body = await readFile(options.bodyFile, "utf8");
  if (options.completed !== undefined)
    result.result = {
      ...z.record(z.string(), z.unknown()).parse(result.result ?? {}),
      completed: options.completed,
    };
  return result;
}
function context(options: WorkOptions) {
  return {
    projectId: projectId(options),
    callerAgentId: process.env.PASEO_AGENT_ID?.trim() || undefined,
  };
}
async function list(client: WorkClient, options: WorkOptions, parentCardId?: string) {
  const parsed = {
    query: options.query,
    label: options.label,
    goal: options.goal,
    basedOn: options.basedOn,
    sessionId: options.sessionId,
    sessionRelation: options.sessionRelation,
    archive: options.archive,
    order: options.order,
    limit: options.limit === undefined ? 100 : Number(options.limit),
    cursor: options.cursor,
  };
  const objects: WorkView[] = [];
  let nextCursor: string | null = options.cursor ?? null;
  do {
    const fields = { ...parsed, cursor: nextCursor ?? undefined };
    const page = parentCardId
      ? await client.listWorkItems({
          projectId: projectId(options),
          ...WorkListItemsSchema.parse({ ...fields, parentCardId }),
        })
      : await client.listWorkCards({
          projectId: projectId(options),
          ...WorkListCardsSchema.parse(fields),
        });
    objects.push(...page.objects);
    nextCursor = page.nextCursor;
  } while (nextCursor && options.limit === undefined && options.cursor === undefined);
  return { objects, nextCursor };
}

export function createWorkCommand(): Command {
  const work = new Command("work").description("Manage Works cards, items and results");
  const card = work.command("card").description("Experiments and topics");
  const item = work.command("item").description("Attempts and issues");
  listOptions(command(card, "ls")).action(
    withOutput(async (options: WorkOptions, _command: Command) =>
      run(options, (client) => list(client, options)),
    ),
  );
  listOptions(command(item, "ls").argument("<cardId>")).action(
    withOutput(async (cardId: string, options: WorkOptions, _command: Command) =>
      run(options, (client) => list(client, options, cardId)),
    ),
  );
  command(card, "show")
    .argument("<cardId>")
    .action(
      withOutput(async (cardId: string, options: WorkOptions, _command: Command) =>
        run(options, (client) =>
          client.getWorkCard({
            projectId: projectId(options),
            cardId,
            select: FULL_SELECT,
            allItems: true,
          }),
        ),
      ),
    );
  command(item, "show")
    .argument("<itemId>")
    .action(
      withOutput(async (itemId: string, options: WorkOptions, _command: Command) =>
        run(options, (client) =>
          client.getWorkItem({ projectId: projectId(options), itemId, select: FULL_SELECT }),
        ),
      ),
    );
  mutationOptions(command(card, "create")).action(
    withOutput(async (options: WorkOptions, _command: Command) => {
      const value = WorkCreateCardSchema.parse(await input(options));
      return run(options, (client) => client.createWorkCard({ ...value, ...context(options) }));
    }),
  );
  mutationOptions(command(item, "create").argument("<cardId>")).action(
    withOutput(async (cardId: string, options: WorkOptions, _command: Command) => {
      const value = WorkCreateItemSchema.parse({ ...(await input(options)), parentCardId: cardId });
      return run(options, (client) => client.createWorkItem({ ...value, ...context(options) }));
    }),
  );
  mutationOptions(command(card, "update").argument("<cardId>")).action(
    withOutput(async (cardId: string, options: WorkOptions, _command: Command) => {
      const value = WorkUpdateCardSchema.parse({ ...(await input(options)), cardId });
      return run(options, (client) => client.updateWorkCard({ ...value, ...context(options) }));
    }),
  );
  mutationOptions(command(item, "update").argument("<itemId>")).action(
    withOutput(async (itemId: string, options: WorkOptions, _command: Command) => {
      const value = WorkUpdateItemSchema.parse({ ...(await input(options)), itemId });
      return run(options, (client) => client.updateWorkItem({ ...value, ...context(options) }));
    }),
  );
  command(work, "storage")
    .argument("[objectId]")
    .option("--shared")
    .action(
      withOutput(async (objectId: string | undefined, options: WorkOptions, _command: Command) => {
        if (!options.shared && !objectId) throw new Error("Supply an object ID or --shared");
        return run(options, (client) =>
          client.getWorkStorage({
            projectId: projectId(options),
            objectId: options.shared ? undefined : objectId,
          }),
        );
      }),
    );
  command(work, "progress")
    .argument("<objectId>")
    .action(
      withOutput(async (objectId: string, options: WorkOptions, _command: Command) =>
        run(options, (client) =>
          client.refreshWorkProgress({ projectId: projectId(options), objectIds: [objectId] }),
        ),
      ),
    );
  const viewer = work.command("viewer").description("Viewer mounts and data sources");
  command(viewer, "ls")
    .argument("<objectId>")
    .action(
      withOutput(async (objectId: string, options: WorkOptions, _command: Command) =>
        run(options, (client) =>
          client.resolveWorkViewers({ projectId: projectId(options), objectId }),
        ),
      ),
    );
  command(viewer, "configure")
    .argument("<objectId>")
    .requiredOption("--file <path>", "Viewer patch JSON file")
    .action(
      withOutput(async (objectId: string, options: WorkOptions, _command: Command) => {
        const viewers: unknown = JSON.parse(await readFile(options.file!, "utf8"));
        return run(options, (client) =>
          objectId.startsWith("card_")
            ? client.updateWorkCard({
                ...context(options),
                ...WorkUpdateCardSchema.parse({ cardId: objectId, viewers }),
              })
            : client.updateWorkItem({
                ...context(options),
                ...WorkUpdateItemSchema.parse({ itemId: objectId, viewers }),
              }),
        );
      }),
    );
  return work;
}

function projectId(options: WorkOptions): string {
  return z.string().min(1).parse(options.project);
}
