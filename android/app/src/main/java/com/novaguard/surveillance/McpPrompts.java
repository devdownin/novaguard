package com.novaguard.surveillance;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeParseException;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * The prompts the server offers (`prompts/list`, `prompts/get`).
 *
 * A client such as Claude Desktop shows them as ready-made requests, so the
 * owner does not have to know which of fifteen tools to chain to get "what
 * happened last night". Each one names the tools and the exact instants to
 * pass: an agent does not know the phone's time zone, and a night computed in
 * UTC is the wrong night for everyone east or west of Greenwich.
 *
 * Plain Java, like `McpRules`, so the window arithmetic — DST included — runs
 * under `scripts/test-presence-native.sh` rather than only on a device.
 */
public final class McpPrompts {
  private McpPrompts() {}

  public static final class Argument {
    public final String name;
    public final String description;
    public final boolean required;

    Argument(String name, String description, boolean required) {
      this.name = name;
      this.description = description;
      this.required = required;
    }
  }

  public static final class Prompt {
    public final String name;
    public final String title;
    public final String description;
    public final List<Argument> arguments;

    Prompt(String name, String title, String description, List<Argument> arguments) {
      this.name = name;
      this.title = title;
      this.description = description;
      this.arguments = arguments;
    }
  }

  /** A night is watched from 20:00 to 08:00 the next morning, local time. */
  static final LocalTime NIGHT_START = LocalTime.of(20, 0);
  static final LocalTime NIGHT_END = LocalTime.of(8, 0);
  public static final int DEFAULT_REVIEW_HOURS = 24;
  public static final int MAX_REVIEW_HOURS = 168;

  private static final List<Prompt> ALL = Collections.unmodifiableList(Arrays.asList(
    new Prompt(
      "night_report",
      "Night report",
      "Summarise what the camera saw during one night (20:00 to 08:00, device time), looking at the clips.",
      Collections.singletonList(new Argument("date", "Evening the night starts on, YYYY-MM-DD. Defaults to the last night that has begun.", false))
    ),
    new Prompt(
      "review_alerts",
      "Review recent alerts",
      "Look at each recent event's frames and say which ones deserve the owner's attention.",
      Collections.singletonList(new Argument("hours", "How far back to look, 1 to " + MAX_REVIEW_HOURS + ". Defaults to " + DEFAULT_REVIEW_HOURS + ".", false))
    ),
    new Prompt(
      "diagnose_camera",
      "Diagnose the camera",
      "Explain whether the camera is working and, if passages may be missed, why.",
      Collections.emptyList()
    )
  ));

  public static List<Prompt> all() {
    return ALL;
  }

  public static Prompt find(String name) {
    for (Prompt p : ALL) if (p.name.equals(name)) return p;
    return null;
  }

  /**
   * The user message a prompt expands to.
   *
   * @throws IllegalArgumentException for an unknown prompt or an argument it
   *     does not take or cannot read; the message is safe to hand back.
   */
  public static String render(String name, Map<String, String> args, ZoneId zone, Instant now) {
    Prompt prompt = find(name);
    if (prompt == null) throw new IllegalArgumentException("Unknown prompt: '" + name + "'");
    for (String key : args.keySet()) {
      boolean known = false;
      for (Argument a : prompt.arguments) known |= a.name.equals(key);
      if (!known) throw new IllegalArgumentException("Prompt '" + name + "' takes no argument '" + key + "'");
    }
    switch (name) {
      case "night_report":
        return nightReport(nightOf(args.get("date"), zone, now), zone);
      case "review_alerts":
        return reviewAlerts(hoursOf(args.get("hours")), now);
      default:
        return DIAGNOSE;
    }
  }

  /** The evening the night starts on: the given date, or the last night that has begun. */
  static LocalDate nightOf(String date, ZoneId zone, Instant now) {
    if (date != null && !date.isEmpty()) {
      try {
        return LocalDate.parse(date);
      } catch (DateTimeParseException e) {
        throw new IllegalArgumentException("'date' must be YYYY-MM-DD");
      }
    }
    ZonedDateTime local = now.atZone(zone);
    return local.toLocalTime().isBefore(NIGHT_START) ? local.toLocalDate().minusDays(1) : local.toLocalDate();
  }

  static int hoursOf(String hours) {
    if (hours == null || hours.isEmpty()) return DEFAULT_REVIEW_HOURS;
    try {
      int h = Integer.parseInt(hours.trim());
      if (h >= 1 && h <= MAX_REVIEW_HOURS) return h;
    } catch (NumberFormatException ignored) {
      // Falls through to the same message as an out-of-range value.
    }
    throw new IllegalArgumentException("'hours' must be a whole number from 1 to " + MAX_REVIEW_HOURS);
  }

  /** Night window as instants. Zoned, so a DST night is 11 or 13 hours, not a shifted 12. */
  static Instant[] nightWindow(LocalDate evening, ZoneId zone) {
    return new Instant[] {
      evening.atTime(NIGHT_START).atZone(zone).toInstant(),
      evening.plusDays(1).atTime(NIGHT_END).atZone(zone).toInstant(),
    };
  }

  private static String nightReport(LocalDate evening, ZoneId zone) {
    Instant[] window = nightWindow(evening, zone);
    return "Write a short report of the night of " + evening + " for the owner of this NovaGuard camera.\n\n"
      + "1. Call novaguard_get_status: if the camera was not healthy, say so first — an empty night means nothing from a covered or stopped camera.\n"
      + "2. Call novaguard_search_events with from=\"" + window[0] + "\" and to=\"" + window[1] + "\" (20:00 to 08:00, device time) and sort=\"timestamp_asc\".\n"
      + "3. Events sharing a passageId are one visit. For each visit, call novaguard_get_event_frames on its first event and describe what is actually visible.\n"
      + "4. End with one line: nothing to report, or what the owner should look at, with the event ids.\n\n"
      + "Do not guess beyond what the frames show. Answer in the owner's language.";
  }

  private static String reviewAlerts(int hours, Instant now) {
    Instant from = now.minusSeconds(hours * 3600L);
    return "Review the NovaGuard events of the last " + hours + " h.\n\n"
      + "1. Call novaguard_search_events with from=\"" + from + "\" and to=\"" + now + "\".\n"
      + "2. For each passage (events sharing a passageId), call novaguard_get_event_frames on one event and classify it: false alarm (shadow, reflection, pet when only people matter), expected visitor, or worth the owner's attention.\n"
      + "3. List only the passages worth attention first, with their event ids and what the frames show; then count the rest.\n\n"
      + "If the control tools are available, you may suggest keep_event for a passage worth keeping, but do not call it without the owner's approval. Answer in the owner's language.";
  }

  private static final String DIAGNOSE =
    "Diagnose this NovaGuard camera for its owner.\n\n"
      + "1. Call novaguard_get_status and novaguard_get_diagnostics, then novaguard_get_storage.\n"
      + "2. Say plainly whether someone walking in front of the camera now would be filmed. A fault status, a stalled analysis or a full disk means no.\n"
      + "3. If passages may be missed or cut, explain why from the figures: the gap between clips, settings the app gave up to keep up (and whether heat caused it), the analysis rate against its target, an analysis step that crashed on a previous launch.\n"
      + "4. Suggest at most three changes the owner can make in the app, most useful first.\n\n"
      + "Quote the figures you rely on. Answer in the owner's language.";
}
