import { readFile } from "node:fs/promises";
import { Command } from "commander";
import {
  SkillRepositorySubscriptionSchema,
  type SkillRepositoryState,
} from "@getpaseo/protocol/skill-repositories";
import {
  withOutput,
  type CommandOptions,
  type CommandResult,
  type OutputSchema,
} from "../output/index.js";
import { addJsonAndDaemonHostOptions } from "../utils/command-options.js";
import { connectToDaemon } from "../utils/client.js";

const schema: OutputSchema<SkillRepositoryState> = {
  idField: (row) => row.subscription.repositoryId,
  columns: [
    { header: "ID", field: (row) => row.subscription.repositoryId },
    { header: "NAME", field: (row) => row.subscription.label },
    { header: "RECEIVE", field: (row) => row.subscription.autoReceive },
    { header: "WORKTREE", field: (row) => row.status?.worktree ?? "uninitialized" },
    { header: "PUBLICATION", field: (row) => row.status?.publication ?? "unknown" },
    { header: "ERROR", field: (row) => row.error ?? row.status?.syncError ?? "" },
  ],
};

async function run(
  operation: "ls" | "inspect" | "configure" | "sync" | "remove",
  target: string | undefined,
  options: CommandOptions,
): Promise<CommandResult<SkillRepositoryState>> {
  const client = await connectToDaemon({ target: options.daemonTarget });
  try {
    if (client.getLastServerInfoMessage()?.features?.skillRepositoryManagement !== true) {
      throw new Error("Update this host to manage skill repositories.");
    }
    const { repositories } = await client.getSkillRepositoryState();
    if (operation === "ls") return { type: "list", data: repositories, schema };
    if (operation === "configure") {
      const subscription = SkillRepositorySubscriptionSchema.parse(
        JSON.parse(await readFile(target!, "utf8")),
      );
      const current = repositories.find(
        (row) => row.subscription.repositoryId === subscription.repositoryId,
      );
      await client.configureSkillRepository({
        repositoryId: subscription.repositoryId,
        subscription,
        expected: current?.subscription ?? null,
      });
      const updated = (await client.getSkillRepositoryState()).repositories.find(
        (row) => row.subscription.repositoryId === subscription.repositoryId,
      );
      if (!updated) throw new Error("Subscription disappeared after configuration.");
      return { type: "single", data: updated, schema };
    }
    const current = repositories.find((row) => row.subscription.repositoryId === target);
    if (!current) throw new Error(`Unknown skill repository ${target}`);
    if (operation === "remove") {
      await client.configureSkillRepository({
        repositoryId: target!,
        subscription: null,
        expected: current.subscription,
      });
    }
    if (operation === "sync") {
      const result = await client.syncSkillRepository(target!, current.subscription);
      if (
        result.state === "failed" ||
        result.state === "unavailable" ||
        result.state === "needs_resolution"
      ) {
        throw new Error(result.error ?? `Skill repository sync: ${result.state}`);
      }
      const updated = (await client.getSkillRepositoryState()).repositories.find(
        (row) => row.subscription.repositoryId === target,
      );
      if (!updated) throw new Error("Subscription disappeared after synchronization.");
      return { type: "single", data: updated, schema };
    }
    return {
      type: "single",
      data: current,
      schema: { ...schema, renderHuman: () => JSON.stringify(current, null, 2) },
    };
  } finally {
    await client.close();
  }
}

export function createSkillRepositoryCommand(): Command {
  const command = new Command("skill-repository").description(
    "Manage this host's subscribed skill repositories",
  );
  addJsonAndDaemonHostOptions(
    command.command("ls").description("List subscriptions and last observed Git state"),
  ).action(
    withOutput((options: CommandOptions, _command: Command) => run("ls", undefined, options)),
  );
  addJsonAndDaemonHostOptions(
    command
      .command("configure")
      .argument("<file>")
      .description("Apply a subscription JSON file; credentials stay on clients"),
  ).action(
    withOutput((file: string, options: CommandOptions, _command: Command) =>
      run("configure", file, options),
    ),
  );
  for (const operation of ["inspect", "sync", "remove"] as const) {
    addJsonAndDaemonHostOptions(command.command(operation).argument("<repository-id>")).action(
      withOutput((id: string, options: CommandOptions, _command: Command) =>
        run(operation, id, options),
      ),
    );
  }
  return command;
}
