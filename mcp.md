# NovaGuard — MCP Server Specification

**Version:** 2.2.0  
**Status:** Implemented (`McpServerModule.kt`)  
**Target MCP specification:** `2026-07-28`  
**Scope:** Read access to NovaGuard surveillance data; opt-in live view; opt-in, non-destructive control by an agent; optional HTTPS

## 1. Purpose

Define the Model Context Protocol (MCP) interface of NovaGuard. NovaGuard performs person/animal detection, tracking and recording locally on Android; the MCP server lets an AI agent **analyse** what was recorded and, when the owner allows it on the device, **pilot** the camera. MCP stays outside the real-time vision path.

Typical requests:

- What happened last night? Show me who came in.
- Were there any people detected today?
- Is the camera actually seeing anything right now?
- Tell me as soon as someone is detected.
- Start surveillance; raise the threshold for animals; keep that passage.

## 2. Architectural principles

1. **Read by default, control and live view by consent.** Every read tool over what was recorded is available to a read token. Control tools exist only while the device's own switch "Autoriser le pilotage par un agent" is on, and answer only to the separate control token; the live view of what the camera sees now has its own switch, off by default.
2. **Nothing destructive, ever.** No tool deletes an event or a recording, edits the detection zone, the retention, a PIN or a token (§19).
3. **Control goes through the app.** The server holds no reference able to modify state; a control call is handed to the app, which carries it out with the same callbacks as its own buttons, or refuses it.
4. **Every control call is logged** on the device, refused ones included, and shown to the owner.
5. **Local-first.** Detection and recording remain on Android. MCP cannot block capture, inference, tracking or recording.
6. **Least privilege, privacy by default.** No public endpoint and no cloud upload by NovaGuard; only required metadata and media are exposed.
7. **Images, not files, for analysis.** `get_event_frames` returns stills as MCP image content; the MP4 resource exists to hand the file on.
8. **No identity inference.** MCP exposes NovaGuard's `Personne` / `Animal` classification and confidence only.
9. **Bounded queries.** Searches are paginated and time-bounded; long polls are capped.

## 3. Current NovaGuard model

The existing `DetectionEvent` is:

```typescript
interface DetectionEvent {
  id: number;
  kind: 'Personne' | 'Animal';
  timestamp: number;       // epoch ms
  dur: number;             // seconds
  conf: number;            // 0..1
  path: string | null;     // MP4 path
  bytes: number;
  thumbPath: string | null;
}
```

An event may exist without a recording (`path === null`). MCP MUST preserve this distinction.

The current storage model is:

```typescript
interface StorageInfo {
  free: number;
  total: number;
  used: number;
}
```

The current settings also contain camera, sensitivity, threshold, auto-zoom, CPU/GPU, precise detection, detection zone, post-roll, maximum duration, recording quality, retention, automatic deletion, notifications and local-stream configuration. Only safe diagnostic values may be exposed; `localStreamPin` MUST NEVER be exposed.

## 4. Architecture

```text
┌──────────────────────────── Android / NovaGuard ───────────────────────────┐
│ Camera → VisionCamera → TFLite → Tracking → DetectionEvent → MP4/JPEG      │
│                                                   │                        │
│ AppStateContext ── snapshot (history, status, settings) ──► McpServerModule│
│        ▲                                                    (Kotlin, HTTP) │
│        └──── control call (start/stop, thresholds…) ◄────────── │          │
└──────────────────────────────────────────────────────────────────┼─────────┘
                                                                   │ MCP / HTTP
                                                                   ▼
                                                         MCP client / agent
```

The server answers reads from a snapshot the app pushes when the history, the status or the settings change — never per frame. A control call is emitted to the app (`McpCommand`), executed by `executeMcpCommand`, and answered back; the HTTP request waits at most 5 s.

## 5. Deployment

