# Viewer migration and TCP acceptance — 2026-10-23

The 0.13 migration retained VIEWER-01–04 in `5c32d1c8bdc7d25b42589e87c18bccc861d5d53f`.
The VIEWER-05 implementation starts from `be947977dd37d9834e8930cc84eaf7cdff5a76ff` on
`complete/viewer-contracts`, under Works issue `item_a435ce98`. The pinned
[transport requirements](../refactors/experiment-viewer-transport-spec.md) are unchanged.
No Canvas algorithms or production daemons were changed by this work.

## Contract evidence

| Contract  | Implementation and evidence                                                                                                                                                                                                                                                                                                   | Remaining platform acceptance                                                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VIEWER-01 | Retained the daemon-global v1/v2 HTTP host, published actual endpoint, bounded conflict fallback, runtime rollback, range/cache/file handling and distinct unknown-v2 response. Real HTTP and TCP fixtures verify resources, concurrent requests, ranges, cancellation, conflict rebinding, failed-bind rollback and restart. | New-file directory refresh, overlapping mounts and traversal retain their existing service coverage; this transport change does not redefine resolution.          |
| VIEWER-02 | Desktop and Android viewer openers use the generic TCP transport. Stable listeners survive stream completion, route replacement, source loss and daemon restart. Real direct and encrypted relay fixtures verify keep-alive, concurrent resources, slow read/cancellation and draining generations.                           | Real Electron 41.2.0 renderer/preload/IPC acceptance passed. Full application navigation and the configured Electron 44 runtime remain unverified.                |
| VIEWER-03 | Android retains its foreground service, Headless JS task, stable port store and explicit-stop lifecycle. Its native bridge forwards one TCP socket per tunnel, including directional FIN and drained-write credit.                                                                                                            | Kotlin compilation and real JVM socket tests passed. Full Expo/Android build, device Chrome/background transition and notification interaction remain unverified. |
| VIEWER-04 | Retained host-qualified links and the shared viewer opener. Opener tests verify exact path/query/fragment preservation, direct-first selection and rejection of a remote daemon's loopback as local.                                                                                                                          | OS deep-link dispatch and native route rendering remain outside this run.                                                                                         |
| VIEWER-05 | Product transport now implements the pinned socket model; requirement mapping follows.                                                                                                                                                                                                                                        | No claim of Android device acceptance or production deployment.                                                                                                   |

## Pinned target comparison

| Pinned requirement                                          | Implementation                                                                                                                                                                                                                                                                                                           | Acceptance                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invariants 1–5; host/listener identity and lifetime         | One daemon HTTP host and internal `viewers` service. Electron shares one `(serverId, service:viewers)` registry between viewer and generic tunnel IPC. Android keys its listener by server ID and the fixed viewer target. Listeners are independent of browser sockets and upstream clients.                            | Real daemon fixture retains the local origin after HTTP reuse, conflict rebinding and worker restart; restarted server ID and report content match.                                                                              |
| Invariant 6; one downstream socket ↔ tunnel ↔ target socket | Product forwarders use raw TCP. HTTP framing stays in the browser and daemon; keep-alive requests reuse one tunnel ID. Resolve the service endpoint when each tunnel opens.                                                                                                                                              | Repeated HTTP requests retain one tunnel ID and one daemon HTTP connection. Six concurrent encrypted-relay requests succeed.                                                                                                     |
| Invariants 7–8; source-owned delivery                       | `tunnel.open.request` retains an operation tied to its physical source. All binary frames use that owner. Client sends retain their original transport. Detach aborts pending/open streams. Awaited ownership denial closes the physical source and rejects.                                                             | Real TCP source-detach/recovery, foreign-source rejection, retained-owner delivery denial and permission revocation pass. A final binary-boundary denial closes the browser without delivering denied bytes.                     |
| Half-close, reset, ordered End                              | Client and daemon share one stream state machine. FIN ends one direction; End waits behind queued Data. Both FINs and queued delivery/socket writes settle before owner release. Reset aborts both directions; late Data is rejected.                                                                                    | Real TCP verifies a 1 MiB downstream body followed by FIN and its later response, then upstream FIN followed by downstream data. State checks cover Data-before-End, Data-after-End, receive-credit violations and send failure. |
| Bounded flow control                                        | Each direction begins with 256 KiB credit returned after socket writes. Frames are at most 64 KiB and unsent data is capped at 1 MiB. Pause/Resume affects flow only. No viewer idle timer was added.                                                                                                                    | An 8 MiB response completes byte-for-byte while another response is paused/cancelled and other requests continue. Credit exhaustion and terminal send errors are exercised.                                                      |
| Route generations and reconnect                             | HostRuntime supplies `clientGeneration`. Establish the selected replacement before making it current; new sockets use it, healthy old streams drain, and failed sources reset their streams.                                                                                                                             | Actual local Wrangler E2EE relay passes direct→relay→direct, concurrent assets, 2 MiB exact binary content, relay process loss/restart and unchanged origin.                                                                     |
| Direct-first selection                                      | Probe the published viewer endpoint before direct access. Local loopback identity comes from the desktop daemon manager. Forward remote loopback; never use the daemon API port as a viewer port.                                                                                                                        | Opener tests cover reachable built-in/network endpoints, failed reachability, remote loopback, capability rejection, exact query and fragment.                                                                                   |
| Authorization and observability                             | Forwarding requires `tunnel.manage`; retained HTTP API uses `workspace.read`; listen changes use `daemon.manage`. Host diagnostics expose endpoints/conflict/connection count. Forwarders expose origin, generation, active streams and last 64 terminal records. Daemon logs source/tunnel IDs, byte counts and reason. | Permission/delivery faults terminate streams. New transport logs omit credentials and resource paths; the v1 viewer error log no longer includes its configured path or raw filesystem error.                                    |

