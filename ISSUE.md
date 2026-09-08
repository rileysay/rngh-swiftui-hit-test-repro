# [iOS] Disabled Touchable crashes inside a SwiftUI-backed React Native blur view

## Description

Tapping the disabled area of a Gesture Handler `Touchable` inside a SwiftUI-backed React Native blur view crashes my iOS app with a native stack overflow.

Expected: the disabled area should ignore the tap without crashing, while an enabled nested Touchable remains usable.

React Native's experimental `enableSwiftUIBasedFilters` flag is explicitly enabled through a native override. The view uses `filter: [{ blur: 0 }]`; in this React Native version, radius 0 still creates the SwiftUI container.

Additional versions: Expo SDK 57 (`expo` 57.0.20), React 19.2.3, Reanimated 4.6.0, and Worklets 0.12.1.

### Device observations

- Tapping the disabled outer area crashes.
- Adding the native boundary guard below prevents the crash without disabling pointer events.
- Setting `pointerEvents="none"` also prevents the crash.
- An enabled nested Touchable responds, but tapping the surrounding disabled area crashes without the guard.

These observations are from the test screen in my original app. The linked repository extracts that screen and has built successfully on EAS; standalone device results have not yet been recorded.

### Crash details

The crash report contains `EXC_BAD_ACCESS` / `SIGSEGV` and `Thread stack size exceeded due to excessive recursion`.

The stack includes:

- Repeated SwiftUI `_UIHostingView._hitTest(with:)` calls
- `-[RNGestureHandlerButton shouldHandleTouch:atPoint:]`
- `-[RNGestureHandlerButton hitTest:withEvent:]`
- `-[RNGestureHandlerButtonComponentView hitTest:withEvent:]`
- React Native `RCTViewComponentView` hit testing

### Suspected cause and proposed fix

The hit-test loop can walk beyond the disabled button into its ancestors. I suspect returning a SwiftUI hosting ancestor causes the recursive hit testing.

Stopping at the button boundary prevents the crash on my device:

```objc
while (inner && ![self shouldHandleTouch:inner atPoint:point]) {
  if (inner == self) {
    return nil;
  }
  inner = inner.superview;
}
```

Eligible child controls can still be found before reaching the boundary, which appears consistent with the nested-button behaviour introduced in [PR #1991](https://github.com/software-mansion/react-native-gesture-handler/pull/1991).

### AI assistance

I used AI (Codex) to help investigate the native code, create the reproduction project, and prepare this report and proposed patch. I personally tested the behaviour on my iPhone. The native crash report and guard-on/off results make this look like a legitimate bug with a plausible fix. The root-cause explanation and broader compatibility of the guard still need maintainer review.

Would this boundary check be appropriate while preserving the intended nested-button behaviour?

## Steps to reproduce

1. Follow the reproduction repository's instructions to build and install the iOS **Debug** development client. The repository includes the native SwiftUI filter flag override.
2. Start Metro and open the app. Select **Original case**, leaving **Pointer-events workaround** off.
3. Select **Enable test area** and tap the disabled outer Touchable.
4. Reopen the app and select **Patched case**. Leave the pointer-events workaround off, enable the test area, and tap the same area to compare.
5. To check nesting, turn on **Enabled inner Touchable** and re-enable the test area. Compare taps on the inner button and the disabled outer area around it.

## Reproduction link

https://github.com/rileysay/rngh-swiftui-hit-test-repro

## Gesture Handler version

3.2.1

## React Native version

0.86.3

## Platforms

iOS

## JavaScript runtime

Hermes

## Workflow

Using Expo Prebuild or an Expo development build

## Architecture

New Architecture (Fabric)

## Build type

Debug mode

## Device

Real device

## Device model

iPhone 16 Pro — iOS 26.5.2

## Acknowledgements

Yes
