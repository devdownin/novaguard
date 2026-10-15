package com.novaguard.surveillance

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId

/**
 * What the server advertises, and what it accepts.
 *
 * The two live together because they are one statement made twice: a schema a
 * client reads and a check the server runs. Splitting them is how a server
 * ends up advertising `additionalProperties: false` and then accepting
 * anything — which is what the Node implementation does, its schemas being
 * decorative and its arguments going through unvalidated.
 */
internal object McpCatalog {

  /**
   * Tool names carry no dot.
   *
   * `mcp.md` writes them `novaguard.get_status`, but a dot is outside the
   * `^[a-zA-Z0-9_-]{1,64}$` pattern the Claude API applies to tool names, so a
   * dotted catalogue is one no client can load. The underscore form is
   * advertised and the dotted form stays accepted on `tools/call`, so anything
   * written against the document keeps working.
   */
  private const val PREFIX = "novaguard_"

  /** Control tools are advertised only while the device allows control. */
  fun tools(controlEnabled: Boolean): JSONArray {
    val list = readTools()
    if (controlEnabled) controlTools().forEach { list.put(it) }
    return list
  }

  private fun controlTools(): List<JSONObject> = listOf(
    tool(
      "start_surveillance",
      "Starts surveillance. Needs the control token. Android only lets the camera start while NovaGuard is on screen; otherwise the result says so. Idempotent: changed is false if it was already running.",
      JSONObject()
    ),
    tool("stop_surveillance", "Stops surveillance. Needs the control token. Idempotent.", JSONObject()),
    tool(
      "set_sensitivity",
      "Sets the detection sensitivity (analysis rate and how much corroboration a detection needs). Needs the control token.",
      JSONObject().put("sensitivity", enumProp(SENSITIVITIES, "Basse, Moyenne or Haute.")),
      required = listOf("sensitivity")
    ),
    tool(
      "set_thresholds",
      "Sets the confidence a detection needs to start a recording, per kind. Needs the control token. Give at least one.",
      JSONObject()
        .put("person", numberProp(0.5, 0.95, "Entry threshold for people, in [0.5, 0.95]."))
        .put("animal", numberProp(0.5, 0.95, "Entry threshold for animals, in [0.5, 0.95]."))
    ),
    tool(
      "keep_event",
      "Marks an event's whole passage as kept (exempt from retention and automatic deletion) or releases it. Needs the control token. Nothing is ever deleted by this server.",
      JSONObject()
        .put("eventId", longProp(0, McpRules.MAX_EVENT_ID, "Identifier of any event of the passage."))
        .put("kept", boolProp("true to keep, false to release.")),
      required = listOf("eventId", "kept")
    ),
    tool(
      "annotate_event",
      "Leaves your verdict on an event, shown to the owner in the history: false_alarm, expected, attention (worth the owner's look) or note, with an optional short note. Needs the control token. Replaces your previous note on that event; the owner can clear it. Look at the frames first.",
      JSONObject()
        .put("eventId", longProp(0, McpRules.MAX_EVENT_ID, "Identifier of the event you looked at."))
        .put("verdict", enumProp(VERDICTS, "false_alarm, expected, attention or note."))
        .put("note", JSONObject().put("type", "string").put("maxLength", NOTE_MAX).put("description", "What you saw, in one or two sentences, in the owner's language.")),
      required = listOf("eventId", "verdict")
    ),
    tool(
      "acknowledge_alert",
      "Acknowledges a camera-moved alert: the current view becomes the one watched. Needs the control token. A black-picture alert cannot be acknowledged; it clears when the camera sees again.",
      JSONObject()
    ),
  )

