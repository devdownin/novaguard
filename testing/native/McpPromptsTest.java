import com.novaguard.surveillance.McpPrompts;
import java.time.Instant;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.Map;

/** Checks the prompts' windows and argument handling. */
public final class McpPromptsTest {
  private static void check(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }

  private static void rejects(String name, Map<String, String> args, String message) {
    try {
      McpPrompts.render(name, args, PARIS, Instant.parse("2026-10-15T10:00:00Z"));
    } catch (IllegalArgumentException e) {
      return;
    }
    throw new AssertionError(message);
  }

  private static final ZoneId PARIS = ZoneId.of("Europe/Paris");

  public static void main(String[] args) {
    Map<String, String> none = new HashMap<>();

    // 12:00 in Paris: tonight has not begun, so the last night is the previous evening's.
    String noon = McpPrompts.render("night_report", none, PARIS, Instant.parse("2026-10-15T10:00:00Z"));
    check(noon.contains("night of 2026-10-14"), "before 20:00 the last night started yesterday");
    check(noon.contains("from=\"2026-10-14T18:00:00Z\"") && noon.contains("to=\"2026-10-15T06:00:00Z\""),
      "the window is 20:00 to 08:00 local, in UTC instants");

    // 21:00 in Paris: tonight has begun.
    String evening = McpPrompts.render("night_report", none, PARIS, Instant.parse("2026-10-15T19:00:00Z"));
    check(evening.contains("night of 2026-10-15"), "from 20:00 the last night is tonight");

    // The night clocks go back: 20:00 CEST to 08:00 CET is 13 hours, not a shifted 12.
    Map<String, String> dst = new HashMap<>();
    dst.put("date", "2026-10-24");
    String autumn = McpPrompts.render("night_report", dst, PARIS, Instant.parse("2026-10-30T10:00:00Z"));
    check(autumn.contains("from=\"2026-10-24T18:00:00Z\"") && autumn.contains("to=\"2026-10-25T07:00:00Z\""),
      "a DST night keeps its local ends");

    Map<String, String> bad = new HashMap<>();
    bad.put("date", "24/10/2026");
    rejects("night_report", bad, "a malformed date is refused");

    Map<String, String> hours = new HashMap<>();
    hours.put("hours", "6");
    String review = McpPrompts.render("review_alerts", hours, PARIS, Instant.parse("2026-10-15T10:00:00Z"));
    check(review.contains("from=\"2026-10-15T04:00:00Z\"") && review.contains("to=\"2026-10-15T10:00:00Z\""),
      "review covers the hours asked");
    check(McpPrompts.render("review_alerts", none, PARIS, Instant.parse("2026-10-15T10:00:00Z")).contains("last 24 h"),
      "and a day by default");
    for (String h : new String[] {"0", "169", "six"}) {
      Map<String, String> wrong = new HashMap<>();
      wrong.put("hours", h);
      rejects("review_alerts", wrong, "hours out of range or not a number is refused: " + h);
    }

    Map<String, String> extra = new HashMap<>();
    extra.put("verbose", "yes");
    rejects("diagnose_camera", extra, "an argument the prompt does not take is refused");
    rejects("delete_everything", none, "an unknown prompt is refused");

    check(McpPrompts.render("diagnose_camera", none, PARIS, Instant.now()).contains("novaguard_get_diagnostics"),
      "the diagnosis uses the diagnostics tool");
    check(McpPrompts.all().size() == 3 && McpPrompts.find("night_report") != null, "three prompts");

    System.out.println("McpPromptsTest passed");
  }
}
