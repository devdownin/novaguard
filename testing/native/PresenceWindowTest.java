import com.novaguard.surveillance.PresenceWindow;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/** Runs the production window policy without Android or simulated JavaScript clocks. */
public final class PresenceWindowTest {
  private static void check(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }
  public static void main(String[] args) {
    PresenceWindow window = new PresenceWindow(100_000, 200_000);
    window.observe(550_000);
    check(!window.contains(99_999), "empty scene before entry must not be persisted");
    check(window.contains(100_000), "first sighting before confirmation must be retained");
    check(window.contains(550_000), "last positive frame must be retained");
    check(!window.contains(550_001), "tracker grace and post-roll must not extend persistence");
    window.close(550_000);
    window.observe(900_000);
    check(!window.contains(900_000), "a delayed observation cannot revive a closed presence");

    PresenceWindow shortVideo = new PresenceWindow(100_000,200_000);
    check(shortVideo.containsAudio(111_000,21_333,33_333), "complete audio packet inside last video frame");
    check(!shortVideo.containsAudio(99_000,21_333,33_333), "audio must not start before the presence");
    check(!shortVideo.containsAudio(120_000,21_333,33_333), "audio packet must not extend past the video window");

    List<List<Long>> chunks = new ArrayList<>();
    long start = 100_000;
    List<Long> chunk = new ArrayList<>();
    for (long timestamp : new long[]{50_000,100_000,150_000,200_000,300_000,350_000,500_000,550_000,600_000}) {
      if (!window.contains(timestamp)) continue;
      if (window.mustRotate(start, timestamp)) { chunks.add(chunk); chunk = new ArrayList<>(); start = timestamp; }
      chunk.add(timestamp);
    }
    chunks.add(chunk);
    check(chunks.equals(Arrays.asList(Arrays.asList(100_000L,150_000L,200_000L),
      Arrays.asList(300_000L,350_000L),Arrays.asList(500_000L,550_000L))),
      "rotation must partition all presence samples, with no loss or duplicate");
    check(window.mustRotate(100_000,300_000), "exact duration limit must rotate");
    check(!window.mustRotate(100_000,299_999), "do not rotate early");
    try { new PresenceWindow(0,0); throw new AssertionError("zero duration accepted"); }
    catch (IllegalArgumentException expected) { /* invalid input rejected */ }
    System.out.println("PresenceWindow: entry, exit, late observations and continuous partitions passed");
  }
}
