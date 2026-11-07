import com.novaguard.surveillance.McpRules;
import java.util.Arrays;
import java.util.Collections;

/** Checks the MCP server's pure decisions. */
public final class McpRulesTest {
  private static void check(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }

  private static boolean near(double a, double b) {
    return Math.abs(a - b) < 1e-9;
  }

  public static void main(String[] args) {
    // A real id: what nextEventId mints today is epoch milliseconds.
    long today = 1_760_000_000_000L;
    check(today > Integer.MAX_VALUE, "fixture must be a real, post-1970 id");
    check(McpRules.isEventId(today), "an epoch-ms event id must be accepted");
    check(McpRules.isEventId(0), "zero is a valid id");
    check(!McpRules.isEventId(-1), "a negative id is not");
    check(!McpRules.isEventId(McpRules.MAX_EVENT_ID + 1), "the bound is the 15-digit one the URIs use");
    check(String.valueOf(McpRules.MAX_EVENT_ID).length() == 15, "bound and URI pattern must agree");

    check(McpRules.resourceRpcCode("NOVAGUARD_NOT_FOUND", -32603) == -32002, "missing event is -32002");
    check(McpRules.resourceRpcCode("NOVAGUARD_MEDIA_UNAVAILABLE", -32603) == -32002, "missing file is -32002");
    check(McpRules.resourceRpcCode("NOVAGUARD_MEDIA_TOO_LARGE", -32603) == -32603, "other failures keep their code");

    check(McpRules.statusSince("camera-obstructed", 1_000, "camera-obstructed", 9_000) == 1_000, "a repeated status keeps its start");
    check(McpRules.statusSince("active", 1_000, "camera-obstructed", 9_000) == 9_000, "a new status starts now");
    check(McpRules.statusSince(null, 0, "active", 9_000) == 9_000, "the first status starts now");

    check(McpRules.isFault("camera-obstructed") && McpRules.isFault("recording-error"), "faults are faults");
    check(!McpRules.isFault("active") && !McpRules.isFault("recording") && !McpRules.isFault(null), "health is not");

    McpRules.ConnectionGate gate = new McpRules.ConnectionGate(3, 2);
    check(gate.tryEnter("a") && gate.tryEnter("a"), "a peer gets its share");
    check(!gate.tryEnter("a"), "and no more");
    check(gate.tryEnter("b"), "another peer still gets in");
    check(!gate.tryEnter("c"), "until the total is reached");
    gate.leave("a");
    check(gate.inUse() == 2, "leaving frees a slot");
    check(gate.tryEnter("c"), "which someone else can take");
    gate.leave("unknown");
    check(gate.inUse() == 3, "leaving without entering frees nothing");

    McpRules.Deadline deadline = new McpRules.Deadline(1_000, 500);
    check(deadline.remainingMs(1_200) == 300 && !deadline.expired(1_499), "within budget");
    check(deadline.expired(1_500) && deadline.remainingMs(2_000) == 0, "past budget");

    long[] four = McpRules.frameTimesUs(8_000, 4);
    check(four.length == 4, "one time per frame asked");
    check(four[0] == 1_000_000L && four[3] == 7_000_000L, "slice centres, in microseconds, never the very ends");
    for (int i = 1; i < four.length; i++) check(four[i] > four[i - 1], "times increase");
    check(McpRules.frameTimesUs(8_000, 50).length == McpRules.MAX_FRAMES, "count is capped");
    check(McpRules.frameTimesUs(8_000, 0).length == 1, "at least one frame");
    long[] unknown = McpRules.frameTimesUs(0, 4);
    check(unknown.length == 1 && unknown[0] == 0L, "unknown duration: the first frame only");

    check(McpRules.principal(true, true, false, false) == McpRules.PRINCIPAL_CONTROL, "the control token controls");
    check(McpRules.principal(true, true, true, true) == McpRules.PRINCIPAL_CONTROL, "whatever else is true");
    check(McpRules.principal(false, true, true, false) == McpRules.PRINCIPAL_READ, "the read token only reads");
    check(McpRules.principal(false, true, false, true) == McpRules.PRINCIPAL_READ, "loopback reads without a token");
    check(McpRules.principal(false, true, false, true) != McpRules.PRINCIPAL_CONTROL, "but never controls without one");
    check(McpRules.principal(false, true, false, false) == McpRules.PRINCIPAL_NONE, "a LAN caller without a token is nobody");
    check(McpRules.principal(true, false, false, false) == McpRules.PRINCIPAL_NONE, "an expired control token grants nothing");
    check(McpRules.principal(true, false, false, true) == McpRules.PRINCIPAL_READ, "on loopback it is just a local reader");
    check(McpRules.principal(true, false, true, false) == McpRules.PRINCIPAL_READ, "and the read token still reads");

    check(McpRules.controlLive(0, 9_000), "no expiry lives forever");
    check(McpRules.controlLive(10_000, 9_999), "alive until its end");
    check(!McpRules.controlLive(10_000, 10_000), "and dead from it");

    check(McpRules.waitBudgetMs(10) == 10_000L, "budget in ms");
    check(McpRules.waitBudgetMs(600) == McpRules.MAX_WAIT_SECONDS * 1000L, "a long wait is capped");
    check(McpRules.waitBudgetMs(0) == 1_000L, "and a zero one raised");

    check(McpRules.nearestSample(new long[] {0, 1000, 2000}, 1400) == 1, "nearest sample in time");
    check(McpRules.nearestSample(new long[] {0, 1000, 2000}, 9000) == 2, "past the end: the last one");
    check(McpRules.nearestSample(new long[] {}, 10) == -1, "no sample, no crop");

    double[] centred = McpRules.subjectCrop(0.4, 0.3, 0.2, 0.4);
    check(near(centred[2], 0.4) && near(centred[3], 0.8), "the box grows by half of itself on every side");
    check(near(centred[0], 0.3) && near(centred[1], 0.1), "around the same centre");
    double[] tiny = McpRules.subjectCrop(0.5, 0.5, 0.02, 0.05);
    check(near(tiny[2], McpRules.MIN_CROP_SIDE) && near(tiny[3], McpRules.MIN_CROP_SIDE), "a far subject still gets context");
    double[] corner = McpRules.subjectCrop(0.9, 0.85, 0.1, 0.15);
    check(near(corner[0] + corner[2], 1) && near(corner[1] + corner[3], 1), "shifted to stay in frame");
    check(near(corner[2], McpRules.MIN_CROP_SIDE), "shifted, not shrunk");
    double[] huge = McpRules.subjectCrop(0, 0, 0.9, 0.9);
    check(near(huge[0], 0) && near(huge[2], 1) && near(huge[3], 1), "never more than the frame");

    check(McpRules.sampleSizeFor(3840, 2160, 768) == 4, "4K to 768: decode at a quarter, 960 px, then scale");
    check(McpRules.sampleSizeFor(1280, 720, 768) == 1, "already close: no reduction");
    check(McpRules.sampleSizeFor(720, 1280, 320) == 4, "portrait counts its longest side");
    check(McpRules.sampleSizeFor(1920, 1080, 0) == 1, "no edge, no reduction");

    check(McpRules.negotiate("2025-06-18").equals("2025-06-18"), "a known version is given back");
    check(McpRules.negotiate("2024-10-07").equals(McpRules.LATEST_PROTOCOL), "an unknown one is offered the latest");
    check(McpRules.negotiate(null).equals(McpRules.LATEST_PROTOCOL), "and so is none");
    check(McpRules.responseProtocol(null, "2025-03-26").equals("2025-03-26"), "initialize answers with what it agreed");
    check(McpRules.responseProtocol("2025-06-18", null).equals("2025-06-18"), "later requests get their own version back");
    check(McpRules.responseProtocol(null, null) == null, "no header asked, none given");
    check(McpRules.rejectsProtocolHeader("1999-01-01"), "an unknown header is refused");
    check(!McpRules.rejectsProtocolHeader(null) && !McpRules.rejectsProtocolHeader(""), "an absent one is not");
    check(!McpRules.rejectsProtocolHeader(McpRules.LATEST_PROTOCOL), "nor a known one");

    check("192.168.1.42".equals(McpRules.lanAddress(Arrays.asList(
      new String[] {"rmnet_data0", "10.64.12.7"},
      new String[] {"tun0", "10.8.0.2"},
      new String[] {"wlan0", "192.168.1.42"}))), "Wi-Fi wins over cellular and VPN whatever the order");
    check("192.168.1.42".equals(McpRules.lanAddress(Arrays.asList(
      new String[] {"p2p0", "192.168.49.1"}, new String[] {"wlan0", "192.168.1.42"}))),
      "Wi-Fi wins over an interface listed before it");
    check(McpRules.lanAddress(Arrays.asList(
      new String[] {"rmnet0", "10.64.12.7"}, new String[] {"tun0", "10.8.0.2"})) == null, "cellular and VPN are never a LAN");
    check("192.168.43.1".equals(McpRules.lanAddress(Collections.singletonList(new String[] {"swlan0", "192.168.43.1"}))),
      "a hotspot is a LAN");
    check("172.20.0.3".equals(McpRules.lanAddress(Collections.singletonList(new String[] {"usb0", "172.20.0.3"}))),
      "an unknown interface is kept when nothing better exists");
    check(McpRules.lanAddress(Collections.emptyList()) == null, "nothing, nothing");

    check(McpRules.relayPrincipal(true) == McpRules.PRINCIPAL_READ, "the read token reads through the relay");
    check(McpRules.relayPrincipal(false) == McpRules.PRINCIPAL_NONE, "and nothing else does, loopback or not");

    System.out.println("McpRulesTest passed");
  }
}
