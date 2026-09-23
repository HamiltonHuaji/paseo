# Experiment Viewer Transport Requirements

Status: proposed. This document defines the target viewer host and forwarding model. The current
implementation still differs where called out in the owning implementation docs.

## Scope

Experiment viewers are ordinary HTTP resources served by the daemon. A client may open that HTTP
service directly or expose it through a client-local TCP forwarder. Both paths reach the same daemon
HTTP host and use the same `/view/...` namespace.

Keep these three resources independent:

```text
daemon viewer HTTP host
        ^
        | daemon-side TCP connections
        |
tunnel streams
        ^
        | browser-side TCP connections
        |
client-local forwarder
```

The HTTP host is not owned by a client. The local forwarder is not owned by one browser connection.
A tunnel stream is not a viewer, Experiment, HTTP request, or listener.

## Required invariants

1. One daemon worker owns one viewer HTTP host for every Project, Experiment, and Attempt it serves.
2. The viewer HTTP host has a preferred stable endpoint and publishes the endpoint it actually
   bound.
3. Direct access and client-local forwarding are both supported transports to the same HTTP host.
4. A Host is identified by `serverId`. Direct, relay, and other connection paths do not create
   separate viewer proxies for that Host.
5. One client-local listener serves all viewer paths for one `(serverId, target)` pair while the
   desktop process is alive.
6. One accepted downstream TCP connection owns one tunnel stream and one daemon-side TCP
   connection. A bounded pool may create idle streams before assignment to hide relay latency, but
   an assigned stream is never shared or moved between downstream connections.
7. Every daemon-to-client tunnel frame has an active delivery owner bound to the requesting source.
8. Flow-control, authorization, or delivery failures terminate the affected stream visibly. They
   never become a successful no-op that leaves an HTTP request waiting forever.

## Daemon viewer HTTP host

### Service lifetime

Start the viewer HTTP host during daemon worker startup and stop it during worker shutdown. It is a
daemon-global service, not a per-session or per-viewer process. Register it under the internal
service name `viewers` after the listener binds.

All viewer routes share this host:

```text
/view/<project-id>/<experiment-id>/...
/view/<project-id>/<experiment-id>/<attempt-id>/...
```

Do not allocate one port per Experiment, Attempt, entry, mount, or client.

### Preferred and actual endpoint

Add a viewer-host listen setting. The proposed configuration name is:

```json
{
  "daemon": {
    "experimentViewer": {
      "listen": "127.0.0.1:8765"
    }
  }
}
```

`127.0.0.1:8765` is the default preferred endpoint. `PASEO_EXPERIMENT_VIEWER_LISTEN` may override
it.

Bind according to this order:

1. Try the configured host and port.
2. On `EADDRINUSE`, try a small deterministic sequence of following ports on the same host.
3. If that sequence is occupied, bind port `0` on the configured host.
4. Do not silently recover from permission errors, invalid addresses, or other listener failures.

The deterministic conflict range must be bounded and documented next to the implementation. The
daemon logs the preferred endpoint, the actual endpoint, and whether conflict resolution was used.
A port conflict is not a daemon startup error.

The actual endpoint is authoritative. Publish it through the daemon service description so clients
never assume that `8765` succeeded. A daemon restart should normally recover the same endpoint;
clients must still accept a different published port after a conflict or configuration change.

The Host settings page may update the same `daemon.experimentViewer.listen` setting at runtime. The
daemon rebinding operation persists the requested endpoint, binds the replacement listener, and
publishes the new actual endpoint. If binding or persistence fails, restore the previous listener.
An environment override remains authoritative and disables client-side changes.

### Direct access

Opening the daemon viewer HTTP host without a client-local forwarder is supported. A built-in local
daemon should prefer this path when its published endpoint is reachable from the desktop process.

The default listener is loopback-only. An explicit non-loopback listener is an opt-in,
unauthenticated publication surface. Anyone who can reach that port may read the generated viewer
navigation page, experiment and attempt names, and every file reachable through configured viewer
mounts. Do not add Paseo login, tickets, or cookies to this listener. The client must show this scope
before applying a non-loopback address, and the daemon must log a warning when it binds one. The
main daemon listener being public does not implicitly expose viewers.

`GET /` serves a generated navigation page for configured experiment viewers. Viewer links remain
stable `/view/...` paths and work without a Paseo client, including when a cluster or firewall
publishes the configured port directly.

Viewer resolution returns a path plus a service description. It does not return a URL that assumes
the main daemon API origin. The client combines the path with either the reachable direct viewer
origin or its local-forwarder origin.

## Client-local forwarder

### Identity and lifetime

Key a local forwarder by stable Host identity and canonical target:

```text
(serverId, service:viewers)
```

Do not include the active direct or relay path, password, relay key, or viewer entry path in the
identity. Those values describe how to reach the Host, not which Host or service the listener
represents.

Create the listener lazily on first use. Keep its loopback port stable until one of these events:

- the desktop process exits;
- the Host is removed;
- the proxy is explicitly reset after an unrecoverable configuration change.

Closing a browser tab, finishing an HTTP request, losing one upstream path, or restarting the daemon
does not close the listener.

Use one local port per Host viewer target. Do not multiplex several daemons behind path prefixes on
one local HTTP port. That would make a generic TCP forwarder responsible for HTTP origin and path
rewriting.

