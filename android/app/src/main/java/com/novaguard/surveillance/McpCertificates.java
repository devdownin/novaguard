package com.novaguard.surveillance;

import java.io.ByteArrayOutputStream;
import java.math.BigInteger;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/**
 * X.509 certificates for the MCP server's HTTPS, built without a library.
 *
 * Android ships no API that issues a certificate, and the libraries that do are
 * megabytes for two structures. A device authority (`ca`) is created once and
 * trusted once by the owner — its PEM and fingerprint are what Réglages hands
 * out — and a server certificate is issued under it for the addresses the
 * phone has *now*. A DHCP lease that moves gets a new server certificate under
 * the same authority, so the client's trust survives it, where pinning one
 * self-signed certificate would break on every new address.
 *
 * Plain Java with the signature passed in, so `scripts/test-presence-native.sh`
 * builds both on a JVM, parses them back, verifies the chain and runs a real
 * TLS handshake against them; on the device the authority's key lives in the
 * Android Keystore and never leaves it.
 */
public final class McpCertificates {
  private McpCertificates() {}

  /** Signs a to-be-signed structure with the issuer's key, SHA-256 with ECDSA, DER output. */
  public interface Signer {
    byte[] sign(byte[] data) throws GeneralSecurityException;
  }

  private static final String ECDSA_WITH_SHA256 = "1.2.840.10045.4.3.2";
  private static final String COMMON_NAME = "2.5.4.3";
  private static final String BASIC_CONSTRAINTS = "2.5.29.19";
  private static final String KEY_USAGE = "2.5.29.15";
  private static final String EXT_KEY_USAGE = "2.5.29.37";
  private static final String SUBJECT_ALT_NAME = "2.5.29.17";
  private static final String SERVER_AUTH = "1.3.6.1.5.5.7.3.1";

  /**
   * One certificate. `ca` makes it an authority (keyCertSign); otherwise it is a
   * TLS server certificate for `ips` and `dnsNames`.
   */
  public static byte[] certificate(
      String subjectCn, String issuerCn, PublicKey subjectKey, BigInteger serial,
      long notBeforeMs, long notAfterMs, boolean ca, List<String> ips, List<String> dnsNames, Signer issuer)
      throws GeneralSecurityException {
    List<byte[]> extensions = new ArrayList<>();
    extensions.add(extension(BASIC_CONSTRAINTS, true, ca ? seq(bool(true)) : seq()));
    // keyCertSign + cRLSign for the authority, digitalSignature for the server.
    extensions.add(extension(KEY_USAGE, true, ca ? bitString(1, (byte) 0x06) : bitString(7, (byte) 0x80)));
    if (!ca) {
      extensions.add(extension(EXT_KEY_USAGE, false, seq(oid(SERVER_AUTH))));
      List<byte[]> names = new ArrayList<>();
      for (String ip : ips) names.add(tagged(0x87, ipBytes(ip)));
      for (String dns : dnsNames) names.add(tagged(0x82, dns.getBytes(StandardCharsets.US_ASCII)));
      extensions.add(extension(SUBJECT_ALT_NAME, false, seq(names.toArray(new byte[0][]))));
    }
    byte[] algorithm = seq(oid(ECDSA_WITH_SHA256));
    byte[] tbs = seq(
        tagged(0xa0, integer(BigInteger.valueOf(2))),
        integer(serial),
        algorithm,
        name(issuerCn),
        seq(time(notBeforeMs), time(notAfterMs)),
        name(subjectCn),
        subjectKey.getEncoded(),
        tagged(0xa3, seq(extensions.toArray(new byte[0][]))));
    return seq(tbs, algorithm, bitString(0, issuer.sign(tbs)));
  }

  public static String pem(byte[] der) {
    String body = Base64.getMimeEncoder(64, "\n".getBytes(StandardCharsets.US_ASCII)).encodeToString(der);
    return "-----BEGIN CERTIFICATE-----\n" + body + "\n-----END CERTIFICATE-----\n";
  }

