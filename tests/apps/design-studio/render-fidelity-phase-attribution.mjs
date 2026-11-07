// Offline evidence classification only. Raw geometry/pixel failures stay intact.
export function classifyHtmlDualShadowPhase({ node, scale, tile, measurements, exportProof }) {
  if (!(scale > 0) || !tile || ![tile.x,tile.y].every(Number.isFinite) ||
      !(node.strokeWidth > 0) || node.rotation || ["inside","outside"].includes(node.strokeAlign) ||
      !/^(center|legacy)-shadow-v1$/.test(exportProof?.marker ?? "") ||
      !/^0 0 0 ([\d.]+px) (#[a-f\d]{6}|rgba\([^)]*\)),inset 0 0 0 \1 \2(?:,|$)/i.test(exportProof?.boxShadow ?? "")) return null;
  const edges = [node.x-tile.x,node.y-tile.y,node.x+node.width-tile.x,node.y+node.height-tile.y].map(x=>x*scale);
  if (!edges.every(Number.isFinite) || !edges.some(x=>Math.abs(x-Math.round(x))>1e-6)) return null;
  const sets = ["gpu","svg","html"].map(route=>measurements[route]?.strokeEdges);
  if (sets.some(set=>!set?.measurable || !Array.isArray(set.probes) || set.probes.length<12)) return null;
  const [gpu,svg,html] = sets.map(set=>set.probes);
  if (gpu.length!==svg.length || gpu.length!==html.length) return null;
  const table=[];
  for (let i=0;i<gpu.length;i++) {
    const g=gpu[i],s=svg[i],h=html[i];
    if (s.edge!==g.edge || h.edge!==g.edge || s.fraction!==g.fraction || h.fraction!==g.fraction) return null;
    for (const field of ["centroid","width"]) {
      if (![g[field],s[field],h[field]].every(Number.isFinite)) return null;
      const gpuSvg=Math.abs(g[field]-s[field]),htmlGpu=Math.abs(h[field]-g[field]),htmlSvg=Math.abs(h[field]-s[field]);
      if (gpuSvg>.1) return null;
      table.push({edge:g.edge,fraction:g.fraction,field,gpu:g[field],svg:s[field],html:h[field],gpuSvg,htmlGpu,htmlSvg});
    }
  }
  // The same probe must distinguish HTML from both agreeing independent routes.
  if (!table.some(p=>p.htmlGpu>.1 && p.htmlSvg>.1)) return null;
  return {kind:"HTML_DUAL_SHADOW_PHASE",pass:false,rawFailuresRetained:true,
    fractionalDeviceEdges:edges.filter(x=>Math.abs(x-Math.round(x))>1e-6),exportProof,
    maximumGpuSvg:Math.max(...table.map(p=>p.gpuSvg)),maximumHtmlGpu:Math.max(...table.map(p=>p.htmlGpu)),
    maximumHtmlSvg:Math.max(...table.map(p=>p.htmlSvg)),gpuSvgLimitDevicePx:.1,probes:table,
    scope:"only measured centered dual-shadow stroke phase; unrelated geometry/shadow/text failures remain"};
}
