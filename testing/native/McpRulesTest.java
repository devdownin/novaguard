import com.novaguard.surveillance.McpRules;

/** Checks the MCP server's pure decisions. */
public final class McpRulesTest {
  private static void check(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
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

    System.out.println("McpRulesTest passed");
  }
}
