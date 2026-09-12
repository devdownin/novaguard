# NovaGuard — MCP Read-Only Server Specification

**Version:** 1.0.0  
**Status:** Proposed  
**Target MCP specification:** `2026-07-28`  
**Scope:** Read-only access to NovaGuard surveillance data

## 1. Purpose

Define a read-only Model Context Protocol (MCP) interface for NovaGuard. NovaGuard performs person/animal detection, tracking and recording locally on Android. MCP must remain outside the real-time vision path and must never modify surveillance state.

Typical queries:

- What happened last night?
- Were there any people detected today?
- Show me the last animal detection.
- How many detections occurred this week?
- Show me the video for event 1042.
- How much storage is available?

The MCP server MUST NOT start/stop surveillance, change settings, delete events, delete recordings, alter retention, change detection zones or otherwise mutate NovaGuard state.

## 2. Architectural principles

1. **Read-only by construction.** No write/control tools.
2. **Local-first.** Detection and recording remain on Android.
3. **MCP is not part of computer vision.** It cannot block capture, inference, tracking or recording.
4. **Least privilege.** Expose only required metadata/media.
5. **Privacy by default.** No public endpoint and no cloud upload by NovaGuard.
6. **Explicit media retrieval.** Event queries return resource URIs; MP4 bytes are fetched only when explicitly requested.
7. **No identity inference.** MCP exposes NovaGuard's `Personne` / `Animal` classification and confidence only.
8. **Bounded queries.** Searches are paginated and time-bounded.
9. **Stable contract.** The MCP model is derived from NovaGuard's current local event model.

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

## 4. Target architecture

```text
                         READ-ONLY PATH

┌────────────────────────── Android / NovaGuard ─────────────────────────┐
│                                                                        │
│ Camera → VisionCamera → TFLite → Tracking → DetectionEvent            │
│                                                    │                   │
│                                                    ├→ MP4              │
│                                                    ├→ Thumbnail        │
│                                                    └→ Local persistence │
│                                                        │               │
│                                                        ▼               │
│                                              NovaGuard Read API        │
└──────────────────────────────────────────────────────┬─────────────────┘
                                                       │ authenticated
                                                       ▼
                                          ┌─────────────────────────┐
                                          │ NovaGuard MCP Gateway   │
                                          │ tools + resources       │
                                          └────────────┬────────────┘
                                                       │ MCP
                                                       ▼
                                                MCP Client / LLM
```

### Responsibilities

**Android:** capture, inference, tracking, event creation, recording, thumbnails, retention, local persistence.

**Read API:** expose a narrow read-only domain API; validate queries; never expose arbitrary filesystem paths or credentials.

**MCP gateway:** translate MCP tools/resources to the read API; enforce bounds, authentication and authorization; return structured MCP results.

**LLM/client:** interpret natural language and request read-only information.

## 5. Deployment

### 5.1 Recommended: companion MCP gateway on trusted LAN

```text
Android phone ── HTTPS/read-only ──> NovaGuard MCP Gateway ── MCP ──> AI client
```

The Android read API is enabled only when explicitly configured. HTTPS is preferred. Authentication is mandatory for non-loopback access. Public Internet exposure and port forwarding are prohibited by default.

### 5.2 Loopback

For local development, bind the gateway/read API to loopback where possible.

### 5.3 Remote deployment

A remote gateway is allowed only with authenticated encrypted transport. The Android read API MUST NOT be directly exposed to the public Internet.

## 6. Android networking/privacy impact

The current release intentionally does not declare Android `INTERNET`. Adding an HTTP read API is therefore an explicit privacy/architecture change.

Default state:

```text
MCP disabled → no listening socket → no network exposure
```

Enabled state:

```text
MCP read API → read-only → authenticated → loopback/LAN only
```

Documentation MUST explain why networking is required, where the server listens, how authentication works, whether traffic can leave the device, and how the feature is disabled.

## 7. MCP capabilities

Target protocol: MCP `2026-07-28`.

