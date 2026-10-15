package com.novaguard.surveillance;

import java.nio.ByteBuffer;

/**
 * Row-wise copies between strided YUV_420_888 planes and a packed I420 array.
 *
 * Copying byte by byte through ByteBuffer.get/put(index) cost two bounds checks and a
 * virtual call per pixel, twice per frame (camera → array, array → encoder): at 1080p
 * that alone exceeded the 33 ms frame budget, the worker fell behind and the capture
 * failed with "image perdue". Every copy here moves a whole row per call.
 */
public final class YuvPlanes {
  private YuvPlanes() {}

  /** Packs a {@code width}x{@code height} plane into {@code dst} at {@code offset}; returns the next offset. */
  public static int read(ByteBuffer plane, int rowStride, int pixelStride,
                         int width, int height, byte[] dst, int offset) {
    ByteBuffer src = plane.duplicate();
    int origin = src.position();
    if (pixelStride == 1) {
      for (int y = 0; y < height; y++) {
        src.position(origin + y * rowStride);
        src.get(dst, offset, width);
        offset += width;
      }
      return offset;
    }
    // The last row of an interleaved plane can end right after its last sample.
    byte[] row = new byte[(width - 1) * pixelStride + 1];
    for (int y = 0; y < height; y++) {
      src.position(origin + y * rowStride);
      src.get(row, 0, row.length);
      for (int x = 0, i = 0; x < width; x++, i += pixelStride) dst[offset++] = row[i];
    }
    return offset;
  }

  /**
   * Unpacks {@code width}x{@code height} bytes from {@code src} into a strided plane;
   * returns the next offset. An interleaved row is read back before being written so
   * the samples of the sibling chroma plane sharing that memory are preserved.
   */
  public static int write(byte[] src, int offset, ByteBuffer plane, int rowStride, int pixelStride,
                          int width, int height) {
    ByteBuffer dst = plane.duplicate();
    int origin = dst.position();
    if (pixelStride == 1) {
      for (int y = 0; y < height; y++) {
        dst.position(origin + y * rowStride);
        dst.put(src, offset, width);
        offset += width;
      }
      return offset;
    }
    byte[] row = new byte[(width - 1) * pixelStride + 1];
    for (int y = 0; y < height; y++) {
      int start = origin + y * rowStride;
      dst.position(start);
      dst.get(row, 0, row.length);
      for (int x = 0, i = 0; x < width; x++, i += pixelStride) row[i] = src[offset++];
      dst.position(start);
      dst.put(row, 0, row.length);
    }
    return offset;
  }
}