  private fun readTools(): JSONArray = JSONArray()
    .put(
      tool(
        "get_status",
        "Returns high-level surveillance status: active state, the status the device itself shows (inactive, starting, active, recording, or a fault: camera-unavailable, camera-obstructed, camera-moved, storage-insufficient, analysis-unavailable, recording-error) and since when, camera, last detection time, today's detection count and a storage summary. While healthy is false, an absence of events does not mean nothing happened.",
        JSONObject()
      )
    )
    .put(
      tool(
        "search_events",
        "Primary surveillance-history query, with time filters and pagination. Defaults to the last 24 hours when no range is given.",
        JSONObject()
          .put("from", stringProp("Inclusive ISO-8601 start of the range."))
          .put("to", stringProp("Inclusive ISO-8601 end of the range."))
          .put("kind", enumProp(KINDS, "Restrict to one detection kind."))
          .put("minConfidence", numberProp(0.0, 1.0, "Lowest detection confidence to return."))
          .put("hasVideo", boolProp("Keep only events that do, or do not, have a clip."))
          .put("limit", intProp(1, 100, "Events per page. Defaults to 20."))
          .put("offset", intProp(0, 10_000, "Events to skip. Defaults to 0."))
          .put("sort", enumProp(SORTS, "Ordering. Defaults to timestamp_desc."))
      )
    )
    .put(
      tool(
        "get_event",
        "Returns one surveillance event by id.",
        JSONObject().put("eventId", longProp(0, McpRules.MAX_EVENT_ID, "Identifier of the event, as returned by the other tools.")),
        required = listOf("eventId")
      )
    )
    .put(
      tool(
        "get_latest_events",
        "Returns the most recent surveillance events.",
        JSONObject()
          .put("kind", enumProp(KINDS, "Restrict to one detection kind."))
          .put("limit", intProp(1, 20, "How many to return. Defaults to 5."))
      )
    )
    .put(
      tool(
        "get_statistics",
        "Returns aggregate statistics for a period without loading any media.",
        JSONObject()
          .put("from", stringProp("Inclusive ISO-8601 start of the period."))
          .put("to", stringProp("Inclusive ISO-8601 end of the period."))
          .put("groupBy", enumProp(GROUPS, "Bucket the counts by hour, day or kind.")),
        required = listOf("from", "to")
      )
    )
    .put(
      tool(
        "get_event_frames",
        "Returns JPEG stills sampled across an event's clip, as images you can look at: use it to see who or what was filmed. Frames are taken at the middle of equal slices of the clip. Falls back to the event's thumbnail when the clip is gone. Prefer this over the video resource, which most clients cannot read. framing \"subject\" crops each still around where the subject was (with context), when the event recorded it (subjectTracked); otherwise whole frames are returned and each frame says cropped false.",
        JSONObject()
          .put("eventId", longProp(0, McpRules.MAX_EVENT_ID, "Identifier of the event, as returned by the other tools."))
          .put("count", intProp(1, McpRules.MAX_FRAMES, "How many frames. Defaults to ${McpRules.DEFAULT_FRAMES}."))
          .put("maxEdge", intProp(160, 1280, "Longest side of each frame, in pixels. Defaults to ${McpFrames.DEFAULT_MAX_EDGE}."))
          .put("framing", enumProp(FRAMINGS, "full (default) or subject.")),
        required = listOf("eventId")
      )
    )
    .put(
      tool(
        "wait_for_event",
        "Waits until a new surveillance event is recorded, or the timeout passes, and returns it with the current status. Use it to watch the camera without polling. Pass the latestEventId of the previous answer as afterEventId to never miss one.",
        JSONObject()
          .put("afterEventId", longProp(0, McpRules.MAX_EVENT_ID, "Return events newer than this id. Defaults to the newest event at the time of the call."))
          .put("timeoutSeconds", intProp(1, McpRules.MAX_WAIT_SECONDS, "How long to wait. Defaults to ${McpRules.DEFAULT_WAIT_SECONDS}."))
          .put("kind", enumProp(KINDS, "Wait only for this kind."))
      )
    )
    .put(tool("get_storage", "Returns used, free and total bytes, plus event and clip counts.", JSONObject()))
    .put(
      tool(
        "get_configuration",
        "Returns the diagnostic configuration: camera, detection settings, recording quality, retention and notification state. Never returns secrets or file paths.",
        JSONObject()
      )
    )
    .put(tool("get_camera_info", "Returns safe diagnostic information about the active camera.", JSONObject()))
    .put(
      tool(
        "get_diagnostics",
        "Returns why the camera may miss or cut passages: the measured gap between consecutive clips of one passage (finalize is the encoder's, restart is the app's), the settings the app gave up to keep its analysis rate and the rate measured against its target, whether the camera session is interrupted, the analysis step a previous launch crashed in, and the device's thermal status (0 none … 6 shutdown, -1 unknown) and battery.",
        JSONObject()
      )
    )