The forwarder may keep a small bounded pool of idle upstream streams. Fill it asynchronously so
creating the listener does not block on several relay round trips. Assign one idle stream to the
next accepted downstream socket, then replenish the pool. Idle streams carry no application bytes.
Reset the entire idle pool when the active route changes or the forwarder closes.

### Multiple paths to one Host

HostRuntime remains the owner of direct/relay probing and active-path selection. The desktop proxy
manager consumes route-generation updates; it does not duplicate HostRuntime's selection policy.

When the active path changes:

1. Keep the local listener and origin unchanged.
2. Establish the replacement upstream client before making it current when possible.
3. New downstream connections use the current upstream generation.
4. Existing streams remain on the generation that created them while it is healthy.
5. Retire an old upstream client after its streams drain. If the old path has failed, reset those
   streams immediately.

An upstream disconnect may end current streams. It must not invalidate the local viewer URL. After
HostRuntime reconnects or selects another path, reloading that URL creates streams on the new path.

## Tunnel stream

### Identity

One assigned stream maps exactly:

```text
one accepted downstream TCP socket
<-> one tunnel id
<-> one daemon-side target TCP socket
```

Before assignment, a pooled tunnel id may own only the daemon-side target socket. It becomes an
ordinary assigned stream once a downstream socket claims it.

A stream may carry several HTTP/1.1 keep-alive requests. Do not create streams per HTTP request or
viewer asset.

Resolve a named target such as `viewers` when the stream opens. The service may have rebound to a
different daemon-local port after a worker restart.

### Ownership

Create one retained owned operation inside `tunnel.open.request`. Bind it to the physical source and
tunnel id. Use that owner for every daemon-to-client Data, End, Reset, Pause, and Resume frame.

Release the owner only when the stream reaches a terminal state. Source detach aborts all stream
owners created by that source. It does not stop the daemon viewer HTTP host or a client-local
listener.

An ownership denial is a server invariant failure. Reject the send, record the tunnel and source,
close the affected transport so the client can settle its streams, and surface the failure in logs.

### State machine

A TCP forwarder preserves half-close semantics:

```text
CONNECTING
    |
    v
OPEN
  |-- downstream FIN --> DOWNSTREAM_HALF_CLOSED
  |-- upstream FIN ----> UPSTREAM_HALF_CLOSED
  `-- reset/error ------> ABORTED

DOWNSTREAM_HALF_CLOSED -- upstream FIN --> CLOSED
UPSTREAM_HALF_CLOSED --- downstream FIN -> CLOSED
either half-closed state -- reset/error --> ABORTED
```

Frame semantics:

- `Data`: bytes in the frame direction;
- `End`: FIN in the frame direction; the opposite direction remains usable;
- `Reset`: immediate abnormal termination in both directions;
- `Pause` and `Resume`: backpressure only; they do not change stream lifetime.

Queue End behind all earlier Data in the same direction. Reject Data received after that direction's
End. Release the owned operation after both directions end and queued sends settle, or immediately
after Reset/abort cleanup.

Do not impose a viewer-specific idle timeout. HTTP keep-alive policy belongs to the HTTP endpoints.
Transport liveness, source detach, daemon shutdown, and explicit reset still terminate streams.

### Connection-path changes

A running stream belongs to the upstream connection generation that opened it. Do not migrate byte
streams between direct and relay connections. A healthy old generation may drain; a failed one
resets its streams. New downstream connections use the latest route while retaining the same local
proxy origin.

## Client selection policy

Resolve a viewer path in this order:

1. Use direct access when the daemon-published viewer endpoint is known to be reachable, especially
   for a client-managed built-in daemon.
2. Otherwise use the stable local forwarder for `(serverId, service:viewers)`.
3. If neither path is available, report that the viewer transport is unavailable. Do not construct a
   URL against an unrelated daemon API origin.

Direct and forwarded URLs differ only in origin. Preserve the daemon-provided `/view/...` path
verbatim so relative resources, absolute same-origin paths, redirects, range requests, and caching
behave the same on both transports.

## Failure and observability requirements

Expose enough state to distinguish the three layers:

- viewer host: preferred endpoint, actual endpoint, conflict fallback, active HTTP connections;
- local forwarder: server id, target, stable origin, current route generation, active streams;
- stream: tunnel id, source, state, byte counters, termination reason.

Do not log passwords, relay keys, viewer capability tokens, or configured filesystem paths.

The following outcomes are forbidden:

- a denied binary frame reported as successfully sent;
- a browser request left open after its stream owner has disappeared;
- closing one browser connection removes the local listener;
- switching direct/relay paths allocates a new local origin for the same Host;
- restarting the daemon requires a new local viewer URL while the desktop client remains alive;
- a client silently assumes port `8765` after the daemon selected a conflict fallback.

## Implementation boundaries

The viewer HTTP host owns HTTP routing and filesystem serving. The generic tunnel owns byte
transport, flow control, and per-stream lifetime. HostRuntime owns Host identity and path selection.
Electron main owns stable loopback listeners. Do not move concerns across these boundaries to avoid
adding a protocol field or lifecycle hook.

The implementation may require a new tunnel-stream capability for half-close and Reset semantics.
Gate it once and require both sides to upgrade; do not retain the old full-close behavior as a
fallback.
