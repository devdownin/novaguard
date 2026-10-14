import com.novaguard.surveillance.YuvPlanes;
import java.nio.ByteBuffer;
import java.util.Arrays;

/** Checks the strided YUV copies against the per-pixel definition they replace. */
public final class YuvPlanesTest {
  private static void check(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }

  /** The per-pixel copy the production code used to run. */
  private static byte[] reference(ByteBuffer plane, int rowStride, int pixelStride, int w, int h) {
    byte[] out = new byte[w * h];
    int origin = plane.position();
    for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
      out[y * w + x] = plane.get(origin + y * rowStride + x * pixelStride);
    }
    return out;
  }

  public static void main(String[] args) {
    int w = 6, h = 4;

    // Planar luma with row padding, and a non-zero start position.
    ByteBuffer luma = ByteBuffer.allocate(3 + 8 * (h - 1) + w);
    for (int i = 0; i < luma.capacity(); i++) luma.put(i, (byte) (i * 7 + 1));
    luma.position(3);
    byte[] packed = new byte[w * h];
    check(YuvPlanes.read(luma, 8, 1, w, h, packed, 0) == w * h, "read must return the next offset");
    check(Arrays.equals(packed, reference(luma, 8, 1, w, h)), "planar read must match per-pixel copy");
    check(luma.position() == 3, "read must not move the caller's buffer");

    // NV12-style chroma: U and V share memory, pixelStride 2, last row ends after its last sample.
    int cw = 3, ch = 2, stride = 8;
    ByteBuffer shared = ByteBuffer.allocate(stride * (ch - 1) + (cw - 1) * 2 + 2);
    for (int i = 0; i < shared.capacity(); i++) shared.put(i, (byte) (100 + i));
    ByteBuffer u = shared.duplicate(); u.position(0);
    ByteBuffer v = shared.duplicate(); v.position(1);
    v = v.slice();
    byte[] uv = new byte[cw * ch * 2];
    int next = YuvPlanes.read(u, stride, 2, cw, ch, uv, 0);
    next = YuvPlanes.read(v, stride, 2, cw, ch, uv, next);
    check(next == uv.length, "both chroma planes must be packed");
    byte[] expected = new byte[uv.length];
    System.arraycopy(reference(u, stride, 2, cw, ch), 0, expected, 0, cw * ch);
    System.arraycopy(reference(v, stride, 2, cw, ch), 0, expected, cw * ch, cw * ch);
    check(Arrays.equals(uv, expected), "interleaved read must match per-pixel copy");

    // Writing U then V into interleaved memory must leave each plane's samples intact.
    ByteBuffer target = ByteBuffer.allocate(shared.capacity());
    ByteBuffer tu = target.duplicate(); tu.position(0);
    ByteBuffer tv = target.duplicate(); tv.position(1); tv = tv.slice();
    int written = YuvPlanes.write(uv, 0, tu, stride, 2, cw, ch);
    written = YuvPlanes.write(uv, written, tv, stride, 2, cw, ch);
    check(written == uv.length, "write must return the next offset");
    check(Arrays.equals(reference(tu, stride, 2, cw, ch), Arrays.copyOfRange(uv, 0, cw * ch)), "U survives V write");
    check(Arrays.equals(reference(tv, stride, 2, cw, ch), Arrays.copyOfRange(uv, cw * ch, uv.length)), "V written");
    check(target.get(stride - 1) == 0, "row padding must not be touched");

    // Planar write round-trips.
    ByteBuffer out = ByteBuffer.allocate(8 * (h - 1) + w);
    YuvPlanes.write(packed, 0, out, 8, 1, w, h);
    check(Arrays.equals(reference(out, 8, 1, w, h), packed), "planar write must round-trip");
    System.out.println("YuvPlanesTest passed");
  }
}
