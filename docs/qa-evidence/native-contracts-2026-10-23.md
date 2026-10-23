# Native contract closeout — 2026-10-23

This closeout starts from `f804a4d7889acf664fb825aa449c8334c7c5cb9c` and continues
COMPOSER-01 and VIEWER-03–05 under Works `item_a435ce98`. The implementation commits are
`663f180095f1e77faada48dfd29b832c7c339f4d` and `e672a40d0`. Existing TCP, E2EE relay, Electron and JVM
socket acceptance remains in [the viewer record](viewer-contracts-2026-10-22.md).
The fixed viewer specification, production daemon and Canvas geometry are unchanged.

## Composer

Android now implements the same native hardware-keyboard module as iOS. Its window
callback receives keys before the text input consumes them. Ordinary Enter stays
multiline; Ctrl/Cmd+Enter uses the current submit handler; unmodified Tab queues
only while the composer has a queue action. Composition, software-keyboard events,
modified Tab and disabled/loading inputs do not submit. Repeated key-down events
produce one action, and focus/background teardown returns control to the window.

The shared JS controller tests passed nine cases, including idle/running queue
transitions and current callbacks. The Android Gradle run passed all three hardware-key policy JUnit cases and
compiled both Expo modules. This record does not claim that a physical keyboard
or Android IME has been exercised.

## Viewer service lifetime

Headless JS tasks now carry their native service instance ID. A delayed task checks
whether that instance still exists after registering its completion callback; an
old stop cannot finish a replacement task. Three targeted tests passed: late start
after stop, old/new instance separation, and stop during the initial native query.
Two Android JS bridge tests also cover a delayed old-service Stop and replacement
listener creation during pending cleanup. Stop cleanup shares the listener mutation
queue and checks the current native service ID before closing routes or disabling
persisted assignments. Module destruction clears only its own event sink, startup
waiting is bounded, and service teardown releases superclass resources even if
event delivery throws.

## Two hosts with the same path

Two isolated daemons served the exact same path with different HTML contents:
`/view/v2/prj_same_report_fixture/card_98ac4cc9/files/files/index.html`.
The fixture used the WorkStore and project-registry owners to prepare temporary
records. It did not alter the tracked Works records or production state.

Chromium loaded each host's workspace in the combined preview on port 6779, opened
Works, expanded the topic details and clicked Report. The first popup showed
`Host A result` from port 36349; the second showed `Host B result` from port 33779.
Both returned deep links carried their actual server IDs. The page-error list was
empty. This proves the Works click path and server-generated links; Android OS
URI dispatch remains a separate device check.

## Build and device evidence

`build:client`, `build:app-deps`, Expo Android prebuild, full workspace typecheck, lint
and formatting passed. The controller/lifetime tests passed 12 cases; the Android
bridge tests passed two. Metro exported Android Hermes bytecode at `e672a40d0` after the package-version
audit confirmed no differences from the integration checkout. The actual Expo project passed `:paseo-hardware-keyboard:testReleaseUnitTest` and
`:paseo-viewer-proxy:compileReleaseKotlin` using `--configure-on-demand`, two workers
and `--no-daemon`. Both custom modules, Expo core and worklets completed their
Release Kotlin compilation. Gradle reported success in 1m 33s, with 33 tasks
executed and 51 up to date. The keyboard JUnit report records three tests and no
failures, errors or skips. APK packaging remains unverified.

The available SDK is `/tmp/paseo-viewer-sdk`, with API 36 and build-tools 35/36.
Java is 17.0.20.1 and Kotlin is 2.1.20. Gradle 9.3.1 was downloaded and checked against its official
SHA-256. The autolinking audit resolves all 59 Android projects inside the native worktree.
Native dependency copies and a separate Gradle home isolate subsequent build writes
from the integration checkout. The first configuration attempt found a remaining
package-level `expo-dev-launcher` link; its plugin wrote build caches in the
integration checkout before the link was replaced. The exact-version audit then
restored package-local versions before the final prebuild, export and compile.

The Markdown dependency initially lacked grammar assets. Its postinstall completed
using the pinned tree-sitter archive after SHA-256 verification. Slow direct Maven
downloads were replaced with official AAR downloads through the existing proxy,
verified against Maven SHA1s and added to the isolated Gradle cache. Earlier failed
and interrupted logs remain alongside the successful build log.

`adb devices -l` lists no devices. The SDK has no
emulator/system image installed, and the current user cannot write `/dev/kvm`.
Chrome/background transitions, notification Stop, physical hardware keys and OS
deep-link dispatch therefore have no device result from this run.

Retained evidence is in the owning issue's `native-closeout-evidence` directory:
`native-controls.log`, `native-stop.log`, `prebuild-corrected.log`, `typecheck-corrected.log`,
`lint-corrected.log`, `android-export.log`, `android-environment.json`,
`native-isolation.json`, `native-compile.log`, `native-build-receipt.json`,
`keyboard-junit.xml`, `native-aar-checksums.json`, `native-markdown-assets.log`, `two-host-proof.json`,
`two-host-A.png`, `two-host-B.png`, and `two-host-viewers.ts`.
