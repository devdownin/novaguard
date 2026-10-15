package com.novaguard.surveillance

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Log
import java.io.ByteArrayInputStream
import java.io.File
import java.math.BigInteger
import java.net.Socket
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Principal
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.Signature
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.spec.ECGenParameterSpec
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLEngine
import javax.net.ssl.X509ExtendedKeyManager

/**
 * HTTPS for the MCP server: a device authority and a server certificate under it.
 *
 * The authority's private key is generated in the Android Keystore and cannot
 * leave it; only its certificate is kept on disk, beside nothing else. What the
 * owner trusts is that certificate (Réglages offers its PEM and fingerprint),
 * once. The server certificate is issued in software for the addresses the
 * phone has at the moment of a handshake, and reissued when they change: a new
 * DHCP lease must not mean a client that refuses to connect.
 */
internal object McpTls {
  private const val TAG = "NovaGuardTls"
  private const val CA_ALIAS = "novaguard-mcp-ca"
  private const val CA_NAME = "NovaGuard device CA"
  private const val SERVER_NAME = "NovaGuard MCP"
  private const val DAY_MS = 86_400_000L
  private const val CA_DAYS = 3650L * 3
  private const val SERVER_DAYS = 825L

  /** The authority's certificate, creating the authority on first use. */
  fun authority(context: Context): X509Certificate {
    val keystore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val file = File(context.filesDir, "mcp-tls/ca.der")
    if (keystore.containsAlias(CA_ALIAS) && file.isFile) {
      return parse(file.readBytes())
    }
    // Half an authority (a key without its certificate, or the reverse) is
    // replaced whole: a client that trusted the old one has to re-trust anyway.
    if (keystore.containsAlias(CA_ALIAS)) keystore.deleteEntry(CA_ALIAS)
    val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
    generator.initialize(
      KeyGenParameterSpec.Builder(CA_ALIAS, KeyProperties.PURPOSE_SIGN)
        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_SHA256)
        .build()
    )
    val pair = generator.generateKeyPair()
    val now = System.currentTimeMillis()
    val der = McpCertificates.certificate(
      CA_NAME, CA_NAME, pair.public, serial(), now - DAY_MS, now + CA_DAYS * DAY_MS, true,
      emptyList(), emptyList(), signer(pair.private),
    )
    file.parentFile?.mkdirs()
    file.writeBytes(der)
    return parse(der)
  }

  /** An SSL context whose server certificate follows `addresses()` from one handshake to the next. */
  fun context(context: Context, addresses: () -> List<String>): SSLContext {
    val ca = authority(context)
    val caKey = (KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.getKey(CA_ALIAS, null) as PrivateKey)
    val manager = ReissuingKeyManager(ca, caKey, addresses)
    return SSLContext.getInstance("TLS").apply { init(arrayOf(manager), null, SecureRandom()) }
  }

  fun pem(context: Context): String = McpCertificates.pem(authority(context).encoded)

  fun fingerprint(context: Context): String = McpCertificates.fingerprint(authority(context).encoded)

  private fun signer(key: PrivateKey) = McpCertificates.Signer { data ->
    Signature.getInstance("SHA256withECDSA").run {
      initSign(key)
      update(data)
      sign()
    }
  }

  private fun serial(): BigInteger = BigInteger(127, SecureRandom())

  private fun parse(der: ByteArray): X509Certificate =
    CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(der)) as X509Certificate

  /**
   * Answers every handshake with a server certificate for the current
   * addresses, issuing a new one when they have changed since the last.
   */
  private class ReissuingKeyManager(
    private val ca: X509Certificate,
    private val caKey: PrivateKey,
    private val addresses: () -> List<String>,
  ) : X509ExtendedKeyManager() {
    private var issuedFor: List<String> = emptyList()
    private var keys: KeyPair? = null
    private var chain: Array<X509Certificate> = emptyArray()

    @Synchronized
    private fun current(): Pair<PrivateKey, Array<X509Certificate>> {
      val now = addresses().distinct().sorted()
      val pair = keys
      if (pair == null || now != issuedFor) {
        val generator = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }
        val fresh = generator.generateKeyPair()
        val issuedAt = System.currentTimeMillis()
        val der = McpCertificates.certificate(
          SERVER_NAME, CA_NAME, fresh.public, serial(), issuedAt - DAY_MS, issuedAt + SERVER_DAYS * DAY_MS, false,
          now, listOf("localhost"), signer(caKey),
        )
        keys = fresh
        chain = arrayOf(parse(der), ca)
        issuedFor = now
        Log.i(TAG, "Issued a server certificate for $now")
      }
      return keys!!.private to chain
    }

    // The key is EC: answering an RSA query with it would pick a suite the key cannot sign for.
    private fun aliasFor(keyType: String?): String? = if (keyType == null || keyType.startsWith("EC")) ALIAS else null
    override fun chooseServerAlias(keyType: String?, issuers: Array<out Principal>?, socket: Socket?) = aliasFor(keyType)
    override fun chooseEngineServerAlias(keyType: String?, issuers: Array<out Principal>?, engine: SSLEngine?) = aliasFor(keyType)
    override fun getServerAliases(keyType: String?, issuers: Array<out Principal>?) = arrayOf(ALIAS)
    override fun getCertificateChain(alias: String?): Array<X509Certificate> = current().second
    override fun getPrivateKey(alias: String?): PrivateKey = current().first
    override fun getClientAliases(keyType: String?, issuers: Array<out Principal>?): Array<String>? = null
    override fun chooseClientAlias(keyType: Array<out String>?, issuers: Array<out Principal>?, socket: Socket?): String? = null

    private companion object {
      const val ALIAS = "novaguard-mcp"
    }
  }
}
