#!/usr/bin/env node
/**
 * tools/fix-sidebars.js
 * ------------------------------------------------------------------
 * One-shot codemod that unifies the sidebar/topbar layout across
 * every .html file in the project.
 *
 * Usage:
 *   node tools/fix-sidebars.js            # dry run (shows what would change)
 *   node tools/fix-sidebars.js --write    # actually writes the files
 *   node tools/fix-sidebars.js --dir=src  # scan a specific folder
 *   node tools/fix-sidebars.js --skip=a.html,b.html  # skip specific files
 *
 * What it does to each file:
 *   1. Removes <script src="js/sidebar.js"></script>
 *   2. Ensures <body> has class="discover-body has-sidebar"
 *   3. Inserts the standard <aside class="side-rail"> markup if missing
 *   4. Wraps <main> in <div class="side-rail__content"> if not wrapped
 *   5. Adds the topbar (user chip slot) inside the content wrapper
 *   6. Normalizes class names (double-underscore variants)
 *   7. Bumps cache-busters on js/auth.js, js/api.js, js/main.js
 *
 * Auto-skips files that are already fully migrated. Idempotent.
 * ------------------------------------------------------------------
 */

const fs   = require("fs");
const path = require("path");

/* ---------------- CLI flags ---------------- */
const args    = process.argv.slice(2);
const WRITE   = args.includes("--write");
const DIR_ARG = args.find((a) => a.startsWith("--dir="));
const ROOT    = DIR_ARG ? path.resolve(DIR_ARG.slice(6)) : process.cwd();

// --skip=file1.html,file2.html
const SKIP_ARG = args.find((a) => a.startsWith("--skip="));
const SKIP_FILES = new Set(
  SKIP_ARG
    ? SKIP_ARG.slice(7).split(",").map((s) => s.trim()).filter(Boolean)
    : []
);

/* ---------------- Config ---------------- */
const SKIP_DIRS = new Set(["node_modules", ".git", "backend", "public", "dist", "build"]);

/* ---------------- The standard sidebar markup ---------------- */
const SIDEBAR_HTML = `<!-- ============================================================
     SIDEBAR
     ============================================================ -->
<aside class="side-rail" id="side-rail" aria-label="Main navigation">
  <a href="index.html" class="side-rail__brand" aria-label="Athi Soko Connect - home">
    <svg class="side-rail__mark" viewBox="0 0 44 44" aria-hidden="true">
      <rect width="44" height="44" rx="12" fill="#16233f"/>
      <path d="M12 30 22 13l10 17z" fill="none" stroke="#c8862a" stroke-width="2.6" stroke-linejoin="round"/>
      <circle cx="22" cy="26" r="2.6" fill="#fff"/>
    </svg>
    <span class="side-rail__brand-text">
      <b>Athi Soko Connect</b>
      <small>Athi Highway Estate</small>
    </span>
  </a>

  <nav class="side-rail__nav" aria-label="Main">
    <a href="index.html" data-nav="index.html">
      <i class="fas fa-compass" aria-hidden="true"></i>
      <span>Discover</span>
    </a>
    <a href="register.html" data-nav="register.html">
      <i class="fas fa-user-plus" aria-hidden="true"></i>
      <span>Become a Provider</span>
    </a>
    <a href="dashboard.html" data-nav="dashboard.html">
      <i class="fas fa-calendar-check" aria-hidden="true"></i>
      <span>My Bookings</span>
    </a>
    <a href="notices.html" data-nav="notices.html">
      <i class="fas fa-bullhorn" aria-hidden="true"></i>
      <span>Estate Notice Board</span>
    </a>
    <a href="security-visitors.html" data-nav="security-visitors.html">
      <i class="fas fa-shield-halved" aria-hidden="true"></i>
      <span>Security — Visitors</span>
    </a>
    <a href="admin.html" data-nav="admin.html" data-admin-only hidden>
      <i class="fas fa-user-shield" aria-hidden="true"></i>
      <span>Admin</span>
    </a>
    <a href="super-admin.html" data-nav="super-admin.html" data-super-admin-only hidden>
      <i class="fas fa-crown" aria-hidden="true"></i>
      <span>Super Admin</span>
    </a>
  </nav>

  <div class="side-rail__footer">
    <div class="side-rail__status">
      <span class="side-rail__dot"></span>
      Estate server connected
    </div>
  </div>
</aside>

<!-- Mobile toggle -->
<button class="side-rail__toggle" id="side-rail-toggle" aria-label="Toggle navigation" type="button">
  <i class="fas fa-bars"></i>
</button>
<div class="side-rail__backdrop" id="side-rail-backdrop"></div>
`;

/* ---------------- The topbar markup ---------------- */
const TOPBAR_HTML = `  <div class="side-rail__topbar">
    <div class="side-rail__topbar-inner">
      <div class="side-rail__topbar-left" id="topbar-left"></div>
      <div class="side-rail__topbar-user" id="topbar-user"></div>
    </div>
  </div>
`;

