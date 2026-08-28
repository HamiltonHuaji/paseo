import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { createLocalTunnelForwarder } from "@getpaseo/client/node/local-tunnel-forwarder";
import { createDaemonTestContext } from "../test-utils/index.js";

describe("project Experiments", () => {
  test("persists records, resolves viewers, and refreshes log progress", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-experiment-project-"));
    const ctx = await createDaemonTestContext({
      serviceProxy: {
        publicBaseUrl: "https://services.example.test",
        standaloneListen: null,
      },
    });
    let projectId: string | null = null;
    try {
      const added = await ctx.client.addProject(projectRoot);
      expect(added.project).not.toBeNull();
      projectId = added.project!.projectId;

      const created = await ctx.client.createExperiment({
        projectId,
        shortDescription: "Compare router training schedules",
        description: "Find a stable schedule for the router model.",
        goal: "router architecture",
      });
      expect(created.experiment.goal).toBe("router architecture");
      expect(created.experiment.id).toMatch(/^exp_/);

      const outputDir = path.join(projectRoot, "outputs", "run-7");
      await mkdir(outputDir, { recursive: true });
      const logPath = path.join(outputDir, "train.log");
      await writeFile(logPath, "step=120 phase=mixed\n", "utf8");

      const attemptResult = await ctx.client.createExperimentAttempt({
        projectId,
        experiment: created.experiment.id,
        shortDescription: "Formal training run 7",
        purpose: "Train the selected router for 500 steps.",
        wandbId: "entity/project/run-7",
        jobId: "81273",
        outputDir,
        progressPlan: {
          unit: "step",
          total: 500,
          segments: [
            { label: "short", start: 0, end: 100 },
            { label: "mixed", start: 100, end: 300 },
            { label: "long", start: 300, end: 500 },
          ],
        },
        progressSource: {
          type: "log",
          path: "${attempt.outputDir}/train.log",
          progressRegex: "step=(?<current>\\d+) phase=(?<phase>\\w+)",
          endRegex: "training completed",
        },
      });
      const attempt = attemptResult.attempt;

      const first = await ctx.client.refreshExperimentProgress({ projectId, attempt: attempt.id });
      expect(first.observation).toMatchObject({
        current: 120,
        total: 500,
        ended: false,
        phase: "mixed",
      });
      expect(first.nextRefreshAfterMs).toBeGreaterThan(0);

      await writeFile(
        logPath,
        "step=120 phase=mixed\nstep=500 phase=long\ntraining completed\n",
        "utf8",
      );
      const second = await ctx.client.refreshExperimentProgress({ projectId, attempt: attempt.id });
      expect(second.observation).toMatchObject({ current: 500, ended: true, phase: "long" });
      expect(second.nextRefreshAfterMs).toBeNull();

      const storage = await ctx.client.resolveExperimentStorage({
        projectId,
        scope: "attempt",
        attempt: attempt.id,
      });
      await mkdir(path.join(storage.path, "preview"), { recursive: true });
      await writeFile(path.join(storage.path, "preview", "index.html"), "<h1>run 7</h1>", "utf8");
      await ctx.client.configureExperimentViewer({
        projectId,
        target: { attempt: attempt.id },
        viewer: {
          mounts: { preview: "${attempt.blobDir}/preview" },
          entries: { results: "preview/index.html" },
        },
      });
      const viewers = await ctx.client.resolveExperimentViewers({
        projectId,
        target: { attempt: attempt.id },
      });
      expect(viewers.entries).toMatchObject([
        {
          name: "results",
          path: "preview/index.html",
          available: true,
        },
      ]);
      const viewerResponse = await fetch(
        `http://127.0.0.1:${ctx.daemon.port}${viewers.entries[0]!.url}`,
      );
      expect(viewerResponse.status).toBe(200);
      expect(await viewerResponse.text()).toBe("<h1>run 7</h1>");
      const forwarder = await createLocalTunnelForwarder({
        client: ctx.client,
        target: { type: "service", name: "viewers" },
      });
      try {
        const tunneledResponses = await Promise.all([
          fetch(`${forwarder.origin}${viewers.entries[0]!.url}`),
          fetch(`${forwarder.origin}${viewers.entries[0]!.url}`),
        ]);
        expect(await Promise.all(tunneledResponses.map((response) => response.text()))).toEqual([
          "<h1>run 7</h1>",
          "<h1>run 7</h1>",
        ]);
      } finally {
        await forwarder.close();
      }
      const updatedAttempt = await ctx.client.updateExperimentAttempt({
        projectId,
        attempt: attempt.id,
        resultSummary: "Training completed without instability.",
        wandbId: null,
      });
      expect(updatedAttempt.attempt).toMatchObject({
        resultSummary: "Training completed without instability.",
        wandbId: null,
        jobId: "81273",
        outputDir,
      });

      const detail = await ctx.client.getExperiment({
        projectId,
        experiment: created.experiment.id,
      });
      expect(detail.detail.attempts).toHaveLength(1);
      expect(detail.detail.attempts[0]?.progress).toMatchObject({ current: 500, ended: true });
      expect(path.basename(path.dirname(storage.path))).toBe("attempts");
      expect(path.basename(path.join(projectRoot, ".paseo", "v1", "state.db"))).toBe("state.db");
    } finally {
      if (projectId) await ctx.client.removeProject(projectId).catch(() => undefined);
      await ctx.cleanup();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("runs a command progress source for every refresh request", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "paseo-experiment-command-"));
    const ctx = await createDaemonTestContext();
    let projectId: string | null = null;
    try {
      const added = await ctx.client.addProject(projectRoot);
      projectId = added.project!.projectId;
      const experiment = await ctx.client.createExperiment({
        projectId,
        shortDescription: "Command progress",
        description: "Exercise generic command progress parsing.",
      });
      const counterPath = path.join(projectRoot, "counter.txt");
      await writeFile(counterPath, "0", "utf8");
      const scriptPath = path.join(projectRoot, "progress.mjs");
      await writeFile(
        scriptPath,
        `import { readFile, writeFile } from "node:fs/promises";
const file = process.argv[2];
const next = Number(await readFile(file, "utf8")) + 1;
await writeFile(file, String(next));
console.log("step=" + next + " ended=false");\n`,
        "utf8",
      );
      const attempt = await ctx.client.createExperimentAttempt({
        projectId,
        experiment: experiment.experiment.id,
        shortDescription: "Command observed run",
        purpose: "Verify each client request executes the configured command.",
        progressSource: {
          type: "command",
          command: [
            process.execPath,
            "${project.root}/progress.mjs",
            "${project.root}/counter.txt",
          ],
          parse: {
            type: "regex",
            regex: "step=(?<current>\\d+) ended=(?<ended>true|false)",
          },
        },
      });
      const first = await ctx.client.refreshExperimentProgress({
        projectId,
        attempt: attempt.attempt.id,
      });
      const second = await ctx.client.refreshExperimentProgress({
        projectId,
        attempt: attempt.attempt.id,
      });
      expect(first.observation?.current).toBe(1);
      expect(second.observation?.current).toBe(2);

      const cleared = await ctx.client.updateExperimentAttempt({
        projectId,
        attempt: attempt.attempt.id,
        progressSource: null,
      });
      expect(cleared.attempt.progressSource).toBeNull();
      expect(cleared.attempt.progress).toBeNull();
    } finally {
      if (projectId) await ctx.client.removeProject(projectId).catch(() => undefined);
      await ctx.cleanup();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
