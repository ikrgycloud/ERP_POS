import React, { useEffect, useRef } from "react";
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { colors, radii, spacing, typography } from "../constants/theme";

const features = [
  {
    title: "Unified Product Catalog",
    description:
      "Manage all your products, SKUs, pricing tiers, and supplier information from a single, reliable source of truth.",
    icon: "📦",
  },
  {
    title: "Real-Time Inventory Tracking",
    description:
      "Live stock levels across all outlets, with low-stock alerts, movement history, and value reporting.",
    icon: "📊",
  },
  {
    title: "Integrated Order Management",
    description:
      "Create, track, and fulfill both customer sales orders and supplier purchase orders in one connected workflow.",
    icon: "🔄",
  },
  {
    title: "GST-Compliant Invoicing",
    description:
      "Generate accurate GST invoices, manage payment collections, and handle reversals with a complete audit trail.",
    icon: "🧾",
  },
  {
    title: "Outlet & Staff Control",
    description:
      "Define roles and permissions for your team, giving them scoped access to the outlets and features they need.",
    icon: "🏢",
  },
  {
    title: "Actionable Business Reports",
    description:
      "Gain insights into sales performance, inventory health, and financial metrics with easy-to-understand reports.",
    icon: "📈",
  },
];

function Button({ children, outline, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ hovered }) => [
        styles.button,
        outline && styles.outline,
        hovered && styles.hover,
      ]}
    >
      <Text style={[styles.buttonText, outline && styles.outlineText]}>
        {children} →
      </Text>
    </Pressable>
  );
}

function AnimatedCardStack() {
  const animValues = useRef(features.map(() => new Animated.Value(0))).current;
  const hoverAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animations = animValues.map((anim) =>
      Animated.spring(anim, {
        toValue: 1,
        friction: 7,
        tension: 50,
        useNativeDriver: true,
      }),
    );
    Animated.stagger(100, animations).start();
  }, [animValues]);

  const handleMouseEnter = () => {
    Animated.spring(hoverAnim, {
      toValue: 1,
      useNativeDriver: true,
      friction: 5,
    }).start();
  };

  const handleMouseLeave = () => {
    Animated.spring(hoverAnim, {
      toValue: 0,
      useNativeDriver: true,
      friction: 5,
    }).start();
  };

  return (
    <View
      style={styles.stackContainer}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {features.map((feature, index) => {
        const translateY = animValues[index].interpolate({
          inputRange: [0, 1],
          outputRange: [150, 0],
        });
        const hoverTranslateY = hoverAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0, (index - (features.length - 1) / 2) * -12],
        });
        const scale = animValues[index].interpolate({
          inputRange: [0, 1],
          outputRange: [0.95, 1 - index * 0.03],
        });
        const opacity = animValues[index].interpolate({
          inputRange: [0, 1],
          outputRange: [0, 1],
        });
        const rotateZ = animValues[index].interpolate({
          inputRange: [0, 1],
          outputRange: [
            "-10deg",
            `${(index - (features.length - 1) / 2) * -2.5}deg`,
          ],
        });
        const hoverRotateZ = hoverAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [
            "0deg",
            `${(index - (features.length - 1) / 2) * -4}deg`,
          ],
        });

        return (
          <Animated.View
            key={feature.title}
            style={[
              styles.featureCard,
              {
                opacity,
                transform: [
                  { perspective: 1000 },
                  { translateY },
                  { translateY: hoverTranslateY },
                  { scale },
                  { rotateZ },
                  { rotateZ: hoverRotateZ },
                ],
                zIndex: features.length - index,
                marginTop: index > 0 ? -120 : 0,
              },
            ]}
          >
            <Text style={styles.featureIcon}>{feature.icon}</Text>
            <Text style={styles.featureTitle}>{feature.title}</Text>
            <Text style={styles.featureDescription}>{feature.description}</Text>
          </Animated.View>
        );
      })}
    </View>
  );
}

export function FeaturesScreen({ onLogin, onRegister }) {
  const { width } = useWindowDimensions();
  const compact = width < 820;

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <View style={[styles.nav, compact && styles.navCompact]}>
        <Text style={styles.brand}>
          <Text style={styles.badge}>E</Text> ERP
        </Text>
        <View style={styles.navActions}>
          <Pressable onPress={onLogin}>
            <Text style={styles.signin}>Sign in</Text>
          </Pressable>
          <Button onPress={onRegister}>Get Started</Button>
        </View>
      </View>

      <View style={[styles.hero, compact && styles.heroCompact]}>
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>— CORE CAPABILITIES</Text>
          <Text style={styles.heroTitle}>
            Everything you need.{`\n`}Nothing you don’t.
          </Text>
          <Text style={styles.lede}>
            Our ERP is built on six core pillars that connect your entire
            business, from procurement to final sale, giving you clarity and
            control over your operations.
          </Text>
        </View>
        <View style={styles.heroVisual}>
          <AnimatedCardStack />
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.brand}>
          <Text style={styles.badge}>E</Text> ERP
        </Text>
        <Text style={styles.footerCopy}>
          © {new Date().getFullYear()} · Business operations software
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { alignItems: "center", paddingBottom: spacing.xl },
  nav: {
    width: "96%",
    maxWidth: 1120,
    minHeight: 64,
    marginTop: 18,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xl,
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    shadowColor: colors.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navCompact: { minHeight: 68, marginTop: 10, paddingHorizontal: 14 },
  brand: {
    fontSize: 21,
    fontWeight: "700",
    letterSpacing: -1,
    color: colors.ink,
  },
  badge: {
    backgroundColor: colors.primaryDark,
    color: colors.white,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.lg,
    fontSize: 13,
  },
  navActions: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  signin: { fontSize: 13, color: colors.primaryDark, fontWeight: "600" },
  hero: {
    width: "100%",
    maxWidth: 1180,
    padding: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xl,
  },
  heroCompact: { flexDirection: "column" },
  heroCopy: { flex: 1, minWidth: 300 },
  heroVisual: { flex: 1.2, alignItems: "center", justifyContent: "center" },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 1.25,
    fontWeight: "700",
    color: colors.primary,
    marginBottom: spacing.md,
  },
  heroTitle: {
    fontSize: 52,
    lineHeight: 56,
    fontWeight: "700",
    letterSpacing: -2.5,
    color: colors.ink,
  },
  lede: {
    fontSize: 16,
    lineHeight: 26,
    color: colors.muted,
    marginTop: spacing.lg,
    maxWidth: 480,
  },
  stackContainer: {
    minHeight: 380,
    width: "100%",
    maxWidth: 450,
    alignItems: "center",
    justifyContent: "center",
  },
  featureCard: {
    position: "absolute",
    width: "90%",
    backgroundColor: colors.white,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderColor: colors.border,
    borderWidth: 1,
    shadowColor: colors.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
  featureIcon: { fontSize: 24, marginBottom: spacing.sm },
  featureTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: colors.ink,
    marginBottom: spacing.xs,
  },
  featureDescription: { fontSize: 13, color: colors.muted, lineHeight: 19 },
  button: {
    backgroundColor: colors.primaryDark,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
  },
  outline: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  hover: { transform: [{ translateY: -2 }], shadowOpacity: 0.22 },
  buttonText: { fontSize: 13, color: colors.white, fontWeight: "700" },
  outlineText: { color: colors.primaryDark },
  footer: {
    width: "100%",
    maxWidth: 1180,
    paddingHorizontal: 24,
    paddingBottom: 38,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingTop: 27,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 80,
  },
  footerCopy: { fontSize: 11, color: colors.muted },
});