```json
{
  "capabilities": {
    "tools": { "listChanged": false },
    "resources": { "subscribe": false, "listChanged": false }
  }
}
```

No control prompts are exposed. The server SHOULD remain stateless with respect to surveillance data.

# 8. MCP Tools

All tools are read-only.

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
  "properties":{"eventId":{"type":"integer","minimum":0}}
}
```

Output contains `id`, `kind`, `timestamp`, `durationSeconds`, `confidence`, `hasVideo`, `sizeBytes`, `videoResourceUri` and `thumbnailResourceUri` where available.

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
    "zoneConfigured":false
  },
  "recording":{
    "quality":"1080p",
    "postRoll":"10 s",
    "maxClipDuration":"5 min",
    "retention":"30 jours",
    "automaticDeletion":true
  },
  "notifications":{"enabled":true,"detectionNotifications":true}
}
```

Forbidden fields: `localStreamPin`, credentials, access tokens, Android permission tokens and arbitrary absolute paths.

## 8.8 `novaguard.get_camera_info`

Returns safe camera diagnostics only:

```json
{"camera":"Arrière (1×)","active":true,"streamEnabled":false}
```

No camera-control operation exists.

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
client explicitly requests media
      ↓
video/thumbnail fetched
```

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

## Read-only guarantee

The MCP server MUST have no credential capable of modifying NovaGuard state. The upstream API SHOULD expose only read endpoints rather than generic CRUD.

Required API surface:

```text
GET /api/v1/status
GET /api/v1/events
GET /api/v1/events/{id}
GET /api/v1/events/{id}/thumbnail
GET /api/v1/events/{id}/video
GET /api/v1/statistics
GET /api/v1/storage
GET /api/v1/configuration
```

No POST/PUT/PATCH/DELETE endpoint is required.

## Authentication

Authentication is mandatory beyond loopback. Preferred options:

1. mTLS in controlled deployments;
2. OAuth/OIDC at the MCP gateway for multi-user deployments;
3. strong bearer token for simple single-user LAN deployment;
4. loopback-only for development.

## Authorization

Preferred scope:

```text
novaguard:read
```

Optional:

```text
novaguard:events:read
novaguard:statistics:read
novaguard:media:read
novaguard:configuration:read
```

A principal with event-read but no media-read MUST still be able to query metadata.

## Audit

Gateway SHOULD log timestamp, principal, MCP operation, event ID, response status, duration and media bytes. It MUST NOT log video contents, bearer tokens or credential-bearing URLs.

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

# 18. REST-to-MCP mapping

| REST | MCP |
|---|---|
| `GET /status` | `novaguard.get_status` / `novaguard://status` |
| `GET /events` | `novaguard.search_events` |
| `GET /events/{id}` | `novaguard.get_event` / `novaguard://event/{id}` |
| latest query | `novaguard.get_latest_events` |
| `GET /statistics` | `novaguard.get_statistics` |
| `GET /storage` | `novaguard.get_storage` |
| `GET /configuration` | `novaguard.get_configuration` |
| `GET /events/{id}/thumbnail` | `novaguard://thumbnail/{id}` |
| `GET /events/{id}/video` | `novaguard://video/{id}` |

# 19. Explicitly forbidden MCP operations

The following MUST NOT exist in v1:

```text
start_surveillance
stop_surveillance
arm_camera
disarm_camera
set_camera
set_detection_threshold
set_detection_zone
set_sensitivity
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

NovaGuard MCP is an observability interface, not a control plane.

# 20. Natural-language examples

### "Que s'est-il passé cette nuit ?"

```text
novaguard.search_events
  from = previous 22:00
  to   = today 07:00
  sort = timestamp_asc
```

### "Y a-t-il eu des personnes aujourd'hui ?"

```text
novaguard.search_events
  kind = Personne
  from = start of local day
  to   = now
```

### "Montre-moi la dernière détection."

```text
novaguard.get_latest_events
  limit = 1
