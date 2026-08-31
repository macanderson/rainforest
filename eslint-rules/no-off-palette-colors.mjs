/**
 * ESLint rule: no-off-palette-colors
 *
 * Enforces the locked black/white/red token sheet (docs/architecture.md §2,
 * AGENTS.md §4). Rejects:
 *   1. Any hex color literal outside the locked sheet (any length, any case).
 *   2. Any Tailwind color utility class outside the locked sheet — including
 *      default-palette names (blue-500, emerald-100, ...) and off-sheet
 *      shades of red/grey (red-100, grey-950, gray-500, ...).
 *   3. rgb()/hsl()/hwb()/lab()/oklch() color functions — the sheet is hex-only.
 *
 * The allowed set is derived from lib/tokens.ts, the single source of truth.
 */

import { allowedColorClassNames, allowedHexColors } from "../lib/tokens.ts";

const COLOR_PREFIXES = [
  "bg",
  "text",
  "border",
  "ring",
  "fill",
  "stroke",
  "outline",
  "decoration",
  "accent",
  "caret",
  "shadow",
  "from",
  "via",
  "to",
  "divide",
  "placeholder",
];

// A color utility segment: <prefix>-<name> or <prefix>-<name>-<shade>.
// The name must be a known Tailwind color family (so `text-sm`, `border-r`,
// `ring-offset` etc. are never mistaken for colors).
const KNOWN_COLOR_FAMILIES = new Set([
  // Locked sheet
  "black",
  "white",
  "red",
  "grey",
  // Default Tailwind palette (all forbidden here)
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
  // Special color utilities
  "inherit",
  "current",
  "transparent",
]);

const COLOR_CLASS_RE = new RegExp(
  `^(?:${COLOR_PREFIXES.join("|")})-([a-z]+)(?:-(\\d{2,3}))?$`,
);

// A Tailwind arbitrary value on a color prefix: bg-[#123456], border-[red].
// Clearing the theme's color namespace does not reach these — Tailwind builds
// the declaration from the bracket, not from a token — so they are the one way
// an off-palette color still compiles, and this rule is what stops them.
const ARBITRARY_RE = new RegExp(
  `^(?:${COLOR_PREFIXES.join("|")})-\\[(.+)\\]$`,
);

// Any hex literal of 3, 4, 6, or 8 digits.
const HEX_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;

// CSS color functions other than the locked hex sheet.
const COLOR_FN_RE = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/gi;

/**
 * Whether an arbitrary value is a color rather than a length.
 *
 * `text-[14px]` and `border-[2px]` share their prefixes with color utilities
 * and are perfectly legal, so the prefix cannot decide this on its own — the
 * bracket has to. A named color is bare letters; every size carries a digit or
 * a unit, which is what keeps the two apart.
 */
function isColorValue(content) {
  const inner = content.trim();
  if (inner.startsWith("#")) return true;
  if (COLOR_FN_RE.test(inner)) {
    COLOR_FN_RE.lastIndex = 0;
    return true;
  }
  if (/^color:/i.test(inner)) return true;
  return /^[a-zA-Z]+$/.test(inner);
}

/**
 * Drop `hover:` / `md:` prefixes without splitting an arbitrary value that
 * contains its own colon — `fill-[color:var(--x)]` is one token, and a naive
 * split on ":" hands back `var(--x)]`.
 */
function stripVariants(token) {
  let depth = 0;
  for (let i = 0; i < token.length; i += 1) {
    const ch = token[i];
    if (ch === "[") depth += 1;
    else if (ch === "]") depth -= 1;
    else if (ch === ":" && depth === 0) return stripVariants(token.slice(i + 1));
  }
  return token;
}

function normalizeHex(hex) {
  let h = hex.toLowerCase();
  // Expand shorthand (#abc -> #aabbcc, #abcd -> #aabbccdd) then drop alpha.
  if (h.length === 4 || h.length === 5) {
    h = "#" + [...h.slice(1)].map((c) => c + c).join("");
  }
  if (h.length === 9) {
    h = h.slice(0, 7);
  }
  return h;
}

function checkStringValue(value, node, context, seen) {
  // 1. Hex literals
  for (const match of value.matchAll(HEX_RE)) {
    const normalized = normalizeHex(match[0]);
    if (!allowedHexColors.has(normalized) && !seen.has(node)) {
      seen.add(node);
      context.report({
        node,
        messageId: "offPaletteHex",
        data: { color: match[0] },
      });
    }
  }

  // 2. CSS color functions
  for (const match of value.matchAll(COLOR_FN_RE)) {
    if (!seen.has(node)) {
      seen.add(node);
      context.report({
        node,
        messageId: "offPaletteFunction",
        data: { fn: match[0].replace(/\s*\($/, "()") },
      });
    }
  }

  // 3. Tailwind color classes — inspect every whitespace-separated token,
  //    including variant-prefixed ones (hover:bg-blue-500, md:text-red-100).
  for (const rawToken of value.split(/\s+/)) {
    const token = rawToken.replace(/\/\d{1,3}$/, ""); // strip opacity modifier
    const segment = stripVariants(token);
    if (!segment) continue;

    // 4. Arbitrary values on a color prefix. Only a locked hex is admitted;
    //    a named color, a color function or a `color:` reference is not.
    const arbitrary = ARBITRARY_RE.exec(segment);
    if (arbitrary) {
      const inner = arbitrary[1].trim();
      const admitted =
        /^#[0-9a-fA-F]{3,8}$/.test(inner) &&
        allowedHexColors.has(normalizeHex(inner));
      if (isColorValue(inner) && !admitted && !seen.has(node)) {
        seen.add(node);
        context.report({
          node,
          messageId: "offPaletteArbitrary",
          data: { className: segment },
        });
      }
      continue;
    }

    const m = COLOR_CLASS_RE.exec(segment);
    if (!m) continue;
    // A bare family name (bg-black) is a color; a family with a numeric
    // shade (bg-red-600) is a color; anything else (text-sm, border-r) is
    // not a color utility.
    if (!KNOWN_COLOR_FAMILIES.has(m[1]) && !m[2]) continue;
    const name = m[2] ? `${m[1]}-${m[2]}` : m[1];
    if (!allowedColorClassNames.has(name) && !seen.has(node)) {
      seen.add(node);
      context.report({
        node,
        messageId: "offPaletteClass",
        data: { className: segment },
      });
    }
  }
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Reject color literals and Tailwind color classes outside the locked black/white/red token sheet",
    },
    messages: {
      offPaletteHex:
        "Color literal '{{color}}' is outside the locked black/white/red token sheet (docs/architecture.md §2).",
      offPaletteClass:
        "Tailwind color class '{{className}}' is outside the locked token sheet. Only black, white, red-300…red-900 and grey-50…grey-900 are permitted.",
      offPaletteFunction:
        "CSS color function '{{fn}}' is not permitted; use the locked hex tokens only.",
      offPaletteArbitrary:
        "Arbitrary color utility '{{className}}' bypasses the locked token sheet. Tailwind builds these from the bracket, so the theme cannot reject them — use a locked utility (bg-red-600, text-grey-700) instead.",
    },
    schema: [],
  },
  create(context) {
    const seen = new Set();
    return {
      Literal(node) {
        if (typeof node.value === "string") {
          checkStringValue(node.value, node, context, seen);
        }
      },
      TemplateElement(node) {
        checkStringValue(node.value.cooked ?? "", node, context, seen);
      },
    };
  },
};

export default rule;