  private fun tool(name: String, description: String, properties: JSONObject, required: List<String> = emptyList()): JSONObject {
    val schema = JSONObject()
      .put("type", "object")
      .put("additionalProperties", false)
      .put("properties", properties)
    if (required.isNotEmpty()) schema.put("required", JSONArray(required))
    return JSONObject()
      .put("name", PREFIX + name)
      .put("description", description)
      .put("inputSchema", schema)
  }

  private fun stringProp(description: String) =
    JSONObject().put("type", "string").put("format", "date-time").put("description", description)

  private fun enumProp(values: List<String>, description: String) =
    JSONObject().put("type", "string").put("enum", JSONArray(values)).put("description", description)

  private fun numberProp(min: Double, max: Double, description: String) =
    JSONObject().put("type", "number").put("minimum", min).put("maximum", max).put("description", description)

  private fun intProp(min: Int, max: Int, description: String) =
    JSONObject().put("type", "integer").put("minimum", min).put("maximum", max).put("description", description)

  private fun longProp(min: Long, max: Long, description: String) =
    JSONObject().put("type", "integer").put("minimum", min).put("maximum", max).put("description", description)

  private fun boolProp(description: String) =
    JSONObject().put("type", "boolean").put("description", description)

  // --------------------------------------------------------------- validation

  /** Both spellings a caller may use for a tool. Only the first is advertised. */
  internal val TOOL_PREFIXES = listOf("novaguard_", "novaguard.")

  /** Whether the catalogue advertises this name, under either prefix, given the device's control switch. */
  fun isKnownTool(rawName: String, controlEnabled: Boolean): Boolean {
    val operation = TOOL_PREFIXES.firstNotNullOfOrNull { prefix ->
      if (rawName.startsWith(prefix)) rawName.removePrefix(prefix) else null
    } ?: return false
    if (operation in CONTROL_TOOLS) return controlEnabled
    return ARGUMENT_SPECS.containsKey(operation)
  }

  /** Tools that change the device, and so need the control token. */
  val CONTROL_TOOLS = setOf(
    "start_surveillance", "stop_surveillance", "set_sensitivity", "set_thresholds", "keep_event", "acknowledge_alert",
    "annotate_event",
  )

  /**
   * Enforces the schema the tool list advertised.
   *
   * Unknown keys are refused rather than ignored: a caller that misspells
   * `minConfidence` is asking for a filter it will not get, and answering it
   * with the unfiltered history is a wrong answer delivered as a right one.
   */
  fun validateArguments(name: String, args: JSONObject) {
    val spec = ARGUMENT_SPECS[name]
      ?: throw McpException("NOVAGUARD_NOT_FOUND", "Unknown tool: '$name'", -32601)

    for (key in args.keys()) {
      val rule = spec[key]
        ?: throw McpException("NOVAGUARD_INVALID_ARGUMENT", "Unknown argument '$key' for $name", -32602)
      rule(args, key)
    }
    REQUIRED_ARGUMENTS[name]?.forEach { key ->
      if (!args.has(key) || args.isNull(key)) {
        throw McpException("NOVAGUARD_INVALID_ARGUMENT", "Missing required parameter $key", -32602)
      }
    }
  }

  private fun invalid(key: String, expectation: String): Nothing =
    throw McpException("NOVAGUARD_INVALID_ARGUMENT", "Argument '$key' $expectation", -32602)

