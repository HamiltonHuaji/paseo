import type { ExperimentService } from "./service.js";
import type { ProjectRegistry } from "../workspace-registry.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function viewerLink(input: {
  name: string;
  url: string;
  available: boolean;
  unavailableReason: string | null;
}): string {
  const name = escapeHtml(input.name);
  if (!input.available) {
    return `<li class="viewer unavailable"><span>${name}</span><small>${escapeHtml(input.unavailableReason ?? "Unavailable")}</small></li>`;
  }
  return `<li class="viewer"><a href="${escapeHtml(input.url)}">${name}<span aria-hidden="true">↗</span></a></li>`;
}

export async function renderExperimentViewerIndex(
  projectRegistry: Pick<ProjectRegistry, "list">,
  experimentService: Pick<ExperimentService, "list" | "get" | "resolveViewers">,
): Promise<string> {
  const sections: string[] = [];
  const projects = (await projectRegistry.list()).filter((project) => project.archivedAt === null);

  for (const project of projects) {
    const experiments = await experimentService.list(project.projectId, {
      includeClosed: true,
      includeArchived: false,
    });
    const experimentCards: string[] = [];

    for (const experiment of experiments) {
      const targets = [
        {
          label: "Experiment",
          resolve: () =>
            experimentService.resolveViewers(project.projectId, { experiment: experiment.id }),
        },
      ];
      const detail = await experimentService.get(project.projectId, experiment.id);
      for (const attempt of detail.attempts) {
        targets.push({
          label: attempt.shortDescription || attempt.id,
          resolve: () =>
            experimentService.resolveViewers(project.projectId, { attempt: attempt.id }),
        });
      }

      const groups: string[] = [];
      for (const target of targets) {
        const viewers = await target.resolve().catch(() => []);
        if (viewers.length === 0) continue;
        groups.push(
          `<div class="target"><h4>${escapeHtml(target.label)}</h4><ul>${viewers.map(viewerLink).join("")}</ul></div>`,
        );
      }
      if (groups.length === 0) continue;
      experimentCards.push(
        `<article><h3>${escapeHtml(experiment.shortDescription || experiment.id)}</h3><p>${escapeHtml(experiment.description)}</p>${groups.join("")}</article>`,
      );
    }

    if (experimentCards.length === 0) continue;
    const projectName = project.customName ?? project.displayName;
    sections.push(
      `<section><h2>${escapeHtml(projectName)}</h2><div class="grid">${experimentCards.join("")}</div></section>`,
    );
  }

  const content =
    sections.length > 0
      ? sections.join("")
      : '<div class="empty">No configured experiment viewers are available.</div>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Paseo Viewers</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #111714; color: #edf4ef; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top left, #20352b 0, #111714 38rem); }
    main { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 48px 0 80px; }
    header { display: flex; align-items: center; gap: 16px; margin-bottom: 36px; }
    header svg { width: 46px; height: 46px; color: #63dc9b; }
    h1, h2, h3, h4, p { margin: 0; }
    h1 { font-size: 28px; letter-spacing: -.03em; }
    header p, article > p { color: #9db0a4; margin-top: 5px; }
    section + section { margin-top: 38px; }
    h2 { font-size: 20px; margin-bottom: 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 14px; }
    article, .empty { background: rgba(31, 42, 36, .92); border: 1px solid #34483d; border-radius: 14px; padding: 18px; box-shadow: 0 14px 36px rgba(0, 0, 0, .18); }
    article > p { font-size: 13px; line-height: 1.45; min-height: 19px; }
    .target { margin-top: 17px; }
    h4 { color: #b8c7be; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; }
    ul { list-style: none; margin: 7px 0 0; padding: 0; display: grid; gap: 6px; }
    .viewer a, .viewer > span { display: flex; justify-content: space-between; gap: 12px; padding: 9px 11px; border-radius: 8px; }
    .viewer a { color: #7ce4a9; background: #17251e; text-decoration: none; border: 1px solid transparent; }
    .viewer a:hover, .viewer a:focus-visible { border-color: #4c9f70; background: #1b3025; outline: none; }
    .viewer.unavailable { color: #718078; }
    .viewer.unavailable small { display: block; padding: 0 11px 7px; overflow-wrap: anywhere; }
    .empty { color: #9db0a4; }
  </style>
</head>
<body>
  <main>
    <header>
      <svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M18 5h12M21 5v12L9.8 36.4A4.4 4.4 0 0 0 13.6 43h20.8a4.4 4.4 0 0 0 3.8-6.6L27 17V5" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 32h18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>
      <div><h1>Paseo Viewers</h1><p>Experiment outputs hosted by this daemon</p></div>
    </header>
    ${content}
  </main>
</body>
</html>`;
}