- **Loopback** (no token): the socket binds `127.0.0.1` only. Reading needs no token there; control always needs the control token, so another app on the phone cannot switch the camera off.
- **LAN** (a read or control token is set): the socket binds all interfaces; every non-loopback request needs a token. The LAN address the server answers to (`Host`, certificate, URL shown) is the Wi-Fi, hotspot or Ethernet one; VPN and cellular interfaces are never taken for it (`McpRules.lanAddress`). Only IPv4 is served on the LAN. In plain HTTP the token is readable on a shared Wi-Fi.
- **HTTPS** (switch "Chiffrer les connexions", off by default): the phone creates its own authority once — EC P-256, private key in the Android Keystore, never exported — and issues under it a server certificate for its current addresses (loopback and the Wi-Fi IP), reissued at the next handshake when the address changes. The owner installs the authority's PEM on the client once (system store, or `NODE_EXTRA_CA_CERTS` for Node clients) and compares the SHA-256 fingerprint Réglages shows. Every connection, loopback included, is then TLS. Certificates are built by `McpCertificates.java`, which `scripts/test-presence-native.sh` parses back, verifies and uses in a real TLS handshake.
- **Discovery.** On the LAN the server is advertised over DNS-SD as `NovaGuard`, type `_novaguard-mcp._tcp`, TXT `path=/mcp`, `auth=bearer`: the phone's address is a DHCP lease, and a client that browses (`dns-sd -B _novaguard-mcp._tcp`, `avahi-browse -r _novaguard-mcp._tcp`) finds it again after it moves. Réglages also shows the client configuration as a QR code.
- Public Internet exposure and port forwarding are not supported.
- Client-by-client connection guides, and what each client can and cannot reach: [`docs/CONNEXION.md`](docs/CONNEXION.md).
- The server lives in the app's process. Android only lets a camera foreground service start while the app is on screen, so `start_surveillance` from the background is refused with a clear message; stopping works at any time.

## 6. Android networking/privacy impact

The app declares Android `INTERNET` only so that the two optional local servers (MCP and Wi-Fi live view) can listen; both are off by default and NovaGuard opens no outgoing connection (`__tests__/playRelease.test.ts` checks the sources).

Default state:

```text
MCP disabled → no listening socket → no network exposure
```

Enabled state:

```text
MCP enabled → reads authenticated beyond loopback → control only with the device switch and the control token
```

Documentation MUST explain why networking is required, where the server listens, how authentication works, whether traffic can leave the device, and how the feature is disabled.

## 7. MCP capabilities

Target protocol: MCP `2026-07-28`.

```json
{
  "capabilities": {
    "tools": { "listChanged": false },
    "resources": { "subscribe": false, "listChanged": false },
    "prompts": { "listChanged": false }
  }
}
```

`initialize` returns the requested version when it is one of `2024-11-05`, `2025-03-26`, `2025-06-18`, `2026-07-28`, and `2026-07-28` otherwise. Every response carries `MCP-Protocol-Version`: the negotiated version on `initialize`, the client's own header afterwards; a later request whose header names an unknown version is HTTP 400, and a request without the header (clients older than 2025-06-18) is answered without it.

Control tools appear in `tools/list` only while control is enabled on the device and the control token has not expired; `get_live_frame` only while the owner's live-view switch is on.

## 7.1 Prompts

| Prompt | Arguments | What it asks the agent |
|---|---|---|
| `night_report` | `date` (YYYY-MM-DD, evening the night starts on; default the last night that has begun) | Status first, then the events from 20:00 to 08:00 device time, one look at the frames per passage, a one-line conclusion. |
| `review_alerts` | `hours` (1–168, default 24) | Classify each recent passage from its frames; list those worth attention first. |
| `diagnose_camera` | — | Status, diagnostics and storage; say whether someone would be filmed now, and why passages may be missed. |

`prompts/get` returns one `user` message whose search window is already written as instants: the night is computed in the device's time zone (DST included), which an agent cannot know. An unknown prompt or argument is JSON-RPC `-32602`.

# 8. MCP Tools

