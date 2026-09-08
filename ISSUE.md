# [iOS] Disabled Touchable crashes inside a SwiftUI-backed React Native blur view

Notes for [issue #4494](https://github.com/software-mansion/react-native-gesture-handler/issues/4494)
and [PR #4495](https://github.com/software-mansion/react-native-gesture-handler/pull/4495),
updated after the [maintainer's review](https://github.com/software-mansion/react-native-gesture-handler/pull/4495#pullrequestreview-5139569972).

## Description

Tapping the disabled area of a Gesture Handler `Touchable` inside a SwiftUI-backed React Native blur view crashes my iOS app with a native stack overflow.

Expected: the disabled area should ignore the tap without crashing, while an enabled nested Touchable remains usable.

React Native's experimental `enableSwiftUIBasedFilters` flag is explicitly enabled through a native override. The view uses `filter: [{ blur: 0 }]`; in this React Native version, radius 0 still creates the SwiftUI container.

Additional versions: Expo SDK 57 (`expo` 57.0.20), React 19.2.3, Reanimated 4.6.0, and Worklets 0.12.1.

### Historical device observations: initial patch

- Tapping the disabled outer area crashes.
- Adding the initial boundary guard, which returned `nil` at the button, prevents the crash without disabling pointer events.
- Setting `pointerEvents="none"` also prevents the crash.
- An enabled nested Touchable responds, but tapping the surrounding disabled area crashes without the guard.

These observations are from the test screen in my original app. The earlier standalone project also built successfully on EAS. Neither those device observations nor that build verifies the revised fix below.

### Crash details

The crash report contains `EXC_BAD_ACCESS` / `SIGSEGV` and `Thread stack size exceeded due to excessive recursion`.

The stack includes:

- Repeated SwiftUI `_UIHostingView._hitTest(with:)` calls
- `-[RNGestureHandlerButton shouldHandleTouch:atPoint:]`
- `-[RNGestureHandlerButton hitTest:withEvent:]`
- `-[RNGestureHandlerButtonComponentView hitTest:withEvent:]`
- React Native `RCTViewComponentView` hit testing

### Suspected cause and revised fix

The hit-test loop can walk beyond the disabled button into its ancestors. I suspect returning a SwiftUI hosting ancestor causes the recursive hit testing.

The initial patch returned `nil` at the button boundary and stopped the crash on my device. The maintainer identified a behavior regression: returning `nil` lets a sibling underneath the disabled button receive the tap.

The revised loop stops at the button and returns it as the target instead:

```objc
RNGHUIView *inner = [super hitTest:point withEvent:event];
while (inner && inner != self && ![self shouldHandleTouch:inner atPoint:point]) {
  inner = inner.superview;
}
return inner;
```

This keeps the disabled button in front of its siblings. An early `if (!_userEnabled) { return NO; }` in `beginTrackingWithTouch:withEvent:` prevents it from beginning tracking. The macOS `mouseDown:`, `mouseUp:`, and `mouseDragged:` methods each get an early `if (!_userEnabled) { return; }`.

Eligible child controls can still be found before reaching the boundary, preserving the intended nested-button behavior from [PR #1991](https://github.com/software-mansion/react-native-gesture-handler/pull/1991).

The current reproduction includes these revisions plus a Debug-only original-search switch for the marked blur test button. That switch does not disable the event-tracking guards or change the separate sibling-overlay test.

**Revised validation is pending:** I still need to rebuild and test this version on my iPhone. macOS has not been built or tested because I do not have access to a Mac. The automated tests use mocked native views; they do not run UIKit, SwiftUI, or AppKit.

### AI assistance

I used AI (Codex) to help investigate the native code, create the reproduction project, and prepare this report and patch. I personally tested the original crash and initial patch on my iPhone. The revised approach follows the maintainer's feedback and has not yet been retested on my device.

## Steps to reproduce

1. Follow the reproduction repository's instructions to **rebuild and reinstall** the iOS **Debug** development client from the current revision. An older build or Metro reload will not contain the revised native fix. The repository includes the native SwiftUI filter flag override.
2. Start Metro and open the app. Select **Original case**, leaving **Pointer-events workaround** off.
3. Select **Enable test area** and tap the disabled outer Touchable.
4. Reopen the app and select **Patched case**. Leave the pointer-events workaround off, enable the test area, and tap the same area to compare.
5. With **Patched case** selected, turn on **Enabled inner Touchable** and re-enable the test area. Tapping the inner button should increment only its counter. Tapping the surrounding disabled area should change neither counter and should not crash.
6. Select **Enable sibling test** in **Sibling overlay**. Tapping the gray disabled overlay should leave both counters unchanged. Tapping an exposed green edge should increment only **Sibling presses**. This case has no blur and always uses the compiled revised fix, independently of the Original / Patched presets above.

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
