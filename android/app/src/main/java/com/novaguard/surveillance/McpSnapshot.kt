package com.novaguard.surveillance

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeParseException

/**
 * One event as the MCP server knows it.
 *
 * The two paths are the reason this is a class and not the raw JSON JavaScript
 * pushed: they are needed to open the file and must never reach a response.
 * `toJson` is the only way out, and it builds its object field by field, so a
 * path cannot be carried along by a serializer that simply copies what it was
 * given. `mcp.md` §14 forbids exposing raw filesystem paths, and a caller is
 * handed a `novaguard://` URI instead — an id it can read back, not a location.
 */
internal data class McpEvent(
  val id: Long,
  val kind: String,
  val timestampMs: Long,
  val durationSeconds: Double,
  val confidence: Double,
  val sizeBytes: Long,
  val videoPath: String?,
  val thumbPath: String?
) {
  val hasVideo: Boolean get() = !videoPath.isNullOrEmpty() && sizeBytes > 0

  fun toJson(): JSONObject = JSONObject()
    .put("id", id)
    .put("kind", kind)
    .put("timestamp", McpServerModule.isoOf(timestampMs))
    .put("durationSeconds", durationSeconds)
    .put("confidence", confidence)
    .put("hasVideo", hasVideo)
    .put("videoResourceUri", if (!videoPath.isNullOrEmpty()) "novaguard://video/$id" else JSONObject.NULL)
    .put("thumbnailResourceUri", if (!thumbPath.isNullOrEmpty()) "novaguard://thumbnail/$id" else JSONObject.NULL)
    .put("sizeBytes", sizeBytes)
}

/**
 * Everything the server can answer from, as of the last push from JavaScript.
 *
 * Immutable on purpose: request threads read it without a lock, and a push
 * swaps the whole object rather than mutating one under a reader.
 */