§8.1–§8.10, §8.12 and §8.13 are read tools. §8.11 lists the control tools.

## 8.1 `novaguard.get_status`

Returns high-level surveillance status.

Input:

```json
{"type":"object","additionalProperties":false}
```

Output:

```json
{
  "surveillanceActive": true,
  "status": "camera-obstructed",
  "statusSince": "2026-09-12T03:12:08Z",
  "healthy": false,
  "camera": "Arrière (1×)",
  "lastDetectionAt": "2026-09-12T10:41:32+01:00",
  "detectionsToday": 4,
  "storage": {
    "usedBytes": 734003200,
    "freeBytes": 12884901888,
    "totalBytes": 67108864000
  }
}
```

No filesystem path, PIN, token or credential may be returned.

`status` is the status the device itself shows: `inactive`, `starting`, `active`, `recording`, or a fault — `camera-unavailable`, `camera-obstructed` (black picture: lens covered or room unlit), `camera-moved` (field of view changed with nobody tracked), `storage-insufficient`, `analysis-unavailable`, `recording-error`. `healthy` is false on a fault. A client MUST NOT read an absence of events during an unhealthy period as an absence of activity.

## 8.2 `novaguard.search_events`

Primary surveillance-history query.

Input schema:

```json
{
  "type":"object",
  "additionalProperties":false,
  "properties":{
    "from":{"type":"string","format":"date-time"},
    "to":{"type":"string","format":"date-time"},
    "kind":{"type":"string","enum":["Personne","Animal"]},
    "minConfidence":{"type":"number","minimum":0,"maximum":1},
    "hasVideo":{"type":"boolean"},
    "limit":{"type":"integer","minimum":1,"maximum":100},
    "offset":{"type":"integer","minimum":0,"maximum":10000},
    "sort":{"type":"string","enum":["timestamp_desc","timestamp_asc"]}
  }
}
```

Rules:

- ISO-8601 timestamps;
- default range: last 24 hours when omitted;
- maximum range: 90 days per request;
- default limit: 20;
- maximum limit: 100;
- deterministic ordering;
- no internal filesystem paths.

Output:

```json
{
  "events":[
    {
      "id":1042,
      "kind":"Personne",
      "timestamp":"2026-09-12T09:21:44+01:00",
      "durationSeconds":18,
      "confidence":0.94,
      "hasVideo":true,
      "videoResourceUri":"novaguard://video/1042",
      "thumbnailResourceUri":"novaguard://thumbnail/1042",
      "sizeBytes":18432000
    }
  ],
  "total":1,
  "limit":20,
  "offset":0
}
```

## 8.3 `novaguard.get_event`

Input:

```json
{
  "type":"object",
  "additionalProperties":false,
  "required":["eventId"],
  "properties":{"eventId":{"type":"integer","minimum":0,"maximum":999999999999999}}
}
```

Event ids are epoch milliseconds (up to 15 digits); a 32-bit bound rejects every real event.

Output contains `id`, `kind`, `timestamp`, `durationSeconds`, `confidence` (in `[0,1]`), `hasVideo`, `sizeBytes`, `videoResourceUri` and `thumbnailResourceUri` where available, `passageId` (shared by the clips of one visit, `null` on older clips), `kinds` (every kind seen during the passage), `kept` (exempt from retention and automatic deletion), `subjectTracked` (the event recorded where its subject was, so `get_event_frames` can crop to it) and `agentNote` (`{verdict, text, at}` left by `annotate_event`, or `null`).

## 8.4 `novaguard.get_latest_events`

Convenience query.

```json
{
  "type":"object",
  "additionalProperties":false,
  "properties":{
    "kind":{"type":"string","enum":["Personne","Animal"]},
    "limit":{"type":"integer","minimum":1,"maximum":20}
  }
}
```

Default limit: 5.

## 8.5 `novaguard.get_statistics`

Returns aggregate statistics without media.

Input:

