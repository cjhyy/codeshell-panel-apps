const frame = (content, background = "#f4f6f8") => `
  <section style="flex:1 1 0;min-width:0;height:100%;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;background:${background};padding:20px;font-family:Arial,sans-serif;color:#172033;">
    ${content}
  </section>
`;

export const html2figmaCases = [
  {
    id: "flex-hug-fill-fixed",
    name: "Flex Hug / Fill / Fixed",
    category: "layout",
    sourceTemplate: "[Layout] Flex Basis Zero",
    width: 760,
    reflowWidth: 520,
    height: 220,
    expected: { autoLayouts: 2 },
    html: frame(`
      <div style="display:flex;align-items:center;gap:12px;padding:16px;background:#fff;border:1px solid #dbe2ea;border-radius:12px;">
        <div style="flex:0 0 72px;height:72px;display:flex;align-items:center;justify-content:center;background:#2563eb;color:#fff;border-radius:10px;font-weight:700;">Fixed</div>
        <div style="flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:6px;">
          <strong style="font-size:18px;">Fill takes the remaining width</strong>
          <span style="font-size:13px;line-height:18px;color:#64748b;">This copy wraps when the parent frame becomes narrower.</span>
        </div>
        <button style="flex:0 0 auto;border:0;border-radius:8px;background:#e2e8f0;color:#334155;padding:10px 14px;font-weight:700;">Hug</button>
      </div>
    `),
  },
  {
    id: "flex-column-fill",
    name: "Vertical Fill and footer",
    category: "layout",
    sourceTemplate: "[Layout] HUG vs FIXED Height",
    width: 760,
    reflowWidth: 520,
    height: 280,
    expected: { autoLayouts: 3 },
    html: frame(`
      <div style="height:240px;display:flex;flex-direction:column;background:#fff;border:1px solid #dbe2ea;border-radius:12px;overflow:hidden;">
        <header style="padding:14px 18px;border-bottom:1px solid #e2e8f0;font-weight:700;">Project activity</header>
        <div style="flex:1 1 0;min-height:0;padding:18px;display:flex;align-items:center;justify-content:center;color:#64748b;background:#f8fafc;">Fill height content</div>
        <footer style="padding:12px 18px;display:flex;justify-content:flex-end;gap:8px;border-top:1px solid #e2e8f0;">
          <button style="padding:8px 12px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;">Cancel</button>
          <button style="padding:8px 12px;border:0;border-radius:7px;background:#2563eb;color:#fff;">Save</button>
        </footer>
      </div>
    `),
  },
  {
    id: "flex-wrap-tags",
    name: "Wrapped chips",
    category: "layout",
    sourceTemplate: "[Layout] Text - Flex Layout with Spans",
    width: 760,
    reflowWidth: 520,
    height: 190,
    expected: { autoLayouts: 2, wrapLayouts: 1 },
    html: frame(`
      <div style="display:flex;flex-direction:column;gap:14px;padding:18px;background:#fff;border-radius:12px;border:1px solid #dbe2ea;">
        <strong>Filter by capability</strong>
        <div style="display:flex;flex-wrap:wrap;gap:8px 10px;">
          <span style="padding:7px 11px;border-radius:999px;background:#dbeafe;color:#1d4ed8;">Auto Layout</span>
          <span style="padding:7px 11px;border-radius:999px;background:#ede9fe;color:#6d28d9;">Variables</span>
          <span style="padding:7px 11px;border-radius:999px;background:#dcfce7;color:#15803d;">Components</span>
          <span style="padding:7px 11px;border-radius:999px;background:#ffedd5;color:#c2410c;">Prototype</span>
          <span style="padding:7px 11px;border-radius:999px;background:#fce7f3;color:#be185d;">Dev Mode</span>
        </div>
      </div>
    `),
  },
  {
    id: "grid-spans",
    name: "Responsive grid with spans",
    category: "layout",
    sourceTemplate: "[Layout] CSS Grid Layout Test",
    width: 760,
    reflowWidth: 520,
    height: 300,
    expected: { autoLayouts: 1, gridLayouts: 1 },
    html: frame(`
      <div style="height:260px;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(2,1fr);gap:12px;">
        <article style="grid-column:span 2;padding:18px;background:#1d4ed8;color:#fff;border-radius:12px;display:flex;flex-direction:column;justify-content:space-between;">
          <strong style="font-size:20px;">Primary metric</strong><span style="font-size:34px;font-weight:700;">84%</span>
        </article>
        <article style="padding:18px;background:#fff;border:1px solid #dbe2ea;border-radius:12px;"><strong>12.4k</strong><p style="margin:8px 0 0;color:#64748b;">Visitors</p></article>
        <article style="padding:18px;background:#fff;border:1px solid #dbe2ea;border-radius:12px;"><strong>2.1k</strong><p style="margin:8px 0 0;color:#64748b;">Trials</p></article>
        <article style="grid-column:span 2;padding:18px;background:#0f172a;color:#fff;border-radius:12px;"><strong>Conversion is growing</strong><p style="margin:8px 0 0;color:#94a3b8;">Compared with the previous period</p></article>
      </div>
    `),
  },
  {
    id: "absolute-constraints",
    name: "Absolute children in Auto Layout",
    category: "layout",
    sourceTemplate: "[Layout] Absolute Positioning Layout",
    width: 760,
    reflowWidth: 520,
    height: 250,
    expected: { autoLayouts: 1, absoluteAutoChildren: 3 },
    html: frame(`
      <div style="position:relative;height:210px;display:flex;align-items:center;justify-content:center;background:#0f172a;border-radius:14px;overflow:hidden;">
        <div style="position:absolute;top:12px;left:12px;padding:6px 9px;background:#22c55e;color:#052e16;border-radius:6px;font-size:12px;font-weight:700;">TOP LEFT</div>
        <div style="position:absolute;top:12px;right:12px;width:36px;height:36px;border-radius:50%;background:#38bdf8;"></div>
        <div style="position:absolute;left:18px;right:18px;bottom:14px;height:5px;background:#334155;border-radius:99px;"></div>
        <div style="text-align:center;color:#fff;"><strong style="font-size:24px;">Flow content</strong><p style="margin:8px 0 0;color:#94a3b8;">Absolute layers stay outside the flow.</p></div>
      </div>
    `),
  },
  {
    id: "navigation-bar",
    name: "Navigation bar",
    category: "layout",
    sourceTemplate: "[Layout] Navigation Bar",
    width: 760,
    reflowWidth: 520,
    height: 120,
    expected: { autoLayouts: 3 },
    html: frame(`
      <nav style="height:80px;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;padding:0 20px;background:#fff;border:1px solid #dbe2ea;border-radius:12px;">
        <div style="display:flex;align-items:center;gap:10px;"><span style="width:28px;height:28px;border-radius:8px;background:#2563eb;"></span><strong>Orbit</strong></div>
        <div style="display:flex;align-items:center;gap:18px;color:#475569;font-size:14px;"><span>Product</span><span>Docs</span><span>Pricing</span></div>
        <button style="padding:9px 13px;border:0;border-radius:8px;background:#0f172a;color:#fff;">Sign in</button>
      </nav>
    `),
  },
  {
    id: "feature-cards",
    name: "Feature cards",
    category: "layout",
    sourceTemplate: "[Layout] Feature Section",
    width: 760,
    reflowWidth: 520,
    height: 270,
    expected: { autoLayouts: 4 },
    html: frame(`
      <div style="display:flex;gap:12px;height:230px;">
        <article style="flex:1 1 0;display:flex;flex-direction:column;gap:10px;padding:18px;background:#fff;border:1px solid #dbe2ea;border-radius:12px;"><span style="width:34px;height:34px;background:#dbeafe;border-radius:9px;"></span><strong>Capture</strong><p style="margin:0;color:#64748b;font-size:13px;line-height:18px;">Measure the rendered browser result.</p></article>
        <article style="flex:1 1 0;display:flex;flex-direction:column;gap:10px;padding:18px;background:#fff;border:1px solid #dbe2ea;border-radius:12px;"><span style="width:34px;height:34px;background:#dcfce7;border-radius:9px;"></span><strong>Convert</strong><p style="margin:0;color:#64748b;font-size:13px;line-height:18px;">Keep layers editable and responsive.</p></article>
        <article style="flex:1 1 0;display:flex;flex-direction:column;gap:10px;padding:18px;background:#fff;border:1px solid #dbe2ea;border-radius:12px;"><span style="width:34px;height:34px;background:#fce7f3;border-radius:9px;"></span><strong>Compare</strong><p style="margin:0;color:#64748b;font-size:13px;line-height:18px;">Catch visual drift with screenshots.</p></article>
      </div>
    `),
  },
  {
    id: "product-card",
    name: "Product card",
    category: "components",
    sourceTemplate: "[Components] Product Card",
    width: 760,
    reflowWidth: 520,
    height: 320,
    expected: { autoLayouts: 4 },
    html: frame(`
      <article style="width:100%;height:280px;box-sizing:border-box;display:flex;gap:20px;padding:18px;background:#fff;border:1px solid #dbe2ea;border-radius:14px;box-shadow:0 8px 24px rgba(15,23,42,.08);">
        <div style="flex:0 0 220px;background:#e0e7ff;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#4338ca;font-size:24px;font-weight:700;">IMAGE</div>
        <div style="flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:10px;">
          <span style="font-size:12px;color:#7c3aed;font-weight:700;">NEW COLLECTION</span>
          <strong style="font-size:24px;">Everyday wireless headphones</strong>
          <p style="margin:0;color:#64748b;line-height:20px;">Balanced sound, soft cushions, and a battery that lasts all week.</p>
          <div style="margin-top:auto;display:flex;align-items:center;justify-content:space-between;"><strong style="font-size:22px;">$129</strong><button style="padding:10px 14px;border:0;border-radius:8px;background:#7c3aed;color:#fff;">Add to cart</button></div>
        </div>
      </article>
    `),
  },
  {
    id: "contact-form",
    name: "Form controls",
    category: "components",
    sourceTemplate: "[Components] Form Example",
    width: 760,
    reflowWidth: 520,
    height: 330,
    expected: { autoLayouts: 4 },
    html: frame(`
      <form style="height:290px;box-sizing:border-box;display:flex;flex-direction:column;gap:14px;padding:20px;background:#fff;border:1px solid #dbe2ea;border-radius:12px;">
        <div style="display:flex;gap:12px;">
          <label style="flex:1 1 0;display:flex;flex-direction:column;gap:6px;font-size:13px;color:#475569;">First name<input value="Ada" style="box-sizing:border-box;width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;color:#172033;"></label>
          <label style="flex:1 1 0;display:flex;flex-direction:column;gap:6px;font-size:13px;color:#475569;">Last name<input value="Lovelace" style="box-sizing:border-box;width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;color:#172033;"></label>
        </div>
        <label style="display:flex;flex-direction:column;gap:6px;font-size:13px;color:#475569;">Message<textarea style="box-sizing:border-box;width:100%;height:82px;padding:10px 12px;border:1px solid #cbd5e1;border-radius:7px;resize:none;color:#172033;">Design systems should stay editable.</textarea></label>
        <button type="button" style="align-self:flex-end;padding:10px 16px;border:0;border-radius:8px;background:#2563eb;color:#fff;">Send message</button>
      </form>
    `),
  },
  {
    id: "basic-table",
    name: "Basic data table",
    category: "components",
    sourceTemplate: "[Components] Table - Basic",
    width: 760,
    reflowWidth: 520,
    height: 270,
    expected: { autoLayouts: 1 },
    html: frame(`
      <div style="height:230px;box-sizing:border-box;padding:16px;background:#fff;border:1px solid #dbe2ea;border-radius:12px;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr style="background:#f1f5f9;text-align:left;"><th style="padding:11px;border-bottom:1px solid #cbd5e1;">Name</th><th style="padding:11px;border-bottom:1px solid #cbd5e1;">Role</th><th style="padding:11px;border-bottom:1px solid #cbd5e1;text-align:right;">Status</th></tr></thead>
          <tbody>
            <tr><td style="padding:12px 11px;border-bottom:1px solid #e2e8f0;">Mina Chen</td><td style="padding:12px 11px;border-bottom:1px solid #e2e8f0;color:#64748b;">Designer</td><td style="padding:12px 11px;border-bottom:1px solid #e2e8f0;text-align:right;color:#15803d;">Active</td></tr>
            <tr><td style="padding:12px 11px;">Leo Park</td><td style="padding:12px 11px;color:#64748b;">Engineer</td><td style="padding:12px 11px;text-align:right;color:#15803d;">Active</td></tr>
          </tbody>
        </table>
      </div>
    `),
  },
  {
    id: "complex-table",
    name: "Table spans and spacing",
    category: "components",
    sourceTemplate: "[Components] Table - Complex",
    width: 760,
    reflowWidth: 520,
    height: 280,
    expected: { autoLayouts: 1 },
    html: frame(`
      <div style="height:240px;box-sizing:border-box;padding:16px;background:#fff;border-radius:12px;">
        <table style="width:100%;height:100%;border-collapse:separate;border-spacing:6px;font-size:13px;text-align:center;">
          <tr><th colspan="3" style="padding:10px;background:#1e293b;color:#fff;border-radius:7px;">Quarterly summary</th></tr>
          <tr><th rowspan="2" style="padding:10px;background:#dbeafe;color:#1d4ed8;border-radius:7px;">H1</th><td style="padding:10px;background:#f1f5f9;border-radius:7px;">Q1</td><td style="padding:10px;background:#dcfce7;border-radius:7px;">$24k</td></tr>
          <tr><td style="padding:10px;background:#f1f5f9;border-radius:7px;">Q2</td><td style="padding:10px;background:#dcfce7;border-radius:7px;">$31k</td></tr>
        </table>
      </div>
    `),
  },
  {
    id: "mixed-inline-text",
    name: "Mixed inline text",
    category: "basic",
    sourceTemplate: "[Basic] Text - Multiple Inline Spans",
    width: 760,
    reflowWidth: 520,
    height: 220,
    expected: { autoLayouts: 1 },
    html: frame(`
      <article style="height:180px;box-sizing:border-box;padding:20px;background:#fff;border:1px solid #dbe2ea;border-radius:12px;">
        <h2 style="margin:0 0 12px;font-size:24px;line-height:30px;">A <span style="color:#2563eb;">design layer</span> can stay <em style="color:#7c3aed;">editable</em>.</h2>
        <p style="margin:0;color:#475569;font-size:15px;line-height:24px;">Inline <strong style="color:#0f172a;">weights</strong>, colors, and <span style="background:#fef3c7;color:#92400e;padding:2px 5px;border-radius:4px;">highlighted phrases</span> should keep their visual rhythm when the width changes.</p>
      </article>
    `),
  },
  {
    id: "text-overflow",
    name: "Wrapping and ellipsis",
    category: "advanced",
    sourceTemplate: "[Advanced] Text - Overflow and Wrapping",
    width: 760,
    reflowWidth: 520,
    height: 220,
    expected: { autoLayouts: 2 },
    html: frame(`
      <div style="display:flex;gap:14px;height:180px;">
        <article style="flex:1 1 0;min-width:0;padding:16px;background:#fff;border-radius:12px;border:1px solid #dbe2ea;"><strong>Wrapped paragraph</strong><p style="margin:10px 0 0;font-size:14px;line-height:20px;color:#64748b;">Long text should naturally wrap inside a fill-width card instead of expanding beyond its parent.</p></article>
        <article style="flex:1 1 0;min-width:0;padding:16px;background:#fff;border-radius:12px;border:1px solid #dbe2ea;"><strong>Single line</strong><p style="margin:10px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#64748b;">A very long filename-that-needs-to-be-truncated.codesign.json</p></article>
      </div>
    `),
  },
  {
    id: "semantic-list",
    name: "Lists and semantic content",
    category: "basic",
    sourceTemplate: "🌟🌟🌟 [Basic] List Markers & Semantic Tags",
    width: 760,
    reflowWidth: 520,
    height: 280,
    expected: { autoLayouts: 2 },
    html: frame(`
      <div style="height:240px;display:flex;gap:18px;">
        <section style="flex:1 1 0;padding:16px;background:#fff;border-radius:12px;"><strong>Checklist</strong><ul style="margin:12px 0 0;padding-left:22px;color:#475569;line-height:26px;"><li>Capture browser layout</li><li>Keep semantic groups</li><li>Run visual comparison</li></ul></section>
        <blockquote style="flex:1 1 0;margin:0;padding:16px 18px;border-left:4px solid #8b5cf6;background:#f5f3ff;border-radius:0 12px 12px 0;color:#5b21b6;line-height:22px;">“Responsive structure matters more than storing a pile of coordinates.”<footer style="margin-top:12px;color:#7c3aed;font-size:13px;">— Design Studio QA</footer></blockquote>
      </div>
    `),
  },
  {
    id: "svg-vectors",
    name: "Basic SVG vectors",
    category: "advanced",
    sourceTemplate: "[Advanced] SVG Vector Test",
    width: 760,
    reflowWidth: 520,
    height: 220,
    expected: { autoLayouts: 2 },
    html: frame(`
      <div style="height:180px;display:flex;align-items:center;justify-content:space-between;padding:16px;background:#fff;border:1px solid #dbe2ea;border-radius:12px;">
        <svg width="120" height="90" viewBox="0 0 120 90"><rect x="8" y="8" width="104" height="74" rx="12" fill="#dbeafe" stroke="#2563eb" stroke-width="3"></rect><circle cx="42" cy="45" r="18" fill="#2563eb"></circle><text x="68" y="50" font-family="Arial" font-size="16" font-weight="700" fill="#1e3a8a">UI</text></svg>
        <svg width="120" height="90" viewBox="0 0 120 90"><ellipse cx="60" cy="45" rx="48" ry="30" fill="#dcfce7" stroke="#16a34a" stroke-width="3"></ellipse><circle cx="60" cy="45" r="12" fill="#16a34a"></circle></svg>
        <div style="display:flex;flex-direction:column;gap:7px;"><strong>Editable vectors</strong><span style="color:#64748b;font-size:13px;">Rect, circle, ellipse, and SVG text</span></div>
      </div>
    `),
  },
  {
    id: "borders-shadows",
    name: "Borders, radii, and shadows",
    category: "advanced",
    sourceTemplate: "[Advanced] Box Shadow Transparency",
    width: 760,
    reflowWidth: 520,
    height: 240,
    expected: { autoLayouts: 2 },
    html: frame(`
      <div style="height:200px;display:flex;align-items:center;gap:18px;">
        <article style="flex:1 1 0;padding:18px;background:#fff;border:1px solid #cbd5e1;border-radius:16px;box-shadow:0 10px 24px rgba(15,23,42,.14);"><strong>Soft elevation</strong><p style="margin:8px 0 0;color:#64748b;">One shadow remains on its owner.</p></article>
        <article style="flex:1 1 0;padding:18px;background:#0f172a;border:3px solid #38bdf8;border-radius:4px 18px 18px 18px;color:#fff;box-shadow:0 6px 14px rgba(14,165,233,.22);"><strong>Accent border</strong><p style="margin:8px 0 0;color:#bae6fd;">Rounded container with contrast.</p></article>
      </div>
    `),
  },
  {
    id: "nested-relative",
    name: "Nested relative Flex",
    category: "advanced",
    sourceTemplate: "[Advanced] Relative + Flex Mixed Layout",
    width: 760,
    reflowWidth: 520,
    height: 270,
    expected: { autoLayouts: 4 },
    html: frame(`
      <div style="position:relative;height:230px;display:flex;gap:16px;padding:18px;box-sizing:border-box;background:#fff;border:1px solid #dbe2ea;border-radius:12px;">
        <aside style="flex:0 0 150px;display:flex;flex-direction:column;gap:10px;padding:12px;background:#f1f5f9;border-radius:9px;"><strong>Layers</strong><span style="padding:7px;background:#dbeafe;color:#1d4ed8;border-radius:6px;">Header</span><span style="padding:7px;color:#64748b;">Content</span></aside>
        <main style="flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:10px;"><strong>Canvas</strong><div style="position:relative;flex:1 1 0;background:#eef2ff;border-radius:9px;"><span style="position:absolute;right:10px;top:10px;padding:5px 8px;background:#4f46e5;color:#fff;border-radius:5px;font-size:12px;">Overlay</span></div></main>
      </div>
    `),
  },
  {
    id: "dashboard-widget",
    name: "Dashboard widget",
    category: "advanced",
    sourceTemplate: "[Advanced] Dashboard Widget",
    width: 760,
    reflowWidth: 520,
    height: 300,
    expected: { autoLayouts: 4, gridLayouts: 1 },
    html: frame(`
      <section style="height:260px;display:flex;flex-direction:column;gap:14px;">
        <header style="display:flex;align-items:center;justify-content:space-between;"><div><strong style="font-size:20px;">Workspace overview</strong><p style="margin:4px 0 0;color:#64748b;font-size:13px;">Last 30 days</p></div><button style="padding:8px 11px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;">Export</button></header>
        <div style="flex:1 1 0;display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">
          <article style="padding:16px;background:#fff;border-radius:12px;border:1px solid #dbe2ea;"><span style="color:#64748b;font-size:12px;">FILES</span><strong style="display:block;margin-top:10px;font-size:28px;">128</strong></article>
          <article style="padding:16px;background:#fff;border-radius:12px;border:1px solid #dbe2ea;"><span style="color:#64748b;font-size:12px;">COMPONENTS</span><strong style="display:block;margin-top:10px;font-size:28px;">42</strong></article>
          <article style="padding:16px;background:#fff;border-radius:12px;border:1px solid #dbe2ea;"><span style="color:#64748b;font-size:12px;">WARNINGS</span><strong style="display:block;margin-top:10px;font-size:28px;color:#d97706;">3</strong></article>
        </div>
      </section>
    `),
  },
  {
    id: "baseline-alignment",
    name: "Baseline alignment",
    category: "layout",
    sourceTemplate: "[Layout] Baseline Alignment",
    width: 760,
    reflowWidth: 520,
    height: 190,
    expected: { autoLayouts: 1 },
    html: frame(`
      <div style="height:150px;display:flex;align-items:baseline;gap:14px;padding:18px;box-sizing:border-box;background:#fff;border-radius:12px;border:1px solid #dbe2ea;">
        <span style="font-size:12px;padding:7px 10px;background:#e0e7ff;color:#4338ca;border-radius:6px;">Small label</span>
        <strong style="font-size:34px;line-height:40px;color:#1e1b4b;">84</strong>
        <span style="font-size:18px;color:#6366f1;">points</span>
        <span style="font-size:13px;color:#64748b;">aligned on one baseline</span>
      </div>
    `),
  },
];

export const html2figmaCatalog = {
  sourceRepository: "https://github.com/cjhyy/html2figma",
  sourceFile: "packages/test/web/templates.ts",
  sourceRevision: "ea78385c7ab8cb251d5f0cc10213dea4a93e9a7c",
  sourceTemplateCount: 64,
  sourceCategoryCounts: {
    basic: 8,
    components: 9,
    layout: 19,
    advanced: 28,
  },
};

export function getHtml2figmaCase(id) {
  return html2figmaCases.find((entry) => entry.id === id);
}
