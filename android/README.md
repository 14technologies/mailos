# MailOS for Android

This native Android app opens an existing MailOS server in a first-party WebView. It does not bundle the server or a demo mailbox: email data, login, calendar, and files remain on the MailOS instance the user connects.

## Launch behavior

- First launch asks for the MailOS server address once.
- Later launches go directly to `/inbox`; MailOS redirects to sign-in when needed.
- The address is stored in private app preferences. Press Back at the inbox to open the native actions for reloading, changing servers, or closing the app.
- The native app bar is hidden so the inbox fills the screen. Your teal paper-plane image is used for the launcher and first-run icon.
- On Android 13 and later, MailOS asks for notification permission the first time the connected inbox opens and creates a private, sound-and-vibration “New mail” channel. Android presents this permission after installation, at first use; users can change it from the app’s system notification settings.
- Same-server navigation stays in the app. External HTTPS links, `mailto:`, and `tel:` links open in their matching Android apps.
- File attachments use Android's system file picker.

Use an HTTPS URL for MailOS servers. The Android app rejects plain HTTP. New-mail notifications come from a background check that runs about every 15 minutes (Android's shortest background interval) using the app's own signed-in session; they show the sender, subject and preview and open that email. Instant push would need Firebase Cloud Messaging, which is not configured. Browser push and passkeys depend on Android WebView support; for those capabilities, install the MailOS PWA from Chrome on the same device.

## Build a debug APK

Install Android Studio with Android SDK Platform 36 and JDK 17. From this folder run:

```powershell
.\gradlew.bat assembleDebug
```

The installable APK is written to `app/build/outputs/apk/debug/app-debug.apk`. To install it over USB debugging:

```powershell
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Debug APKs are for testing and sideloading. A Play Store release needs a release signing key and a signed bundle/APK.

## Download the built APK

**[Download MailOS for Android 1.0.5](https://github.com/14technologies/mailos/releases/latest)** (GitHub Releases) or [from this folder](releases/MailOS-Android-1.0.5-debug.apk). SHA-256 checksums are in [releases/SHA256SUMS.txt](releases/SHA256SUMS.txt). This debug-signed APK installs by sideloading; it is not a Google Play release.

## Google Play preparation

Google Play accepts Android App Bundles (`.aab`) for new app submissions. The project targets API 36, the current submission requirement. Release signing, store listing assets, and Play Console declarations are documented in [PLAY-STORE.md](PLAY-STORE.md). Do not upload the debug APK as a store release. When `upload-key.properties` and its keystore are present, `.\gradlew.bat bundleRelease` creates a signed AAB under `app/build/outputs/bundle/release/`.