```json
{
  "type":"object",
  "additionalProperties":false,
  "required":["from","to"],
  "properties":{
    "from":{"type":"string","format":"date-time"},
    "to":{"type":"string","format":"date-time"},
    "groupBy":{"type":"string","enum":["hour","day","kind"]}
  }
}
```

Example output:

```json
{
  "period":{"from":"2026-09-01T00:00:00+01:00","to":"2026-09-12T00:00:00+01:00"},
  "total":42,
  "persons":19,
  "animals":23,
  "averageConfidence":0.89,
  "withVideo":41,
  "withoutVideo":1
}
```

Statistics MUST be calculated from persisted events, not notifications.

## 8.6 `novaguard.get_storage`

Returns measured storage information:

```json
{
  "usedBytes":734003200,
  "freeBytes":12884901888,
  "totalBytes":67108864000,
  "eventCount":42,
  "videoCount":41
}
```

## 8.7 `novaguard.get_configuration`

Returns safe diagnostic configuration, for example:

```json
{
  "camera":"Arrière (1×)",
  "detection":{
    "person":true,
    "animal":true,
    "sensitivity":"Moyenne",
    "threshold":0.6,
    "preciseDetection":false,
    "autoZoom":true,
    "zoneConfigured":false,
    "ignoredZones":1
  },
  "recording":{
    "quality":"1080p",
    "postRoll":"10 s",
    "maxClipDuration":"5 min",
    "retention":"30 jours",
    "automaticDeletion":true
  },
  "notifications":{
    "enabled":true,
    "detectionNotifications":true,
    "alertPicture":true,
    "quietHours":{"start":22,"end":7}
  }
}
```

`quietHours` is `null` when off; `start` and `end` are local hours on the phone, `start` included, `end` excluded. During them no alert is shown, and passages are still recorded. `ignoredZones` counts the parts of the frame where nothing counts.

Forbidden fields: `localStreamPin`, credentials, access tokens, Android permission tokens and arbitrary absolute paths.

## 8.8 `novaguard.get_camera_info`

Returns safe camera diagnostics only:

```json
{"camera":"Arrière (1×)","active":true,"streamEnabled":false}
```

No camera-control operation exists.

## 8.9 `novaguard.get_event_frames`

Returns stills sampled across an event's clip, as MCP `image` content — the form a model actually looks at.

Input:

```json
{
  "type":"object",
  "additionalProperties":false,
  "required":["eventId"],
  "properties":{
    "eventId":{"type":"integer","minimum":0,"maximum":999999999999999},
    "count":{"type":"integer","minimum":1,"maximum":8},
    "maxEdge":{"type":"integer","minimum":160,"maximum":1280},
    "framing":{"type":"string","enum":["full","subject"]}
  }
}
```

Output: a `text` block `{"eventId","source":"video"|"thumbnail","frames":[{"index","offsetSeconds","cropped"}]}`, then one `image/jpeg` block per frame. Frames sit at the middle of `count` equal slices of the clip (default 4, longest side default 768 px), decoded already scaled, one extraction at a time. Without a clip, the event's thumbnail is returned; without either, the result carries `isError` and `NOVAGUARD_MEDIA_UNAVAILABLE`.

`framing: "subject"` crops each still around where the subject was at that moment — the box recorded with the event (`subjectTracked: true`, one sample a second at most), grown by half on every side, never under 35 % of the frame, decoded larger first so the crop keeps detail (at most 1920 px). An event without a recorded subject (older clips) gets whole frames, each marked `cropped: false`.

## 8.10 `novaguard.wait_for_event`

Long poll: returns as soon as an event newer than `afterEventId` is recorded (default: the newest at call time), or after `timeoutSeconds` (1–25, default 20). Output: `{"events":[…],"timedOut":bool,"latestEventId":n,"status":{…}}`. Passing the previous `latestEventId` back never misses an event.

## 8.11 Control tools (control token, device switch on)

