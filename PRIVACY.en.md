# Privacy Policy — NovaGuard

*[Version française](PRIVACY.md)*

**Last updated: 5 September 2026**

NovaGuard is a monitoring app that turns an Android phone into a detection
camera. It is published under the GPL-3.0 licence and its source code can be
read in full: <https://github.com/devdownin/novaguard>.

## In one sentence

NovaGuard collects nothing, sends nothing, and has no server. Everything the app
produces stays on your phone.

## What the app processes, and where

| Data | Where it is processed | Where it is kept | What leaves the device |
| --- | --- | --- | --- |
| Camera frames | On the device, in memory | Not kept as such | Nothing |
| Detections (person / animal) | On the device, by a bundled model | Local history (`AsyncStorage`) | Nothing |
| Recorded videos | On the device | The app's private folder | Nothing, unless you share one explicitly (see below) |
| Video thumbnails | On the device | The app's private folder, deleted with their video | Nothing |
| Sound (if the microphone is allowed) | On the device | In the audio track of the videos | Nothing |
| Settings and counters | On the device | The app's local storage | Nothing |
| MCP Server (optional) | On the device (port 8081) | Not kept | Data and media explicitly requested by the user's AI assistant |

People and animals are detected by a TensorFlow Lite model bundled inside the
app (EfficientDet-Lite0). Face detection uses ML Kit, also bundled and run on
the device. **None of this processing goes over a network.**

## Nothing is transmitted

The app declares the `INTERNET` permission for three reasons, all optional and
**off by default**: Wi-Fi live view and the MCP server, which only listen on the
local network and answer only devices you connect to them yourself; and cloud
access, described below. While that one is off, NovaGuard opens no outgoing
connection, to any server. There is therefore:

- no account, no sign-up, no identifier;
- no telemetry, no usage statistics, no remote crash reporting;
- no advertising, no tracker, no analytics SDK;
- no sharing with third parties, since there is nothing to share.

### Cloud access (Optional)

If you turn on “Cloud access” in the settings — after a confirmation that names the
relay — the phone opens an **outgoing** connection to NovaGuard's relay, so that
claude.ai, ChatGPT or Copilot Studio can reach your MCP server. It is the app's only
outgoing connection, and it exists only while that setting is on.

- The relay passes the assistant's requests to the phone and its answers back. It
  **sees everything that passes**, including the images the assistant asks for:
  encryption runs from the assistant to the relay, then from the relay to the
  phone, not end to end.
- It keeps nothing: its logs hold only the time, the device identifier, the status
  and the size of a request, never its content.
- Through this path the assistant can only **read**, with the access token or with
  an authorization that **you confirm on the phone** (OAuth); the control token is
  not accepted there. Live view has its own switch. Every authorization is listed
  in the settings and revoked in one tap; the phone keeps only digests, never the
  tokens.
- The phone identifies itself to the relay with a key that never leaves the Android
  Keystore; the public address is derived from it.
- You cut access by turning the setting off: the connection closes at once.

The assistant is itself a third-party service: what it reads goes to the model it
uses, as with the local MCP server.

### MCP Server (Optional)

If you turn on the MCP (*Model Context Protocol*) server in the settings, an AI assistant of your choice can query NovaGuard from this device or, with an access token, from the local network (port 8081 by default). It receives the surveillance metadata, stills and videos **it explicitly asks for**; if that assistant relies on a remote model, this data then leaves the device for the service you chose — never for NovaGuard.

Two further capabilities are off by default and are turned on separately:

- **live view**: the assistant can ask for a picture of what the camera sees during surveillance; nothing is recorded;
- **control**: with a separate control token, time-limited and revocable from the notification, the assistant can start or stop surveillance, set the sensitivity and thresholds, keep a passage, acknowledge an alert and leave a note on an event. It can **delete nothing**, nor change the zone, retention or a token. Every action is logged in the settings.

The “What an AI assistant can see and do” page (Settings) lists it all.


## Who can open the history

The private directory puts the videos out of reach of every other app and of the
network; it does not put them out of reach of whoever picks the phone up.
**Settings ▸ Storage ▸ Lock the history** adds that half: the History tab and
opening a video then ask the device to confirm you — fingerprint, face, or the
screen-lock code. The option is off by default, the confirmation is asked of
Android (the app stores nothing of it), and it lapses as soon as the app leaves
the screen. On a phone with no screen lock set up, the setting says so instead of
suggesting a protection it cannot give.

## The only way out, and you are the one who opens it

Videos are written to the app's private folder, which no other app can read. The
**Share** button in an event's detail opens the Android share sheet and hands
**that one file** to the app you choose, through a temporary permission. Nothing
leaves without that gesture, and what the receiving app then does with it falls
under its own policy.

## Permissions requested, and why

- **Camera** — required: this is the feed that is analysed and recorded.
- **Microphone** — optional: adds sound to the recordings. Refusing it does not
  disable monitoring.
- **Notifications** — optional: the alert on a detection, and the ongoing
  notification showing that the camera is active. Refusing it does not disable
  monitoring. The alert can carry a picture of what the camera sees (a
  setting): it shows only once the phone is unlocked and is never passed to a
  watch or any other connected device.
- **Foreground service (camera / microphone)** — lets monitoring continue with
  the screen off. Without it, Android cuts camera access as soon as the app
  stops being visible.

## Deleting your data

- A video can be deleted from its detail view in the history.
- **Setup → Storage → Delete every video** clears them all.
- Automatic retention (1 to 90 days, or "Forever") deletes clips past the chosen
  age.
- **Uninstalling the app deletes everything**: videos, history and settings live
  in its private storage and go with it.

No data survives uninstallation, and there is no copy anywhere else that you
would have to ask us to erase.

## Children

The app is not directed at children and collects no data, whatever the age of
the person using it.

## Filming is your responsibility

NovaGuard is a video capture tool. Depending on the country, filming people —
including at home, and all the more so a shared space or a public street — is
regulated by law (in France, the GDPR and article 226-1 of the penal code). How
you use the app, what you film and how you inform the people concerned are your
responsibility, not the publisher's.

## Changes

Any change to this policy will be published in this file, whose full history can
be read in the Git repository.

## Contact

Through the repository's issues: <https://github.com/devdownin/novaguard/issues>
