# Disabled Touchable / SwiftUI filter reproduction

An isolated iOS test app for a native hit-testing crash involving a disabled
Gesture Handler `Touchable` inside a React Native SwiftUI-backed blur view.
It opens directly into the same controls used to investigate the original crash.

Tracks [issue #4494](https://github.com/software-mansion/react-native-gesture-handler/issues/4494)
and the revision requested in [PR #4495's review](https://github.com/software-mansion/react-native-gesture-handler/pull/4495#pullrequestreview-5139569972).
The current patch keeps disabled buttons as touch targets so taps cannot pass
through to siblings, while suppressing disabled button tracking.

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

**Rebuild and reinstall after pulling this revision.** The earlier development
build contains the old `return nil` fix. A Metro reload or JavaScript update
cannot replace the native hit-testing and tracking changes.

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

The test starts with the revised fix on and the test area inactive. The test state is
not saved, so reopening resets it.

1. Select **Patched case**. Keep **Pointer-events workaround** off.
2. Select **Enable test area**, then tap the disabled outer Touchable.
   It should do nothing without crashing.
3. Select **Original case**, then **Enable test area** and tap the same area.
   This is the case that crashed in the original app.
4. Select **Patched case** again. For nested controls, turn on **Enabled inner Touchable** and re-enable the
   test area. Tap the inner button, then the disabled outer area around it.
   Only the inner press counter should increase. Tapping the surrounding disabled
   area should change neither counter and should not crash.

The two presets differ only in the blur case's hit-test search. Both enable the blur
host, disable the outer Touchable, and leave the pointer-events workaround off.
Changing any option makes the test area inactive until explicitly enabled again.
The disabled tracking checks remain active in both cases.

A second case, **Sibling overlay**, is the structure from the PR #4495 review:
an enabled green sibling fills the frame and a disabled gray overlay sits on top.
Select **Enable sibling test**, then:

1. Tap the gray overlay. Both counters should remain unchanged.
2. Tap an exposed green edge. Only **Sibling presses** should increase.

This case has no blur and always uses the compiled revised fix. The **Original
case** / **Patched case** presets above do not change it. The earlier `return nil`
fix allowed taps on the gray overlay to reach the green sibling underneath.

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
- `patches/react-native-gesture-handler+3.2.1.patch` adds the revised fix and a Debug-only
  per-button switch so original and patched behaviour can be compared in one build.
  **Original case** runs a separate copy of the original unbounded ancestor walk
  for the marked test button only. All disabled tracking checks still apply.
  Release builds always use the bounded search, so use Debug for this comparison.

The two Metro patches are the original app's Worklets bundle-mode support:
generated worklet modules can be hashed during bundling, and hot updates are
forwarded to Worklet runtimes. Metro and metro-runtime are pinned to 0.84.5.
These JavaScript tooling patches do not change native touch handling.

The revised upstream hit-test loop stops at the button and returns it when no
eligible descendant was found:

```objc
RNGHUIView *inner = [super hitTest:point withEvent:event];
while (inner && inner != self && ![self shouldHandleTouch:inner atPoint:point]) {
  inner = inner.superview;
}
return inner;
```

Returning the disabled button prevents the parent from trying a sibling behind
it. An early `if (!_userEnabled) { return NO; }` in
`beginTrackingWithTouch:withEvent:` prevents that button from starting tracking.
The macOS `mouseDown:`, `mouseUp:`, and `mouseDragged:` methods each get an early
`if (!_userEnabled) { return; }` for the same disabled behavior.

These changes follow the maintainer's review. The diagnostic switch is not
proposed upstream. The SwiftUI flag stays enabled while switching cases; the
blur-host switch only changes the rendered view's filter style.

## Validation status

**Historical result — initial `return nil` patch:** the original in-app test was
exercised on an **iPhone 16 Pro running iOS 26.5.2**. The original disabled area
crashed; the initial boundary guard and the pointer-events workaround each
prevented that crash. An enabled inner Touchable responded without the guard
while the surrounding disabled area still crashed. That patch subsequently
proved to allow touches through to overlapping siblings.

The earlier version of this extracted app completed an iOS Debug EAS build on
September 8, 2026. That build and the earlier device observations do not validate
the revised fix now in this repository. **The revised iPhone build and device
tests are pending. macOS has not been built or tested because the reporter does
not have access to a Mac.**

```sh
npm run verify
npm run typecheck
npm test
```

The verification script checks pinned installed versions, the patched native
source, and build configuration. Tests execute the installed hit-test method's
control flow with mocked native views and the screen with mocked React/native
components. They do not execute UIKit or SwiftUI.

These source checks do not replace rebuilding and running the blur, nested-button,
and sibling-overlay cases on an iPhone, or native macOS verification.

## Share

The issue notes and revision status are in [ISSUE.md](ISSUE.md). Link this repository from
the upstream issue so maintainers can build the same test app. It includes the
patches, lockfile, scripts, and tests needed for the reproduction.

Build instructions: [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/).
