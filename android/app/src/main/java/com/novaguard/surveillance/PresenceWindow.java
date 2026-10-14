package com.novaguard.surveillance;

/** Capture timestamps, in microseconds. Track lifetime never extends persisted presence. */
public final class PresenceWindow {
  public final long fromUs;
  public final long maxSegmentUs;
  private long throughUs;
  private boolean closed;

  public PresenceWindow(long fromUs, long maxSegmentUs) {
    if (fromUs < 0 || maxSegmentUs <= 0) throw new IllegalArgumentException("Invalid capture window");
    this.fromUs = this.throughUs = fromUs;
    this.maxSegmentUs = maxSegmentUs;
  }

  public void observe(long timestampUs) {
    if (!closed) throughUs = Math.max(throughUs, timestampUs);
  }

  public void close(long timestampUs) {
    throughUs = Math.max(fromUs, timestampUs);
    closed = true;
  }

  public boolean contains(long timestampUs) {
    return timestampUs >= fromUs && timestampUs <= throughUs;
  }

  /** Include only complete AAC packets inside the video presentation window. */
  public boolean containsAudio(long timestampUs, long packetDurationUs, long lastFrameDurationUs) {
    return timestampUs >= fromUs && timestampUs + packetDurationUs <= throughUs + lastFrameDurationUs;
  }

  public boolean mustRotate(long segmentStartUs, long nextVideoTimestampUs) {
    return nextVideoTimestampUs - segmentStartUs >= maxSegmentUs;
  }

  public long throughUs() { return throughUs; }
}
