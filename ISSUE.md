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
- `enableSwiftUIBasedFilters` explicitly enabled through a native override

## Reproduction

A disabled Touchable is inside a view with `filter: [{ blur: 0 }]`.
The SwiftUI filter flag must be enabled and the app rebuilt. In this React Native
version, a blur filter with radius 0 still creates the SwiftUI container.

In the reproduction app, select **Original case**, select **Enable test area**,
and tap the disabled outer area. Leave **Pointer-events workaround** off.
Compare with **Patched case**.

Reproduction repository: https://github.com/rileysay/rngh-swiftui-hit-test-repro

The standalone app has built successfully on EAS; its device results have not yet
been recorded here. The results below were observed using the same test screen
in the original app.

## Observed behaviour

- Tapping the disabled outer area crashes.
- Adding the native boundary guard prevents the crash without disabling pointer events.
- Setting `pointerEvents="none"` also prevents the crash.
- An enabled nested Touchable responds, but tapping the surrounding disabled
  area crashes without the guard.

Expected: the disabled area should ignore the tap without crashing.

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

Would this boundary check be appropriate?
