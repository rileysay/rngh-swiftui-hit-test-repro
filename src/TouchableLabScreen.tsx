import { useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { Touchable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const colors = {
  bg: '#08090b', text: '#f6f7fb', muted: '#a7aab6', danger: '#ff8f87',
  surface: '#191b22', borderStrong: '#555b6b', cardElevated: '#323846',
};

const DEFAULT_OPTIONS = {
  boundaryFix: true,
  blurHost: true,
  disabled: true,
  pointerWorkaround: false,
  nestedButton: false,
  visibleBlur: false,
};
type Options = typeof DEFAULT_OPTIONS;
const CONTROLS: { key: keyof Options; label: string; detail: string }[] = [
  { key: "boundaryFix", label: "Native boundary fix", detail: "Off restores the original ancestor walk for this test button only." },
  { key: "blurHost", label: "SwiftUI blur host", detail: "Adds a blur filter. Even radius 0 creates the native host." },
  { key: "disabled", label: "Disable outer Touchable", detail: "A disabled outer button should never increment its press count." },
  { key: "pointerWorkaround", label: "Pointer-events workaround", detail: "Blocks touches to the disabled button before reaching the disputed code. Keep off to isolate the native fix." },
  { key: "nestedButton", label: "Enabled inner Touchable", detail: "Checks the nested-button behavior preserved by PR #1991." },
  { key: "visibleBlur", label: "Visible blur (6 pt)", detail: "Off uses radius 0. Only applies when the blur host is on." },
];

/** A device reproduction harness, not a synthetic crash or a production control. */
export default function TouchableLabScreen() {
  const insets = useSafeAreaInsets();
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [armed, setArmed] = useState(false);
  const [outerPresses, setOuterPresses] = useState(0);
  const [innerPresses, setInnerPresses] = useState(0);
  const run = useRef(0);

  const resetCounts = () => {
    setArmed(false);
    setOuterPresses(0);
    setInnerPresses(0);
  };
  const changeOption = (key: keyof Options, value: boolean) => {
    resetCounts();
    setOptions(current => ({ ...current, [key]: value }));
  };
  const preset = (boundaryFix: boolean) => {
    resetCounts();
    setOptions({ ...DEFAULT_OPTIONS, boundaryFix });
  };
  const toggleTest = () => {
    if (armed) {
      setArmed(false);
      return;
    }
    // Log configuration before enabling hit testing: a native crash cannot be caught in JS.
    run.current += 1;
    console.info("[touchable-lab] armed", JSON.stringify({ ...options, run: run.current }));
    setArmed(true);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>

        <Text accessibilityRole="header" style={styles.title}>Touchable hit-test reproduction</Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={styles.help}>
          Requires an iOS Debug build from this project.
          Expo Go cannot run this test. Turning the fix
          off may close the app; reopening starts with safe defaults.
        </Text>
        {Platform.OS !== "ios" ? (
          <Text style={styles.notice}>This crash and native A/B switch are iOS-only.</Text>
        ) : null}
        <View style={styles.presets}>
          <Pressable accessibilityRole="button" onPress={() => preset(true)} style={styles.preset}>
            <Text style={styles.buttonText}>Patched case</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => preset(false)} style={styles.preset}>
            <Text style={styles.buttonText}>Original case</Text>
          </Pressable>
        </View>
        {CONTROLS.map(control => (
          <View key={control.key} style={styles.option}>
            <View style={styles.optionCopy}>
              <Text style={styles.label}>{control.label}</Text>
              <Text style={styles.help}>{control.detail}</Text>
            </View>
            <Switch
              accessibilityLabel={control.label}
              value={options[control.key]}
              onValueChange={value => changeOption(control.key, value)}
            />
          </View>
        ))}

        <Pressable accessibilityRole="button" onPress={toggleTest} style={styles.arm}>
          <Text style={styles.armText}>{armed ? "Disable test area" : "Enable test area"}</Text>
        </Pressable>
        <Text accessibilityLiveRegion="polite" style={styles.help}>
          {armed ? "Tap the outlined test area below." : "Test area is inactive. Choose settings, then enable it."}
        </Text>

        {/* The outer wrapper gates the entire filter host while switches change. */}
        <View collapsable={false} pointerEvents={armed ? "auto" : "none"} style={styles.testFrame}>
          <View
            collapsable={false}
            style={options.blurHost ? { filter: [{ blur: options.visibleBlur ? 6 : 0 }] } : undefined}
          >
            <Touchable
              testID={options.boundaryFix ? "rngh-hit-test-lab-fixed" : "rngh-hit-test-lab-unbounded"}
              accessibilityLabel="Outer test Touchable"
              accessibilityState={{ disabled: options.disabled }}
              disabled={options.disabled}
              pointerEvents={options.disabled && options.pointerWorkaround ? "none" : "auto"}
              onPress={() => setOuterPresses(current => current + 1)}
              style={styles.testButton}
            >
              <Text style={styles.testTitle}>Outer Touchable</Text>
              <Text style={styles.help}>{options.disabled ? "Disabled" : "Enabled"}</Text>
              {options.nestedButton ? (
                <Touchable
                  testID="rngh-hit-test-lab-inner"
                  accessibilityLabel="Enabled inner test Touchable"
                  onPress={() => setInnerPresses(current => current + 1)}
                  style={styles.innerButton}
                >
                  <Text style={styles.buttonText}>Enabled inner button</Text>
                </Touchable>
              ) : null}
            </Touchable>
          </View>
        </View>
        <Text accessibilityLiveRegion="polite" style={styles.count}>
          Outer presses: {outerPresses} · Inner presses: {innerPresses}
        </Text>
        <Text style={styles.help}>
          Compare Patched case and Original case with the pointer workaround off.
          Each preset resets the counters and disables the test area. No crash in
          this reduced example does not rule out the original app crash.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", gap: 18, paddingHorizontal: 20, minHeight: 56 },
  scroll: { flex: 1 },
  title: { color: colors.text, fontSize: 21, fontWeight: "700" },
  content: { padding: 20, gap: 18 },
  help: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  notice: { color: colors.danger, fontSize: 15 },
  presets: { flexDirection: "row", gap: 12 },
  preset: { flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: colors.surface },
  buttonText: { color: colors.text, fontSize: 15, fontWeight: "600" },
  option: { flexDirection: "row", alignItems: "center", gap: 18 },
  optionCopy: { flex: 1, gap: 4 },
  label: { color: colors.text, fontSize: 16, fontWeight: "600" },
  arm: { minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: colors.text },
  armText: { color: colors.bg, fontSize: 16, fontWeight: "700" },
  testFrame: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 18, padding: 12 },
  testButton: { minHeight: 130, padding: 24, gap: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderRadius: 12 },
  testTitle: { color: colors.text, fontSize: 19, fontWeight: "600" },
  innerButton: { minHeight: 48, paddingHorizontal: 18, justifyContent: "center", backgroundColor: colors.cardElevated, borderRadius: 12 },
  count: { color: colors.text, fontSize: 15, textAlign: "center" },
});