  private fun stringRule(allowed: List<String>? = null): (JSONObject, String) -> Unit = { args, key ->
    val value = args.opt(key)
    if (value !is String || value.isEmpty()) invalid(key, "must be a non-empty string")
    if (allowed != null && !allowed.contains(value)) invalid(key, "must be one of ${allowed.joinToString(", ")}")
  }

  /** Free text, possibly empty, at most `max` characters. */
  private fun textRule(max: Int): (JSONObject, String) -> Unit = { args, key ->
    val value = args.opt(key)
    if (value !is String) invalid(key, "must be a string")
    if (value.length > max) invalid(key, "must be at most $max characters")
  }

  private fun intRule(min: Int, max: Int): (JSONObject, String) -> Unit = { args, key ->
    val value = args.opt(key)
    if (value !is Int && value !is Long) invalid(key, "must be an integer")
    val number = (value as Number).toLong()
    if (number < min || number > max) invalid(key, "must be between $min and $max")
  }

  private fun longRule(min: Long, max: Long): (JSONObject, String) -> Unit = { args, key ->
    val value = args.opt(key)
    if (value !is Int && value !is Long) invalid(key, "must be an integer")
    val number = (value as Number).toLong()
    if (number < min || number > max) invalid(key, "must be between $min and $max")
  }

  private fun numberRule(min: Double, max: Double): (JSONObject, String) -> Unit = { args, key ->
    val value = args.opt(key)
    if (value !is Number) invalid(key, "must be a number")
    val number = value.toDouble()
    if (number < min || number > max) invalid(key, "must be between $min and $max")
  }

  private val boolRule: (JSONObject, String) -> Unit = { args, key ->
    if (args.opt(key) !is Boolean) invalid(key, "must be a boolean")
  }

  private val KINDS = listOf("Personne", "Animal")
  private val SORTS = listOf("timestamp_desc", "timestamp_asc")
  private val GROUPS = listOf("hour", "day", "kind")
  private val SENSITIVITIES = listOf("Basse", "Moyenne", "Haute")
  private val FRAMINGS = listOf("full", "subject")
  private val VERDICTS = listOf("false_alarm", "expected", "attention", "note")
  /** Same bound as `AGENT_NOTE_MAX` in `mcpCommands.ts`. */
  private const val NOTE_MAX = 280

  private val ARGUMENT_SPECS: Map<String, Map<String, (JSONObject, String) -> Unit>> = mapOf(
    "get_status" to emptyMap(),
    "get_storage" to emptyMap(),
    "get_configuration" to emptyMap(),
    "get_camera_info" to emptyMap(),
    "get_diagnostics" to emptyMap(),
    // Ids are epoch milliseconds: an Int bound refused every event ever recorded.
    "get_event" to mapOf("eventId" to longRule(0, McpRules.MAX_EVENT_ID)),
    "get_event_frames" to mapOf(
      "eventId" to longRule(0, McpRules.MAX_EVENT_ID),
      "count" to intRule(1, McpRules.MAX_FRAMES),
      "maxEdge" to intRule(160, 1280),
      "framing" to stringRule(FRAMINGS)
    ),
    "wait_for_event" to mapOf(
      "afterEventId" to longRule(0, McpRules.MAX_EVENT_ID),
      "timeoutSeconds" to intRule(1, McpRules.MAX_WAIT_SECONDS),
      "kind" to stringRule(KINDS)
    ),
    "start_surveillance" to emptyMap(),
    "stop_surveillance" to emptyMap(),
    "set_sensitivity" to mapOf("sensitivity" to stringRule(SENSITIVITIES)),
    "set_thresholds" to mapOf("person" to numberRule(0.5, 0.95), "animal" to numberRule(0.5, 0.95)),
    "keep_event" to mapOf("eventId" to longRule(0, McpRules.MAX_EVENT_ID), "kept" to boolRule),
    "acknowledge_alert" to emptyMap(),
    "annotate_event" to mapOf(
      "eventId" to longRule(0, McpRules.MAX_EVENT_ID), "verdict" to stringRule(VERDICTS), "note" to textRule(NOTE_MAX)
    ),
    "get_latest_events" to mapOf("kind" to stringRule(KINDS), "limit" to intRule(1, 20)),
    "get_statistics" to mapOf(
      "from" to stringRule(), "to" to stringRule(), "groupBy" to stringRule(GROUPS)
    ),
    "search_events" to mapOf(
      "from" to stringRule(), "to" to stringRule(), "kind" to stringRule(KINDS),
      "minConfidence" to numberRule(0.0, 1.0), "hasVideo" to boolRule,
      "limit" to intRule(1, 100), "offset" to intRule(0, 10_000), "sort" to stringRule(SORTS)
    )
  )

