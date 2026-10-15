package com.novaguard.surveillance;

import java.util.HashMap;
import java.util.Map;

/**
 * The MCP server's decisions that do not need Android, JSON or a socket.
 *
 * Plain Java so `scripts/test-presence-native.sh` can compile and run them on a
 * bare JVM: the Kotlin around them is compiled only by an APK build, which no
 * ordinary pull request pays for, and two of the bugs these replace — an id
 * bound no real event fitted under, and an error code the documentation said
 * was something else — were exactly the kind a unit test catches in seconds.
 */
public final class McpRules {
  private McpRules() {}

  /**
   * Largest event id accepted. Ids are epoch milliseconds (`nextEventId`), so
   * they passed `Int.MAX_VALUE` in January 1970; fifteen digits is what the
   * resource URIs already admitted and covers the next thirty thousand years.
   */
  public static final long MAX_EVENT_ID = 999_999_999_999_999L;

  /** JSON-RPC code the MCP specification gives a resource that cannot be produced. */
  public static final int RESOURCE_NOT_FOUND = -32002;

  public static boolean isEventId(long id) {
    return id >= 0 && id <= MAX_EVENT_ID;
  }

  /**
   * The JSON-RPC code for a failure while reading a resource: a missing event
   * or a missing file is "not found", whatever code the lookup carried.
   */
  public static int resourceRpcCode(String mcpCode, int fallback) {
    if ("NOVAGUARD_NOT_FOUND".equals(mcpCode) || "NOVAGUARD_MEDIA_UNAVAILABLE".equals(mcpCode)) {
      return RESOURCE_NOT_FOUND;
    }
    return fallback;
  }

  /**
   * When the current status began. A snapshot that repeats the previous status
   * keeps its start, so "camera obstructed since 03:12" survives every history
   * push that happens while it lasts.
   */
  public static long statusSince(String previousStatus, long previousSince, String status, long now) {
    if (status == null) return now;
    return status.equals(previousStatus) && previousSince > 0 ? previousSince : now;
  }

  /** The statuses that mean nobody is being reliably filmed (`status.ts`). */
  public static boolean isFault(String status) {
    if (status == null) return false;
    switch (status) {
      case "camera-unavailable":
      case "camera-obstructed":
      case "camera-moved":
      case "storage-insufficient":
      case "analysis-unavailable":
      case "recording-error":
        return true;
      default:
        return false;
    }
  }

  /** Who a request is from, in increasing privilege. */
  public static final int PRINCIPAL_NONE = 0;
  public static final int PRINCIPAL_READ = 1;
  public static final int PRINCIPAL_CONTROL = 2;

  /**
   * The control token alone grants control, and it grants reading too — while
   * it lives. A loopback caller reads without a token — anything on the phone
   * could open the app — but never controls without one: an app sitting on
   * 127.0.0.1 must not be able to switch the camera off. An expired control
   * token grants nothing, not even reading: it is the credential the owner
   * meant to stop working, and quietly downgrading it would keep a forgotten
   * agent watching.
   */
  public static int principal(boolean controlTokenMatches, boolean controlLive, boolean readTokenMatches, boolean loopback) {
    if (controlTokenMatches && controlLive) return PRINCIPAL_CONTROL;
    if (readTokenMatches || loopback) return PRINCIPAL_READ;
    return PRINCIPAL_NONE;
  }

  /** `expiresAt` 0 means the owner chose no expiry; otherwise epoch ms. */
  public static boolean controlLive(long expiresAt, long now) {
    return expiresAt <= 0 || now < expiresAt;
  }

  /** `wait_for_event` long-poll bounds, in seconds. */
  public static final int DEFAULT_WAIT_SECONDS = 20;
  public static final int MAX_WAIT_SECONDS = 25;

  public static long waitBudgetMs(int requestedSeconds) {
    return Math.max(1, Math.min(MAX_WAIT_SECONDS, requestedSeconds)) * 1000L;
  }

  /** Frames one `get_event_frames` call may return, and the default. */
  public static final int MAX_FRAMES = 8;
  public static final int DEFAULT_FRAMES = 4;

