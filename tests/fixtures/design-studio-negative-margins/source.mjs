export const css = '#fixture{padding:20px;height:300px;background:#e2e8f0}#row{display:flex;align-items:flex-start;justify-content:flex-start;gap:10px;margin-left:-15px;margin-right:-15px}#row>div{flex:1;height:50px;background:#2563eb}#after{height:20px;background:#f97316}';
export const html = '<main id="fixture"><section id="row"><div></div><div></div></section><div id="after"></div></main>';

export const negativeMarginFixtures = [
    { id: "symmetric", html, css },
    { id: "asymmetric", html, css: css.replace('margin-left:-15px;margin-right:-15px', 'margin-left:-12px;margin-right:-4px') },
    { id: "small-margins", html, css: css.replace('margin-left:-15px;margin-right:-15px', 'margin-left:-2px;margin-right:-1px').replace('gap:10px','gap:11px') },
    { id: "left-only", html, css: css.replace('margin-right:-15px', 'margin-right:0').replace('gap:10px','gap:11px') },
    { id: "maximum", html, css: css + '#row{max-width:480px}' },
    { id: "minimum-overflow", html, css: css + '#row{min-width:480px}' },
    { id: "content-box-maximum", html, css: css + '#row{box-sizing:content-box;padding:10px;max-width:460px}' },
    { id: "grid-row", html, css: css + '#row{display:grid;grid-template-columns:1fr 1fr;justify-content:start;align-content:start;align-items:start}' },
    { id: "wrapped-row", html: html.replace('<div></div><div></div>', '<div></div><div></div><div></div>'), css: css + '#row{flex-wrap:wrap}#row>div{flex:none;width:180px;height:40px}' },
    { id: "clipped", html, css: css.replace('padding:20px', 'padding:5px') + '#fixture{overflow:hidden}' },
    { id: "transparent-border", html, css: css + '#fixture{border:2px solid transparent}' },
    { id: "editable-copy", html: '<main id="fixture"><section id="row"><p id="copy">Editable ordinary text wraps across the negative horizontal margins when the outer viewport becomes narrower.</p></section><div id="after"></div></main>', css: css + '#row{display:block;padding:10px}p{margin:0;font:20px/24px Arial}' },
  ];

// Known DPR1 CSS background edge snapping differs from antialiased SVG edges.
// Preserve this exact fractional geometry and report the strict failure.
export const negativeMarginResidualFixtures = [{ id: "fractional-paint-boundary", html,
  css: css.replace("margin-left:-15px;margin-right:-15px", "margin-left:-2px;margin-right:-1px") }];