## Protocol and boundaries

The optional `tunnelStreamV3` server feature and `tunnel_stream_v3` client capability gate credit-window
TCP streams. Older peers still parse messages and receive an update error for this feature; there is
no full-close fallback. The additive credit opcode is `0x25`. Existing terminal, file, Connected Hosts
and viewer HTTP resource opcodes retain their meanings. The HTTP resource API and `0x40..0x45` framing
remain available. No new RPC names or required wire fields were introduced.

The daemon HTTP host owns routing/filesystem access, the shared tunnel owns byte flow and lifetime,
HostRuntime owns route selection, Electron main owns desktop listeners, and the Android foreground
service owns native listeners. The product does not allocate a stream per asset.

## Verification record

- `npm run build:client`, `npm run build:server`, `npm run typecheck`, `npm run lint`, and
  `npm run format` passed in the isolated candidate worktree.
- `bootstrap.test.ts`: retained HTTP resource checks plus real TCP keep-alive, concurrency,
  slow-read cancellation, rebind/restart, both FIN directions, reset, source detach and final
  delivery-boundary fault injection.
- `session/owned-subscriptions/index.test.ts`: 8 passed, including source spoofing,
  revocation, delivery denial and owner cleanup with real target sockets.
- `daemon-client.test.ts -t 'TCP tunnel'`: 2 passed; queued FIN and credit/state violations.
- `viewers/open.test.ts`: 10 passed; direct-first and forwarded URL selection.
- `daemon-e2e/relay-transport.e2e.test.ts -t 'viewer TCP forwarding'` with
  `FORCE_RELAY_E2E=1`: passed against the actual local Wrangler relay and E2EE paths.
- Electron 41.2.0 with its sandboxed production preload and production viewer IPC loaded HTML,
  JavaScript and SVG in Chromium against a temporary real daemon. Path/query/fragment survived;
  repeated viewer and generic-tunnel calls shared one listener; generation replacement retained
  active streams; host removal and recreation reused the stored port. The fixture had its own
  profile and daemon. The configured Electron 44 binary was unavailable locally.
- Kotlin 2.0.21 compiled `LoopbackViewerProxy.kt`. JVM socket acceptance passed 8 simultaneous
  connections, 64 round trips, 2 MiB exact bytes, 8 FINs, active-listener removal/reset, same-port
  rebinding and rejection after close. This does not test the Expo bridge or Android service UI.

Evidence lives outside the source worktree in the issue's `viewer-evidence` directory:
`build-server.log`, `typecheck.log`, `lint.log`, `bootstrap-final.log`, `ownership.log`,
`client-state.log`, `open.log`, `relay-acceptance.log`, `kotlin-compile.log`,
`kotlin-socket-smoke.log`, `LoopbackSmoke.java`, `electron-ipc.log`, `electron-result.json`,
`electron-state.json`, `electron-viewer.cjs`, and `electron-daemon.ts`. Earlier failed TCP fixture attempts exposed
test assumptions about reset errors, asynchronous close notification and reusing a disposed client; neither failure was
hidden by removing an assertion. Final integration and device acceptance are separate.
