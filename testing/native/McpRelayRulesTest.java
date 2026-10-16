import com.novaguard.surveillance.McpRelayRules;
import java.nio.charset.StandardCharsets;

/** Checks the relay client's pure decisions. */
public final class McpRelayRulesTest {
  private static void check(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }

  public static void main(String[] args) {
    // Computed by relay/src/protocol.js for the same 91 bytes: the two sides must agree on an address.
    byte[] spki = new byte[91];
    for (int i = 0; i < spki.length; i++) spki[i] = (byte) i;
    check("ldjjiwnscmfc4fisklkarok6nu".equals(McpRelayRules.deviceId(spki)), "same id as the relay computes");
    check(McpRelayRules.deviceId(spki).matches("[a-z2-7]{26}"), "26 base32 characters");

    check("novaguard-relay-v1\nabc".equals(new String(McpRelayRules.signedMessage("abc"), StandardCharsets.UTF_8)),
      "the signed message is the relay's prefix and the nonce");

    check("https://relay.example.org".equals(McpRelayRules.relayBase(" https://Relay.Example.org/ ")), "trimmed, lower-cased, no slash");
    check("https://relay.example.org:8443".equals(McpRelayRules.relayBase("https://relay.example.org:8443")), "a port is kept");
    check(McpRelayRules.relayBase("http://relay.example.org") == null, "plain http would carry the token in clear");
    check(McpRelayRules.relayBase("https://relay.example.org/path") == null, "no path");
    check(McpRelayRules.relayBase("https://user:pw@relay.example.org") == null, "no credentials");
    check(McpRelayRules.relayBase("https://relay.example.org?x=1") == null, "no query");
    check(McpRelayRules.relayBase("https://relay.example.org:99999") == null, "a port in range");
    check(McpRelayRules.relayBase("https://") == null && McpRelayRules.relayBase("") == null && McpRelayRules.relayBase(null) == null, "nothing to dial");
    check(McpRelayRules.relayBase("https://exa mple.org") == null, "no spaces");

    check("wss://relay.example.org:8443/connect".equals(McpRelayRules.connectUrl("https://relay.example.org:8443")), "secure web socket");
    check("https://relay.example.org/d/abc/mcp".equals(McpRelayRules.publicUrl("https://relay.example.org", "abc")), "the public address");

    check(McpRelayRules.pathAllowed("/mcp") && McpRelayRules.pathAllowed("/mcp?x=1"), "the endpoint");
    check(!McpRelayRules.pathAllowed("/health") && !McpRelayRules.pathAllowed("/mcp/../x") && !McpRelayRules.pathAllowed(null), "nothing else");

    check(McpRelayRules.backoffMs(0) == 1_000 && McpRelayRules.backoffMs(1) == 2_000 && McpRelayRules.backoffMs(5) == 32_000, "doubles");
    check(McpRelayRules.backoffMs(6) == 60_000 && McpRelayRules.backoffMs(50) == 60_000, "then holds at a minute");
    check(McpRelayRules.backoffMs(-3) == 1_000, "never negative");

    check(McpRelayRules.shouldReconnect(1006) && McpRelayRules.shouldReconnect(1001), "a dropped line is retried");
    check(!McpRelayRules.shouldReconnect(McpRelayRules.CLOSE_REPLACED), "a replaced phone does not fight itself");
    check(!McpRelayRules.shouldReconnect(McpRelayRules.CLOSE_UNAUTHORIZED), "a refused signature is not retried");

    System.out.println("McpRelayRulesTest passed");
  }
}