  /**
   * Where to sample `count` frames in a clip of `durationMs`, in microseconds.
   *
   * The middle of each of `count` equal slices rather than the ends: a clip
   * starts on the first sighting and stops on the last, so its first and last
   * frames are the ones where the subject is least in view. A clip whose
   * duration is unknown (0) gets one frame at its start, which always decodes.
   */
  public static long[] frameTimesUs(long durationMs, int count) {
    int n = Math.max(1, Math.min(MAX_FRAMES, count));
    if (durationMs <= 0) return new long[] {0L};
    long[] times = new long[n];
    for (int i = 0; i < n; i++) {
      times[i] = (long) ((i + 0.5) * durationMs * 1000L / n);
    }
    return times;
  }

  /** The sample whose time is nearest `atMs`, or -1 when there is none. */
  public static int nearestSample(long[] timesMs, long atMs) {
    int best = -1;
    long bestGap = Long.MAX_VALUE;
    for (int i = 0; i < timesMs.length; i++) {
      long gap = Math.abs(timesMs[i] - atMs);
      if (gap < bestGap) { best = i; bestGap = gap; }
    }
    return best;
  }

  /**
   * The largest power-of-two decode reduction that still leaves the longest
   * side at or above `maxEdge`; the exact size is reached by scaling after.
   */
  public static int sampleSizeFor(int width, int height, int maxEdge) {
    int longest = Math.max(width, height);
    int sample = 1;
    while (maxEdge > 0 && longest / (sample * 2) >= maxEdge) sample *= 2;
    return sample;
  }

  /** Half the box again on every side. */
  public static final double CROP_PAD = 0.5;
  /** Never tighter than this share of the frame, on either axis. */
  public static final double MIN_CROP_SIDE = 0.35;

  /**
   * Where to crop a still around a subject box, as `{left, top, width, height}`
   * fractions of the frame.
   *
   * Generous by design. The box is a sample up to a second from the frame it
   * crops, decoded from the nearest point the codec can seek to, and a crop
   * that cuts off the hands is the face-only zoom this app already gave up. So
   * the box grows by {@link #CROP_PAD} on every side, never below
   * {@link #MIN_CROP_SIDE}, and is shifted — not shrunk — to stay in frame.
   */
  public static double[] subjectCrop(double x, double y, double w, double h) {
    double width = Math.min(1, Math.max(MIN_CROP_SIDE, w * (1 + 2 * CROP_PAD)));
    double height = Math.min(1, Math.max(MIN_CROP_SIDE, h * (1 + 2 * CROP_PAD)));
    double left = Math.max(0, Math.min(1 - width, x + w / 2 - width / 2));
    double top = Math.max(0, Math.min(1 - height, y + h / 2 - height / 2));
    return new double[] {left, top, width, height};
  }

  /**
   * Admission for connections, before anything is read from them.
   *
   * An unbounded thread pool with a per-read timeout let any peer on the Wi-Fi
   * hold a thread for as long as it kept trickling bytes, and open as many as
   * it liked — in the process that also runs the camera and the encoder. The
   * gate caps the total and each peer's share, so one client cannot take every
   * slot and none can take the process down.
   */
  public static final class ConnectionGate {
    private final int maxTotal;
    private final int maxPerPeer;
    private final Map<String, Integer> perPeer = new HashMap<>();
    private int total;

    public ConnectionGate(int maxTotal, int maxPerPeer) {
      this.maxTotal = maxTotal;
      this.maxPerPeer = maxPerPeer;
    }

    /** Takes a slot for `peer`, or returns false and takes nothing. */
    public synchronized boolean tryEnter(String peer) {
      int mine = perPeer.getOrDefault(peer, 0);
      if (total >= maxTotal || mine >= maxPerPeer) return false;
      perPeer.put(peer, mine + 1);
      total++;
      return true;
    }

    public synchronized void leave(String peer) {
      Integer mine = perPeer.get(peer);
      if (mine == null) return;
      if (mine <= 1) perPeer.remove(peer); else perPeer.put(peer, mine - 1);
      total--;
    }

    public synchronized int inUse() {
      return total;
    }
  }

  /**
   * A whole request's time budget. A per-read timeout is renewed by every byte,
   * so it bounds silence, not duration; this bounds duration.
   */
  public static final class Deadline {
    private final long endsAt;

    public Deadline(long now, long budgetMs) {
      this.endsAt = now + budgetMs;
    }

    public long remainingMs(long now) {
      return Math.max(0, endsAt - now);
    }

    public boolean expired(long now) {
      return now >= endsAt;
    }
  }
}
