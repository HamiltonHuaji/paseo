# Viewer migration review — 2026-10-22

Candidate base: `44682f9f99aba9fdc0cc6fc521fab772df19a9bd`. Source reference:
`1bd70fb5056d623e8da784dce82d8ee72fa5f486`. Viewer issue: `item_732c09d9`;
pinned-spec comparison: `item_641e3748`. Works records, configuration resolution and W&B
are supplied by the Works migration (`09d2dc255`, `c8a430ba5`). No canvas changes.

## Contract evidence

| Contract  | Implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Runtime evidence and limits                                                                                                                                                                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| VIEWER-01 | Shared daemon listener starts/stops with worker; v1 routes and v2 router are separate. Preferred port, bounded 16-port fallback then ephemeral port, published actual endpoint, runtime rebind and rollback. HTTP range/cache behavior uses Express file serving. Directory snapshots support bounded pagination; v2 routes terminate unknown paths. File failures return sanitized messages; configured non-loopback and IPv6 addresses reach the correct upstream. | Isolated integration and proxy runtime checks are recorded below. No device acceptance implied. Directory traversal/mount resolution belongs to the Works/Experiments services; those implementations were retained, not redefined here.                                             |
| VIEWER-02 | Source-owned HTTP requests, bounded credit window, per-source scheduling, cancellation and awaited writes; stable per-host Electron listeners and draining upstream generations. Android shares the HTTP stream protocol. Cancellation before headers now rejects its pending operation.                                                                                                                                                                             | Client build/typecheck and app typecheck passed. `viewers/open.test.ts` verifies forwarding/direct selection and preserved query/fragment. Actual encrypted relay, route switching and daemon restart have not been exercised this round.                                            |
| VIEWER-03 | Restored Android Expo module, loopback HTTP server, foreground service, headless JS task, stable host port storage, host removal and shutdown cleanup. Registered task at the current application entry point.                                                                                                                                                                                                                                                       | TypeScript static check passed. Android compilation, foreground notification, Chrome background transition, reconnect and explicit-stop behavior are **not device-accepted**.                                                                                                        |
| VIEWER-04 | `paseo://h/<serverId>/view/...` parser/builder; explicit viewer resolution precedes ordinary file handling. Shared link-provider opener works across chat/report consumers. Host-owned catch-all route handles externally opened/copied links.                                                                                                                                                                                                                       | `viewer-deep-link.test.ts` verifies host-qualified parsing, query/fragment and rejects plain `/view/...` as viewer links. Opener tests cover host identity and resource path. Two live hosts, OS deep-link routing, browser copy/paste and native route rendering remain unverified. |
| VIEWER-05 | Comparison against the pinned target follows below. The pinned document is unchanged.                                                                                                                                                                                                                                                                                                                                                                                | Comparison is complete; full TCP target acceptance is **not claimed**.                                                                                                                                                                                                               |

## Protocol adaptation

Official 0.13 reserves binary opcode `0x30` for Connected Hosts. The older viewer resource
channel used the same opcode. Viewer frames now occupy `0x40..0x45`, gated by the optional
`viewerHttpFramingV2` feature and `viewer_http_framing_v2` client capability. A daemon only
advertises `viewerHttpProxy` to clients supporting this framing; a client rejects older viewer
framing with an update message. Existing host, terminal and file frames retain their meanings.
All new message fields are optional, and new RPCs have dotted request/response names.
Generic TCP tunnels require the existing `tunnel.manage` permission; HTTP viewer reads require
`workspace.read`; listener settings require `daemon.manage`.

## Pinned target comparison

Reference: [Experiment Viewer Transport Requirements](../refactors/experiment-viewer-transport-spec.md).