| Tool | Arguments | Effect |
|---|---|---|
| `start_surveillance` | — | Starts surveillance. Refused if the camera permission is missing or the app is not on screen. |
| `stop_surveillance` | — | Stops surveillance. |
| `set_sensitivity` | `sensitivity`: `Basse`/`Moyenne`/`Haute` | Same as the Réglages control. |
| `set_thresholds` | `person`, `animal` ∈ [0.5, 0.95], at least one | Entry thresholds per kind. |
| `keep_event` | `eventId`, `kept` | Keeps or releases the event's whole passage (exempt from retention and automatic deletion). |
| `acknowledge_alert` | — | Acknowledges `camera-moved`; `camera-obstructed` cannot be acknowledged, it clears when the camera sees again. |
| `annotate_event` | `eventId`, `verdict`: `false_alarm`/`expected`/`attention`/`note`, `note` (≤ 280 characters) | Leaves the agent's verdict on the event, shown in Historique (card and sheet). Replaces the previous one; the owner can clear it. Read back as `agentNote` on the event. |

Every control tool is idempotent and returns `changed`. A call with a read token is a JSON-RPC error `NOVAGUARD_AUTH_FORBIDDEN` (HTTP 403); a refusal by the app (no permission, background, unknown event) is a result carrying `isError`.

## 8.12 `novaguard.get_diagnostics`

Why the camera may miss or cut passages. No arguments.

```json
{
  "clipGap": {"samples":3,"meanMs":420,"worstMs":610,"lastFinalizeMs":300,"lastRestartMs":110},
  "autoTune": {"enabled":true,"given":["autoZoom"],"blocked":[],"measuredFps":2.4,"targetFps":5},
  "cameraSession": "healthy",
  "crashedStage": null,
  "device": {"thermalStatus":0,"batteryPercent":81,"charging":true}
}
```

`clipGap` is the time between two clips of one passage (`finalize` the encoder's, `restart` the app's); `null` until measured. `autoTune.given` are the settings the app gave up to keep its analysis rate, in order; `measuredFps`/`targetFps` are the figures of its last decision. `crashedStage` names the analysis step a previous launch never returned from (`camera`, `resize`, `inference`, `faces`, `report`). `device` is read at call time: `thermalStatus` is Android's `PowerManager` scale (0 none … 6 shutdown, -1 unknown).

## 8.13 `novaguard.get_live_frame`

What the camera sees now, as one `image/jpeg` block after a `text` block `{"capturedAt","status"}`. Argument: `maxEdge` (160–1280, default 768). Advertised only while the owner's switch "Vue en direct pour l'agent" is on (off by default), answered only while surveillance runs; otherwise `NOVAGUARD_DEVICE_UNAVAILABLE`, and `NOVAGUARD_TIMEOUT` if no frame arrives within 3 s (camera interrupted). Nothing is recorded. The frame processor offers a frame twice a second to a native plugin that does nothing until a request is pending; the YUV copy, JPEG encoding, downscale and rotation happen only then, off the camera thread except for the copy.

# 9. MCP Resources

URI scheme:

```text
novaguard://event/{eventId}
novaguard://video/{eventId}
novaguard://thumbnail/{eventId}
novaguard://timeline/{date}
novaguard://statistics/{period}
novaguard://status
```

Every URI MUST be strictly validated. Unknown schemes, path traversal and arbitrary file references MUST be rejected.

A resource that cannot be produced — unknown event, missing file — is JSON-RPC error `-32002`.

### `novaguard://event/{eventId}`

MIME: `application/json`. Canonical event metadata.

### `novaguard://thumbnail/{eventId}`

MIME: `image/jpeg`. Available only when a valid thumbnail exists.

### `novaguard://video/{eventId}`

MIME: `video/mp4`. Resolves only to the recording associated with that event. It MUST NOT expose `file://`, raw Android paths, `content://` identifiers or arbitrary filenames. Prefer an authenticated media endpoint/resource link rather than embedding the complete MP4 in the LLM context.

### `novaguard://timeline/{date}`

One calendar day only. Returns a compact chronological event list.