```

The client can then explicitly fetch the thumbnail/video resource.

### "Combien d'animaux cette semaine ?"

```text
novaguard.get_statistics
  from = start of 7-day period
  to   = now
  groupBy = kind
```

### "Le téléphone manque-t-il d'espace ?"

```text
novaguard.get_storage
```

# 21. Test strategy

## Contract tests

Each tool MUST test: valid request, empty result, malformed input, boundaries, maximum limit, excessive date range, event not found, event without video, media deleted after lookup, authentication failure and authorization failure.

## Security tests

Mandatory: path traversal, arbitrary URI, arbitrary media identifier, token leakage, filesystem path leakage, unauthenticated LAN access and access outside the configured media directory.

## Performance tests

Datasets SHOULD cover 1,000, 10,000 and 100,000 events. Searches MUST remain paginated and MUST NOT load the entire video archive into memory.

# 22. Implementation recommendation

A small dedicated MCP gateway is preferred over embedding the complete MCP stack into React Native.

```text
novaguard-mcp/
├── transport/              # MCP HTTP transport
├── tools/
│   ├── get_status
│   ├── search_events
│   ├── get_event
│   ├── get_latest_events
│   ├── get_statistics
│   ├── get_storage
│   └── get_configuration
├── resources/
│   ├── event
│   ├── timeline
│   ├── thumbnail
│   └── video
├── client/                 # NovaGuardReadApiClient
├── security/
│   ├── authentication
│   └── authorization
└── tests/
```

The gateway should remain stateless with respect to surveillance data; NovaGuard remains the source of truth.

# 23. Evolution path

Future read-only versions MAY add:

- event grouping by passage/session;
- activity heatmaps;
- hourly/daily activity profiles;
- storage forecast;
- recording diagnostics;
- camera health diagnostics;
- detection pipeline performance metrics;
- model/version information;
- local-stream health status;
- event similarity search, provided it does not become biometric identification.

A useful future resource is:

```text
novaguard://timeline/{date}
```

for efficient chronological summaries.

# 24. Acceptance criteria

- [ ] MCP `2026-07-28` supported by the selected SDK/transport.
- [ ] Only read-only tools/resources exposed.
- [ ] No operation can modify NovaGuard state.
- [ ] No operation can delete an event or recording.
- [ ] `localStreamPin` never exposed.
- [ ] No arbitrary filesystem path is addressable.
- [ ] Event searches are bounded and paginated.
- [ ] ISO-8601 timezone-aware timestamps.
- [ ] `Personne` / `Animal` preserved exactly.
- [ ] Confidence remains `[0,1]`.
- [ ] Events without recordings handled correctly.
- [ ] Expired recordings return controlled errors.
- [ ] Media is fetched explicitly, not embedded in every event response.
- [ ] Authentication required outside loopback.
- [ ] MCP credentials cannot modify NovaGuard.
- [ ] MCP cannot block camera/inference/tracking/recording.
- [ ] Security tests cover traversal and arbitrary media access.
- [ ] Performance tested with at least 10,000 events.
- [ ] Privacy documentation explains remote-LLM data transfer implications.

# 25. Architectural decision

**Decision:** NovaGuard MCP v1 is a **read-only observability interface** over the existing local surveillance event model.

Canonical separation:

```text
REAL-TIME
Camera → VisionCamera → EfficientDet-Lite → Tracking
       → DetectionEvent → MP4/thumbnail → Local persistence

READ
Local persistence → NovaGuard Read API → MCP Gateway → MCP Client → LLM
```

This preserves NovaGuard's core local-processing model while providing a natural-language interface over history, statistics, storage, configuration diagnostics and explicitly requested recordings.

## References

- MCP 2026-07-28 specification: https://modelcontextprotocol.io/specification/2026-07-28
- MCP Tools: https://modelcontextprotocol.io/specification/2026-07-28/server/tools
- MCP Resources: https://modelcontextprotocol.io/specification/2026-07-28/server/resources
- NovaGuard: https://github.com/devdownin/novaguard