  private val REQUIRED_ARGUMENTS: Map<String, List<String>> = mapOf(
    "get_event" to listOf("eventId"),
    "get_event_frames" to listOf("eventId"),
    "set_sensitivity" to listOf("sensitivity"),
    "keep_event" to listOf("eventId", "kept"),
    "annotate_event" to listOf("eventId", "verdict"),
    "get_statistics" to listOf("from", "to")
  )

  // ------------------------------------------------------------------ prompts

  fun prompts(): JSONArray = JSONArray().apply {
    McpPrompts.all().forEach { p ->
      put(
        JSONObject()
          .put("name", p.name)
          .put("title", p.title)
          .put("description", p.description)
          .put("arguments", JSONArray().apply {
            p.arguments.forEach { a ->
              put(JSONObject().put("name", a.name).put("description", a.description).put("required", a.required))
            }
          })
      )
    }
  }

  /**
   * `prompts/get`. A bad name or argument is `-32602`, as the specification
   * gives it: no prompt ran, and the caller has to change what it sent.
   */
  fun renderPrompt(params: JSONObject, zone: ZoneId, now: Instant): JSONObject {
    val name = params.optString("name")
    val raw = params.optJSONObject("arguments") ?: JSONObject()
    val args = HashMap<String, String>()
    for (key in raw.keys()) {
      val value = raw.opt(key)
      if (value !is String && value !is Number) invalid(key, "must be a string")
      args[key] = value.toString()
    }
    val text = try {
      McpPrompts.render(name, args, zone, now)
    } catch (e: IllegalArgumentException) {
      throw McpException("NOVAGUARD_INVALID_ARGUMENT", e.message ?: "Invalid prompt request", -32602)
    }
    val prompt = McpPrompts.find(name)!!
    return JSONObject()
      .put("description", prompt.description)
      .put("messages", JSONArray().put(
        JSONObject().put("role", "user").put("content", JSONObject().put("type", "text").put("text", text))
      ))
  }

  // ---------------------------------------------------------------- resources

  /**
   * `resources/list` returns resources that exist; `resources/templates/list`
   * returns the shapes. The Node server returns templates from the first and
   * does not implement the second, which is why a conforming client shows an
   * empty resource list against it.
   */
  fun resources(snapshot: Snapshot): JSONArray {
    val list = JSONArray()
      .put(resource("novaguard://status", "Status", "High-level NovaGuard surveillance status", "application/json"))
      .put(resource("novaguard://timeline/${McpServerModule.today()}", "Timeline — today", "Chronological event list for today", "application/json"))
    listOf("today" to "today", "7d" to "the last 7 days", "30d" to "the last 30 days").forEach { (key, label) ->
      list.put(resource("novaguard://statistics/$key", "Statistics — $label", "Aggregate statistics for $label", "application/json"))
    }
    snapshot.events.sortedByDescending { it.timestampMs }.take(RECENT_RESOURCE_LIMIT).forEach { event ->
      val stamp = McpServerModule.isoOf(event.timestampMs)
      list.put(resource("novaguard://event/${event.id}", "Event ${event.id}", "${event.kind} at $stamp", "application/json"))
      if (event.thumbPath != null) {
        list.put(resource("novaguard://thumbnail/${event.id}", "Thumbnail ${event.id}", "Still from event ${event.id}", "image/jpeg"))
      }
      if (event.hasVideo) {
        list.put(resource("novaguard://video/${event.id}", "Video ${event.id}", "Clip recorded for event ${event.id}; to look at it, call novaguard_get_event_frames", "video/mp4"))
      }
    }
    return list
  }

