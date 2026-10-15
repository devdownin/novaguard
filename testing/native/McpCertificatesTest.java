import com.novaguard.surveillance.McpCertificates;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigInteger;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.Signature;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.security.spec.ECGenParameterSpec;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLServerSocket;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManagerFactory;

/** Builds a device authority and a server certificate, parses them back, and shakes hands with them. */
public final class McpCertificatesTest {
  private static void check(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }

  private static KeyPair ec() throws Exception {
    KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
    generator.initialize(new ECGenParameterSpec("secp256r1"));
    return generator.generateKeyPair();
  }

  private static McpCertificates.Signer signer(KeyPair pair) {
    return data -> {
      Signature signature = Signature.getInstance("SHA256withECDSA");
      signature.initSign(pair.getPrivate());
      signature.update(data);
      return signature.sign();
    };
  }

  private static X509Certificate parse(byte[] der) throws Exception {
    return (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(new ByteArrayInputStream(der));
  }

  public static void main(String[] args) throws Exception {
    long now = System.currentTimeMillis();
    long year = 365L * 24 * 3600 * 1000;
    KeyPair caKeys = ec();
    byte[] caDer = McpCertificates.certificate("NovaGuard device CA", "NovaGuard device CA", caKeys.getPublic(),
        BigInteger.valueOf(1), now - 86_400_000L, now + 30 * year, true,
        Collections.emptyList(), Collections.emptyList(), signer(caKeys));
    X509Certificate ca = parse(caDer);
    ca.verify(caKeys.getPublic());
    check(ca.getBasicConstraints() >= 0, "the authority is a CA");
    check(ca.getKeyUsage()[5], "and may sign certificates");
    check(ca.getNotAfter().getTime() / 1000 == (now + 30 * year) / 1000, "a validity past 2049 survives (GeneralizedTime)");

    KeyPair leafKeys = ec();
    byte[] leafDer = McpCertificates.certificate("NovaGuard MCP", "NovaGuard device CA", leafKeys.getPublic(),
        new BigInteger(1, new byte[] {0x7f, 1, 2, 3, 4, 5, 6, 7}), now - 86_400_000L, now + year, false,
        Arrays.asList("127.0.0.1", "192.168.1.42", "::1"), Collections.singletonList("localhost"), signer(caKeys));
    X509Certificate leaf = parse(leafDer);
    leaf.verify(caKeys.getPublic());
    check(leaf.getBasicConstraints() == -1, "the server certificate is not a CA");
    check(leaf.getKeyUsage()[0] && !leaf.getKeyUsage()[5], "it signs handshakes, not certificates");
    check(leaf.getExtendedKeyUsage().contains("1.3.6.1.5.5.7.3.1"), "for TLS servers");
    StringBuilder sans = new StringBuilder();
    for (List<?> san : leaf.getSubjectAlternativeNames()) sans.append(san.get(1)).append(' ');
    check(sans.toString().contains("192.168.1.42") && sans.toString().contains("localhost"), "names its addresses: " + sans);
    check(leaf.getIssuerX500Principal().equals(ca.getSubjectX500Principal()), "issued by the authority");

    String fingerprint = McpCertificates.fingerprint(caDer);
    check(fingerprint.matches("([0-9A-F]{2}:){31}[0-9A-F]{2}"), "fingerprint in the usual form");
    String pem = McpCertificates.pem(caDer);
    check(parse(pem.getBytes("US-ASCII")).equals(ca), "the PEM is the same certificate");

    handshake(leafKeys, leaf, ca, true);
    handshake(leafKeys, leaf, parse(McpCertificates.certificate("Other CA", "Other CA", ec().getPublic(),
        BigInteger.TEN, now - 1000, now + year, true, Collections.emptyList(), Collections.emptyList(), signer(ec()))), false);

    System.out.println("McpCertificatesTest passed");
  }

  /** A real TLS 1.3 handshake on loopback, hostname checked against the IP SAN. */
  private static void handshake(KeyPair leafKeys, X509Certificate leaf, X509Certificate trusted, boolean expectOk) throws Exception {
    char[] password = "x".toCharArray();
    KeyStore keys = KeyStore.getInstance(KeyStore.getDefaultType());
    keys.load(null, null);
    keys.setKeyEntry("leaf", leafKeys.getPrivate(), password, new java.security.cert.Certificate[] {leaf});
    KeyManagerFactory kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
    kmf.init(keys, password);
    SSLContext serverContext = SSLContext.getInstance("TLS");
    serverContext.init(kmf.getKeyManagers(), null, null);

    KeyStore trust = KeyStore.getInstance(KeyStore.getDefaultType());
    trust.load(null, null);
    trust.setCertificateEntry("ca", trusted);
    TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
    tmf.init(trust);
    SSLContext clientContext = SSLContext.getInstance("TLS");
    clientContext.init(null, tmf.getTrustManagers(), null);

    try (SSLServerSocket server = (SSLServerSocket) serverContext.getServerSocketFactory()
        .createServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))) {
      Thread accept = new Thread(() -> {
        try (SSLSocket peer = (SSLSocket) server.accept()) {
          InputStream in = peer.getInputStream();
          OutputStream out = peer.getOutputStream();
          out.write(in.read());
          out.flush();
        } catch (Exception ignored) {
          // The refused case ends here, by design.
        }
      });
      accept.start();
      boolean ok;
      try (SSLSocket client = (SSLSocket) clientContext.getSocketFactory().createSocket("127.0.0.1", server.getLocalPort())) {
        SSLParameters parameters = client.getSSLParameters();
        parameters.setEndpointIdentificationAlgorithm("HTTPS");
        client.setSSLParameters(parameters);
        client.getOutputStream().write(42);
        client.getOutputStream().flush();
        ok = client.getInputStream().read() == 42;
      } catch (javax.net.ssl.SSLException e) {
        ok = false;
      }
      accept.join(5000);
      check(ok == expectOk, expectOk ? "a client trusting the device CA connects" : "a client trusting another CA is refused");
    }
  }
}
