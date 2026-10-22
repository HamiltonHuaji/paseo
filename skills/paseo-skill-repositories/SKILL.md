---
name: paseo-skill-repositories
description: Edit, commit, fetch, and publish skills in Git repositories subscribed by a Paseo daemon. Use for repository-backed skills, not bundled or machine-local skills.
---

# Work with subscribed skill repositories

Use the daemon's skill repository tools when they are available. If the connected daemon lacks them, report that this daemon cannot fetch or publish through Paseo. Do not invent tool results or repository paths.

Read [the tool interface](references/interface.md) when calling the repository tools or handling their results.

## Find the checkout

Call `list_skill_repositories` and select the repository the user intends. Use its `repositoryId` and `checkoutPath`; do not infer ownership from a skill name or from `~/.agents/skills/`. If several repositories fit, inspect them with `get_skill_repository_status` before editing. An uninitialized checkout needs a capable client to fetch its first history.

Each repository is one Git checkout. Each first-level directory containing `SKILL.md` is a skill. Edit a skill in its checkout, or follow an existing link only after confirming its real target is in that checkout. For a new skill, create a first-level directory in the chosen checkout and follow the available skill creation guidance.

## Commit and request publication

1. Finish the file edits. Review `git -C <checkoutPath> status` and the diff. Stage only the intended paths, including deletions: `git -C <checkoutPath> add -A -- <skill-directory>`. Review the staged diff before committing. Use ordinary Git to make the local commit; do not wait for a client before committing.
2. Read the commit ID with `git -C <checkoutPath> rev-parse HEAD`. Call `publish_skill_repository` with the repository ID and that commit ID as `expectedHead`.
3. Report the returned state accurately. `published` means the remote accepted the result. `local_only` means the local commit and publication intent are saved; a capable client can retry later. `needs_resolution` means the remote history prevents automatic publication. A changed local HEAD requires a fresh status check and publication request.

Do not use `git push` from the daemon or force-push through Paseo. A successful local commit does not imply that the remote or another daemon has received it. Publication requires the subscription's agent-publish grant; the daemon chooses an eligible connected client and never takes a client ID or credential from this tool call.

## Fetch and resolve

Call `fetch_skill_repository` when the user asks to pull or when publication reports `needs_resolution`. It retrieves Git history into the returned remote-tracking ref without changing the working tree. If it returns `unavailable`, say that the remote state is unknown and leave the checkout alone.

After a successful fetch, inspect local status and the two histories with Git. Fast-forward when possible. For divergent histories, merge or rebase in the daemon checkout, resolve conflicts there, and inspect the resulting diff. Use `get_skill_repository_status` to see whether local work remains unpublished, then call `publish_skill_repository` with the current HEAD. Do not reset or discard local work merely because the subscription's automatic receive mode is `overwrite`; that mode governs automatic receive, not an agent's explicit conflict resolution.

If fetch rejects a remote force rewrite, inspect the error and ask the user before accepting a new baseline. After that decision, call `fetch_skill_repository` with `allowRewrite: true`; the prior observed ref stays under `refs/paseo/recovery/`. Inspect both histories before changing the local branch.

## Skill links

The checkout is the repository state. `~/.agents/skills/` contains optional links chosen by the agent and may also contain unrelated skills. Sync operations never create or repair links. Create, change, or remove a link only when the user's skill activation or maintenance task calls for it; inspect an existing path before replacing it. Removing a link does not delete the checkout. A deleted repository directory can leave a dangling link for the agent to handle.