Example:

```json
{
  "date":"2026-09-12",
  "events":[
    {"id":1042,"time":"09:21:44","kind":"Personne","confidence":0.94,"durationSeconds":18},
    {"id":1043,"time":"10:03:18","kind":"Animal","confidence":0.88,"durationSeconds":7}
  ]
}
```

### `novaguard://status`

Same information as `novaguard.get_status`.

# 10. Media handling

Recommended sequence:

```text
LLM asks for event
      ↓
get_event
      ↓
metadata + resource URI
      ↓
get_event_frames to look at it   (images in the tool result)
      ↓
video resource only to hand the file on
```

The video resource carries the whole MP4 as base64 and is capped at 20 MB on the device; most clients cannot read it. Analysis goes through `get_event_frames`.

A video resource MUST:

- require the same authenticated principal as metadata;
- be bound to an event ID;
- verify that the file exists;
- verify that it resides in NovaGuard's approved media directory;
- reject traversal and arbitrary filenames;
- return controlled `NOVAGUARD_MEDIA_UNAVAILABLE` when retention removed the file.

Recommended operational limits:

- thumbnail <= 2 MB;
- video fetch <= 250 MB by default;
- maximum 2 concurrent video streams.

# 11. Query semantics

### Time

NovaGuard stores epoch milliseconds. MCP serializes ISO-8601 with explicit offset or `Z`. The Android device timezone SHOULD be used unless the client supplies a timezone.

### Confidence

Confidence remains the detector confidence in `[0,1]`. It MUST NOT be described as identity certainty or intent probability.

### Classification

MCP preserves exactly `Personne` and `Animal`. It MUST NOT invent species, identities or behaviours absent from NovaGuard's detector.

### Duration

`dur` becomes `durationSeconds`. MCP MUST NOT claim an exact physical dwell time beyond the semantics guaranteed by event segmentation.

# 12. Error model

Recommended application codes:

```text
NOVAGUARD_NOT_FOUND
NOVAGUARD_INVALID_ARGUMENT
NOVAGUARD_RANGE_TOO_LARGE
NOVAGUARD_LIMIT_EXCEEDED
NOVAGUARD_MEDIA_UNAVAILABLE
NOVAGUARD_MEDIA_FORBIDDEN
NOVAGUARD_STORAGE_UNAVAILABLE
NOVAGUARD_DEVICE_UNAVAILABLE
NOVAGUARD_AUTH_REQUIRED
NOVAGUARD_AUTH_FORBIDDEN
```

Errors MUST NOT leak filesystem paths, stack traces, tokens or credentials.

# 13. Security

## Control guarantee

The server cannot modify NovaGuard state by itself. Control is a request the app carries out with its own callbacks and the seven commands of §8.11 only; everything in §19 is unreachable by construction and refused by name.

## Authentication

Two bearer tokens, generated on the device with a CSPRNG and compared by SHA-256 digest in constant time:

- **read token** — every read tool and resource;
- **control token** — read tools plus §8.11, honoured only while the device's control switch is on and until it expires.

Loopback reads need no token; loopback control does.

Transport is plain HTTP unless the owner turns on HTTPS (§5): the tokens then travel encrypted, under a device authority the client trusts once.

The control token has a lifetime chosen on the device — 1 h, 24 h (default) or none — counted from when it is issued or the lifetime changed. The server enforces it: past its end the token grants nothing, not even reading (a LAN caller gets `NOVAGUARD_AUTH_REQUIRED`, "expired"). While control is possible, the surveillance notification carries **Couper le pilotage**: one tap drops the control token in the server at once, answers a call in flight with `NOVAGUARD_AUTH_FORBIDDEN`, and turns the device switch off.

## Audit

Every control call is logged on the device (time, command, applied / unchanged / refused), kept across restarts and shown in Réglages → Serveur MCP. Tokens and media are never logged.

# 14. Privacy

The default design MUST NOT:

