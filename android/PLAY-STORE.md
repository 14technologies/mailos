# Google Play release preparation

## Listing draft

- **App name:** MailOS
- **Short description:** Free business email, calendar, and file Drive for your domain.
- **Category:** Productivity
- **Ads:** No ads are included by this Android shell.
- **Target audience:** Adults/business users; confirm the target audience in Play Console.
- **App icon:** Adapt the project icon to Play's 512 × 512 PNG listing requirement, using `../public/icon-512.png` as the source.
- **Feature graphic and screenshots:** Capture these from the final app on supported Android phone and tablet sizes after review. Don't use mockups that imply features not present in the shipped build.

## App description draft

MailOS brings your business email to Android. Connect your own MailOS server once and open straight to your inbox on every later launch. Read and write business email, manage your calendar, and access your files through the MailOS account you already use.

MailOS is open source. Each organization runs its own MailOS server and controls its own data. This Android app stores the server address on your device and keeps the signed-in session in Android WebView storage. Use your organization's HTTPS MailOS address to connect.

## Before submission

1. Confirm that the Play Console owner has the rights to publish the MailOS name, brand, and service. The Android app uses a WebView of the MailOS service, so include evidence of ownership/authorization if requested by Google Play.
2. Host a reviewed privacy policy on a public HTTPS URL and enter it in Play Console. Explain that the app connects to a MailOS server selected by the user and that each server operator controls email and account data. Review any server-side analytics, mail, storage, and authentication providers before publishing.
3. Complete the Data safety, content rating, target audience, app access, and developer verification sections from the actual production deployment. This shell includes no analytics or advertising SDKs, but the connected MailOS server may have additional data flows.
4. Replace the package ID if the Play Console app was already created under a different ID. Once uploaded, the application ID cannot be changed for that listing.
5. Build a signed Android App Bundle (`.aab`) with the publisher's protected upload key. Back up the key and its password separately; losing them can prevent future updates.
6. Verify install, login/session persistence, inbox, calendar, Drive, compose, attachment picking, external links, offline/reconnect behavior, accessibility, and supported Android versions on real devices. Verify the deployed server uses HTTPS.
7. Upload the AAB to an internal testing track, complete Play's pre-launch report, fix findings, then submit the reviewed listing for production.

## Known release considerations

- This is a native Android entry point around the MailOS web client, not a second implementation of its mail/calendar APIs. Google Play can reject low-functionality wrappers or apps without rights to the content. The native first-run server connection, direct inbox launch, same-origin navigation, attachment picker, session persistence, and external link handling are included, but Play approval is never guaranteed.
- The Android app requests notification permission and creates a notification channel, but native Android push delivery is not implemented. The server currently supports APNs registrations only; Firebase Cloud Messaging setup and Android token delivery are missing. Android WebView does not provide the same web-push and passkey capabilities as Chrome. Do not claim push or passkey support in the Play listing unless the complete delivery flows are implemented and verified.
- The MailOS deployment URL and Play Console owner are not bundled. Users select their own MailOS HTTPS instance on first launch.
- A Play Store release requires a signed AAB, store listing assets, policy declarations, and a verified publisher account. This repository alone cannot complete account verification or submit a release.
