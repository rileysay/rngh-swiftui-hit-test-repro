# Disabled Touchable / SwiftUI filter reproduction

An isolated iOS test app for a native hit-testing crash involving a disabled
Gesture Handler `Touchable` inside a React Native SwiftUI-backed blur view.
It opens directly into the same controls used to investigate the original crash.

```sh
git clone https://github.com/rileysay/rngh-swiftui-hit-test-repro.git
cd rngh-swiftui-hit-test-repro
```

## Versions

| Dependency | Version |
| --- | --- |
| Expo | 57.0.20 (SDK 57) |
| React Native | 0.86.3 |
| React | 19.2.3 |
| Gesture Handler | 3.2.1 |
| Reanimated | 4.6.0 |
| Worklets | 0.12.1 |
| Safe Area Context | 5.7.0 |
| Expo Dev Client | 57.0.18 |

Dependencies are pinned in `package.json` and `package-lock.json`. Worklets uses
bundle mode with `strictGlobal: true`, matching the original app. Reanimated is
initialized at the entry point. The test UI itself does not require an animation.
The Worklets override also matches the original app: Expo Modules Core's older
optional peer range must not introduce a second Worklets native module.

## Build and run

Use a current Node.js LTS release compatible with Expo SDK 57 (Node 24 was used
for the local checks). This needs a native **iOS Debug build**. Expo Go and a web
preview cannot reproduce this native path.

On macOS with Xcode and CocoaPods:

```sh
npm ci
npm run ios -- --device
```

`expo run:ios` generates the native project and builds the Debug configuration.
For a simulator, use `npm run ios` without `--device`.

From Windows, Linux, or macOS using EAS Build:

```sh
npm ci
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build --platform ios --profile development
```

The local checkout is linked to the original reporter's EAS project. Other
contributors should remove `expo.owner` and `expo.extra.eas.projectId` from
`app.json`, then use their own Expo project and Apple development credentials
when prompted. Change the bundle identifier in `app.json` if needed for signing.

After installing the development build:

```sh
npm start
```

Open the development client and connect to this project's Metro server. If the
main app's Metro is already using port 8081, choose a free port, for example
`npm start -- --port 8083`, and open the QR code from that server. Phone and
computer must be able to reach each other over the network.

The native build uses source-built React Native with the **stable** release level.
`patch-package` enables `enableSwiftUIBasedFilters` in that level's native flag
provider. A precompiled React Native binary would not contain the override.
See [Expo's build-properties documentation](https://docs.expo.dev/versions/latest/sdk/build-properties/).

## Test

The test starts with the guard on and the test area inactive. The test state is
not saved, so reopening resets it.

1. Select **Patched case**. Keep **Pointer-events workaround** off.
2. Select **Enable test area**, then tap the disabled outer Touchable.
   It should do nothing without crashing.
3. Select **Original case**, then **Enable test area** and tap the same area.
   This is the case that crashed in the original app.
4. For nested controls, turn on **Enabled inner Touchable** and re-enable the
   test area. Tap the inner button, then the disabled outer area around it.
   The inner press counter should increase; with the guard on the outer area
   should remain safe.

The two presets differ only in the native guard setting. Both enable the blur
host, disable the outer Touchable, and leave the pointer-events workaround off.
Changing any option makes the test area inactive until explicitly enabled again.

Other controls allow checking:

- **SwiftUI blur host**: adds/removes the filter. Radius 0 still creates the host
  in the pinned React Native version.
- **Visible blur (6 pt)**: changes the radius from 0 to 6.
- **Disable outer Touchable**: compares enabled and disabled behaviour.
- **Pointer-events workaround**: blocks the outer button and all its descendants.
  Leave it off when comparing the native guard.

The configuration is logged before enabling the test area. A native crash cannot
be caught by a JavaScript error boundary. Reopen the app to continue comparing.

## Native changes

There are two native patches:

- `patches/react-native+0.86.3.patch` enables the SwiftUI filter flag.
- `patches/react-native-gesture-handler+3.2.1.patch` adds the guard and a Debug-only
  per-button switch so original and patched behaviour can be compared in one build.
  **Original case** runs the original ancestor walk for the marked test button.
  Release builds always retain the guard, so use Debug for this comparison.

The two Metro patches are the original app's Worklets bundle-mode support:
generated worklet modules can be hashed during bundling, and hot updates are
forwarded to Worklet runtimes. Metro and metro-runtime are pinned to 0.84.5.
These JavaScript tooling patches do not change native touch handling.

The proposed upstream fix is only:

```objc
if (inner == self) {
  return nil;
}
```

inside the `while` loop in `RNGestureHandlerButton`'s `hitTest:withEvent:` before
advancing to `inner.superview`. The diagnostic switch is not proposed upstream.
The flag stays enabled while switching cases; the blur-host switch only changes
the rendered view's filter style.

## Validation status

The original in-app test was exercised on an **iPhone 16 Pro running iOS 26.5.2**.
The user reported that the original disabled outer area crashes, enabling the
guard prevents it, and disabling pointer events also prevents it. An enabled
inner Touchable responded with the guard off while the surrounding disabled area
still crashed.

This extracted app successfully completed an iOS Debug development build on EAS
on September 8, 2026. Standalone device results have not yet been recorded here.
Confirm it reproduces on-device before describing the standalone reproduction as verified.
An absence of a crash here would mean the reduced example needs further work.

```sh
npm run verify
npm run typecheck
npm test
```

The verification script checks pinned installed versions, the patched native
source, and build configuration. Tests execute the installed hit-test method's
control flow with mocked native views and the screen with mocked React/native
components. They do not execute UIKit or SwiftUI.

Local checks completed: fresh `npm ci --include=dev` with all patches applied, TypeScript,
13 regression tests, iOS JavaScript export, and Expo config introspection.
React Doctor reported 100/100 for the standalone project. These checks and the
successful native build do not replace an iOS device test.

## Share

The simplified issue draft is in [ISSUE.md](ISSUE.md). Link this repository from
the upstream issue so maintainers can build the same test app. It includes the
patches, lockfile, scripts, and tests needed for the reproduction.

Build instructions: [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/).
