# iPhone build plan

This is a plan for turning the existing React UI into an installed Capacitor iOS app. It has not been built or tested on an iPhone yet. The first milestone is a signed build running on a real device; TestFlight and App Store submission require the additional work below.

## Current state

The repository already depends on Capacitor 8 core and has native adapters for foreground location, preferences, private file storage, sharing, local notifications, network state, app lifecycle, and incoming URLs. `initializePlatform()` loads those adapters before React mounts. The UI build produces `dist/`, and installed builds must set `VITE_API_ORIGIN` explicitly so API calls reach the public HTTPS service. The live-feed host is discovered from `/api/v1/auth/config` at launch rather than embedded in the app.

The repository does **not** yet contain `@capacitor/cli`, `@capacitor/ios`, `capacitor.config.ts`, or an `ios/` Xcode project. The account adapter interface exists, but the app currently mounts the browser Clerk provider on every platform. Incoming URL handling exists in JavaScript, but iOS Universal Links are not configured. See [UI platform boundaries](ui-platform.md), [mobile privacy contract](api/mobile-privacy.md), and [Clerk setup](clerk-setup.md).

## Build on the Mac

These steps create and modify project files. Make sure the Mac has the intended source revision, including any changes that have not been committed on another machine. Work from the repository root.

1. Check the tools and install the locked JavaScript dependencies. Capacitor 8 requires Node.js 22 or later and Xcode 26 or later. Xcode Command Line Tools must be available. The default Capacitor 8 iOS project uses Swift Package Manager, so CocoaPods is not needed for this setup. If `xcode-select -p` or `xcodebuild -version` fails, finish installing or selecting Xcode before proceeding. [Capacitor environment requirements](https://capacitorjs.com/docs/getting-started/environment-setup).

   ```sh
   cd /path/to/api.ttcstatus.ca
   node --version
   xcodebuild -version
   xcode-select -p
   npm ci
   ```

2. Add the missing Capacitor packages on major version 8, matching the existing `@capacitor/core` major version:

   ```sh
   npm install --save-dev @capacitor/cli@8
   npm install @capacitor/ios@8
   ```

3. Choose a unique, permanent Apple bundle identifier that you control. Replace `ca.example.ttcstatus` in the command below with that identifier. Create `capacitor.config.ts` in the repository root:

   ```sh
   cat > capacitor.config.ts <<'EOF'
   import type { CapacitorConfig } from '@capacitor/cli';

   const config: CapacitorConfig = {
     appId: 'ca.example.ttcstatus',
     appName: 'TTC Status',
     webDir: 'dist',
   };

   export default config;
   EOF
   ```

   Keep the default iOS WebView scheme and host while testing: `capacitor://localhost` already appears in the API's authorized session parties. Changing the scheme or host also requires corresponding Clerk and API configuration.

4. Build the UI with public HTTPS origins, generate the native project, copy the bundle and plugins into it, and open Xcode. Run `cap add ios` only the first time; later changes use `cap sync ios`. Use `build:ui`, because the repository's general `build` command also builds API artifacts. [Capacitor iOS setup](https://capacitorjs.com/docs/ios).

   ```sh
   VITE_API_ORIGIN=https://ttcstatus.ca VITE_SITE_ORIGIN=https://ttcstatus.ca npm run build:ui
   npx cap add ios
   npx cap sync ios
   npx cap open ios
   ```

   Without `VITE_API_ORIGIN`, API requests from the installed bundle would resolve against the local WebView origin. These `VITE_` values are public build settings, not credentials. Confirm that the production API and live-feed host are reachable from the phone before testing signed-in flows.

5. In Xcode, select the **App target**:

   - Under **Signing & Capabilities**, choose your Apple Developer team, enable automatic signing, and confirm that the Bundle Identifier matches `appId`.
   - Under **Info**, add `NSLocationWhenInUseUsageDescription` and `NSLocationAlwaysAndWhenInUseUsageDescription`. A suitable description is “Find nearby TTC stops when you tap Locate.” Capacitor's geolocation plugin requires both descriptions. This app currently uses foreground location; do not enable background location just to satisfy the usage-description requirement. [Capacitor geolocation guidance](https://capacitorjs.com/docs/apis/geolocation).
   - Select a connected iPhone as the run destination and press **Run**. Complete any device trust or Developer Mode prompts. The simulator is useful for layout checks, but GPS, lifecycle, sharing, and permission behavior need real-device validation. Capacitor 8 supports iOS 15 and later. [Capacitor iOS guide](https://capacitorjs.com/docs/ios).

6. After each UI or asset change, rebuild and sync before running the app again:

   ```sh
   VITE_API_ORIGIN=https://ttcstatus.ca VITE_SITE_ORIGIN=https://ttcstatus.ca npm run build:ui
   npx cap sync ios
   ```

   Run `npm run typecheck` and `npm run check:boundaries` before packaging. `npm run test:mobile` checks phone layouts in a browser; it does not validate iOS plugins. Commit the new Capacitor configuration, iOS project, and package-lock changes once the device build is working.

## Device acceptance checks

On a real iPhone, verify all of the following before treating the shell as functional:

- Cold launch loads the bundled UI and public map; live vehicles load through the launch-time transport configuration.
- Foreground/background transitions pause and resume live work correctly; loss and restoration of connectivity show the expected saved or stale state. Validate the live-feed clock-skew and outage paths (tick document gaps, outage documents — see [Data.md](Data.md)).
- Tapping **Locate** prompts for foreground location and shows nearby stops. Denying permission leaves the app usable.
- Preferences and cached map data survive a cold restart. Sharing and exported files use the iOS share sheet.
- Sign-up, sign-in, sign-out, session restoration, and every authenticated account write work with the production Clerk instance and API. Check the issued token's authorized party against `capacitor://localhost`; the API already permits that party, but unit tests do not prove a real iPhone sign-in flow. [Clerk says Capacitor origins must be allowed on the instance](https://clerk.com/docs/reference/backend/types/backend-instance).
- Test the actual sign-in methods offered to users, especially any email-link or external OAuth return flow. Confirm that redirects return to the app and do not strand the user in Safari.

The current entry point mounts `<AccountProvider>` without a native adapter, so it uses `BrowserAccountProvider` inside the WebView. It may work after configuring Clerk's allowed origin, but it has not been validated on iOS. If sign-in, redirects, session restoration, or bearer tokens fail, implement and mount a native session adapter using the existing `Account` interface and `createApiClient({ token, credentials: 'omit' })`. That adapter must also provide account management and sign-out behavior where the UI currently relies on Clerk components.

## Work before TestFlight or App Store release

1. **Finish account handling.** Resolve the real-device Clerk results above. [Clerk setup](clerk-setup.md) also records that account deletion controls and cleanup of the app's D1 account data after Clerk deletion are future work. An App Store app that offers account creation must let users initiate deletion in the app. Complete the user flow and data cleanup before submission. [Apple account-deletion guidance](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/).
2. **Add Universal Links if shared website URLs should open the app.** Configure the Associated Domains capability for `applinks:ttcstatus.ca` and serve a valid `https://ttcstatus.ca/.well-known/apple-app-site-association` file containing the Apple Team ID and final bundle ID. The JavaScript incoming-link handler is already present. Test cold and warm launches from a link. [Capacitor deep-link guide](https://capacitorjs.com/docs/guides/deep-links).
3. **Prepare native presentation and privacy information.** Add a production app icon and review the launch screen and safe areas on actual iPhone sizes. Review the generated iOS privacy manifest and the data used by the app and its SDKs, then complete App Store Connect privacy answers. [Capacitor privacy manifest guide](https://capacitorjs.com/docs/ios/privacy-manifest). The local-notification adapter exists, but no current UI schedules reminders; notification product behavior would be separate work.
4. **Archive and distribute.** Create an App Store Connect app record using the exact Xcode bundle ID, set the version and build number in Xcode, select a generic iOS device, and use **Product → Archive → Distribute App → App Store Connect**. Use TestFlight to validate the distributed build before submitting for review. Apple requires the app record before upload, and current uploads require Xcode 26 or later with an iOS 26 or later SDK. [App record](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/), [upload requirements](https://developer.apple.com/news/upcoming-requirements/?id=04282026a).

The first build can proceed without Universal Links or App Store metadata. Signed-in features and the deletion/data-retention work need to be resolved before claiming the app is ready for public distribution.