| Pinned requirement                                                   | Implemented or retained                                                                                                                                                               | Gap / unverified boundary                                                                                                                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Required invariants 1–5; daemon service lifetime and actual endpoint | One worker viewer host; internal `viewers` service registration; same v1/v2 host; stable local listener keyed by server ID; bounded conflict fallback and runtime rollback.           | Active HTTP connection counts are not exposed. Process restart / route-change identity needs an end-to-end acceptance run.                                                                   |
| Required invariant 6; stream identity                                | Generic `local-tunnel-forwarder` and `TunnelController` retain one downstream socket to one stream / target socket.                                                                   | The product's viewer opener uses a **per-request HTTP resource channel**, not that TCP forwarder. HTTP success does not verify TCP keep-alive semantics.                                     |
| Required invariants 7–8; ownership                                   | Retained operation binds binary sends to the physical source. Detach aborts the operation. Awaited delivery denial closes the source and rejects instead of reporting success.        | Logs do not yet expose all required source/stream identifiers and terminal-state detail. Fault-injected ownership-denial acceptance is not run.                                              |
| Tunnel state machine; End, Reset, Pause/Resume                       | Generic tunnel retains `allowHalfOpen`, directional end flags, reset, data-after-end rejection and bounded send queues. Reset is registered in binary demux.                          | Full half-close/reset ordering matrix is not runtime-accepted. HTTP End/Reset are request lifecycle events, not TCP FIN equivalence.                                                         |
| Multiple paths / connection generations                              | Desktop stable listener managers retire upstream generations after draining. HostRuntime supplies active route changes; listeners remain independent from browser requests.           | Actual direct↔relay transition, failed-generation reset, reconnect and daemon restart require an end-to-end run.                                                                             |
| Client selection policy                                              | Published viewer port is used; no URL is built from the unrelated daemon API port. Browser direct access uses the actual plain-HTTP viewer service; desktop/Android support proxying. | Current desktop/Android policy prefers HTTP proxy even on a reachable local host; target direct-first preference is not implemented.                                                         |
| Authorization                                                        | Viewer reads and generic TCP tunnels use their respective daemon permissions. Explicit non-loopback exposure is disclosed in settings and daemon startup logs.                        | Dedicated permission/revocation fault tests and client source-detach races are not run.                                                                                                      |
| Failure and observability                                            | Preferred/actual endpoint and conflict status are logged; HTTP errors are sanitized; transport failures cancel affected requests.                                                     | No complete public three-layer state view, stream byte counters or reason inventory. Some server-side error logs still carry raw errors; pinned no-path logging rule needs a separate audit. |

## Verification record

- `npm run build:client`: passed, including protocol declarations and generated validators.
- `npm run typecheck --workspace=@getpaseo/client`: passed.
- `npm run typecheck --workspace=@getpaseo/app`: passed; native code is outside this check.
- `npm run typecheck --workspace=@getpaseo/server`: passed with Works wiring overlaid locally.
- `npm run format` and `npm run lint`: passed for the combined validation checkout; commit hooks check the selected migration files again.
- `viewer-deep-link.test.ts`: passed; `viewers/open.test.ts`: passed.
- Works integration initially stopped on a stale `.codex/skills` installation assertion. Per
  Skills ownership confirmation, it now checks canonical `.agents/skills/paseo-works/SKILL.md`
  and its actual content. The installation assertion was retained.
- `bootstrap.test.ts` now exercises concurrent real proxy resource fetches, cancellation,
  a response larger than the credit window, ranges, unknown v2 paths, sanitized errors,
  occupied-port fallback, failed-bind rollback and stable local origin. This test passed.
  A final rerun alongside Works integration is pending local server build output for its CLI child.
- The integration harness previously isolated `PASEO_HOME` but did not override orchestration
  skill targets. Earlier daemon startup could reconcile real provider-home skill directories.
  This was reported to root; no manual restoration or deletion was attempted. The harness now
  injects `resolveSkillTargets` under its temporary `provider-home` for startup and reconciliation.

Retained build/test logs live beside the viewer worktree in the Works issue storage. Final
integration, application preview and device acceptance belong to the root handoff.
