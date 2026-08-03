export const colors = {
  background: "#F7F4EE",
  border: "#E4DCCF",
  danger: "#C65C4C",
  dangerSoft: "#FBE9E6",
  ink: "#22303A",
  muted: "#6F7B86",
  primary: "#4C7B6E",
  primaryDark: "#32584D",
  primarySoft: "#E8F2ED",
  shadow: "#8A7D68",
  success: "#2F8F62",
  successSoft: "#EAF7EE",
  surface: "#FFFFFF",
  warning: "#C48A2F",
  warningSoft: "#FFF6E6",
  white: "#FFFFFF",
};

export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radii = {
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
};

export const typography = {
  baseFont: "Calibri",
  headingFont: "Calibri",
  sizes: {
    caption: 11,
    body: 13,
    input: 14,
    label: 12,
    cardTitle: 15,
    sectionTitle: 18,
    pageTitle: 24,
  },
  weights: {
    regular: "400",
    medium: "500",
    semibold: "600",
    bold: "700",
  },
  lineHeights: {
    caption: 15,
    body: 19,
    title: 28,
  },
};

export function responsiveCardBasis(width, maxColumns = 4) {
  if (maxColumns >= 4 && width >= 1024) return "23%";
  if (maxColumns >= 3 && width >= 720) return "31%";
  if (maxColumns >= 2 && width >= 480) return "47%";
  return "100%";
}
