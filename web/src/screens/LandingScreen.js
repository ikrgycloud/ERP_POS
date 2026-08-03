import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { colors, radii, spacing, typography } from "../constants/theme";

const features = [
  ["01", "Inventory that stays accurate", "See stock, movement, value, and reorder attention in one calm, reliable view."],
  ["02", "Sales without loose ends", "Move from quote to order, GST invoice, and payment without repeating data."],
  ["03", "A clearer business picture", "Bring outlets, people, customers, reports, and audit history into one workspace."],
];

const workflow = ["Purchase", "Stock in", "Sell", "Invoice", "Collect", "Report"];
const flowStages = [
  ["01", "Purchase order", "Supplier and cost confirmed"],
  ["02", "Stock received", "Inventory updated instantly"],
  ["03", "Customer order", "Team fulfils with confidence"],
  ["04", "GST invoice", "Billing and payment stay linked"],
];
const roleViews = [
  { role: "Business owner", title: "Know what needs your attention before the day gets away from you.", copy: "A concise business pulse brings sales, collections, stock, and team activity into one priority view.", items: ["Revenue and collections snapshot", "Cross-outlet inventory health", "Exception-led daily attention"], metric: "92%", metricLabel: "inventory health" },
  { role: "Operations team", title: "Turn every hand-off into a simple, traceable next step.", copy: "Keep purchase, stock, order, and fulfilment work moving without losing context or ownership.", items: ["Live order and stock queues", "Clear ownership at every step", "Updates recorded automatically"], metric: "14", metricLabel: "orders awaiting action" },
  { role: "Finance team", title: "Keep billing and collections as clear as the sale itself.", copy: "Connect GST invoices, receipts, payments, and reversals in one accountable financial workflow.", items: ["GST-ready invoice records", "Payment status at a glance", "Audit-friendly receipt history"], metric: "₹8.4L", metricLabel: "sales processed this month" },
];

function ActionButton({ children, onPress, variant = "primary" }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.actionButton,
        variant === "secondary" && styles.actionButtonSecondary,
        (hovered || pressed) && styles.actionButtonActive,
      ]}
    >
      <Text style={[styles.actionButtonText, variant === "secondary" && styles.actionButtonSecondaryText]}>
        {children}
      </Text>
      <Text style={[styles.buttonArrow, variant === "secondary" && styles.actionButtonSecondaryText]}>→</Text>
    </Pressable>
  );
}

function ProductPreview({ floatY, pulse }) {
  return (
    <View style={styles.previewWrap}>
      <View style={styles.previewGlowOne} />
      <View style={styles.previewGlowTwo} />
      <View style={styles.previewCard}>
        <View style={styles.previewTopbar}>
          <View style={styles.previewBrand}><Text style={styles.previewBrandText}>E</Text></View>
          <Text style={styles.previewTitle}>Overview</Text>
          <View style={styles.previewUser}><Text style={styles.previewUserText}>AR</Text></View>
        </View>
        <View style={styles.previewContent}>
          <View style={styles.previewSidebar}>
            {["Overview", "Products", "Orders", "Invoices", "Reports"].map((item, index) => (
              <View key={item} style={[styles.previewNav, index === 0 && styles.previewNavActive]}>
                <View style={[styles.previewNavDot, index === 0 && styles.previewNavDotActive]} />
                <Text style={[styles.previewNavText, index === 0 && styles.previewNavTextActive]}>{item}</Text>
              </View>
            ))}
          </View>
          <View style={styles.previewMain}>
            <Text style={styles.previewGreeting}>Good morning, Arjun</Text>
            <Text style={styles.previewDate}>Here is what needs your attention today.</Text>
            <View style={styles.metricRow}>
              <Metric label="SALES" value="₹84,260" trend="+18.4%" />
              <Metric label="ORDERS" value="12" trend="4 due today" warm />
              <Metric label="COLLECTED" value="92%" trend="On track" />
            </View>
            <View style={styles.chartCard}>
              <View style={styles.chartHeader}><View><Text style={styles.chartTitle}>Sales performance</Text><Text style={styles.chartSub}>Last 7 days</Text></View><Text style={styles.chartBadge}>This week</Text></View>
              <View style={styles.chartBars}>
                {[35, 54, 43, 68, 59, 82, 72].map((height, index) => <View key={index} style={[styles.chartBar, { height: `${height}%` }, index === 5 && styles.chartBarStrong]} />)}
              </View>
            </View>
            <View style={styles.previewActivity}><View style={styles.previewActivityDot} /><Text style={styles.previewActivityText}>4 new orders since 9:00 AM</Text><Text style={styles.previewActivityLink}>View</Text></View>
          </View>
        </View>
      </View>
      <Animated.View style={[styles.floatingStatus, { transform: [{ scale: pulse }] }]}><View style={styles.statusDot} /><View><Text style={styles.statusTitle}>Inventory synced</Text><Text style={styles.statusCopy}>All outlets are up to date</Text></View></Animated.View>
      <Animated.View style={[styles.orderToast, { transform: [{ translateY: floatY }] }]}><View style={styles.orderToastIcon}><Text style={styles.orderToastIconText}>₹</Text></View><View><Text style={styles.orderToastTitle}>Payment received</Text><Text style={styles.orderToastCopy}>INV-1048 · ₹12,450</Text></View><View style={styles.orderToastCheck}><Text style={styles.orderToastCheckText}>✓</Text></View></Animated.View>
    </View>
  );
}

function Metric({ label, value, trend, warm }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text><Text style={[styles.metricTrend, warm && styles.metricTrendWarm]}>{trend}</Text></View>;
}

function FlowIcon({ symbol, active }) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!active) {
      scale.setValue(1);
      return undefined;
    }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(scale, { toValue: 1.12, duration: 850, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 1, duration: 850, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [active, scale]);

  return <Animated.View style={[styles.flowNodeIcon, active && styles.flowNodeIconActive, { transform: [{ scale }] }]}><Text style={[styles.flowNodeIconText, active && styles.flowNodeIconTextActive]}>{symbol}</Text></Animated.View>;
}

