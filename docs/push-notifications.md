# Push notifications

Every in-app notification is also sent as a push to the recipient's registered devices.
Delivery goes through **Firebase Cloud Messaging (FCM)**, which is free and needs only outbound calls
from the server to Google, so it works from the VPS.

## How it fits together

1. The app signs in, asks for notification permission, gets an FCM token and `POST`s it to
   `/api/v1/notifications/push-tokens` (`{ token, platform: ANDROID | IOS }`).
2. When the notification service stores a notification (from a QC, finance or account event) it then calls
   `PushService.dispatch` for the rows it just stored. A redelivered event stores nothing new, so it pushes nothing.
3. `FcmSender` sends to each active token. A token FCM reports as gone is switched off.
4. A push failure is logged and never affects the stored notification.
5. Tapping a push opens the finance request it is about (`/finance/requests/:id`); other pushes just open the app.
   A push that arrives while the app is open shows a banner instead.
6. Signing out, or switching "Push notifications" off in Profile, unregisters the device
   (`POST /notifications/push-tokens/unregister`).

Push is **off until a key is configured**: devices still register, so pushes start the day the key is set.

## One-time setup (Android)

1. Create a project at <https://console.firebase.google.com> (free "Spark" plan is enough).
2. Add an Android app with package name `com.axiom.mobile.mobile` (the app's `applicationId`; the file must match it). Download `google-services.json` and put it at
   `apps/mobile/android/app/google-services.json`. It is **git-ignored** (CI's secret scanner flags the API key inside it), so every developer downloads their own copy. The build applies the Google services plugin only when the file exists, so builds without it still work, with push off.
3. Project settings, Service accounts, "Generate new private key". Copy `docker/env/notification.secrets.env.example` to
   `docker/env/notification.secrets.env` (git-ignored, `chmod 600`) and put the **whole key JSON on one line** after
   `FCM_SERVICE_ACCOUNT_JSON=` (no spaces around `=`). Then rebuild the notification service:
   `docker compose -f docker/docker-compose.yml -p ipms up -d --build notification`.
   Check `docker compose ... logs notification | grep -i push` says "push enabled through FCM".
4. Rebuild and install the app. Sign in, allow notifications, and check Profile shows "Push notifications" on.

Neither `google-services.json` nor the service-account JSON is committed. The service-account JSON is the real secret. The API key inside `google-services.json` ships in every APK, but restrict it anyway in Google Cloud, APIs & Services, Credentials: limit it to Android apps with package `com.axiom.mobile.mobile`.

## iOS (wired, untested)

The app code is shared. Still to do, in Xcode and Apple's developer portal:

1. Add an iOS app in Firebase with the iOS bundle id (currently `com.ipms.mobile.mobile`, which you may want to change to `com.axiom.mobile.mobile` to match); add `GoogleService-Info.plist` to `Runner`.
2. In Xcode, Runner target, Signing & Capabilities: add **Push Notifications** and **Background Modes, Remote notifications**.
3. Create an APNs authentication key (.p8) in your Apple developer account and upload it in Firebase,
   Project settings, Cloud Messaging.

## Testing

* Server: `cd apps/notification && npx vitest run` (sender, dispatch and registration are covered with fakes).
* App: `flutter test test/core/push`.
* End to end needs a real device and the key: sign in on the phone, then trigger a notification (for example submit a finance request so an approver is notified).