/* ---------------- Class-name normalizer ---------------- */
const CLASS_RENAMES = [
  // Single → double underscore, matching the current design system
  [/\bpage-head_text\b/g,       "page-head__text"],
  [/\bstat-section_title\b/g,   "stat-section__title"],
  [/\bstat-tile_value\b/g,      "stat-tile__value"],
  [/\bstat-tile_label\b/g,      "stat-tile__label"],
  [/\bstat-tile_delta\b/g,      "stat-tile__delta"],
  [/\bstat-tile_icon\b/g,       "stat-tile__icon"],
  [/\bstat-tile_desc\b/g,       "stat-tile__desc"],
  [/\bchart-card_head\b/g,      "chart-card__head"],
  [/\bchart-card_body\b/g,      "chart-card__body"],
  [/\balert-card_head\b/g,      "alert-card__head"],
  [/\balert-card_body\b/g,      "alert-card__body"],
  [/\bnotice-item_title\b/g,    "notice-item__title"],
  [/\bnotice-item_body\b/g,     "notice-item__body"],
  [/\bnotice-item_icon\b/g,     "notice-item__icon"],
  [/\bnotice-item_meta\b/g,     "notice-item__meta"],
  [/\bnotice-item_actions\b/g,  "notice-item__actions"],
  [/\bnotice-item_head\b/g,     "notice-item__head"],
  [/\bnotice-item_badge\b/g,    "notice-item__badge"],
  [/\badmin-tile_value\b/g,     "admin-tile__value"],
  [/\badmin-tile_label\b/g,     "admin-tile__label"],
  [/\badmin-tile_icon\b/g,      "admin-tile__icon"],
  [/\badmin-tile_desc\b/g,      "admin-tile__desc"],
  [/\badmin-tile_delta\b/g,     "admin-tile__delta"],
  [/\bside-rail_brand\b/g,      "side-rail__brand"],
  [/\bside-rail_mark\b/g,       "side-rail__mark"],
  [/\bside-rail_nav\b/g,        "side-rail__nav"],
  [/\bside-rail_footer\b/g,     "side-rail__footer"],
  [/\bside-rail_content\b/g,    "side-rail__content"],
  [/\bside-rail_toggle\b/g,     "side-rail__toggle"],
  [/\bside-rail_backdrop\b/g,   "side-rail__backdrop"],
  [/\bside-rail_topbar\b/g,     "side-rail__topbar"],
  [/\bside-rail_status\b/g,     "side-rail__status"],
  [/\bside-rail_dot\b/g,        "side-rail__dot"],
  [/\bside-rail_brand-text\b/g, "side-rail__brand-text"],
  [/\bside-rail_submenu\b/g,    "side-rail__submenu"],
  [/\bside-rail_group\b/g,      "side-rail__group"],
  [/\bside-rail_group-toggle\b/g, "side-rail__group-toggle"],
  [/\bside-rail_chev\b/g,       "side-rail__chev"],
  [/\bside-rail_auth\b/g,       "side-rail__auth"],
];

/* ---------------- File walker ---------------- */
function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
      files.push(full);
    }
  }
  return files;
}

