package com.novaguard.surveillance

import android.content.Context
import android.util.Log
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/**
 * Asks the device to confirm who is holding it, for the one screen worth
 * protecting: the recordings.
 *
 * NovaGuard keeps its footage in the app's own private directory and sends it
 * nowhere. That protects it from every other app on the phone and from the
 * network — and not at all from the person who picks the phone up off the hall
 * table where it was propped to watch the door. This is the missing half, and
 * it stays optional: a camera nobody else can reach does not need it.
 *
 * The screen lock is accepted alongside biometrics (`DEVICE_CREDENTIAL`), so a
 * phone whose owner uses a PIN and no fingerprint is not shut out of their own
 * recordings. That also rules out a negative button: BiometricPrompt refuses
 * one when device credentials are allowed.
 */
object IdentityCheck {

  private const val TAG = "NovaGuardIdentity"

  private const val AUTHENTICATORS =
    BiometricManager.Authenticators.BIOMETRIC_WEAK or
      BiometricManager.Authenticators.DEVICE_CREDENTIAL

  fun isAvailable(context: Context): Boolean =
    BiometricManager.from(context).canAuthenticate(AUTHENTICATORS) ==
      BiometricManager.BIOMETRIC_SUCCESS

  /**
   * Runs the prompt and answers exactly once.
   *
   * Must be called on the main thread — BiometricPrompt attaches a fragment to
   * the activity. Every way this can fail to ask is answered `false`: with no
   * activity (the app sits behind the surveillance service, so there may be
   * none), with a device that has since removed its lock, with an OEM that
   * throws from the prompt itself. A locked history that will not open is
   * recoverable; one that opens because the check could not run is not.
   */
  fun confirm(
    activity: FragmentActivity?,
    title: String,
    subtitle: String,
    onResult: (Boolean) -> Unit,
  ) {
    if (activity == null) {
      onResult(false)
      return
    }
    try {
      val prompt = BiometricPrompt(
        activity,
        ContextCompat.getMainExecutor(activity),
        object : BiometricPrompt.AuthenticationCallback() {
          override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
            onResult(true)
          }

          // Cancelled, too many attempts, no hardware any more: all "not now".
          // `onAuthenticationFailed` is deliberately not overridden — a single
          // finger that did not match leaves the prompt open for another try.
          override fun onAuthenticationError(code: Int, message: CharSequence) {
            onResult(false)
          }
        },
      )
      prompt.authenticate(
        BiometricPrompt.PromptInfo.Builder()
          .setTitle(title)
          .setSubtitle(subtitle)
          .setAllowedAuthenticators(AUTHENTICATORS)
          .setConfirmationRequired(false)
          .build(),
      )
    } catch (e: Exception) {
      Log.w(TAG, "Identity check refused: ${e.message}")
      onResult(false)
    }
  }
}