- upload recordings to cloud storage;
- send frames to an AI vision service;
- perform face recognition;
- create biometric identifiers;
- identify individuals;
- expose arbitrary Android storage;
- expose `localStreamPin`;
- expose raw filesystem paths.

The user-facing documentation MUST explicitly state that if the MCP client uses a remote LLM, selected surveillance metadata/media can leave the phone even though NovaGuard's own processing remains local.

# 15. Performance

MCP MUST NOT participate in the real-time pipeline.

Recommended targets:

| Operation | Target |
|---|---:|
| status | < 100 ms |
| get_event | < 100 ms |
| latest events | < 200 ms |
| search_events | < 500 ms |
| statistics | < 1 s |
| thumbnail | < 1 s excluding transfer |
| video start | < 1 s excluding network |

Search MUST be paginated for large datasets.

# 16. Caching

Recommended TTLs:

```text
status:        2 s
configuration: 10 s
statistics:    5 s
events:        2 s
media:         no cache
```

Where supported by the selected SDK, use MCP response cache metadata such as `ttlMs` and `cacheScope`.

# 17. Consistency/race conditions

Retention may delete media after metadata retrieval. Therefore metadata is authoritative at query time and media availability is checked at resource-read time.

Example:

```text
09:00:00 get_event(42) → videoResourceUri returned
09:00:01 retention cleanup deletes video
09:00:02 resources/read(video/42) → MEDIA_UNAVAILABLE
```

This is expected and MUST be handled gracefully.

# 19. Explicitly forbidden MCP operations

The following MUST NOT exist:

```text
arm_camera
disarm_camera
set_camera
set_detection_threshold
set_detection_zone
set_recording_quality
set_retention
set_notification_settings
delete_event
delete_video
clear_history
change_stream_pin
restart_camera
update_configuration
```

Control is limited to what the owner can undo at a glance; anything whose damage would only be discovered later stays out.

# 20. Natural-language examples

### "Que s'est-il passé cette nuit ?"

```text
prompts/get night_report            → the window is computed in the phone's time zone
novaguard_get_status                → an empty night means nothing from a covered camera
novaguard_search_events from/to as the prompt gives, sort = timestamp_asc
novaguard_get_event_frames eventId = first event of each passage, framing = subject
```

### "Y a-t-il eu des personnes aujourd'hui ?"

```text
novaguard_search_events
  kind = Personne
  from = start of local day
  to   = now
```

### "Montre-moi la dernière détection."

```text
novaguard_get_latest_events limit = 1
novaguard_get_event_frames  eventId = <id>, framing = subject
```

### "Qu'est-ce que la caméra voit maintenant ?"

```text
novaguard_get_live_frame            → only if the owner turned on the live view
```

### "Préviens-moi dès que quelqu'un arrive."

```text
novaguard_wait_for_event kind = Personne   → call again with afterEventId = latestEventId
```

### "Ce passage était le facteur, note-le."

```text
novaguard_annotate_event eventId = <id>, verdict = expected, note = "Facteur, colis déposé."
```

### "Le téléphone manque-t-il d'espace ? Rate-t-il des passages ?"

```text
novaguard_get_storage
novaguard_get_diagnostics           → or prompts/get diagnose_camera
```

# 21. Test strategy

## Contract tests

Each tool MUST test: valid request, empty result, malformed input, boundaries, maximum limit, excessive date range, event not found, event without video, media deleted after lookup, authentication failure and authorization failure.

## Security tests

Mandatory: path traversal, arbitrary URI, arbitrary media identifier, token leakage, filesystem path leakage, unauthenticated LAN access and access outside the configured media directory.

## Performance tests

Datasets SHOULD cover 1,000, 10,000 and 100,000 events. Searches MUST remain paginated and MUST NOT load the entire video archive into memory.

# 22. Implementation

