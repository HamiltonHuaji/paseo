import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const repoRoot = new URL("../", import.meta.url);

function source(path) {
  return readFileSync(new URL(path, repoRoot), "utf8");
}

function workflowTrigger(path) {
  return source(path).split("jobs:", 1)[0];
}

const forkWorkflows = [
  ".github/workflows/fork-desktop-release.yml",
  ".github/workflows/fork-desktop-rollout.yml",
  ".github/workflows/fork-daemon-release.yml",
  ".github/workflows/fork-vscode-release.yml",
  ".github/workflows/fork-android-release.yml",
];

const removedUpstreamWorkflows = [
  ".github/workflows/android-apk-release.yml",
  ".github/workflows/deploy-app.yml",
  ".github/workflows/deploy-relay.yml",
  ".github/workflows/deploy-website.yml",
  ".github/workflows/desktop-release.yml",
  ".github/workflows/desktop-rollout.yml",
  ".github/workflows/nix-update-hash.yml",
  ".github/workflows/release-notes-sync.yml",
];

test("the overlay exposes only manual fork release workflows", () => {
  for (const path of forkWorkflows) {
    assert.ok(existsSync(new URL(path, repoRoot)), `missing ${path}`);
    const trigger = workflowTrigger(path);
    assert.match(trigger, /^\s+workflow_dispatch:\s*$/m, path);
    assert.doesNotMatch(trigger, /^\s+push:\s*$/m, path);
  }

  for (const path of removedUpstreamWorkflows) {
    assert.ok(!existsSync(new URL(path, repoRoot)), `${path} must stay out of the overlay`);
  }
});

test("fork desktop release preserves source and publication boundaries", () => {
  const workflow = source(".github/workflows/fork-desktop-release.yml");
  const trigger = workflowTrigger(".github/workflows/fork-desktop-release.yml");

  assert.match(workflow, /^name: Fork Desktop Release$/m);
  assert.match(trigger, /^\s+default: "overlay"$/m);
  assert.doesNotMatch(trigger, /^\s+- (?:all|macos)\s*$/m);
  assert.match(workflow, /node scripts\/emit-fork-build-env\.mjs/);
  assert.match(workflow, /--target "\$CHECKOUT_REF"/);
  assert.match(workflow, /^\s+--draft \\$/m);
  assert.match(workflow, /^\s+if: \$\{\{ false \}\}$/m);
  assert.match(workflow, /--linux --x64/);
  assert.match(workflow, /--win --x64/);
  assert.doesNotMatch(workflow, /--win --arm64/);
  assert.match(workflow, /Publish release after update manifests are available/);
  assert.match(workflow, /gh release edit "\$RELEASE_TAG" --draft=false/);
});

test("ordinary CI targets overlay without publishing release artifacts", () => {
  for (const path of [".github/workflows/ci.yml", ".github/workflows/nix.yml"]) {
    const trigger = workflowTrigger(path);
    assert.match(trigger, /branches: \[overlay\]/, path);
    assert.doesNotMatch(trigger, /branches: \[main\]/, path);
  }

  const docker = source(".github/workflows/docker.yml");
  const dockerTrigger = workflowTrigger(".github/workflows/docker.yml");
  assert.match(dockerTrigger, /branches: \[overlay\]/);
  assert.doesNotMatch(dockerTrigger, /^\s+push:\s*$/m);
  assert.doesNotMatch(dockerTrigger, /^\s+workflow_dispatch:\s*$/m);
  assert.doesNotMatch(docker, /push: true/);
});

test("root package and agent skills cannot invoke the upstream npm release", () => {
  const packageJson = JSON.parse(source("package.json"));
  assert.equal(typeof packageJson.scripts["release:fork:check"], "string");
  for (const [name, command] of Object.entries(packageJson.scripts)) {
    if (name === "release:fork:check") continue;
    assert.ok(!name.startsWith("release:"), `unexpected upstream release script ${name}`);
    assert.doesNotMatch(command, /npm publish/, name);
  }

  assert.ok(existsSync(new URL(".agents/skills/release-fork/SKILL.md", repoRoot)));
  assert.ok(!existsSync(new URL(".agents/skills/release-stable/SKILL.md", repoRoot)));
  assert.ok(!existsSync(new URL(".agents/skills/release-beta/SKILL.md", repoRoot)));
  assert.match(source(".agents/skills/release-fork/SKILL.md"), /origin\/overlay/);

  const releaseDoc = source("docs/release.md");
  assert.match(releaseDoc, /checkout_ref="\$RELEASE_COMMIT"/);
  assert.doesNotMatch(releaseDoc, /git push origin ["']?v\$INSTALLER_VERSION/);
});