/* ---------------- Transform one HTML file ---------------- */
function transform(html, filename) {
  const changes = [];
  const original = html;

  /* ----------------------------------------------------------
     AUTO-SKIP: detect a page that's already fully migrated.
     Four markers must all be present:
       - body has class "has-sidebar"
       - a .side-rail element exists
       - a .side-rail__content element exists
       - no legacy js/sidebar.js <script> tag
     If all four are true, leave the file completely alone.
     ---------------------------------------------------------- */
  const hasSidebarBody = /<body[^>]*class\s*=\s*["'][^"']*\bhas-sidebar\b/i.test(html);
  const hasSideRail    = /class\s*=\s*["'][^"']*\bside-rail\b[^"']*["']/i.test(html);
  const hasContent     = /class\s*=\s*["'][^"']*\bside-rail__content\b[^"']*["']/i.test(html);
  const hasLegacyJs    = /<script[^>]*src=["'](?:\/)?js\/sidebar\.js/i.test(html);

  if (hasSidebarBody && hasSideRail && hasContent && !hasLegacyJs) {
    return { html: original, changes: [], changed: false, alreadyMigrated: true };
  }

  /* 1. Remove <script src="js/sidebar.js"></script> (any path/variant) */
  const sidebarScriptRe = /\s*<script[^>]*src=["'](?:\/)?js\/sidebar\.js[^"']*["'][^>]*>\s*<\/script>/gi;
  if (sidebarScriptRe.test(html)) {
    html = html.replace(sidebarScriptRe, "");
    changes.push("removed sidebar.js <script>");
  }

  /* 2. Ensure body class includes has-sidebar */
  html = html.replace(/<body([^>]*)>/i, (full, attrs) => {
    let newAttrs = attrs;

    // Add or update class="..."
    const classMatch = newAttrs.match(/class\s*=\s*"([^"]*)"/i);
    if (classMatch) {
      const classes = classMatch[1].split(/\s+/).filter(Boolean);
      if (!classes.includes("has-sidebar")) classes.push("has-sidebar");
      if (!classes.includes("discover-body")) classes.push("discover-body");
      newAttrs = newAttrs.replace(classMatch[0], `class="${classes.join(" ")}"`);
    } else {
      newAttrs = ` class="discover-body has-sidebar"` + newAttrs;
    }

    if (newAttrs !== attrs) changes.push("updated <body> class");
    return `<body${newAttrs}>`;
  });

  /* 3. Insert sidebar markup if missing */
  if (!hasSideRail) {
    // Insert right after <body ...>
    html = html.replace(/(<body[^>]*>)/i, (m) => `${m}\n\n${SIDEBAR_HTML}`);
    changes.push("inserted side-rail markup");
  }

  /* 4. Wrap <main> in .side-rail__content if not already wrapped */
  if (!hasContent) {
    // Find the first <main ...> ... </main>
    const mainMatch = html.match(/(<main\b[^>]*>)([\s\S]*?)(<\/main>)/i);
    if (mainMatch) {
      const [fullMain, openTag, inner, closeTag] = mainMatch;

      // Determine whether <main> already has the dx-main class
      let newOpen = openTag;
      const classAttr = openTag.match(/class\s*=\s*"([^"]*)"/i);
      if (classAttr) {
        const classes = classAttr[1].split(/\s+/).filter(Boolean);
        if (!classes.includes("dx-main")) classes.push("dx-main");
        newOpen = openTag.replace(classAttr[0], `class="${classes.join(" ")}"`);
      } else {
        newOpen = openTag.replace(/<main\b/i, `<main class="container dx-main"`);
      }

      const replacement =
        `<div class="side-rail__content">\n` +
        TOPBAR_HTML +
        `\n  ${newOpen}${inner}${closeTag}\n` +
        `</div>`;

      html = html.replace(fullMain, replacement);
      changes.push("wrapped <main> in .side-rail__content");
    } else {
      changes.push("WARN: no <main> found to wrap");
    }
  }

  /* 5. Normalize class names — collect matched renames via re.source */
  const renamed = [];
  for (const [re, replacement] of CLASS_RENAMES) {
    const before = html;
    html = html.replace(re, replacement);
    if (html !== before) renamed.push(re.source);
  }
  if (renamed.length) {
    changes.push(`normalized: ${renamed.join(", ")}`);
  }

  /* 6. Bump script cache-busters on the standard scripts (one time) */
  const scriptBumps = [
    ["js/auth.js",     "?v=8"],
    ["js/api.js",      "?v=10"],
    ["js/main.js",     "?v=7"],
  ];
  for (const [file, qs] of scriptBumps) {
    const re = new RegExp(
      `(<script[^>]*src=["'][^"']*${file.replace(/\./g, "\\.")})(["'])`,
      "g"
    );
    const before = html;
    html = html.replace(re, (m, prefix, quote) => {
      // If a ?v= is already there, leave it
      if (/\?v=/.test(prefix)) return m;
      return `${prefix}${qs}${quote}`;
    });
    if (html !== before) changes.push(`bumped ${file} cache-buster`);
  }

  return { html, changes, changed: html !== original, alreadyMigrated: false };
}

/* ---------------- Main ---------------- */
(function main() {
  console.log(`Scanning: ${ROOT}`);
  console.log(`Mode:     ${WRITE ? "WRITE" : "DRY RUN"}`);
  if (SKIP_FILES.size) {
    console.log(`Skipping: ${[...SKIP_FILES].join(", ")}`);
  }
  console.log("");

  const files = walk(ROOT);
  let touched  = 0;
  let skipped  = 0;   // fully migrated or in --skip list
  let warnings = 0;

  for (const file of files) {
    const rel  = path.relative(ROOT, file);
    const base = path.basename(file);

    // Manual skip list (--skip=)
    if (SKIP_FILES.has(rel) || SKIP_FILES.has(base)) {
      console.log(`⏭  ${rel}  (skipped by flag)`);
      skipped++;
      continue;
    }

    const original = fs.readFileSync(file, "utf8");
    const { html, changes, changed, alreadyMigrated } = transform(original, file);

    // Auto-skip: already fully migrated
    if (alreadyMigrated) {
      console.log(`⏭  ${rel}  (already migrated)`);
      skipped++;
      continue;
    }

    if (!changed) {
      skipped++;
      continue;
    }

    touched++;
    console.log(`✔ ${rel}`);
    for (const c of changes) {
      console.log(`    · ${c}`);
      if (c.startsWith("WARN")) warnings++;
    }

    if (WRITE) {
      fs.writeFileSync(file, html, "utf8");
    }
  }

  console.log(`\n${files.length} HTML files scanned`);
  console.log(`${touched} ${WRITE ? "written" : "would change"}`);
  console.log(`${skipped} already OK or skipped`);
  if (warnings) console.log(`${warnings} warning(s) — inspect the WARN lines above`);

  if (!WRITE && touched > 0) {
    console.log(`\nRun again with --write to apply the changes.`);
  }
})();