```text
android/app/src/main/java/com/novaguard/surveillance/
├── McpServerModule.kt   # HTTP(S) transport, JSON-RPC, auth, tools, control bridge, wait_for_event, DNS-SD
├── McpCatalog.kt        # advertised tools/resources/prompts and the validation derived from them
├── McpSnapshot.kt       # what reads answer from
├── McpFrames.kt         # stills for get_event_frames, whole or cropped to the subject
├── LiveFramePlugin.kt   # get_live_frame: frame processor plugin, idle until a request is pending
├── McpTls.kt            # device authority (Android Keystore) and per-address server certificates
├── McpCertificates.java # X.509 builder, tested on the JVM with a real TLS handshake
├── McpPrompts.java      # prompts and their time windows, tested on the JVM
├── McpRules.java        # pure decisions, tested on the JVM (scripts/test-presence-native.sh)
└── SurveillanceService.kt  # notification action "Couper le pilotage"
src/surveillance/
├── mcpServer.ts         # snapshot (diagnostics, subject trail, agent notes) and native bridge
├── mcpCommands.ts       # the seven control commands
├── mcpControl.ts        # control token lifetime, live-view gating
├── mcpServices.ts       # what the "Services MCP" page lists, checked against McpCatalog.kt
└── agentLog.ts          # the owner-visible log of control calls
src/recording/subjectTrail.ts  # where the subject was in each clip, for framing "subject"
src/utils/qr.ts          # QR encoder for the client configuration
```

# 23. Evolution path

Done since v1: passage grouping, recording and camera diagnostics (`get_diagnostics`), the `timeline` resource, stills cropped to the subject, the live view, HTTPS.

Future versions MAY add:

- activity heatmaps and hourly/daily activity profiles;
- storage forecast;
- model/version information and detection pipeline metrics beyond the self-tuning figures;
- local-stream health status;
- server push (`resources/subscribe` over a streamed transport) in place of the `wait_for_event` long poll;
- event similarity search, provided it does not become biometric identification.

# 24. Acceptance criteria

- [x] Read tools and resources bounded, paginated, timezone-aware.
- [x] `localStreamPin` and filesystem paths never exposed.
- [x] Control tools absent unless the device switch is on, and refused without the control token.
- [x] No operation can delete an event or recording, or change zone, retention, PIN or token.
- [x] Every control call logged on the device.
- [x] Confidence on `[0,1]`; `Personne` / `Animal` preserved.
- [x] Agents see stills (`get_event_frames`) without loading clips in memory, cropped to the subject on request.
- [x] Live view behind its own switch, off by default; the frame path is idle until a request is pending.
- [x] Control token time-limited, enforced by the server, revocable from the notification.
- [x] Optional HTTPS under a device authority whose key never leaves the Android Keystore; certificates verified on the JVM by a real TLS handshake.
- [ ] Verified on a device (`docs/DEVICE_CHECKS.md`): control from the foreground, refusal from the background, `wait_for_event` wake-up, 9th concurrent client refused, live view orientation, subject crop with the front camera, HTTPS across an IP change.

# 25. Architectural decision

**Decision (v2):** NovaGuard MCP is a read interface over the local surveillance model plus an **opt-in, non-destructive control plane**, carried out by the app itself.

```text
REAL-TIME   Camera → EfficientDet-Lite → Tracking → DetectionEvent → MP4/JPEG
READ        App snapshot → McpServerModule → MCP client
LIVE        MCP client → McpServerModule → McpLiveFrame ← LiveFramePlugin (frame processor, idle until asked)
CONTROL     MCP client → McpServerModule → app (executeMcpCommand) → same callbacks as the UI
```

v1 was read-only by construction; v2 keeps that construction for the server and moves every change of state into the app, behind a device switch and a separate token.

## References

- MCP 2026-07-28 specification: https://modelcontextprotocol.io/specification/2026-07-28
- MCP Tools: https://modelcontextprotocol.io/specification/2026-07-28/server/tools
- MCP Resources: https://modelcontextprotocol.io/specification/2026-07-28/server/resources
- NovaGuard: https://github.com/devdownin/novaguard
