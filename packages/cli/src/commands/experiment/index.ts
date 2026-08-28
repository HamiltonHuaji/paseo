import { readFile } from "node:fs/promises";
import { Command } from "commander";
import {
  ProgressPlanSetSchema,
  ProgressSourceSchema,
  ViewerConfigSchema,
  type ExperimentAttempt,
  type ExperimentRecord,
} from "@getpaseo/protocol/experiments";
import {
  withOutput,
  type CommandOptions,
  type ListResult,
  type OutputSchema,
  type SingleResult,
} from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { buildDaemonConnectionCommandError, connectToDaemon } from "../../utils/client.js";

interface ExperimentOptions extends CommandOptions {
  project?: string;
}

const experimentSchema: OutputSchema<ExperimentRecord> = {
  idField: "id",
  columns: [
    { header: "EXPERIMENT", field: "id", width: 14 },
    { header: "GOAL", field: (value) => value.goal ?? "", width: 22 },
    { header: "SUMMARY", field: "shortDescription", width: 48 },
    { header: "CLOSED", field: (value) => (value.closedAt ? "yes" : ""), width: 8 },
  ],
};

const attemptSchema: OutputSchema<ExperimentAttempt> = {
  idField: "id",
  columns: [
    { header: "ATTEMPT", field: "id", width: 14 },
    { header: "SUMMARY", field: "shortDescription", width: 42 },
    { header: "JOB", field: (value) => value.jobId ?? "", width: 18 },
    {
      header: "PROGRESS",
      field: (value) =>
        value.progress
          ? `${value.progress.current}/${value.progress.total ?? "?"}${value.progress.ended ? " done" : ""}`
          : "",
      width: 22,
    },
  ],
};

const opaqueSchema: OutputSchema<unknown> = {
  idField: () => "",
  columns: [{ header: "VALUE", field: (value) => JSON.stringify(value), width: 100 }],
};

function withProject(command: Command): Command {
  return command.requiredOption("--project <project-id>", "Paseo project id");
}

async function connect(options: ExperimentOptions) {
  return connectToDaemon({ host: options.host }).catch((error: unknown) => {
    throw buildDaemonConnectionCommandError({ host: options.host, error });
  });
}