export function LandingScreen({ onLogin, onRegister }) {
  const { width } = useWindowDimensions();
  const compact = width < 760;
  const [activeRole, setActiveRole] = useState(0);
  const [activeFlowStage, setActiveFlowStage] = useState(0);
  const [contactOpen, setContactOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const webZoom = Platform.OS === "web" ? { zoom: 1.1 } : null;
  const scrollRef = useRef(null);
  const sections = useRef({});
  const pageScale = useRef(new Animated.Value(0.97)).current;
  const heroY = useRef(new Animated.Value(22)).current;
  const productY = useRef(new Animated.Value(28)).current;
  const previewFloat = useRef(new Animated.Value(0)).current;
  const previewPulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(pageScale, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.spring(heroY, { toValue: 0, tension: 45, friction: 8, useNativeDriver: true }),
      Animated.spring(productY, { toValue: 0, delay: 160, tension: 42, friction: 8, useNativeDriver: true }),
    ]).start();
    const previewMotion = Animated.loop(Animated.parallel([
      Animated.sequence([Animated.timing(previewFloat, { toValue: -7, duration: 1800, useNativeDriver: true }), Animated.timing(previewFloat, { toValue: 0, duration: 1800, useNativeDriver: true })]),
      Animated.sequence([Animated.timing(previewPulse, { toValue: 1.035, duration: 1200, useNativeDriver: true }), Animated.timing(previewPulse, { toValue: 1, duration: 1200, useNativeDriver: true })]),
    ]));
    previewMotion.start();
    return () => previewMotion.stop();
  }, [heroY, pageScale, previewFloat, previewPulse, productY]);

  const scrollTo = (section) => {
    scrollRef.current?.scrollTo({
      animated: true,
      y: Math.max(0, (sections.current[section] || 0) - 76),
    });
  };
  const currentRole = roleViews[activeRole];
  const currentFlowStage = flowStages[activeFlowStage];

  return (
    <Animated.ScrollView ref={scrollRef} style={[styles.page, webZoom, { transform: [{ scale: pageScale }] }]} contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false}>
      <View style={[styles.nav, compact && styles.navCompact]}>
        <View style={styles.logoLockup}><View style={styles.logoMark}><Text style={styles.logoMarkText}>E</Text></View><Text style={styles.logoText}>ERP Manager</Text></View>
        {!compact && <View style={styles.navLinks}>
          <Pressable onPress={() => scrollTo("product")}><Text style={styles.navLink}>Product</Text></Pressable>
          <Pressable onPress={() => scrollTo("workflow")}><Text style={styles.navLink}>Workflow</Text></Pressable>
          <Pressable onPress={() => scrollTo("start")}><Text style={styles.navLink}>For teams</Text></Pressable>
        </View>}
        <View style={[styles.headerActions, compact && styles.headerActionsCompact]}><Pressable accessibilityRole="button" onPress={() => setContactOpen(true)} style={({ hovered }) => [styles.contactButton, compact && styles.headerButtonCompact, hovered && styles.contactButtonActive]}><Text style={[styles.contactButtonText, compact && styles.headerButtonTextCompact]}>Contact us</Text></Pressable><Pressable accessibilityRole="button" onPress={() => setDemoOpen(true)} style={({ hovered }) => [styles.demoButton, compact && styles.headerButtonCompact, hovered && styles.demoButtonActive]}><Text style={[styles.demoButtonText, compact && styles.headerButtonTextCompact]}>Ask for demo</Text><Text style={styles.demoButtonArrow}>→</Text></Pressable><Pressable accessibilityRole="button" onPress={onLogin} style={({ hovered }) => [styles.signInButton, compact && styles.headerButtonCompact, hovered && styles.signInButtonActive]}><Text style={[styles.signInText, compact && styles.headerButtonTextCompact]}>Sign in</Text></Pressable></View>
      </View>

      <View style={[styles.hero, compact && styles.heroCompact]}>
        <Animated.View style={[styles.heroCopy, { transform: [{ translateY: heroY }] }]}>
          <View style={styles.kicker}><View style={styles.kickerDot} /><Text style={styles.kickerText}>ONE WORKSPACE. TOTAL CLARITY.</Text></View>
          <Text style={[styles.heroTitle, compact && styles.heroTitleCompact]}>The calm way to run your business.</Text>
          <Text style={styles.heroDescription}>ERP Manager connects your products, inventory, sales, billing, and people—so every day feels more in control.</Text>
          <View style={styles.heroActions}><ActionButton onPress={onRegister}>Start your workspace</ActionButton><ActionButton variant="secondary" onPress={onLogin}>Sign in to ERP</ActionButton></View>
          <View style={styles.heroProof}><View style={styles.proofAvatars}><View style={styles.proofAvatar}><Text>R</Text></View><View style={[styles.proofAvatar, styles.proofAvatarTwo]}><Text>S</Text></View><View style={[styles.proofAvatar, styles.proofAvatarThree]}><Text>A</Text></View></View><Text style={styles.proofText}>Built for focused teams and growing businesses.</Text></View>
        </Animated.View>
        <Animated.View style={[styles.previewColumn, { transform: [{ translateY: productY }] }]}><ProductPreview floatY={previewFloat} pulse={previewPulse} /></Animated.View>
      </View>

      <View onLayout={(event) => { sections.current.product = event.nativeEvent.layout.y; }} style={styles.section}>
        <View style={styles.sectionIntro}><Text style={styles.sectionEyebrow}>DESIGNED FOR THE WORK THAT MATTERS</Text><Text style={[styles.sectionTitle, compact && styles.sectionTitleCompact]}>Everything connected. Nothing complicated.</Text><Text style={styles.sectionCopy}>A clear operational flow gives your team the confidence to act quickly and accurately.</Text></View>
        <View style={[styles.featureGrid, compact && styles.featureGridCompact]}>{features.map(([number, title, copy]) => <View key={number} style={styles.featureCard}><Text style={styles.featureNumber}>{number}</Text><View style={styles.featureIcon}><Text style={styles.featureIconText}>{number === "01" ? "▦" : number === "02" ? "↗" : "◌"}</Text></View><Text style={styles.featureTitle}>{title}</Text><Text style={styles.featureCopy}>{copy}</Text><Text style={styles.featureMore}>Explore feature  →</Text></View>)}</View>
      </View>

      <View onLayout={(event) => { sections.current.workflow = event.nativeEvent.layout.y; }} style={styles.workflowBackground}><View style={[styles.workflowSection, compact && styles.workflowSectionCompact]}><View style={styles.workflowCopy}><Text style={styles.sectionEyebrow}>ONE FLOW FROM START TO FINISH</Text><Text style={[styles.workflowTitle, compact && styles.sectionTitleCompact]}>Keep every business movement in sync.</Text><Text style={styles.workflowBody}>From purchase to payment, ERP Manager keeps the details connected behind the scenes.</Text><View style={styles.textLink}><Text style={styles.textLinkText}>One connected operational flow</Text><Text style={styles.textLinkArrow}>→</Text></View></View><View style={styles.workflowSteps}>{workflow.map((step, index) => <React.Fragment key={step}><View style={styles.workflowStep}><Text style={styles.workflowNumber}>{String(index + 1).padStart(2, "0")}</Text><Text style={styles.workflowStepText}>{step}</Text></View>{index < workflow.length - 1 && <View style={styles.workflowLine} />}</React.Fragment>)}</View></View></View>

      <View style={styles.section}>
        <View style={styles.sectionIntro}><Text style={styles.sectionEyebrow}>YOUR BUSINESS, AT A GLANCE</Text><Text style={[styles.sectionTitle, compact && styles.sectionTitleCompact]}>A command center your whole team can trust.</Text></View>
        <View style={[styles.signalGrid, compact && styles.signalGridCompact]}>
          <View style={styles.signalPrimary}>
            <View style={styles.signalHeader}><View><Text style={styles.signalOverline}>LIVE OPERATIONS</Text><Text style={styles.signalTitle}>Today’s business pulse</Text></View><View style={styles.livePill}><View style={styles.liveDot}/><Text style={styles.liveText}>Live</Text></View></View>
            {[['14', 'orders waiting for confirmation'], ['08', 'products below reorder level'], ['03', 'payments due for collection']].map(([count, label], index) => <View key={label} style={[styles.signalRow, index === 2 && styles.signalRowLast]}><Text style={styles.signalCount}>{count}</Text><Text style={styles.signalLabel}>{label}</Text><Text style={styles.signalArrow}>→</Text></View>)}
          </View>
          <View style={styles.signalSide}>
            <View style={styles.scoreCard}><Text style={styles.signalOverline}>INVENTORY HEALTH</Text><View style={styles.scoreRow}><Text style={styles.scoreValue}>92<Text style={styles.scoreUnit}>%</Text></Text><View style={styles.scoreRing}><Text style={styles.scoreRingText}>Good</Text></View></View><Text style={styles.scoreCopy}>Your stock position is healthy across all outlets.</Text></View>
            <View style={styles.activityCard}><Text style={styles.signalOverline}>TEAM ACTIVITY</Text><Text style={styles.activityTitle}>Everything is recorded</Text><View style={styles.activityPeople}><View style={styles.smallAvatar}><Text>SK</Text></View><View><Text style={styles.activityName}>Sanjay updated a sale</Text><Text style={styles.activityTime}>2 minutes ago</Text></View></View></View>
          </View>
        </View>
      </View>

      <View style={styles.flowBoardBackground}>
        <View style={[styles.flowBoardSection, compact && styles.flowBoardSectionCompact]}>
          <View style={styles.flowBoardHeading}><Text style={styles.sectionEyebrow}>A CLEARER WAY TO MOVE WORK FORWARD</Text><Text style={[styles.sectionTitle, compact && styles.sectionTitleCompact]}>Every hand-off, visible and accountable.</Text><Text style={styles.sectionCopy}>Give each team the context they need, while keeping the whole business connected from one clean flow.</Text></View>
          <View style={[styles.flowBoard, compact && styles.flowBoardCompact]}>
            {flowStages.map(([number, title, caption], index) => <React.Fragment key={number}><Pressable accessibilityRole="button" onPress={() => setActiveFlowStage(index)} style={({ hovered }) => [styles.flowNode, activeFlowStage === index && styles.flowNodeActive, hovered && activeFlowStage !== index && styles.flowNodeHover]}><Text style={[styles.flowNodeNumber, activeFlowStage === index && styles.flowNodeNumberActive]}>{number}</Text><FlowIcon active={activeFlowStage === index} symbol={index === 0 ? '↙' : index === 1 ? '▣' : index === 2 ? '↗' : '₹'} /><Text style={[styles.flowNodeTitle, activeFlowStage === index && styles.flowNodeTitleActive]}>{title}</Text><Text style={styles.flowNodeCaption}>{caption}</Text></Pressable>{index < flowStages.length - 1 && <View style={[styles.flowConnector, compact && styles.flowConnectorCompact]}><Text style={styles.flowConnectorArrow}>→</Text></View>}</React.Fragment>)}
          </View>
          <View style={styles.flowStageDetail}><View style={styles.flowStageDetailIcon}><Text style={styles.flowStageDetailIconText}>{currentFlowStage[0]}</Text></View><View><Text style={styles.flowStageDetailTitle}>{currentFlowStage[1]}</Text><Text style={styles.flowStageDetailCopy}>{currentFlowStage[2]} · Select another step to explore the flow.</Text></View><Text style={styles.flowStageDetailArrow}>→</Text></View>
          <View style={[styles.performancePanel, compact && styles.performancePanelCompact]}><View><Text style={styles.signalOverline}>THIS MONTH’S MOMENTUM</Text><Text style={styles.performanceTitle}>Work is flowing smoothly</Text></View><View style={styles.performanceStats}><View><Text style={styles.performanceValue}>₹8.4L</Text><Text style={styles.performanceLabel}>Sales processed</Text></View><View style={styles.performanceDivider}/><View><Text style={styles.performanceValue}>1,248</Text><Text style={styles.performanceLabel}>Items moved</Text></View><View style={styles.performanceDivider}/><View><Text style={styles.performanceValue}>92%</Text><Text style={styles.performanceLabel}>Collections rate</Text></View></View></View>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionIntro}><Text style={styles.sectionEyebrow}>ONE ERP, MADE FOR REAL TEAMS</Text><Text style={[styles.sectionTitle, styles.roleSectionTitle, compact && styles.sectionTitleCompact]}>A clearer workspace for every role.</Text></View>
        <View style={[styles.roleExperience, compact && styles.roleExperienceCompact]}>
          <View style={[styles.roleList, compact && styles.roleListCompact]}>{roleViews.map((item, index) => <Pressable key={item.role} onPress={() => setActiveRole(index)} style={({ hovered }) => [styles.roleOption, activeRole === index && styles.roleOptionActive, hovered && activeRole !== index && styles.roleOptionHover]}><Text style={[styles.roleOptionNumber, activeRole === index && styles.roleOptionNumberActive]}>{String(index + 1).padStart(2, '0')}</Text><Text style={[styles.roleOptionText, activeRole === index && styles.roleOptionTextActive]}>{item.role}</Text><Text style={[styles.roleOptionArrow, activeRole === index && styles.roleOptionArrowActive]}>→</Text></Pressable>)}</View>
          <View style={styles.roleDetail}>
            <View style={styles.roleMetric}><Text style={styles.roleMetricValue}>{currentRole.metric}</Text><Text style={styles.roleMetricLabel}>{currentRole.metricLabel}</Text></View>
            <Text style={styles.roleDetailTitle}>{currentRole.title}</Text><Text style={styles.roleDetailCopy}>{currentRole.copy}</Text>
            <View style={styles.roleChecklist}>{currentRole.items.map((item) => <View key={item} style={styles.roleChecklistItem}><View style={styles.roleCheck}><Text style={styles.roleCheckText}>✓</Text></View><Text style={styles.roleChecklistText}>{item}</Text></View>)}</View>
          </View>
        </View>
      </View>

      <View onLayout={(event) => { sections.current.start = event.nativeEvent.layout.y; }} style={styles.section}><View style={[styles.ctaCard, compact && styles.ctaCardCompact]}><View style={styles.ctaOrb} /><View style={styles.ctaCopyWrap}><Text style={styles.ctaEyebrow}>READY WHEN YOU ARE</Text><Text style={[styles.ctaTitle, compact && styles.sectionTitleCompact]}>Make today’s work feel simpler.</Text><Text style={styles.ctaCopy}>Set up your business or return to your ERP workspace.</Text></View><View style={styles.ctaActions}><ActionButton onPress={onRegister}>Set up business</ActionButton><ActionButton variant="secondary" onPress={onLogin}>Sign in</ActionButton></View></View></View>
      <View onLayout={(event) => { sections.current.contact = event.nativeEvent.layout.y; }} style={[styles.footer, compact && styles.footerCompact]}><View style={styles.footerBrand}><View style={styles.logoLockup}><View style={styles.logoMark}><Text style={styles.logoMarkText}>E</Text></View><Text style={styles.logoText}>ERP Manager</Text></View><Text style={styles.footerText}>© {new Date().getFullYear()} ERP Manager · Business operations, made clear.</Text></View><View style={[styles.contactBlock, compact && styles.contactBlockCompact]}><Text style={styles.contactTitle}>Contact</Text><Text style={styles.contactText}>kganta42@gmail.com</Text><Text style={styles.contactText}>+91 63034 03957</Text><Text style={[styles.contactAddress, compact && styles.contactAddressCompact]}>Manjeera Trinity Corporate, eSeva Ln, Kukatpally Housing Board Colony, K P H B Phase 3, Kukatpally, Hyderabad, Telangana 500072</Text></View></View>
      <Modal animationType="fade" transparent visible={demoOpen} onRequestClose={() => setDemoOpen(false)}><View style={styles.demoOverlay}><View style={styles.demoModal}><Pressable accessibilityRole="button" onPress={() => setDemoOpen(false)} style={styles.demoClose}><Text style={styles.demoCloseText}>×</Text></Pressable><View style={styles.demoMark}><Text style={styles.demoMarkText}>E</Text></View><Text style={styles.demoEyebrow}>PERSONAL PRODUCT WALKTHROUGH</Text><Text style={styles.demoTitle}>See ERP Manager in action.</Text><Text style={styles.demoCopy}>Speak with our developer team for a focused walkthrough of inventory, billing, orders, and business reporting.</Text><View style={styles.demoDetails}><View style={styles.demoDetail}><Text style={styles.demoDetailLabel}>EMAIL</Text><Text style={styles.demoDetailValue}>kganta42@gmail.com</Text></View><View style={styles.demoDetail}><Text style={styles.demoDetailLabel}>PHONE</Text><Text style={styles.demoDetailValue}>+91 63034 03957</Text></View></View><View style={styles.demoAddress}><Text style={styles.demoDetailLabel}>VISIT / DEMO LOCATION</Text><Text style={styles.demoAddressText}>Manjeera Trinity Corporate, eSeva Ln, Kukatpally Housing Board Colony, K P H B Phase 3, Kukatpally, Hyderabad, Telangana 500072</Text></View><Pressable onPress={() => setDemoOpen(false)} style={styles.demoDoneButton}><Text style={styles.demoDoneText}>Got it, I’ll get in touch</Text><Text style={styles.demoDoneArrow}>→</Text></Pressable></View></View></Modal>
      <Modal animationType="fade" transparent visible={contactOpen} onRequestClose={() => setContactOpen(false)}><View style={styles.demoOverlay}><View style={styles.contactModal}><Pressable accessibilityRole="button" onPress={() => setContactOpen(false)} style={styles.demoClose}><Text style={styles.demoCloseText}>×</Text></Pressable><View style={styles.contactModalIcon}><Text style={styles.contactModalIconText}>✦</Text></View><Text style={styles.demoEyebrow}>GET IN TOUCH</Text><Text style={styles.contactModalTitle}>Let’s make your operations simpler.</Text><Text style={styles.demoCopy}>Our team is ready to help with product questions, setup guidance, and a tailored ERP walkthrough.</Text><View style={styles.contactCards}><View style={styles.contactCard}><Text style={styles.contactCardSymbol}>@</Text><View><Text style={styles.demoDetailLabel}>EMAIL US</Text><Text style={styles.contactCardValue}>kganta42@gmail.com</Text></View></View><View style={styles.contactCard}><Text style={styles.contactCardSymbol}>☎</Text><View><Text style={styles.demoDetailLabel}>CALL US</Text><Text style={styles.contactCardValue}>+91 63034 03957</Text></View></View></View><View style={styles.contactLocation}><Text style={styles.demoDetailLabel}>OUR OFFICE</Text><Text style={styles.demoAddressText}>Manjeera Trinity Corporate, eSeva Ln, Kukatpally Housing Board Colony, K P H B Phase 3, Kukatpally, Hyderabad, Telangana 500072</Text></View><Pressable onPress={() => setContactOpen(false)} style={styles.demoDoneButton}><Text style={styles.demoDoneText}>Close contact details</Text><Text style={styles.demoDoneArrow}>→</Text></Pressable></View></View></Modal>
    </Animated.ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#FBFCFA" }, pageContent: { alignItems: "center" },
  nav: { alignItems: "center", borderBottomColor: "#E8EDE9", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", maxWidth: 1240, minHeight: 76, paddingHorizontal: 24, width: "100%" }, navCompact: { minHeight: 68, paddingHorizontal: 18 },
  logoLockup: { alignItems: "center", flexDirection: "row", gap: 9 }, logoMark: { alignItems: "center", backgroundColor: "#163B33", borderRadius: 10, height: 31, justifyContent: "center", width: 31 }, logoMarkText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" }, logoText: { color: "#18312B", fontFamily: typography.headingFont, fontSize: 17, fontWeight: "700", letterSpacing: -0.3 },
  navLinks: { flexDirection: "row", gap: 32, marginLeft: 80 }, navLink: { color: "#63736C", fontSize: 13, fontWeight: "600" }, headerActions: { alignItems: "center", flexDirection: "row", gap: 8 }, headerActionsCompact: { gap: 1 }, headerButtonCompact: { paddingHorizontal: 5, paddingVertical: 8 }, headerButtonTextCompact: { fontSize: 10 }, contactButton: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 10 }, contactButtonActive: { backgroundColor: "#EFF6F1" }, contactButtonText: { color: "#42685B", fontSize: 12, fontWeight: "700" }, demoButton: { alignItems: "center", backgroundColor: "#EAF4EE", borderRadius: 9, flexDirection: "row", gap: 7, paddingHorizontal: 12, paddingVertical: 10 }, demoButtonActive: { backgroundColor: "#D8EDE1" }, demoButtonText: { color: "#1D5948", fontSize: 12, fontWeight: "800" }, demoButtonArrow: { color: "#1D5948", fontSize: 15 }, signInButton: { borderColor: "#D5E0DA", borderRadius: 9, borderWidth: 1, paddingHorizontal: 17, paddingVertical: 10 }, signInButtonActive: { backgroundColor: "#EDF4EF", borderColor: "#163B33" }, signInText: { color: "#173C33", fontSize: 13, fontWeight: "700" },
  hero: { alignItems: "center", flexDirection: "row", gap: 46, maxWidth: 1240, overflow: "hidden", paddingHorizontal: 42, paddingTop: 92, paddingBottom: 108, width: "100%" }, heroCompact: { flexDirection: "column", gap: 46, paddingHorizontal: 20, paddingTop: 58, paddingBottom: 68 }, heroCopy: { flex: 0.9, maxWidth: 540 }, kicker: { alignItems: "center", flexDirection: "row", gap: 8, marginBottom: 20 }, kickerDot: { backgroundColor: "#DCA73C", borderRadius: 99, height: 7, width: 7 }, kickerText: { color: "#487265", fontSize: 10, fontWeight: "800", letterSpacing: 1.3 }, heroTitle: { color: "#163B33", fontFamily: typography.headingFont, fontSize: 58, fontWeight: "700", letterSpacing: -2.4, lineHeight: 61 }, heroTitleCompact: { fontSize: 42, letterSpacing: -1.6, lineHeight: 45 }, heroDescription: { color: "#64746E", fontSize: 16, lineHeight: 25, marginTop: 22, maxWidth: 490 }, heroActions: { flexDirection: "row", flexWrap: "wrap", gap: 11, marginTop: 30 },
  actionButton: { alignItems: "center", backgroundColor: "#163B33", borderColor: "#163B33", borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 12, paddingHorizontal: 17, paddingVertical: 13 }, actionButtonSecondary: { backgroundColor: "#FFFFFF", borderColor: "#D5E0DA" }, actionButtonActive: { opacity: 0.86, transform: [{ translateY: -1 }] }, actionButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" }, actionButtonSecondaryText: { color: "#1C473C" }, buttonArrow: { color: "#FFFFFF", fontSize: 17, lineHeight: 17 }, heroProof: { alignItems: "center", flexDirection: "row", gap: 12, marginTop: 28 }, proofAvatars: { flexDirection: "row", width: 75 }, proofAvatar: { alignItems: "center", backgroundColor: "#F0CE9A", borderColor: "#FBFCFA", borderRadius: 18, borderWidth: 2, height: 32, justifyContent: "center", width: 32 }, proofAvatarTwo: { backgroundColor: "#B9D7CE", marginLeft: -10 }, proofAvatarThree: { backgroundColor: "#D8C7EA", marginLeft: -10 }, proofText: { color: "#76847F", fontSize: 11, fontWeight: "600" },
  previewColumn: { flex: 1, minWidth: 0 }, previewWrap: { alignItems: "center", height: 435, justifyContent: "center", maxWidth: 615, width: "100%" }, previewGlowOne: { backgroundColor: "#D9EFE5", borderRadius: 999, height: 340, opacity: 0.75, position: "absolute", right: 0, top: 12, width: 340 }, previewGlowTwo: { backgroundColor: "#F3E5C9", borderRadius: 999, bottom: 4, height: 170, left: 10, opacity: 0.7, position: "absolute", width: 170 }, previewCard: { backgroundColor: "#FFFFFF", borderColor: "#DCE6E0", borderRadius: 15, borderWidth: 1, boxShadow: "0 24px 55px rgba(26, 58, 49, 0.16)", height: 355, overflow: "hidden", transform: [{ rotate: "-2deg" }], width: "94%" }, previewTopbar: { alignItems: "center", borderBottomColor: "#EDF0EE", borderBottomWidth: 1, flexDirection: "row", gap: 10, height: 52, paddingHorizontal: 14 }, previewBrand: { alignItems: "center", backgroundColor: "#163B33", borderRadius: 6, height: 22, justifyContent: "center", width: 22 }, previewBrandText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" }, previewTitle: { color: "#18312B", fontSize: 12, fontWeight: "700", flex: 1 }, previewUser: { alignItems: "center", backgroundColor: "#E9F1EC", borderRadius: 99, height: 24, justifyContent: "center", width: 24 }, previewUserText: { color: "#376556", fontSize: 8, fontWeight: "800" }, previewContent: { flex: 1, flexDirection: "row" }, previewSidebar: { backgroundColor: "#FAFBFA", borderRightColor: "#EDF0EE", borderRightWidth: 1, paddingHorizontal: 10, paddingTop: 17, width: "25%" }, previewNav: { alignItems: "center", flexDirection: "row", gap: 5, marginBottom: 15 }, previewNavActive: {}, previewNavDot: { backgroundColor: "#C7D0CB", borderRadius: 99, height: 5, width: 5 }, previewNavDotActive: { backgroundColor: "#3E816B" }, previewNavText: { color: "#82908A", fontSize: 7 }, previewNavTextActive: { color: "#21483D", fontWeight: "700" }, previewMain: { flex: 1, padding: 18 }, previewGreeting: { color: "#1C3B32", fontSize: 14, fontWeight: "700" }, previewDate: { color: "#809088", fontSize: 8, marginTop: 4 }, metricRow: { flexDirection: "row", gap: 8, marginTop: 18 }, metric: { backgroundColor: "#F7FAF8", borderColor: "#E8EFEB", borderRadius: 7, borderWidth: 1, flex: 1, minHeight: 67, padding: 8 }, metricLabel: { color: "#85948C", fontSize: 6, fontWeight: "800", letterSpacing: 0.5 }, metricValue: { color: "#1B3E34", fontSize: 12, fontWeight: "800", marginTop: 7 }, metricTrend: { color: "#3E896D", fontSize: 6, marginTop: 3 }, metricTrendWarm: { color: "#BD7A25" }, chartCard: { backgroundColor: "#FAFBFA", borderColor: "#E8EFEB", borderRadius: 8, borderWidth: 1, marginTop: 12, padding: 11 }, chartHeader: { flexDirection: "row", justifyContent: "space-between" }, chartTitle: { color: "#29473E", fontSize: 8, fontWeight: "700" }, chartSub: { color: "#8C9993", fontSize: 6, marginTop: 3 }, chartBadge: { backgroundColor: "#E9F3ED", borderRadius: 5, color: "#4A7B69", fontSize: 6, fontWeight: "700", padding: 5 }, chartBars: { alignItems: "flex-end", flexDirection: "row", gap: 6, height: 90, marginTop: 9 }, chartBar: { backgroundColor: "#CBE4D9", borderRadius: 3, flex: 1 }, chartBarStrong: { backgroundColor: "#3D816A" }, floatingStatus: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E0EAE4", borderRadius: 9, borderWidth: 1, bottom: 9, boxShadow: "0 10px 20px rgba(26, 58, 49, 0.13)", flexDirection: "row", gap: 9, left: 4, padding: 10, position: "absolute" }, statusDot: { backgroundColor: "#4AA97E", borderColor: "#CDEEDC", borderRadius: 99, borderWidth: 3, height: 12, width: 12 }, statusTitle: { color: "#264A3F", fontSize: 9, fontWeight: "700" }, statusCopy: { color: "#84928C", fontSize: 7, marginTop: 2 },
  trustBand: { alignItems: "center", backgroundColor: "#163B33", gap: 17, justifyContent: "center", minHeight: 76, paddingHorizontal: 22, paddingVertical: 20, width: "100%" }, trustText: { color: "#BFD7CC", fontSize: 11, fontWeight: "600" }, trustItems: { color: "#FFFFFF", fontSize: 10, fontWeight: "800", letterSpacing: 1 }, trustDivider: { color: "#77A895" },
  section: { maxWidth: 1240, paddingHorizontal: 42, paddingVertical: 98, width: "100%" }, sectionIntro: { maxWidth: 660 }, sectionEyebrow: { color: "#4B7A6A", fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginBottom: 15 }, sectionTitle: { color: "#183B31", fontFamily: typography.headingFont, fontSize: 43, fontWeight: "700", letterSpacing: -1.7, lineHeight: 47 }, sectionTitleCompact: { fontSize: 34, letterSpacing: -1.2, lineHeight: 38 }, sectionCopy: { color: "#6C7B75", fontSize: 15, lineHeight: 24, marginTop: 18, maxWidth: 540 }, featureGrid: { flexDirection: "row", gap: 16, marginTop: 43 }, featureGridCompact: { flexDirection: "column" }, featureCard: { backgroundColor: "#FFFFFF", borderColor: "#E3EAE6", borderRadius: 14, borderWidth: 1, flex: 1, minHeight: 286, padding: 23 }, featureNumber: { color: "#8AA596", fontSize: 10, fontWeight: "800", letterSpacing: 1 }, featureIcon: { alignItems: "center", backgroundColor: "#EAF4EE", borderRadius: 11, height: 40, justifyContent: "center", marginTop: 22, width: 40 }, featureIconText: { color: "#2B725C", fontSize: 20, fontWeight: "700" }, featureTitle: { color: "#193A31", fontSize: 19, fontWeight: "700", letterSpacing: -0.4, marginTop: 21 }, featureCopy: { color: "#718078", fontSize: 13, lineHeight: 20, marginTop: 9 }, featureMore: { color: "#36745F", fontSize: 11, fontWeight: "800", marginTop: "auto", paddingTop: 19 },
  workflowBackground: { alignItems: "center", backgroundColor: "#EFF6F1", width: "100%" }, workflowSection: { alignItems: "center", flexDirection: "row", gap: 70, maxWidth: 1240, paddingHorizontal: 42, paddingVertical: 95, width: "100%" }, workflowSectionCompact: { alignItems: "stretch", flexDirection: "column", gap: 44, paddingHorizontal: 20, paddingVertical: 65 }, workflowCopy: { flex: 0.9 }, workflowTitle: { color: "#173C32", fontSize: 40, fontWeight: "700", letterSpacing: -1.5, lineHeight: 44 }, workflowBody: { color: "#6B7C74", fontSize: 14, lineHeight: 22, marginTop: 16, maxWidth: 410 }, textLink: { alignItems: "center", flexDirection: "row", gap: 10, marginTop: 25 }, textLinkActive: { opacity: 0.7 }, textLinkText: { color: "#23614F", fontSize: 13, fontWeight: "800" }, textLinkArrow: { color: "#23614F", fontSize: 18 }, workflowSteps: { flex: 1, gap: 0 }, workflowStep: { alignItems: "center", flexDirection: "row", gap: 15, minHeight: 38 }, workflowNumber: { color: "#668B7C", fontSize: 10, fontWeight: "800", width: 24 }, workflowStepText: { color: "#1D4438", fontSize: 15, fontWeight: "700" }, workflowLine: { backgroundColor: "#B9D5C7", height: 20, marginLeft: 11, width: 1 },
  previewActivity: { alignItems: "center", backgroundColor: "#F1F7F3", borderRadius: 6, flexDirection: "row", gap: 5, marginTop: 8, paddingHorizontal: 7, paddingVertical: 6 }, previewActivityDot: { backgroundColor: "#45A878", borderRadius: 99, height: 5, width: 5 }, previewActivityText: { color: "#557267", flex: 1, fontSize: 7, fontWeight: "600" }, previewActivityLink: { color: "#35735E", fontSize: 7, fontWeight: "800" }, orderToast: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E0EAE4", borderRadius: 10, borderWidth: 1, boxShadow: "0 12px 24px rgba(26, 58, 49, 0.15)", flexDirection: "row", gap: 8, padding: 9, position: "absolute", right: -3, top: 25 }, orderToastIcon: { alignItems: "center", backgroundColor: "#E9F4EE", borderRadius: 7, height: 25, justifyContent: "center", width: 25 }, orderToastIconText: { color: "#34755F", fontSize: 12, fontWeight: "800" }, orderToastTitle: { color: "#294B40", fontSize: 8, fontWeight: "800" }, orderToastCopy: { color: "#86948E", fontSize: 7, marginTop: 2 }, orderToastCheck: { alignItems: "center", backgroundColor: "#52A57D", borderRadius: 99, height: 15, justifyContent: "center", width: 15 }, orderToastCheckText: { color: "#FFFFFF", fontSize: 9, fontWeight: "800" },
  flowBoardBackground: { alignItems: "center", backgroundColor: "#F7FAF8", borderBottomColor: "#E4EDE7", borderBottomWidth: 1, borderTopColor: "#E4EDE7", borderTopWidth: 1, width: "100%" }, flowBoardSection: { maxWidth: 1240, paddingHorizontal: 42, paddingVertical: 92, width: "100%" }, flowBoardSectionCompact: { paddingHorizontal: 20, paddingVertical: 62 }, flowBoardHeading: { maxWidth: 660 }, flowBoard: { alignItems: "stretch", flexDirection: "row", marginTop: 42 }, flowBoardCompact: { alignItems: "flex-start", flexDirection: "column", marginTop: 32 }, flowNode: { backgroundColor: "#FFFFFF", borderColor: "#DFEAE3", borderRadius: 13, borderWidth: 1, flex: 1, minHeight: 190, padding: 18 }, flowNodeNumber: { color: "#85A99A", fontSize: 9, fontWeight: "800", letterSpacing: 1 }, flowNodeIcon: { alignItems: "center", backgroundColor: "#E9F4EE", borderRadius: 9, height: 34, justifyContent: "center", marginTop: 17, width: 34 }, flowNodeIconText: { color: "#30745E", fontSize: 17, fontWeight: "800" }, flowNodeTitle: { color: "#21453A", fontSize: 15, fontWeight: "700", marginTop: 15 }, flowNodeCaption: { color: "#77877F", fontSize: 10, lineHeight: 15, marginTop: 6 }, flowConnector: { alignItems: "center", justifyContent: "center", width: 28 }, flowConnectorCompact: { height: 26, paddingLeft: 22, width: "auto" }, flowConnectorArrow: { color: "#70A18C", fontSize: 18 }, performancePanel: { alignItems: "center", backgroundColor: "#173D33", borderRadius: 14, flexDirection: "row", justifyContent: "space-between", marginTop: 18, paddingHorizontal: 24, paddingVertical: 21 }, performancePanelCompact: { alignItems: "flex-start", flexDirection: "column", gap: 22 }, performanceTitle: { color: "#FFFFFF", fontSize: 17, fontWeight: "700", marginTop: 7 }, performanceStats: { alignItems: "center", flexDirection: "row", gap: 19 }, performanceValue: { color: "#F2CB7B", fontSize: 19, fontWeight: "800", letterSpacing: -0.5 }, performanceLabel: { color: "#B8D1C5", fontSize: 9, marginTop: 4 }, performanceDivider: { backgroundColor: "#5B8273", height: 32, width: 1 },
  signalGrid: { flexDirection: "row", gap: 16, marginTop: 42 }, signalGridCompact: { flexDirection: "column" }, signalPrimary: { backgroundColor: "#193F35", borderRadius: 16, flex: 1.3, overflow: "hidden", padding: 26 }, signalHeader: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between", marginBottom: 18 }, signalOverline: { color: "#79A999", fontSize: 9, fontWeight: "800", letterSpacing: 1.15 }, signalTitle: { color: "#FFFFFF", fontSize: 21, fontWeight: "700", letterSpacing: -0.5, marginTop: 8 }, livePill: { alignItems: "center", backgroundColor: "#285B4D", borderRadius: 99, flexDirection: "row", gap: 6, paddingHorizontal: 9, paddingVertical: 6 }, liveDot: { backgroundColor: "#67D09F", borderRadius: 99, height: 6, width: 6 }, liveText: { color: "#DFF3E9", fontSize: 9, fontWeight: "700" }, signalRow: { alignItems: "center", borderTopColor: "rgba(226, 245, 235, 0.15)", borderTopWidth: 1, flexDirection: "row", minHeight: 59 }, signalRowLast: { borderBottomColor: "rgba(226, 245, 235, 0.15)", borderBottomWidth: 1 }, signalCount: { color: "#F3C770", fontSize: 20, fontWeight: "800", width: 46 }, signalLabel: { color: "#D2E4DA", flex: 1, fontSize: 12, fontWeight: "600" }, signalArrow: { color: "#A9D3C1", fontSize: 17 }, signalSide: { flex: 1, gap: 16 }, scoreCard: { backgroundColor: "#F4F8F5", borderColor: "#DFEAE3", borderRadius: 16, borderWidth: 1, flex: 1, padding: 21 }, scoreRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 12 }, scoreValue: { color: "#204C40", fontSize: 43, fontWeight: "800", letterSpacing: -2 }, scoreUnit: { fontSize: 20 }, scoreRing: { alignItems: "center", borderColor: "#5E9D83", borderLeftColor: "#D8EADF", borderRadius: 34, borderWidth: 7, height: 58, justifyContent: "center", width: 58 }, scoreRingText: { color: "#437362", fontSize: 9, fontWeight: "800" }, scoreCopy: { color: "#73847C", fontSize: 11, lineHeight: 17, marginTop: 8 }, activityCard: { backgroundColor: "#FFFFFF", borderColor: "#DFEAE3", borderRadius: 16, borderWidth: 1, flex: 1, padding: 21 }, activityTitle: { color: "#24483D", fontSize: 16, fontWeight: "700", marginTop: 8 }, activityPeople: { alignItems: "center", flexDirection: "row", gap: 9, marginTop: 16 }, smallAvatar: { alignItems: "center", backgroundColor: "#F2D4A2", borderRadius: 99, height: 29, justifyContent: "center", width: 29 }, activityName: { color: "#456156", fontSize: 10, fontWeight: "700" }, activityTime: { color: "#8A9892", fontSize: 9, marginTop: 3 },
  flowNode: { backgroundColor: "#FFFFFF", borderColor: "#DFEAE3", borderRadius: 13, borderWidth: 1, flex: 1, minHeight: 190, padding: 18 }, flowNodeActive: { backgroundColor: "#F0F8F3", borderColor: "#3C8068", boxShadow: "0 12px 22px rgba(33, 86, 69, 0.12)", transform: [{ translateY: -4 }] }, flowNodeHover: { borderColor: "#83B6A1" }, flowNodeNumberActive: { color: "#31765E" }, flowNodeIconActive: { backgroundColor: "#31765E" }, flowNodeIconTextActive: { color: "#FFFFFF" }, flowNodeTitleActive: { color: "#24614E" }, flowStageDetail: { alignItems: "center", backgroundColor: "#EAF4EE", borderRadius: 11, flexDirection: "row", gap: 12, marginTop: 15, paddingHorizontal: 16, paddingVertical: 13 }, flowStageDetailIcon: { alignItems: "center", backgroundColor: "#35765F", borderRadius: 7, height: 27, justifyContent: "center", width: 27 }, flowStageDetailIconText: { color: "#FFFFFF", fontSize: 8, fontWeight: "800" }, flowStageDetailTitle: { color: "#285D4C", fontSize: 11, fontWeight: "800" }, flowStageDetailCopy: { color: "#6A8176", fontSize: 10, marginTop: 2 }, flowStageDetailArrow: { color: "#35765F", fontSize: 17, marginLeft: "auto" },
  roleSectionTitle: { fontSize: 49, lineHeight: 53 }, roleExperience: { backgroundColor: "#FFFFFF", borderColor: "#DCE7E1", borderRadius: 16, borderWidth: 1, flexDirection: "row", marginTop: 40, overflow: "hidden" }, roleExperienceCompact: { flexDirection: "column" }, roleList: { backgroundColor: "#F6FAF7", borderRightColor: "#DCE7E1", borderRightWidth: 1, padding: 14, width: "34%" }, roleListCompact: { borderBottomColor: "#DCE7E1", borderBottomWidth: 1, borderRightWidth: 0, width: "100%" }, roleOption: { alignItems: "center", borderRadius: 10, flexDirection: "row", gap: 11, minHeight: 55, paddingHorizontal: 11 }, roleOptionActive: { backgroundColor: "#1B463A" }, roleOptionHover: { backgroundColor: "#EAF3ED" }, roleOptionNumber: { color: "#83A597", fontSize: 9, fontWeight: "800", width: 18 }, roleOptionNumberActive: { color: "#B7D7C8" }, roleOptionText: { color: "#4E695E", flex: 1, fontSize: 13, fontWeight: "700" }, roleOptionTextActive: { color: "#FFFFFF" }, roleOptionArrow: { color: "#80A094", fontSize: 16 }, roleOptionArrowActive: { color: "#C2E4D4" }, roleDetail: { flex: 1, minHeight: 310, padding: 31, position: "relative" }, roleMetric: { alignItems: "flex-end", position: "absolute", right: 29, top: 27 }, roleMetricValue: { color: "#2F765E", fontSize: 30, fontWeight: "800", letterSpacing: -1.2 }, roleMetricLabel: { color: "#83938B", fontSize: 10, marginTop: 3, maxWidth: 110, textAlign: "right" }, roleDetailTitle: { color: "#22483C", fontSize: 25, fontWeight: "700", letterSpacing: -0.6, lineHeight: 31, maxWidth: "72%" }, roleDetailCopy: { color: "#718178", fontSize: 15, lineHeight: 23, marginTop: 15, maxWidth: "75%" }, roleChecklist: { gap: 11, marginTop: 22 }, roleChecklistItem: { alignItems: "center", flexDirection: "row", gap: 10 }, roleCheck: { alignItems: "center", backgroundColor: "#DCF0E5", borderRadius: 99, height: 19, justifyContent: "center", width: 19 }, roleCheckText: { color: "#34805F", fontSize: 11, fontWeight: "800" }, roleChecklistText: { color: "#486459", fontSize: 13, fontWeight: "600" },
  ctaCard: { alignItems: "center", backgroundColor: "#183D33", borderRadius: 18, flexDirection: "row", gap: 28, minHeight: 235, overflow: "hidden", padding: 42 }, ctaCardCompact: { alignItems: "flex-start", flexDirection: "column", padding: 28 }, ctaOrb: { backgroundColor: "#2E6A58", borderRadius: 999, height: 280, opacity: 0.55, position: "absolute", right: -78, top: -100, width: 280 }, ctaCopyWrap: { flex: 1, zIndex: 1 }, ctaEyebrow: { color: "#A9D1BF", fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginBottom: 12 }, ctaTitle: { color: "#FFFFFF", fontSize: 34, fontWeight: "700", letterSpacing: -1.25, lineHeight: 38, maxWidth: 440 }, ctaCopy: { color: "#C9DDD3", fontSize: 13, lineHeight: 20, marginTop: 10 }, ctaActions: { flexDirection: "row", flexWrap: "wrap", gap: 10, zIndex: 1 },
  demoOverlay: { alignItems: "center", backgroundColor: "rgba(11, 34, 28, 0.62)", flex: 1, justifyContent: "center", padding: 20 }, demoModal: { backgroundColor: "#FFFFFF", borderRadius: 19, boxShadow: "0 28px 80px rgba(0, 0, 0, 0.25)", maxWidth: 500, padding: 31, position: "relative", width: "100%" }, demoClose: { alignItems: "center", backgroundColor: "#F0F5F2", borderRadius: 99, height: 30, justifyContent: "center", position: "absolute", right: 16, top: 16, width: 30 }, demoCloseText: { color: "#42695B", fontSize: 22, lineHeight: 22 }, demoMark: { alignItems: "center", backgroundColor: "#1B493D", borderRadius: 11, height: 42, justifyContent: "center", width: 42 }, demoMarkText: { color: "#FFFFFF", fontSize: 21, fontWeight: "800" }, demoEyebrow: { color: "#568170", fontSize: 9, fontWeight: "800", letterSpacing: 1.1, marginTop: 20 }, demoTitle: { color: "#1C4539", fontSize: 29, fontWeight: "700", letterSpacing: -0.8, marginTop: 9 }, demoCopy: { color: "#708279", fontSize: 13, lineHeight: 21, marginTop: 11 }, demoDetails: { flexDirection: "row", gap: 10, marginTop: 22 }, demoDetail: { backgroundColor: "#F2F8F4", borderRadius: 10, flex: 1, padding: 12 }, demoDetailLabel: { color: "#7C9186", fontSize: 8, fontWeight: "800", letterSpacing: 0.8 }, demoDetailValue: { color: "#2B5A4B", fontSize: 11, fontWeight: "700", marginTop: 6 }, demoAddress: { borderColor: "#E1ECE5", borderRadius: 10, borderWidth: 1, marginTop: 11, padding: 12 }, demoAddressText: { color: "#5E756A", fontSize: 11, lineHeight: 17, marginTop: 6 }, demoDoneButton: { alignItems: "center", backgroundColor: "#1B493D", borderRadius: 10, flexDirection: "row", justifyContent: "space-between", marginTop: 20, paddingHorizontal: 16, paddingVertical: 14 }, demoDoneText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800" }, demoDoneArrow: { color: "#FFFFFF", fontSize: 17 },
  contactModal: { backgroundColor: "#FFFFFF", borderRadius: 19, boxShadow: "0 28px 80px rgba(0, 0, 0, 0.25)", maxWidth: 500, padding: 31, position: "relative", width: "100%" }, contactModalIcon: { alignItems: "center", backgroundColor: "#E3F1E9", borderRadius: 12, height: 43, justifyContent: "center", width: 43 }, contactModalIconText: { color: "#2A705A", fontSize: 20 }, contactModalTitle: { color: "#1C4539", fontSize: 27, fontWeight: "700", letterSpacing: -0.7, lineHeight: 33, marginTop: 9, maxWidth: 370 }, contactCards: { gap: 9, marginTop: 22 }, contactCard: { alignItems: "center", backgroundColor: "#F3F8F5", borderRadius: 10, flexDirection: "row", gap: 11, padding: 12 }, contactCardSymbol: { alignItems: "center", backgroundColor: "#D7EDE0", borderRadius: 8, color: "#2F755D", fontSize: 13, fontWeight: "800", height: 27, paddingTop: 5, textAlign: "center", width: 27 }, contactCardValue: { color: "#2D5D4D", fontSize: 12, fontWeight: "700", marginTop: 4 }, contactLocation: { borderColor: "#E1ECE5", borderRadius: 10, borderWidth: 1, marginTop: 11, padding: 12 },
  footer: { alignItems: "flex-start", borderTopColor: "#E5EBE7", borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", maxWidth: 1240, paddingHorizontal: 42, paddingVertical: 32, width: "100%" }, footerCompact: { alignItems: "flex-start", flexDirection: "column", gap: 24, paddingHorizontal: 20 }, footerBrand: { gap: 12 }, footerText: { color: "#89958F", fontSize: 11 }, contactBlock: { alignItems: "flex-end", gap: 5, maxWidth: 375 }, contactBlockCompact: { alignItems: "flex-start", maxWidth: "100%" }, contactTitle: { color: "#376556", fontSize: 11, fontWeight: "800", letterSpacing: 0.6, marginBottom: 3, textTransform: "uppercase" }, contactText: { color: "#536B61", fontSize: 11, fontWeight: "600" }, contactAddress: { color: "#829088", fontSize: 10, lineHeight: 15, marginTop: 3, textAlign: "right" }, contactAddressCompact: { textAlign: "left" },
});