  /** SHA-256 of the DER, upper-case hex pairs joined by colons — the form browsers and openssl print. */
  public static String fingerprint(byte[] der) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(der);
      StringBuilder out = new StringBuilder();
      for (int i = 0; i < digest.length; i++) {
        if (i > 0) out.append(':');
        out.append(String.format(Locale.ROOT, "%02X", digest[i]));
      }
      return out.toString();
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException(e);
    }
  }

  // ------------------------------------------------------------------- DER

  private static byte[] tlv(int tag, byte[] value) {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    out.write(tag);
    int length = value.length;
    if (length < 0x80) {
      out.write(length);
    } else {
      int bytes = length > 0xffffff ? 4 : length > 0xffff ? 3 : length > 0xff ? 2 : 1;
      out.write(0x80 | bytes);
      for (int i = bytes - 1; i >= 0; i--) out.write(length >>> (8 * i));
    }
    out.write(value, 0, value.length);
    return out.toByteArray();
  }

  private static byte[] concat(byte[]... parts) {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    for (byte[] part : parts) out.write(part, 0, part.length);
    return out.toByteArray();
  }

  private static byte[] seq(byte[]... items) {
    return tlv(0x30, concat(items));
  }

  private static byte[] tagged(int tag, byte[] value) {
    return tlv(tag, value);
  }

  private static byte[] integer(BigInteger value) {
    return tlv(0x02, value.toByteArray());
  }

  private static byte[] bool(boolean value) {
    return tlv(0x01, new byte[] {(byte) (value ? 0xff : 0)});
  }

  private static byte[] bitString(int unusedBits, byte... bits) {
    byte[] value = new byte[bits.length + 1];
    value[0] = (byte) unusedBits;
    System.arraycopy(bits, 0, value, 1, bits.length);
    return tlv(0x03, value);
  }

  private static byte[] oid(String dotted) {
    String[] parts = dotted.split("\\.");
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    out.write(Integer.parseInt(parts[0]) * 40 + Integer.parseInt(parts[1]));
    for (int i = 2; i < parts.length; i++) {
      long value = Long.parseLong(parts[i]);
      int groups = 1;
      for (long v = value >>> 7; v > 0; v >>>= 7) groups++;
      for (int g = groups - 1; g >= 0; g--) {
        int b = (int) ((value >>> (7 * g)) & 0x7f);
        out.write(g > 0 ? b | 0x80 : b);
      }
    }
    return tlv(0x06, out.toByteArray());
  }

  private static byte[] name(String commonName) {
    byte[] cn = tlv(0x0c, commonName.getBytes(StandardCharsets.UTF_8));
    return seq(tlv(0x31, seq(oid(COMMON_NAME), cn)));
  }

  private static byte[] extension(String id, boolean critical, byte[] value) {
    return critical ? seq(oid(id), bool(true), tlv(0x04, value)) : seq(oid(id), tlv(0x04, value));
  }

  /** UTCTime up to 2049, GeneralizedTime after, as RFC 5280 requires. */
  private static byte[] time(long epochMs) {
    Date date = new Date(epochMs);
    SimpleDateFormat year = new SimpleDateFormat("yyyy", Locale.ROOT);
    year.setTimeZone(TimeZone.getTimeZone("UTC"));
    boolean utc = Integer.parseInt(year.format(date)) < 2050;
    SimpleDateFormat format = new SimpleDateFormat(utc ? "yyMMddHHmmss'Z'" : "yyyyMMddHHmmss'Z'", Locale.ROOT);
    format.setTimeZone(TimeZone.getTimeZone("UTC"));
    return tlv(utc ? 0x17 : 0x18, format.format(date).getBytes(StandardCharsets.US_ASCII));
  }

  private static byte[] ipBytes(String ip) {
    try {
      // A literal, never resolved: getByName on an IP string does not touch DNS.
      return InetAddress.getByName(ip).getAddress();
    } catch (UnknownHostException e) {
      throw new IllegalArgumentException("Not an IP literal: " + ip);
    }
  }
}