function requireText(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requireProject(options: ExperimentOptions): string {
  return requireText(options.project, "--project");
}

export function resolveExperimentCallerAgentId(
  env: { PASEO_AGENT_ID?: string } = process.env,
): string | undefined {
  const callerAgentId = env.PASEO_AGENT_ID?.trim();
  return callerAgentId || undefined;
}

async function parseJsonOption<T>(
  value: string | undefined,
  schema: { parse(value: unknown): T },
): Promise<T | undefined> {
  if (!value) return undefined;
  const text = value.startsWith("@") ? await readFile(value.slice(1), "utf8") : value;
  return schema.parse(JSON.parse(text));
}

function resolveStorageTarget(
  projectId: string,
  experimentId: string | undefined,
  options: { attempt?: string; shared?: boolean },
) {
  if (options.shared) return { scope: "shared", projectId } as const;
  if (options.attempt) return { scope: "attempt", projectId, attempt: options.attempt } as const;
  if (experimentId) return { scope: "experiment", projectId, experiment: experimentId } as const;
  return null;
}

export function createExperimentCommand(): Command {
  const experiment = new Command("experiment").description(
    "Track project Experiments and Attempts",
  );

  addJsonAndDaemonHostOptions(
    withProject(
      experiment
        .command("ls")
        .description("List Experiments")
        .option("--goal <name>", "Filter by Goal name")
        .option("--closed", "Include closed Experiments")
        .option("--archived", "Include archived Experiments"),
    ),
  ).action(
    withOutput(
      async (
        options: ExperimentOptions & { goal?: string; closed?: boolean; archived?: boolean },
        _command: Command,
      ): Promise<ListResult<ExperimentRecord>> => {
        const client = await connect(options);
        try {
          const result = await client.listExperiments({
            projectId: requireProject(options),
            ...(options.goal ? { goal: options.goal } : {}),
            includeClosed: options.closed ?? false,
            includeArchived: options.archived ?? false,
          });
          return { type: "list", data: result.experiments, schema: experimentSchema };
        } finally {
          await client.close();
        }
      },
    ),
  );

  addJsonAndDaemonHostOptions(
    withProject(
      experiment
        .command("close")
        .description("Record an Experiment conclusion")
        .argument("<experiment>")
        .requiredOption("--conclusion <text>"),
    ),
  ).action(
    withOutput(
      async (
        experimentId: string,
        options: ExperimentOptions & { conclusion?: string },
        _command: Command,
      ): Promise<SingleResult<ExperimentRecord>> => {
        const client = await connect(options);
        try {
          const callerAgentId = resolveExperimentCallerAgentId();
          const result = await client.updateExperiment({
            projectId: requireProject(options),
            experiment: experimentId,
            conclusion: requireText(options.conclusion, "--conclusion"),
            ...(callerAgentId ? { callerAgentId } : {}),
          });
          return { type: "single", data: result.experiment, schema: experimentSchema };
        } finally {
          await client.close();
        }
      },
    ),
  );

  addJsonAndDaemonHostOptions(
    withProject(
      experiment.command("show").description("Show an Experiment").argument("<experiment>"),
    ),
  ).action(
    withOutput(
      async (
        experimentId: string,
        options: ExperimentOptions,
        _command: Command,
      ): Promise<SingleResult<unknown>> => {
        const client = await connect(options);
        try {
          const result = await client.getExperiment({
            projectId: requireProject(options),
            experiment: experimentId,
          });
          return { type: "single", data: result.detail, schema: opaqueSchema };
        } finally {
          await client.close();
        }
      },
    ),
  );

  addJsonAndDaemonHostOptions(
    withProject(
      experiment
        .command("create")
        .description("Create an Experiment")
        .requiredOption("--summary <text>")
        .requiredOption("--description <text>")
        .option("--goal <name>")
        .option("--based-on <experiment>")
        .option("--viewer-source <experiment>"),
    ),
  ).action(
    withOutput(
      async (
        options: ExperimentOptions & {
          summary?: string;
          description?: string;
          goal?: string;
          basedOn?: string;
          viewerSource?: string;
        },
        _command: Command,
      ): Promise<SingleResult<ExperimentRecord>> => {
        const client = await connect(options);
        try {
          const callerAgentId = resolveExperimentCallerAgentId();
          const result = await client.createExperiment({
            projectId: requireProject(options),
            shortDescription: requireText(options.summary, "--summary"),
            description: requireText(options.description, "--description"),
            ...(options.goal ? { goal: options.goal } : {}),
            ...(options.basedOn ? { basedOn: options.basedOn } : {}),
            ...(options.viewerSource ? { viewerSource: options.viewerSource } : {}),
            ...(callerAgentId ? { callerAgentId } : {}),
          });
          return { type: "single", data: result.experiment, schema: experimentSchema };
        } finally {
          await client.close();
        }
      },
    ),
  );

  const attempt = new Command("attempt").description("Manage concrete Attempts");
  experiment.addCommand(attempt);

  addJsonAndDaemonHostOptions(
    withProject(
      attempt
        .command("add")
        .argument("<experiment>")
        .requiredOption("--summary <text>")
        .requiredOption("--purpose <text>")
        .option("--wandb-id <id>")
        .option("--job-id <id>")
        .option("--output-dir <path>")
        .option("--result <text>")
        .option("--progress-plan <json-or-@file>")
        .option("--progress-source <json-or-@file>"),
    ),
  ).action(
    withOutput(
      async (
        experimentId: string,
        options: ExperimentOptions & {
          summary?: string;
          purpose?: string;
          wandbId?: string;
          jobId?: string;
          outputDir?: string;
          result?: string;
          progressPlan?: string;
          progressSource?: string;
        },
        _command: Command,
      ): Promise<SingleResult<ExperimentAttempt>> => {
        const client = await connect(options);
        try {
          const callerAgentId = resolveExperimentCallerAgentId();
          const progressPlans = await parseJsonOption(options.progressPlan, ProgressPlanSetSchema);
          const progressSource = await parseJsonOption(
            options.progressSource,
            ProgressSourceSchema,
          );
          const result = await client.createExperimentAttempt({
            projectId: requireProject(options),
            experiment: experimentId,
            shortDescription: requireText(options.summary, "--summary"),
            purpose: requireText(options.purpose, "--purpose"),
            ...(options.result ? { resultSummary: options.result } : {}),
            ...(options.wandbId ? { wandbId: options.wandbId } : {}),
            ...(options.jobId ? { jobId: options.jobId } : {}),
            ...(options.outputDir ? { outputDir: options.outputDir } : {}),
            ...(progressPlans ? { progressPlans } : {}),
            ...(progressSource ? { progressSource } : {}),
            ...(callerAgentId ? { callerAgentId } : {}),
          });
          return { type: "single", data: result.attempt, schema: attemptSchema };
        } finally {
          await client.close();
        }
      },
    ),
  );

  addJsonAndDaemonHostOptions(
    withProject(attempt.command("progress").argument("<attempt>")),
  ).action(
    withOutput(
      async (
        attemptId: string,
        options: ExperimentOptions,
        _command: Command,
      ): Promise<SingleResult<unknown>> => {
        const client = await connect(options);
        try {
          const result = await client.refreshExperimentProgress({
            projectId: requireProject(options),
            attempt: attemptId,
          });
          return { type: "single", data: result, schema: opaqueSchema };
        } finally {
          await client.close();
        }
      },
    ),
  );

  addJsonAndDaemonHostOptions(
    withProject(
      attempt
        .command("finish")
        .description("Record an Attempt result")
        .argument("<attempt>")
        .requiredOption("--result <text>"),
    ),
  ).action(
    withOutput(
      async (
        attemptId: string,
        options: ExperimentOptions & { result?: string },
        _command: Command,
      ): Promise<SingleResult<ExperimentAttempt>> => {
        const client = await connect(options);
        try {
          const callerAgentId = resolveExperimentCallerAgentId();
          const result = await client.updateExperimentAttempt({
            projectId: requireProject(options),
            attempt: attemptId,
            resultSummary: requireText(options.result, "--result"),
            ...(callerAgentId ? { callerAgentId } : {}),
          });
          return { type: "single", data: result.attempt, schema: attemptSchema };
        } finally {
          await client.close();
        }
      },
    ),
  );

  addJsonAndDaemonHostOptions(
    withProject(
      experiment
        .command("storage")
        .argument("[experiment]")
        .option("--attempt <attempt>")
        .option("--shared"),
    ),
  ).action(
    withOutput(
      async (
        experimentId: string | undefined,
        options: ExperimentOptions & { attempt?: string; shared?: boolean },
        _command: Command,
      ): Promise<SingleResult<{ path: string }>> => {
        const client = await connect(options);
        try {
          const target = resolveStorageTarget(requireProject(options), experimentId, options);
          if (!target) throw new Error("Choose --shared, an Experiment, or --attempt");
          const result = await client.resolveExperimentStorage(target);
          return {
            type: "single",
            data: { path: result.path },
            schema: { idField: "path", columns: [{ header: "PATH", field: "path", width: 80 }] },
          };
        } finally {
          await client.close();
        }
      },
    ),
  );

  const viewer = new Command("viewer").description("Configure static viewers");
  experiment.addCommand(viewer);
  addJsonAndDaemonHostOptions(
    withProject(
      viewer
        .command("configure")
        .argument("<target>", "Experiment or Attempt handle")
        .option("--config <json-or-@file>")
        .option("--clear", "Remove local configuration and restore inheritance"),
    ),
  ).action(
    withOutput(
      async (
        target: string,
        options: ExperimentOptions & { config?: string; clear?: boolean },
        _command: Command,
      ): Promise<SingleResult<unknown>> => {
        const client = await connect(options);
        try {
          if (Boolean(options.config) === Boolean(options.clear)) {
            throw new Error("Choose exactly one of --config or --clear");
          }
          const config = options.clear
            ? null
            : await parseJsonOption(requireText(options.config, "--config"), ViewerConfigSchema);
          const result = await client.configureExperimentViewer({
            projectId: requireProject(options),
            target: target.startsWith("att_") ? { attempt: target } : { experiment: target },
            viewer: config ?? null,
          });
          return { type: "single", data: result, schema: opaqueSchema };
        } finally {
          await client.close();
        }
      },
    ),
  );

  addJsonAndDaemonHostOptions(
    withProject(viewer.command("ls").argument("<target>", "Experiment or Attempt handle")),
  ).action(
    withOutput(
      async (
        target: string,
        options: ExperimentOptions,
        _command: Command,
      ): Promise<ListResult<unknown>> => {
        const client = await connect(options);
        try {
          const result = await client.resolveExperimentViewers({
            projectId: requireProject(options),
            target: target.startsWith("att_") ? { attempt: target } : { experiment: target },
          });
          return { type: "list", data: result.entries, schema: opaqueSchema };
        } finally {
          await client.close();
        }
      },
    ),
  );

  return experiment;
}
