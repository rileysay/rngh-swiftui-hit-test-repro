# [iOS] Disabled Touchable crashes inside a SwiftUI-backed React Native blur view

## Description

Tapping a disabled Gesture Handler `Touchable` inside a SwiftUI-backed React Native
blur view crashes my iOS app with a native stack overflow. Adding a boundary check
to `RNGestureHandlerButton`'s `hitTest:withEvent:` prevents the crash on my device.

## Environment

- react-native-gesture-handler: 3.2.1
- React Native: 0.86.3
- React: 19.2.3
- Reanimated: 4.6.0
- Worklets: 0.12.1
- Expo SDK: 57, custom development build
- iOS: 26.5.2
- Device: iPhone 16 Pro
- New Architecture / Fabric
- React Native's experimental `enableSwiftUIBasedFilters` flag explicitly enabled through a native override

## Reproduction

Reproduction repository: https://github.com/rileysay/rngh-swiftui-hit-test-repro

1. Follow the repository's instructions to build and install the iOS Debug development client.
2. Select **Original case**, leaving **Pointer-events workaround** off.
3. Select **Enable test area** and tap the disabled outer Touchable.
4. Reopen the app and compare with **Patched case**, again enabling the test area before tapping.

A disabled Touchable is inside a view with `filter: [{ blur: 0 }]`.
The SwiftUI filter flag must be enabled and the app rebuilt; the repository
includes this configuration. In this React Native version, a blur filter with
radius 0 still creates the SwiftUI container.

The repository extracts the test screen used in my original app and has built
successfully on EAS. The device observations below are from that screen in my
original app; standalone device results have not yet been recorded.

## Observed behaviour

- Tapping the disabled outer area crashes.
- Adding the native boundary guard prevents the crash without disabling pointer events.
- Setting `pointerEvents="none"` also prevents the crash.
- An enabled nested Touchable responds, but tapping the surrounding disabled
  area crashes without the guard.

Expected: the disabled area should ignore the tap without crashing, while an
enabled nested Touchable remains usable.

## Crash details

The report contains `EXC_BAD_ACCESS` / `SIGSEGV` and
`Thread stack size exceeded due to excessive recursion`.

The stack includes:

- `-[RNGestureHandlerButton shouldHandleTouch:atPoint:]`
- `-[RNGestureHandlerButton hitTest:withEvent:]`
- `-[RNGestureHandlerButtonComponentView hitTest:withEvent:]`
- React Native `RCTViewComponentView` hit testing
- Repeated SwiftUI `_UIHostingView._hitTest(with:)` calls

## Suspected cause and proposed fix

The hit-test loop can walk beyond the disabled button into its ancestors. I suspect
returning a SwiftUI hosting ancestor causes the recursive hit testing.

Stopping at the button boundary prevents the crash on my device:

```objc
while (inner && ![self shouldHandleTouch:inner atPoint:point]) {
  if (inner == self) {
    return nil;
  }
  inner = inner.superview;
}
```

Eligible child controls can still be found before reaching the boundary, which
appears consistent with the nested-button behaviour introduced in
[PR #1991](https://github.com/software-mansion/react-native-gesture-handler/pull/1991).

## AI assistance

I used AI (Codex) to help investigate the native code, create the reproduction
project, and prepare this report and proposed patch. I personally tested the
behaviour on my iPhone. The native crash report and guard-on/off results make
this look like a legitimate bug with a plausible fix. The root-cause explanation
and broader compatibility of the guard still need maintainer review.

Would this boundary check be appropriate while preserving the intended
nested-button behaviour?