  fun resourceTemplates(): JSONArray = JSONArray()
    .put(template("novaguard://event/{eventId}", "Event Metadata", "Canonical metadata for one event", "application/json"))
    .put(template("novaguard://video/{eventId}", "Event Video Recording", "MP4 clip recorded for one event", "video/mp4"))
    .put(template("novaguard://thumbnail/{eventId}", "Event Thumbnail", "JPEG still for one event", "image/jpeg"))
    .put(template("novaguard://timeline/{date}", "Timeline", "Events of one local calendar day (YYYY-MM-DD)", "application/json"))
    .put(template("novaguard://statistics/{period}", "Statistics Summary", "Aggregates for today, 7d or 30d", "application/json"))

  private fun resource(uri: String, name: String, description: String, mimeType: String) = JSONObject()
    .put("uri", uri).put("name", name).put("description", description).put("mimeType", mimeType)

  private fun template(uriTemplate: String, name: String, description: String, mimeType: String) = JSONObject()
    .put("uriTemplate", uriTemplate).put("name", name).put("description", description).put("mimeType", mimeType)

  internal data class ParsedUri(val type: String, val param: String)

  /**
   * Parses a `novaguard://` URI, accepting only the exact shapes above.
   *
   * Each parameter is matched against a pattern that admits nothing but what
   * it names — digits for an id, a calendar date for a day, one of three words
   * for a period. Traversal and foreign schemes are refused as a consequence
   * rather than by a blocklist: there is no input of that shape to reject.
   */
  fun parseResourceUri(uri: String): ParsedUri {
    if (uri.isEmpty() || uri.length > MAX_URI_LENGTH) {
      throw McpException("NOVAGUARD_INVALID_ARGUMENT", "Resource URI is required", -32602)
    }
    if (!uri.startsWith(SCHEME)) {
      throw McpException("NOVAGUARD_INVALID_ARGUMENT", "Unsupported URI scheme", -32602)
    }
    val parts = uri.substring(SCHEME.length).split('/').filter { it.isNotEmpty() }
    if (parts.isEmpty()) {
      throw McpException("NOVAGUARD_INVALID_ARGUMENT", "Empty resource URI path", -32602)
    }

    return when (val type = parts[0]) {
      "status" -> {
        if (parts.size != 1) throw McpException("NOVAGUARD_INVALID_ARGUMENT", "Invalid status resource URI", -32602)
        ParsedUri("status", "")
      }
      "event", "video", "thumbnail" -> {
        if (parts.size != 2 || !ID_PATTERN.matches(parts[1])) {
          throw McpException("NOVAGUARD_INVALID_ARGUMENT", "Invalid $type URI format", -32602)
        }
        ParsedUri(type, parts[1])
      }
      "timeline" -> {
        if (parts.size != 2 || !DATE_PATTERN.matches(parts[1])) {
          throw McpException("NOVAGUARD_INVALID_ARGUMENT", "Invalid timeline date", -32602)
        }
        ParsedUri("timeline", parts[1])
      }
      "statistics" -> {
        if (parts.size != 2 || !PERIODS.contains(parts[1])) {
          throw McpException("NOVAGUARD_INVALID_ARGUMENT", "Invalid statistics period", -32602)
        }
        ParsedUri("statistics", parts[1])
      }
      else -> throw McpException("NOVAGUARD_INVALID_ARGUMENT", "Unknown resource type: $type", -32602)
    }
  }

  private const val SCHEME = "novaguard://"
  private const val MAX_URI_LENGTH = 512
  private const val RECENT_RESOURCE_LIMIT = 50
  private val ID_PATTERN = Regex("^\\d{1,15}$")
  private val DATE_PATTERN = Regex("^\\d{4}-\\d{2}-\\d{2}$")
  private val PERIODS = setOf("today", "7d", "30d")
}