internal class Snapshot private constructor(
  private val surveillanceActive: Boolean,
  private val camera: String,
  private val lastDetectionAtMs: Long?,
  private val detectionsToday: Int,
  private val streamEnabled: Boolean,
  private val usedBytes: Long,
  private val freeBytes: Long,
  private val totalBytes: Long,
  private val configuration: JSONObject,
  val events: List<McpEvent>
) {

  // ------------------------------------------------------------------ reading

  fun statusJson(): JSONObject = JSONObject()
    .put("surveillanceActive", surveillanceActive)
    .put("camera", camera)
    .put("lastDetectionAt", lastDetectionAtMs?.let { McpServerModule.isoOf(it) } ?: JSONObject.NULL)
    .put("detectionsToday", detectionsToday)
    .put("storage", storageSummary())

  fun storageJson(): JSONObject = storageSummary()
    .put("eventCount", events.size)
    .put("videoCount", events.count { it.hasVideo })

  private fun storageSummary() = JSONObject()
    .put("usedBytes", usedBytes)
    .put("freeBytes", freeBytes)
    .put("totalBytes", totalBytes)

  fun configurationJson(): JSONObject = configuration

  fun cameraInfoJson(): JSONObject = JSONObject()
    .put("camera", camera)
    .put("active", surveillanceActive)
    .put("streamEnabled", streamEnabled)

  fun requireEvent(id: Long): McpEvent =
    events.firstOrNull { it.id == id }
      ?: throw McpException("NOVAGUARD_NOT_FOUND", "Event $id not found", -32603)

  // ------------------------------------------------------------------ queries

  fun latestEvents(args: JSONObject): JSONArray {
    val limit = args.optInt("limit", 5)
    val kind = args.optString("kind").takeIf { it.isNotEmpty() }
    val list = events
      .filter { kind == null || it.kind == kind }
      .sortedByDescending { it.timestampMs }
      .take(limit)
    return JSONArray().apply { list.forEach { put(it.toJson()) } }
  }

  fun searchEvents(args: JSONObject): JSONObject {
    val limit = args.optInt("limit", 20)
    val offset = args.optInt("offset", 0)
    val sort = args.optString("sort").ifEmpty { "timestamp_desc" }
    val now = System.currentTimeMillis()

    val fromMs = args.optString("from").takeIf { it.isNotEmpty() }?.let { parseInstant(it, "from") }
      ?: (now - DAY_MS)
    val toMs = args.optString("to").takeIf { it.isNotEmpty() }?.let { parseInstant(it, "to") } ?: now
    if (fromMs > toMs) {
      throw McpException("NOVAGUARD_INVALID_ARGUMENT", "'from' must be before 'to'", -32602)
    }
    if (toMs - fromMs > MAX_RANGE_MS) {
      throw McpException("NOVAGUARD_RANGE_TOO_LARGE", "Date range exceeds maximum of 90 days", -32602)
    }

    val kind = args.optString("kind").takeIf { it.isNotEmpty() }
    val hasMinConfidence = args.has("minConfidence")
    val minConfidence = args.optDouble("minConfidence", 0.0)
    val hasVideoFilter = if (args.has("hasVideo")) args.optBoolean("hasVideo") else null

    var filtered = events.filter { it.timestampMs in fromMs..toMs }
    if (kind != null) filtered = filtered.filter { it.kind == kind }
    if (hasMinConfidence) filtered = filtered.filter { it.confidence >= minConfidence }
    if (hasVideoFilter != null) filtered = filtered.filter { it.hasVideo == hasVideoFilter }

    val sorted =
      if (sort == "timestamp_asc") filtered.sortedBy { it.timestampMs }
      else filtered.sortedByDescending { it.timestampMs }

    val page = sorted.drop(offset).take(limit)
    return JSONObject()
      .put("events", JSONArray().apply { page.forEach { put(it.toJson()) } })
      .put("total", sorted.size)
      .put("limit", limit)
      .put("offset", offset)
  }

  fun statistics(args: JSONObject): JSONObject {
    val from = args.optString("from")
    val to = args.optString("to")
    if (from.isEmpty() || to.isEmpty()) {
      throw McpException("NOVAGUARD_INVALID_ARGUMENT", "Both from and to are required", -32602)
    }
    val fromMs = parseInstant(from, "from")
    val toMs = parseInstant(to, "to")
    if (fromMs > toMs) {
      throw McpException("NOVAGUARD_INVALID_ARGUMENT", "'from' must be before 'to'", -32602)
    }
    return statisticsBetween(fromMs, toMs, args.optString("groupBy").takeIf { it.isNotEmpty() })
  }

  /**
   * The three named windows of `novaguard://statistics/{period}`.
   *
   * `today` starts at local midnight, not at "now minus 24 h" and not at UTC
   * midnight: the application's own day boundaries are local calendar days —
   * subtracting a fixed number of milliseconds moves the boundary by an hour
   * across a daylight-saving change — and a period the MCP client calls today
   * has to mean the day the history screen calls today, or the two disagree
   * about which events exist.
   */
  fun statisticsForPeriod(period: String): JSONObject {
    val zone = McpServerModule.zone()
    val now = System.currentTimeMillis()
    val fromMs = when (period) {
      "today" -> McpServerModule.today().atStartOfDay(zone).toInstant().toEpochMilli()
      "7d" -> McpServerModule.today().minusDays(6).atStartOfDay(zone).toInstant().toEpochMilli()
      "30d" -> McpServerModule.today().minusDays(29).atStartOfDay(zone).toInstant().toEpochMilli()
      else -> throw McpException("NOVAGUARD_INVALID_ARGUMENT", "Unsupported period: $period", -32602)
    }
    return statisticsBetween(fromMs, now, "kind")
  }

  private fun statisticsBetween(fromMs: Long, toMs: Long, groupBy: String?): JSONObject {
    val window = events.filter { it.timestampMs in fromMs..toMs }
    val persons = window.count { it.kind == PERSON }
    val withVideo = window.count { it.hasVideo }
    val average = if (window.isEmpty()) 0.0
    else Math.round(window.sumOf { it.confidence } / window.size * 100.0) / 100.0

    val result = JSONObject()
      .put("period", JSONObject().put("from", McpServerModule.isoOf(fromMs)).put("to", McpServerModule.isoOf(toMs)))
      .put("total", window.size)
      .put("persons", persons)
      .put("animals", window.size - persons)
      .put("averageConfidence", average)
      .put("withVideo", withVideo)
      .put("withoutVideo", window.size - withVideo)

    if (groupBy != null) {
      val zone = McpServerModule.zone()
      val buckets = LinkedHashMap<String, MutableList<McpEvent>>()
      for (event in window.sortedBy { it.timestampMs }) {
        val instant = Instant.ofEpochMilli(event.timestampMs).atZone(zone)
        val key = when (groupBy) {
          "kind" -> event.kind
          "day" -> instant.toLocalDate().toString()
          else -> "%s T%02d:00".format(instant.toLocalDate(), instant.hour).replace(" T", "T")
        }
        buckets.getOrPut(key) { mutableListOf() }.add(event)
      }
      val groups = JSONArray()
      buckets.forEach { (key, list) ->
        val groupPersons = list.count { it.kind == PERSON }
        groups.put(
          JSONObject()
            .put("key", key)
            .put("count", list.size)
            .put("persons", groupPersons)
            .put("animals", list.size - groupPersons)
        )
      }
      result.put("groups", groups)
    }
    return result
  }

  /**
   * One local calendar day, whole.
   *
   * Bounded like every other list here, and the bound is reported rather than
   * applied in silence: a day that overflows used to come back looking like a
   * quiet day, which on a surveillance camera is the one wrong answer that
   * reads as a right one.
   */
  fun timeline(dateStr: String): JSONObject {
    val date = try {
      LocalDate.parse(dateStr)
    } catch (_: DateTimeParseException) {
      throw McpException("NOVAGUARD_INVALID_ARGUMENT", "Invalid timeline date", -32602)
    }
    val zone = McpServerModule.zone()
    val start = date.atStartOfDay(zone).toInstant().toEpochMilli()
    val end = date.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli() - 1

    val ofDay = events.filter { it.timestampMs in start..end }.sortedBy { it.timestampMs }
    val page = ofDay.take(TIMELINE_LIMIT)
    val compact = JSONArray()
    page.forEach { event ->
      val local = Instant.ofEpochMilli(event.timestampMs).atZone(zone).toLocalTime()
      compact.put(
        JSONObject()
          .put("id", event.id)
          .put("time", "%02d:%02d:%02d".format(local.hour, local.minute, local.second))
          .put("kind", event.kind)
          .put("confidence", event.confidence)
          .put("durationSeconds", event.durationSeconds)
      )
    }
    return JSONObject()
      .put("date", dateStr)
      .put("events", compact)
      .put("total", ofDay.size)
      .put("truncated", ofDay.size > page.size)
  }

  private fun parseInstant(value: String, field: String): Long =
    try {
      Instant.parse(value).toEpochMilli()
    } catch (_: DateTimeParseException) {
      throw McpException("NOVAGUARD_INVALID_ARGUMENT", "Invalid '$field' timestamp: $value", -32602)
    }

  companion object {
    private const val PERSON = "Personne"
    private const val DAY_MS = 24L * 60 * 60 * 1000
    private const val MAX_RANGE_MS = 90L * DAY_MS
    private const val TIMELINE_LIMIT = 500

    fun empty() = Snapshot(
      surveillanceActive = false, camera = "", lastDetectionAtMs = null, detectionsToday = 0,
      streamEnabled = false, usedBytes = 0, freeBytes = 0, totalBytes = 0,
      configuration = JSONObject(), events = emptyList()
    )

    fun parse(json: JSONObject): Snapshot {
      val storage = json.optJSONObject("storage") ?: JSONObject()
      val rawEvents = json.optJSONArray("events") ?: JSONArray()
      val events = ArrayList<McpEvent>(rawEvents.length())
      for (i in 0 until rawEvents.length()) {
        val e = rawEvents.optJSONObject(i) ?: continue
        events.add(
          McpEvent(
            id = e.optLong("id"),
            kind = e.optString("kind"),
            timestampMs = e.optLong("timestamp"),
            durationSeconds = e.optDouble("dur", 0.0),
            confidence = e.optDouble("conf", 0.0),
            sizeBytes = e.optLong("bytes"),
            videoPath = e.optString("path").takeIf { it.isNotEmpty() && !e.isNull("path") },
            thumbPath = e.optString("thumbPath").takeIf { it.isNotEmpty() && !e.isNull("thumbPath") }
          )
        )
      }
      return Snapshot(
        surveillanceActive = json.optBoolean("surveillanceActive"),
        camera = json.optString("camera"),
        lastDetectionAtMs = if (json.isNull("lastDetectionAt")) null else json.optLong("lastDetectionAt"),
        detectionsToday = json.optInt("detectionsToday"),
        streamEnabled = json.optBoolean("streamEnabled"),
        usedBytes = storage.optLong("used"),
        freeBytes = storage.optLong("free"),
        totalBytes = storage.optLong("total"),
        configuration = sanitizeConfiguration(json.optJSONObject("configuration") ?: JSONObject()),
        events = events
      )
    }

    /**
     * Rebuilds the configuration from a fixed set of keys.
     *
     * JavaScript already assembles this object field by field, so nothing
     * secret should arrive. This copies rather than trusts anyway: it is one
     * `patchSettings` away from someone handing the whole settings object to
     * `updateSnapshot`, and `localStreamPin` lives in there. A rebuild cannot
     * carry a key nobody named, where a strip only removes the ones already
     * thought of.
     */
    private fun sanitizeConfiguration(raw: JSONObject): JSONObject {
      val detection = raw.optJSONObject("detection") ?: JSONObject()
      val recording = raw.optJSONObject("recording") ?: JSONObject()
      val notifications = raw.optJSONObject("notifications") ?: JSONObject()
      return JSONObject()
        .put("camera", raw.optString("camera"))
        .put(
          "detection",
          JSONObject()
            .put("person", detection.optBoolean("person"))
            .put("animal", detection.optBoolean("animal"))
            .put("sensitivity", detection.optString("sensitivity"))
            .put("threshold", detection.optDouble("threshold", 0.0))
            .put("preciseDetection", detection.optBoolean("preciseDetection"))
            .put("autoZoom", detection.optBoolean("autoZoom"))
            .put("zoneConfigured", detection.optBoolean("zoneConfigured"))
        )
        .put(
          "recording",
          JSONObject()
            .put("quality", recording.optString("quality"))
            .put("postRoll", recording.optString("postRoll"))
            .put("maxClipDuration", recording.optString("maxClipDuration"))
            .put("retention", recording.optString("retention"))
            .put("automaticDeletion", recording.optBoolean("automaticDeletion"))
        )
        .put(
          "notifications",
          JSONObject()
            .put("enabled", notifications.optBoolean("enabled"))
            .put("detectionNotifications", notifications.optBoolean("detectionNotifications"))
        )
    }
  }
}
