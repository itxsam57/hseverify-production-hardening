import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const projectRoot = process.cwd();

function normalizeLineEndings(value) {
  return value.replace(/\r\n?/g, "\n");
}

async function source(path) {
  const value = await readFile(resolve(projectRoot, path), "utf8");
  return normalizeLineEndings(value);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cssRuleBody(css, selector) {
  const match = css.match(
    new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`, "s")
  );

  assert.ok(match, `Missing CSS rule: ${selector}`);
  return match[1];
}

function assertCssDeclaration(css, selector, property, value) {
  const body = cssRuleBody(css, selector);
  assert.match(
    body,
    new RegExp(
      `(?:^|;)\\s*${escapeRegExp(property)}\\s*:\\s*${escapeRegExp(value)}\\s*;?`,
      "s"
    ),
    `${selector} must declare ${property}: ${value}.`
  );
}

function cssViewportWidth(deviceWidth, zoomPercent) {
  return deviceWidth / (zoomPercent / 100);
}

function portalContentWidth(deviceWidth, zoomPercent) {
  const viewport = cssViewportWidth(deviceWidth, zoomPercent);
  const sidebar = viewport > 860 ? 260 : 0;
  const singleSidePadding = Math.min(42, Math.max(18, viewport * 0.03));
  return viewport - sidebar - singleSidePadding * 2;
}

test("CSS contract inspection is stable across LF and CRLF checkouts", () => {
  const lf = ".profile-history-card {\n  overflow: hidden;\n}\n";
  const crlf = lf.replaceAll("\n", "\r\n");

  assert.equal(normalizeLineEndings(crlf), lf);
  assertCssDeclaration(
    normalizeLineEndings(crlf),
    ".profile-history-card",
    "overflow",
    "hidden"
  );
});

test("Worker shell and Profile keep shrink containment through every layout boundary", async () => {
  const layout = await source("src/app/layout.tsx");
  const containment = await source("src/app/layout-containment.css");
  const profile = await source("src/app/profile.css");

  assert.ok(layout.includes('import "@/app/layout-containment.css"'));
  assert.ok(
    layout.indexOf('import "@/app/layout-containment.css"') <
      layout.indexOf('import "@/app/profile.css"'),
    "Shell containment must load before the Profile stylesheet."
  );

  for (const marker of [
    ".portal-shell {",
    "width: 100%;",
    "min-width: 0;",
    "max-width: 100%;",
    ".portal-main-column,",
    ".portal-content {",
    ".portal-content > * {"
  ]) {
    assert.ok(containment.includes(marker), `Missing shell containment marker: ${marker}`);
  }

  assert.doesNotMatch(
    containment,
    /(?:body|\.portal-shell)\s*\{[^}]*overflow-x:\s*(?:hidden|clip)/s,
    "The repair must not hide page-wide overflow on body or the whole portal shell."
  );

  for (const marker of [
    "container: worker-profile / inline-size;",
    ".profile-page > *,",
    ".profile-layout > *,",
    ".profile-aside > *,",
    "grid-template-columns: minmax(0, 1fr) minmax(16rem, 22rem);",
    "@container worker-profile (max-width: 62rem)",
    "@container worker-profile (max-width: 46rem)"
  ]) {
    assert.ok(profile.includes(marker), `Missing Profile containment marker: ${marker}`);
  }

  assert.ok(
    !profile.includes("minmax(300px"),
    "The Profile layout must not restore the fixed 300px right-column minimum."
  );
});

test("Profile history owns the only horizontal scroll region", async () => {
  const profile = await source("src/app/profile.css");
  const designSystem = await source("src/app/design-system.css");
  const profilePage = await source("src/app/worker/(portal)/profile/page.tsx");

  assert.ok(profilePage.includes('<section className="profile-history-card"'));
  assert.ok(profilePage.includes("<DataTable caption=\"Recent profile activity\">"));
  assertCssDeclaration(profile, ".profile-history-card", "overflow", "hidden");
  assertCssDeclaration(
    profile,
    ".profile-history-card .ds-table-wrap",
    "overflow-x",
    "auto"
  );
  assertCssDeclaration(
    profile,
    ".profile-history-card .ds-table-wrap",
    "overscroll-behavior-inline",
    "contain"
  );
  assert.equal(
    profile.match(/overflow-x:\s*auto;/g)?.length ?? 0,
    1,
    "Only the Profile history table wrapper may scroll horizontally."
  );
  assertCssDeclaration(
    designSystem,
    ".ds-table",
    "min-width",
    "36rem"
  );
});

test("Profile action controls remain bounded by their cards", async () => {
  const profile = await source("src/app/profile.css");

  for (const marker of [
    ".profile-submit-card .button,",
    ".profile-submit-card form {",
    "max-width: 100%;",
    ".profile-form-actions > * {",
    ".profile-form-actions form .button {",
    "width: 100%;"
  ]) {
    assert.ok(profile.includes(marker), `Missing action containment marker: ${marker}`);
  }
});

test("required desktop, tablet, mobile and zoom widths switch before clipping", () => {
  const stackThreshold = 62 * 16;
  const splitRightMinimum = 16 * 16;
  const splitGap = 20;
  const cases = [
    { label: "normal desktop", deviceWidth: 1366, zoom: 100 },
    { label: "860px", deviceWidth: 860, zoom: 100 },
    { label: "768px", deviceWidth: 768, zoom: 100 },
    { label: "390px", deviceWidth: 390, zoom: 100 },
    { label: "320px", deviceWidth: 320, zoom: 100 },
    { label: "125% zoom", deviceWidth: 1366, zoom: 125 },
    { label: "150% zoom", deviceWidth: 1366, zoom: 150 },
    { label: "200% zoom", deviceWidth: 1366, zoom: 200 }
  ];

  for (const scenario of cases) {
    const containerWidth = portalContentWidth(scenario.deviceWidth, scenario.zoom);
    const stacked = containerWidth <= stackThreshold;

    if (stacked) {
      assert.ok(
        containerWidth > 0,
        `${scenario.label} must retain a positive single-column Profile width.`
      );
      continue;
    }

    assert.ok(
      containerWidth - splitRightMinimum - splitGap > 0,
      `${scenario.label} must leave positive width for the Profile editor beside the action column.`
    );
  }

  assert.ok(
    portalContentWidth(860, 100) <= stackThreshold,
    "The 860px acceptance width must use the contained single-column layout."
  );
  assert.ok(
    portalContentWidth(1366, 125) <= stackThreshold,
    "125% zoom must stack before the right column can clip."
  );
  assert.ok(
    portalContentWidth(1366, 200) <= stackThreshold,
    "200% zoom must use the reflowed single-column layout."
  );
});
