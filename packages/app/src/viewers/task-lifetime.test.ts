import { expect, it } from "vitest";
import { createViewerTaskLifetime } from "./task-lifetime";

it("finishes a delayed task after native service stop", async () => {
  const tasks = createViewerTaskLifetime(async () => null);
  await tasks.run("stopped");
});

it("does not let an old service finish its replacement's task", async () => {
  const tasks = createViewerTaskLifetime(async () => "new");
  let finished = false;
  const current = tasks.run("new").then(() => {
    finished = true;
    return undefined;
  });
  await tasks.run("old");
  tasks.stop("old");
  await Promise.resolve();
  expect(finished).toBe(false);
  tasks.stop("new");
  await current;
  expect(finished).toBe(true);
});

it("handles stop while the initial native state query is pending", async () => {
  let respond!: (id: string | null) => void;
  const tasks = createViewerTaskLifetime(
    () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  );
  const task = tasks.run("service");
  tasks.stop("service");
  await task;
  respond("service");
});
