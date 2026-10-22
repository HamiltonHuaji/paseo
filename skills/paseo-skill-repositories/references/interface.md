# Agent tool interface

These tools expose the subscribed local checkout and broker remote Git access through a connected capable client. Git editing, staging, committing, merging, and rebasing remain ordinary commands in the daemon checkout.

## Common rules

- `repositoryId` is an opaque stable ID from `list_skill_repositories`. No tool accepts an arbitrary Git URL, branch, credential, client ID, or shell command.
- `checkoutPath` is the daemon's absolute path for this subscription. Use only a path returned by a tool; do not guess the storage layout.
- `remoteHead` and `remoteCheckedAt` describe the last observed remote state. They do not prove that GitHub is still at that commit. Null means no remote state has been fetched.
- A remote operation uses the current agent turn's authenticated client as the preferred executor when eligible, then another eligible connected client. The origin may be absent. The daemon resolves it from its turn record on each tool call; an environment variable or tool argument supplied by the agent cannot set it. Read and publish eligibility are separate.
- Each tool operates on one daemon subscription. It does not list or contact other daemons. Tool failure must preserve the local Git history and report an actionable error.

## `list_skill_repositories`

Input: `{}`

Output:

```ts
{
  repositories: Array<{
    repositoryId: string;
    label: string;
    checkoutPath: string;
    branch: string;
    initialized: boolean;
    autoReceive: "overwrite" | "fastforward" | "none";
    agentPublishAllowed: boolean;
  }>;
}
```

List only repositories subscribed by this daemon. `initialized: false` means no usable checkout history exists yet; an eligible client must bootstrap it before the agent can commit against that repository.

## `get_skill_repository_status`

Input: `{ repositoryId: string }`

Output:

```ts
{
  repositoryId: string;
  checkoutPath: string;
  branch: string;
  localHead: string | null;
  remoteHead: string | null;
  remoteTrackingRef: string | null;
  remoteCheckedAt: string | null; // ISO 8601 UTC
  worktree: "clean" | "dirty" | "conflicted";
  ahead: number | null;
  behind: number | null;
  publication: "none" | "pending" | "published" | "blocked";
  syncError: string | null;
}
```

`ahead` and `behind` are null until both local and observed remote commits exist. `syncError` reports the latest automatic receive failure or block. `publication` describes the daemon's durable publication record; `published` refers to a confirmed remote update, not merely a dispatched client request. Git status and diff remain authoritative for individual files.

## `fetch_skill_repository`

Input: `{ repositoryId: string; allowRewrite?: boolean }`

Output:

```ts
{
  state: "fetched" | "unavailable";
  remoteHead: string | null;
  remoteTrackingRef: string | null;
  remoteCheckedAt: string | null;
}
```

`fetched` means the daemon has received and verified the branch's Git objects and updated its remote-tracking ref. It does not merge, rebase, or reset the checkout. `unavailable` returns promptly when no eligible client can read this repository. Other failures, including a missing branch or rejected Git objects, are reported as errors without advancing the ref. Calling this tool is an explicit fetch even when `autoReceive` is `none`. Use `allowRewrite: true` only after inspecting a suspected remote force rewrite and deciding to accept its new ref; the previous observed ref is retained under `refs/paseo/recovery/`.

## `publish_skill_repository`

Input: `{ repositoryId: string; expectedHead: string }`

Output:

```ts
{
  state: "published" | "local_only" | "needs_resolution";
  localHead: string;
  publishedHead: string | null;
  remoteHead: string | null;
  remoteTrackingRef: string | null;
}
```

The daemon first verifies that `expectedHead` is the checkout's current committed HEAD, that the subscription allows agent publication, and that the working tree is not in an unresolved Git operation. If HEAD changed, it returns a distinct `head_changed` error and does not publish a different commit.

`published` means the remote accepted a fast-forward result. A client may cleanly replay local commits onto a newer remote history; in that case the daemon receives and verifies the resulting commits, advances its local branch, and returns the new `localHead` and `publishedHead`. It must not silently rewrite a dirty working tree.

`local_only` means a durable publication intent is recorded for this HEAD and no eligible publishing client is available now. It returns immediately; a later capable client may resume the same intent without creating another local commit. `needs_resolution` means automatic replay cannot finish, the local commits remain recoverable, and the latest remote history is available at `remoteTrackingRef` for agent-side conflict resolution. It never authorizes a force push.

Network, authentication, and remote rejection failures other than unavailable execution are explicit errors. They do not report `published`, erase a local commit, or silently switch to another repository or branch.
