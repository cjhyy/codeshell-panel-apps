/* BEGIN GENERATED GRID RUNTIME */
"use strict";var CodeShellFigmaGrid=(()=>{var y=Object.defineProperty;var R=Object.getOwnPropertyDescriptor;var E=Object.getOwnPropertyNames;var C=Object.prototype.hasOwnProperty;var z=(i,r)=>{for(var t in r)y(i,t,{get:r[t],enumerable:!0})},v=(i,r,t,n)=>{if(r&&typeof r=="object"||typeof r=="function")for(let a of E(r))!C.call(i,a)&&a!==t&&y(i,a,{get:()=>r[a],enumerable:!(n=R(r,a))||n.enumerable});return i};var M=i=>v(y({},"__esModule",{value:!0}),i);var $={};z($,{configureNativeGrid:()=>S,finishNativeGrid:()=>I,nativeGridPlan:()=>m,positionNativeGridChild:()=>G,validateGridFields:()=>A});var N=Object.freeze(["gridRows","gridColumnSizes","gridRowSizes","gridItemsPositioning","gridAutoTracks"]),b=Object.freeze(["gridRowAnchorIndex","gridColumnAnchorIndex","gridChildHorizontalAlign","gridChildVerticalAlign"]),h=(i,r,t)=>Number.isInteger(i)&&i>=r&&i<=t;function P(i){if(!Array.isArray(i)||!i.length||i.length>24)throw new Error("Grid tracks 必须为 1–24 项");return i.map(r=>{if(!r||typeof r!="object"||Array.isArray(r)||Object.keys(r).some(n=>!["type","value"].includes(n))||!["fixed","flex","hug"].includes(r.type))throw new Error("Grid track 类型无效");if(r.type==="hug"){if(r.value!==void 0)throw new Error("HUG track 不接受 value");return{type:"hug"}}let t=r.value??(r.type==="flex"?1:void 0);if(!Number.isFinite(t)||t<0||r.type==="flex"&&t===0||t>2e4)throw new Error("Grid track value 超出范围");return{type:r.type,value:t}})}function A(i,r=!1){for(let t of["gridRows","gridColumns","gridColumnSpan","gridRowSpan"])if(i[t]!==void 0&&!h(i[t],1,24))throw new Error(`${t} 必须为 1–24`);for(let t of["gridRowAnchorIndex","gridColumnAnchorIndex"])if(i[t]!==void 0&&!h(i[t],0,9999))throw new Error(`${t} 必须为 0–9999`);if(i.gridRowAnchorIndex===void 0!=(i.gridColumnAnchorIndex===void 0))throw new Error("Grid manual anchors 必须同时包含行和列");for(let t of["gridChildHorizontalAlign","gridChildVerticalAlign"])if(i[t]!==void 0&&!["auto","start","center","end"].includes(i[t]))throw new Error(`${t} 无效`);if(!r&&N.some(t=>i[t]!==void 0))throw new Error("Grid container 字段只适用于容器");if(i.gridItemsPositioning!==void 0&&!["manual","row-auto-flow"].includes(i.gridItemsPositioning))throw new Error("gridItemsPositioning 无效");if(i.gridAutoTracks!==void 0&&!["none","rows"].includes(i.gridAutoTracks))throw new Error("gridAutoTracks 无效");for(let[t,n]of[["gridColumnSizes",i.gridColumns],["gridRowSizes",i.gridRows]])if(i[t]!==void 0){let a=P(i[t]);if(n===void 0||a.length!==n)throw new Error(`${t} 数量与 grid count 不一致`)}if(r&&i.layout==="grid"&&i.gridItemsPositioning==="manual"&&Array.isArray(i.children)){let t=x(i.children,i.gridColumns??1,i);if(i.gridAutoTracks!=="rows"&&i.gridRows!==void 0&&t.rowCount>i.gridRows)throw new Error("Grid manual anchors/spans 超出 gridRows")}}function x(i,r,t={}){if(!h(r,1,24))throw new Error("Grid columns 必须为 1–24");let n=new Set,a=[],l=0,s=(o,e,g,w)=>{if(e+w>r)return!1;for(let f=o;f<o+g;f++)for(let d=e;d<e+w;d++)if(n.has(f*r+d))return!1;return!0};for(let o of i){if(!o||typeof o!="object")throw new Error("Grid 子项无效");for(let u of["gridColumnSpan","gridRowSpan"])if(o[u]!==void 0&&!h(o[u],1,24))throw new Error(`${u} 必须为 1–24`);for(let u of["gridRowAnchorIndex","gridColumnAnchorIndex"])if(o[u]!==void 0&&!h(o[u],0,9999))throw new Error(`${u} 必须为 0–9999`);if(o.visible===!1||o.layoutPositioning==="absolute")continue;let e=Math.min(r,Math.max(1,o.gridColumnSpan??1)),g=Math.max(1,o.gridRowSpan??1),w=t.gridItemsPositioning==="manual"&&Number.isInteger(o.gridRowAnchorIndex)&&Number.isInteger(o.gridColumnAnchorIndex),f=t.gridItemsPositioning==="row-auto-flow"?l:0,d=w?o.gridRowAnchorIndex:Math.floor(f/r),c=w?o.gridColumnAnchorIndex:f%r;if(w&&!s(d,c,g,e))throw new Error(`${o.name??o.id}: Grid placement 重叠或超出列范围`);for(;!w&&!s(d,c,g,e);)f++,d=Math.floor(f/r),c=f%r;for(let u=d;u<d+g;u++)for(let p=c;p<c+e;p++)n.add(u*r+p);l=d*r+c+e,a.push({child:o,row:d,column:c,rowSpan:g,columnSpan:e})}return{placements:a,rowCount:Math.max(0,...a.map(o=>o.row+o.rowSpan))}}function T(i,r){return i.gridAutoTracks==="rows"?Math.max(1,r):Math.max(1,i.gridRows??r,r)}function k(i,r){return i.gridRowSizes?Array.from({length:r},(t,n)=>i.gridRowSizes[n]??{type:"hug"}):void 0}function m(i){A(i,!0);let r=i.gridColumns??1,t=x(i.children??[],r,i),n=T(i,t.rowCount);if(n>24)throw new Error("原生 Grid 互换最多保留 24 行；请拆分网格");if(t.rowCount>n)throw new Error("Grid children 超出 gridRows；请增加行数");if(i.gridAutoTracks==="rows"&&i.gridItemsPositioning==="manual"){let s=new Set;for(let o of t.placements)for(let e=o.row;e<o.row+o.rowSpan;e++)s.add(e);if(s.size&&s.size!==n)throw new Error("自动 Grid 行中的空白手动行不能保留；请移除空行或关闭自动行")}let a=i.gridColumnSizes??Array.from({length:r},()=>({type:"flex",value:1})),l=k(i,n)??Array.from({length:n},()=>({type:"hug"}));for(let[s,o]of[["Horizontal",a],["Vertical",l]]){for(let e of t.placements){let g=e.child,w=g.layoutAlignSelf==="stretch"||(!g.layoutAlignSelf||g.layoutAlignSelf==="auto")&&i.alignItems==="stretch",f=s==="Horizontal"?e.column:e.row,d=s==="Horizontal"?e.columnSpan:e.rowSpan;if((g[`layoutSizing${s}`]==="fill"||w)&&o.slice(f,f+d).some(c=>c.type==="hug"))throw new Error(`Grid ${s}: FILL 子项与 HUG track 的内在尺寸循环尚不能保留；请改为固定 track 或 HUG/固定子项`)}if(i[`layoutSizing${s}`]==="hug"&&o.some(e=>e.type==="flex"))throw new Error(`Grid ${s}: HUG 容器不能包含 FLEX track；请改为 FIXED/HUG track 或固定容器尺寸`)}if(i.layoutReverse||i.layoutWrap&&i.layoutWrap!=="none"||i.justifyContent!=="start"||i.alignContent&&i.alignContent!=="start")throw new Error("Grid 反向/换行/track 分布不能对应 Figma；请使用 start 分布");return{columns:r,rows:n,columnSizes:a,rowSizes:l,...t}}function S(i,r){let t=m(r);for(let n of["gridColumnCount","gridRowCount","gridRowSizes","gridColumnSizes","gridAutoTracks","gridItemsPositioning"])if(!(n in i))throw new Error(`${r.name}: 当前 Figma 不支持原生 GRID API (${n})，请更新 Figma 后重试`);i.layoutMode="GRID",i.layoutSizingHorizontal="FIXED",i.layoutSizingVertical="FIXED",i.gridAutoTracks="NONE",i.gridItemsPositioning="MANUAL",i.gridColumnCount=t.columns,i.gridRowCount=t.rows,i.gridColumnGap=r.columnGap??r.gap,i.gridRowGap=r.rowGap??r.gap;for(let n of["Top","Right","Bottom","Left"])i[`padding${n}`]=r[`padding${n}`]??r.padding;for(let[n,a]of[["gridColumnSizes",t.columnSizes],["gridRowSizes",t.rowSizes]]){let l=i[n];if(l.length!==a.length)throw new Error(`${r.name}: Figma Grid track 数量不匹配`);a.forEach((s,o)=>{l[o].type=s.type.toUpperCase(),s.type!=="hug"&&(l[o].value=s.value??1)})}return t}function G(i,r,t,n){if(i.layoutPositioning=r.layoutPositioning==="absolute"?"ABSOLUTE":"AUTO",r.layoutPositioning==="absolute")return;let a=r.visible===!1,l=a?{row:n.rows,column:0,rowSpan:r.gridRowSpan??1,columnSpan:Math.min(n.columns,r.gridColumnSpan??1)}:n.placements.find(s=>s.child===r);if(typeof i.setGridChildPosition!="function")throw new Error("当前 Figma 不支持 Grid 子项位置；请更新后重试");a&&(i.parent.gridRowCount=Math.max(i.parent.gridRowCount,l.row+l.rowSpan),i.visible=!0),i.setGridChildPosition(l.row,l.column),i.gridColumnSpan=l.columnSpan,i.gridRowSpan=l.rowSpan,a&&(i.visible=!1);for(let s of["Horizontal","Vertical"]){let o=`gridChild${s}Align`,e=r[o]??(r.layoutAlignSelf&&r.layoutAlignSelf!=="auto"?r.layoutAlignSelf:t.alignItems);i[o]={start:"MIN",center:"CENTER",end:"MAX",stretch:"MIN",auto:"AUTO"}[e]??"MIN"}}function I(i,r){i.gridRowCount=m(r).rows,i.gridItemsPositioning=r.gridItemsPositioning==="row-auto-flow"?"ROW_AUTO_FLOW":"MANUAL",i.gridAutoTracks=r.gridAutoTracks==="rows"?"ROWS":"NONE"}return M($);})();
/* END GENERATED GRID RUNTIME */
/* BEGIN GENERATED PAINT RUNTIME */
"use strict";var CodeShellFigmaPaint=(()=>{var S=Object.defineProperty;var T=Object.getOwnPropertyDescriptor;var F=Object.getOwnPropertyNames;var z=Object.prototype.hasOwnProperty;var _=(r,e)=>{for(var t in e)S(r,t,{get:e[t],enumerable:!0})},B=(r,e,t,o)=>{if(e&&typeof e=="object"||typeof e=="function")for(let n of F(e))!z.call(r,n)&&n!==t&&S(r,n,{get:()=>e[n],enumerable:!(o=T(e,n))||o.enumerable});return r};var U=r=>B(S({},"__esModule",{value:!0}),r);var Q={};_(Q,{cssLinearNeedsNativeWarning:()=>b,cssLinearSourceSnapshot:()=>G,designPaintsToFigma:()=>R,figmaFillPaints:()=>j,normalizeCssLinearSource:()=>I,normalizeDesignPaints:()=>d});var W=r=>r&&typeof r=="object"&&!Array.isArray(r),x=r=>typeof r=="number"&&Number.isFinite(r),L=(r,e)=>{if(!W(r)||Object.keys(r).some(t=>!e.includes(t)))throw new Error("CSS 渐变几何包含未知字段")};function C(r,e){L(r,["direction","positions","sourceOnly"]);let t=r.direction;L(t,["angle","corner"]);let o;if(Object.keys(t).length!==1)throw new Error("CSS 渐变方向必须唯一");if(t.angle!==void 0){if(!x(t.angle)||t.angle<0||t.angle>=360)throw new Error("CSS 渐变角度必须为 0–360（不含 360）");o={angle:t.angle}}else{if(!Array.isArray(t.corner)||t.corner.length!==2||!Array.from(t.corner).every(s=>s===-1||s===1))throw new Error("CSS 渐变角方向必须为两个 ±1");o={corner:[...t.corner]}}if(r.sourceOnly!==void 0&&r.sourceOnly!==!0)throw new Error("CSS 渐变 sourceOnly 只能为 true");if(!Array.isArray(r.positions)||r.positions.length<2||r.positions.length>16||!r.sourceOnly&&r.positions.length!==e.length)throw new Error("CSS 渐变位置必须为 2–16 项且与可编辑色标对应");let n=Array.from(r.positions,(s,i)=>{if(s===null)return null;if(s==="previous"){if(!i||r.positions[i-1]==="previous"||!r.sourceOnly&&(e[i].opacity!==0||e[i-1].opacity!==0))throw new Error("CSS 透明色标重复位置无效");return"previous"}if(L(s,["unit","value"]),!["px","percent"].includes(s.unit)||!x(s.value)||Math.abs(s.value)>2e4)throw new Error("CSS 色标只支持有界 px/percent 坐标");return{unit:s.unit,value:s.value}});if(n.filter(s=>s!=="previous").length<2)throw new Error("CSS 渐变至少需要两个原始色标");return{direction:o,positions:n,...r.sourceOnly?{sourceOnly:!0}:{}}}function V(r,e,t){if(r.corner){let s=Math.hypot(e,t);return{x:r.corner[0]*t/s,y:r.corner[1]*e/s}}let o=r.angle*Math.PI/180,n=s=>Math.abs(s)<1e-12?0:Math.abs(Math.abs(s)-1)<1e-12?Math.sign(s):s;return{x:n(Math.sin(o)),y:n(-Math.cos(o))}}function N(r,e,t){var A,M;let o=r.cssLinear;if(!o||o.sourceOnly||!(e>0&&t>0)||![e,t].every(x))return r;let n=V(o.direction,e,t),s=Math.abs(e*n.x)+Math.abs(t*n.y),i=o.positions.flatMap((a,u)=>a==="previous"?[]:[{index:u,value:a===null?null:a.value/(a.unit==="percent"?100:s)}]);(A=i[0]).value??(A.value=0),(M=i.at(-1)).value??(M.value=1);let c=-1/0;for(let a of i)a.value!==null&&(a.value=Math.max(c,a.value),c=a.value);for(let a=0;a<i.length-1;a++){let u=a+1;for(;i[u].value===null;)u++;for(let f=a+1;f<u;f++)i[f].value=i[a].value+(i[u].value-i[a].value)*(f-a)/(u-a);a=u-1}let l=[];for(let a of i)l[a.index]=a.value;o.positions.forEach((a,u)=>{a==="previous"&&(l[u]=l[u-1])});let h=Math.min(0,l[0]),y=Math.max(1,l.at(-1)),w=(a,u=0)=>({x:.5+((a-.5)*s*n.x-u*s*n.y)/e,y:.5+((a-.5)*s*n.y+u*s*n.x)/t});return{...r,handles:[w(h),w(y),w(h,(y-h)/2)],stops:r.stops.map((a,u)=>({...a,position:(l[u]-h)/(y-h)}))}}function b(r){let e=r.cssLinear;return!!(e&&(e.sourceOnly||e.direction.angle!==void 0&&Math.abs(e.direction.angle%90)>1e-9||e.positions.some(t=>t&&t.unit==="px"&&t.value!==0)))}function D(r,e){if(!r.sourceOnly)for(let t=1;t<e.length;t++){let o=e[t-1],n=e[t],s=r.positions[t-1],i=r.positions[t];if(!(i==="previous"||s&&i&&typeof s=="object"&&typeof i=="object"&&s.unit===i.unit&&s.value>=i.value)&&o.opacity!==n.opacity&&o.color!==n.color)throw new Error("不同颜色且透明度变化的 CSS 预乘插值无法由当前原生渐变无损表示")}}var H=r=>r!==null&&typeof r=="object"&&!Array.isArray(r),E=r=>typeof r=="string"&&/^#[a-f\d]{6}$/iu.test(r),p=r=>typeof r=="number"&&Number.isFinite(r),g=r=>Math.max(0,Math.min(1,r));var v=r=>`#${[r.r,r.g,r.b].map(e=>Math.round(g(e)*255).toString(16).padStart(2,"0")).join("")}`,P=r=>[1,3,5].map(e=>parseInt(r.slice(e,e+2),16)/255);function m(r,e){if(!H(r)||Object.keys(r).some(t=>!e.includes(t)))throw new Error("绘制包含未知字段")}function $(r){if(!p(r)||r<0||r>1)throw new Error("绘制透明度必须在 0–1 之间");return r}function J(r){let[e,t,o]=r;return[[t.x-e.x,2*(o.x-e.x),2*e.x-o.x],[t.y-e.y,2*(o.y-e.y),2*e.y-o.y]]}function O(r){let[[e,t,o],[n,s,i]]=J(r),c=e*s-t*n;if(Math.abs(c)<1e-8)throw new Error("线性渐变坐标不可逆");return[[s/c,-t/c,(t*i-s*o)/c],[-n/c,e/c,(n*o-e*i)/c]]}function d(r){if(!Array.isArray(r)||!r.length||r.length>8)throw new Error("填充绘制必须为 1–8 层");return r.map(e=>{m(e,e?.type==="SOLID"?["type","color","opacity"]:["type","opacity","handles","stops","cssLinear"]);let t=$(e.opacity);if(e.type==="SOLID"){if(!E(e.color))throw new Error("纯色绘制必须是六位十六进制颜色");return{type:"SOLID",color:e.color.toLowerCase(),opacity:t}}if(e.type!=="GRADIENT_LINEAR"||!Array.isArray(e.handles)||e.handles.length!==3||!Array.isArray(e.stops)||e.stops.length<2||e.stops.length>16)throw new Error("仅支持有界纯色/线性渐变；渐变必须有三个控制点与 2–16 个色标");let o=e.handles.map(i=>{if(m(i,["x","y"]),![i.x,i.y].every(c=>p(c)&&Math.abs(c)<=100))throw new Error("渐变控制点超出范围");return{x:i.x,y:i.y}});O(o);let n=e.stops.map(i=>{if(m(i,["position","color","opacity"]),!E(i.color))throw new Error("渐变色标颜色无效");return{position:$(i.position),color:i.color.toLowerCase(),opacity:$(i.opacity)}});if(n.some((i,c)=>c&&i.position<n[c-1].position))throw new Error("渐变色标必须按位置排序");let s=e.cssLinear===void 0?void 0:C(e.cssLinear,n);return s&&D(s,n),{type:"GRADIENT_LINEAR",opacity:t,handles:o,stops:n,...s?{cssLinear:s}:{}}})}function q(r){if(!Array.isArray(r)||r.length!==2||!r.every(h=>Array.isArray(h)&&h.length===3&&h.every(p)))throw new Error("渐变矩阵无效");let[[e,t,o],[n,s,i]]=r,c=e*s-t*n;if(Math.abs(c)<1e-8)throw new Error("渐变矩阵不可逆");let l=(h,y)=>({x:(s*(h-o)-t*(y-i))/c,y:(-n*(h-o)+e*(y-i))/c});return[l(0,.5),l(1,.5),l(0,1)]}function j(r,e=()=>{}){if(!Array.isArray(r))return null;let t=r.filter(o=>o?.visible!==!1);if(!t.length||t.length>8||t.some(o=>!["SOLID","GRADIENT_LINEAR"].includes(o?.type)))return null;try{let o=t.map(n=>{if(n.blendMode&&n.blendMode!=="NORMAL")throw new Error("非 NORMAL 混合绘制需本地预览资源");let s=p(n.opacity)?g(n.opacity):1;if(n.type==="SOLID")return{type:"SOLID",color:v(n.color),opacity:s*(p(n.color?.a)?g(n.color.a):1)};let i=n.gradientStops?.map(l=>({position:l.position,color:v(l.color),opacity:p(l.color?.a)?g(l.color.a):1})),c=n.gradientHandlePositions??q(n.gradientTransform);try{O(c)}catch{if(!i?.length)throw new Error("缺少渐变色标");e("退化线性渐变没有可逆控制点；按零长度渐变的末色标保留，不猜测方向。");let l=i.at(-1);return{type:"SOLID",color:l.color,opacity:s*l.opacity}}return{type:"GRADIENT_LINEAR",opacity:s,handles:c,stops:i}});return d(o)}catch(o){return e(`绘制无法无损转换：${o.message}`),null}}function K(r){let e=r.fillPaints??(E(r.fill)?[{type:"SOLID",color:r.fill,opacity:1}]:[]);return e.some(t=>t.cssLinear&&!t.cssLinear.sourceOnly)?e.map(t=>t.cssLinear?N(t,r.width,r.height):t):e}function R(r){let e=K(r);if(e.some(t=>t.cssLinear&&!t.cssLinear.sourceOnly&&t.handles.some(o=>Math.abs(o.x)>100||Math.abs(o.y)>100)))throw new Error("当前 CSS 渐变尺寸/像素色标产生超出 ±100 的原生控制点；请调整尺寸或色标后再导出。原始 CSS 意图仍可在 Design Studio 中编辑。");return e.map(t=>t.type==="SOLID"?{type:"SOLID",color:Object.fromEntries(["r","g","b"].map((o,n)=>[o,P(t.color)[n]])),opacity:t.opacity}:{type:"GRADIENT_LINEAR",opacity:t.opacity,gradientTransform:O(t.handles),gradientStops:t.stops.map(o=>({position:o.position,color:{...Object.fromEntries(["r","g","b"].map((n,s)=>[n,P(o.color)[s]])),a:o.opacity}}))})}function I(r){if(m(r,["version","width","height","paints"]),r.version!==1||![r.width,r.height].every(o=>p(o)&&o>=1&&o<=2e4))throw new Error("CSS 渐变来源尺寸无效");let e=d(r.paints);if(!e.some(o=>o.cssLinear))throw new Error("CSS 渐变来源缺少几何意图");let t={version:1,width:r.width,height:r.height,paints:e};if(JSON.stringify(t).length>32768)throw new Error("CSS 渐变来源超过 32 KiB");return t}function G(r){return r.fillPaints?.some(e=>e.cssLinear)?I({version:1,width:r.width,height:r.height,paints:r.fillPaints}):null}return U(Q);})();
/* END GENERATED PAINT RUNTIME */
/* BEGIN GENERATED TEXT RUNTIME */
"use strict";var CodeShellFigmaText=(()=>{var s=Object.defineProperty;var g=Object.getOwnPropertyDescriptor;var c=Object.getOwnPropertyNames;var u=Object.prototype.hasOwnProperty;var p=(t,e)=>{for(var i in e)s(t,i,{get:e[i],enumerable:!0})},x=(t,e,i,n)=>{if(e&&typeof e=="object"||typeof e=="function")for(let r of c(e))!u.call(t,r)&&r!==i&&s(t,r,{get:()=>e[r],enumerable:!(n=g(e,r))||n.enumerable});return t};var y=t=>x(s({},"__esModule",{value:!0}),t);var w={};p(w,{nativeTextContent:()=>o,nativeTextPlan:()=>h});function l(t){return!!(t&&typeof t=="object"&&!Array.isArray(t)&&Object.keys(t).every(e=>["version","signature","sourceSignature","lineWidths","lineInkBounds","height","fontAvailable"].includes(e))&&t.version===1&&typeof t.signature=="string"&&t.signature.length<=8500&&(t.sourceSignature===void 0||typeof t.sourceSignature=="string"&&t.sourceSignature.length<=8500)&&Array.isArray(t.lineWidths)&&t.lineWidths.length>=1&&t.lineWidths.length<=4001&&t.lineWidths.every(e=>Number.isFinite(e)&&e>=0&&e<=1e6)&&Array.isArray(t.lineInkBounds)&&t.lineInkBounds.length===t.lineWidths.length&&t.lineInkBounds.every(e=>e&&typeof e=="object"&&!Array.isArray(e)&&Object.keys(e).length===4&&["x","y","width","height"].every(i=>Number.isFinite(e[i])&&Math.abs(e[i])<=1e6)&&e.width>=0&&e.height>=0)&&Number.isFinite(t.height)&&t.height>=0&&t.height<=1e6&&typeof t.fontAvailable=="boolean")}var f=t=>{try{let e=JSON.parse(t);return Array.isArray(e)&&e.length===8&&typeof e[0]=="string"?e[0]:void 0}catch{return}};function d(t,e){let i=0;for(let n of t)if(e.startsWith(n,i))i+=n.length;else if(n!==`
`)return!1;return i===e.length}function o(t,e){let i=t.text??"",n=t.textSource;if(typeof n!="string"||i===n)return i;if(l(t.textMetrics)){let r=f(t.textMetrics.signature),a=f(t.textMetrics.sourceSignature);if(i===r)return n;if(r!==void 0&&(a===void 0||n===a))return i}return e&&i===e.text&&n!==e.textSource||t.textFlow==="wrap"&&d(i,n)||t.textOverflow==="ellipsis"&&i.endsWith("…")&&n.startsWith(i.slice(0,-1).trimEnd())?n:i}function h(t,e){return{characters:o(t,e),autoResize:t.layoutSizingHorizontal==="hug"?"WIDTH_AND_HEIGHT":t.layoutSizingVertical==="hug"?"HEIGHT":"NONE",truncation:t.textOverflow==="ellipsis"?"ENDING":"DISABLED",maxLines:t.textOverflow==="ellipsis"?1:null}}return y(w);})();
/* END GENERATED TEXT RUNTIME */
/* Local Figma bridge. Original-node writes require a reviewed, conflict-checked patch. */
(() => {
  const MAX_BYTES = 16 * 1024 * 1024;
  const MAX_TOTAL = 50_000;
  const containers = new Set(["frame", "group", "component"]);
  const supported = new Set([
    "frame",
    "group",
    "component",
    "rectangle",
    "ellipse",
    "text",
    "image",
  ]);
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const color = (value) =>
    value === "transparent" || (typeof value === "string" && /^#[a-f0-9]{6}$/iu.test(value));
  const string = (value, max, empty = false) =>
    typeof value === "string" &&
    value.length <= max &&
    (empty || value.trim().length > 0) &&
    !/[\u0000-\u001f\u007f]/u.test(value);
  const utf8Length = (value) => {
    let length = 0;
    for (const character of value) {
      const point = character.codePointAt(0);
      length += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    }
    return length;
  };
  let busy = false;
  figma.showUI(__html__, { width: 420, height: 520, themeColors: true });
  const post = (message) => figma.ui.postMessage(message);
  const MAX_ASSET = 8 * 1024 * 1024,
    MAX_ASSETS_TOTAL = 12 * 1024 * 1024;
  const encode64 = (bytes) => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let value = "";
    for (let index = 0; index < bytes.length; index += 3) {
      const a = bytes[index],
        b = bytes[index + 1],
        c = bytes[index + 2];
      value +=
        alphabet[a >> 2] +
        alphabet[((a & 3) << 4) | ((b ?? 0) >> 4)] +
        (b === undefined ? "=" : alphabet[((b & 15) << 2) | ((c ?? 0) >> 6)]) +
        (c === undefined ? "=" : alphabet[c & 63]);
    }
    return value;
  };
  const decode64 = (value) => {
    if (
      typeof value !== "string" ||
      !value.length ||
      value.length > Math.ceil(MAX_ASSET / 3) * 4 ||
      value.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)
    )
      throw new Error("图片 Base64 无效或超过 8 MiB。");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
      length = (value.length * 3) / 4 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0),
      bytes = new Uint8Array(length);
    let offset = 0;
    for (let index = 0; index < value.length; index += 4) {
      const bits =
        (alphabet.indexOf(value[index]) << 18) |
        (alphabet.indexOf(value[index + 1]) << 12) |
        (Math.max(0, alphabet.indexOf(value[index + 2])) << 6) |
        Math.max(0, alphabet.indexOf(value[index + 3]));
      if (offset < length) bytes[offset++] = (bits >> 16) & 255;
      if (offset < length) bytes[offset++] = (bits >> 8) & 255;
      if (offset < length) bytes[offset++] = bits & 255;
    }
    if (bytes.length > MAX_ASSET) throw new Error("图片超过 8 MiB。");
    return bytes;
  };
  const imageMime = (bytes) =>
    bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71
      ? "image/png"
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        ? "image/jpeg"
        : bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70
          ? "image/gif"
          : null;
  function validateAssets(assets = {}) {
    if (!object(assets) || Object.keys(assets).length > 2048) throw new Error("图片资源表无效。");
    let total = 0;
    const bytes = new Map();
    for (const [id, asset] of Object.entries(assets)) {
      if (!string(id, 160) || !object(asset)) throw new Error("图片资源无效。");
      const data = decode64(asset.base64);
      if (!imageMime(data) || imageMime(data) !== asset.mime)
        throw new Error("图片须为本地 PNG、JPEG 或 GIF。SVG/WebP 请通过插件界面转换。");
      if ((total += data.length) > MAX_ASSETS_TOTAL) throw new Error("图片总量超过 12 MiB。");
      bytes.set(id, data);
    }
    return bytes;
  }

  function validateTransfer(value, validatedAssets) {
    if (
      !object(value) ||
      value.format !== "codeshell.figma.transfer" ||
      value.version !== 1 ||
      !string(value.name, 120) ||
      !Array.isArray(value.pages) ||
      !value.pages.length ||
      value.pages.length > 1000
    )
      throw new Error("不是有效的 CodeShell Figma 传输包。");
    const assets = validatedAssets ?? validateAssets(value.assets);
    if (
      value.canvas !== undefined &&
      (!object(value.canvas) ||
        !color(value.canvas.background) ||
        value.canvas.background === "transparent" ||
        !finite(value.canvas.width) ||
        !finite(value.canvas.height) ||
        value.canvas.width < 100 ||
        value.canvas.width > 20000 ||
        value.canvas.height < 100 ||
        value.canvas.height > 20000)
    )
      throw new Error("画布尺寸或背景无效。");
    const ids = new Set(),
      seen = new Set();
    let total = 0;
    const range = (value, min, max, key) => {
      if (!finite(value) || value < min || value > max) throw new Error(`图层 ${key} 无效。`);
    };
    const optionalEnum = (node, key, values) => {
      if (node[key] !== undefined && !values.includes(node[key]))
        throw new Error(`图层 ${key} 无效。`);
    };
    const visit = (node, depth, counter) => {
      if (
        !object(node) ||
        seen.has(node) ||
        depth > 32 ||
        !supported.has(node.type) ||
        !string(node.id, 160) ||
        ids.has(node.id) ||
        !string(node.name, 120, true)
      )
        throw new Error("传输包包含无效、重复或过深图层。");
      seen.add(node);
      ids.add(node.id);
      if (++total > MAX_TOTAL || ++counter.count > 10000)
        throw new Error("传输包图层数量超出上限。");
      for (const [key, min, max] of [
        ["x", -20000, 20000],
        ["y", -20000, 20000],
        ["width", 1, 20000],
        ["height", 1, 20000],
        ["rotation", -360, 360],
        ["opacity", 0, 1],
        ["strokeWidth", 0, 100],
        ["cornerRadius", 0, 9999],
      ])
        range(node[key], min, max, key);
      if (
        !color(node.fill) ||
        !color(node.stroke) ||
        typeof node.visible !== "boolean" ||
        typeof node.locked !== "boolean"
      )
        throw new Error("图层外观无效。");
      if (node.cornerRadii !== undefined &&
          (!Array.isArray(node.cornerRadii) || node.cornerRadii.length !== 4 ||
           !["frame", "rectangle", "component", "image"].includes(node.type) ||
           Array.from(node.cornerRadii).some((radius) => !finite(radius) || radius < 0 || radius > 9999)))
        throw new Error("独立圆角必须是四个 0–9999 的有限半径。");
      if (node.fillPaints !== undefined) {
        CodeShellFigmaPaint.normalizeDesignPaints(node.fillPaints);
        CodeShellFigmaPaint.designPaintsToFigma(node);
        if (["group", "image"].includes(node.type)) throw new Error("该图层不支持独立填充绘制。");
      }
      if (node.notes !== undefined && (typeof node.notes !== "string" || node.notes.length > 2000))
        throw new Error("图层备注无效。");
      if (node.sourceId !== undefined && !string(node.sourceId, 160))
        throw new Error("来源 ID 无效。");
      if (
        node.type === "image" &&
        (!string(node.imageRef, 64) ||
          !assets.has(node.imageRef) ||
          !["fill", "contain", "cover"].includes(node.objectFit))
      )
        throw new Error("图片图层缺少本地图片或适配模式无效。");
      if (node.shadow !== undefined) {
        if (
          !object(node.shadow) ||
          !color(node.shadow.color) ||
          node.shadow.color === "transparent"
        )
          throw new Error("投影无效。");
        for (const [key, min, max] of [
          ["opacity", 0, 1],
          ["x", -500, 500],
          ["y", -500, 500],
          ["blur", 0, 200],
        ])
          range(node.shadow[key], min, max, `shadow.${key}`);
      }
      CodeShellFigmaGrid.validateGridFields(node, containers.has(node.type));
      for (const key of ["layoutSizingHorizontal", "layoutSizingVertical"])
        optionalEnum(node, key, ["fixed", "hug", "fill"]);
      optionalEnum(node, "layoutPositioning", ["auto", "absolute"]);
      optionalEnum(node, "layoutAlignSelf", [
        "auto",
        "start",
        "center",
        "end",
        "stretch",
        "baseline",
      ]);
      for (const key of ["minWidth", "maxWidth", "minHeight", "maxHeight"])
        if (node[key] !== undefined) range(node[key], 1, 20000, key);
      if (node.type === "text") {
        if (
          typeof node.text !== "string" ||
          node.text.length > 4000 ||
          (node.textSource !== undefined &&
            (typeof node.textSource !== "string" || node.textSource.length > 4000)) ||
          (node.fontFamily !== undefined && !string(node.fontFamily, 120))
        )
          throw new Error("文字内容或字体无效。");
        optionalEnum(node, "textFlow", ["wrap"]);
        optionalEnum(node, "textOverflow", ["ellipsis"]);
        if ((node.textFlow || node.textOverflow) && !node.textSource?.trim())
          throw new Error("响应式文字缺少原始内容。");
        range(node.fontSize, 6, 240, "fontSize");
        range(node.fontWeight, 100, 900, "fontWeight");
        range(node.lineHeight, 0.7, 3, "lineHeight");
        if (
          ![100, 200, 300, 400, 500, 600, 700, 800, 900].includes(node.fontWeight) ||
          !["left", "center", "right"].includes(node.textAlign)
        )
          throw new Error("文字样式无效。");
        optionalEnum(node, "fontStyle", ["normal", "italic"]);
        optionalEnum(node, "textDecoration", ["none", "underline", "line-through"]);
        if (node.letterSpacing !== undefined) range(node.letterSpacing, -20, 100, "letterSpacing");
      }
      if (containers.has(node.type)) {
        if (
          !Array.isArray(node.children) ||
          !["none", "horizontal", "vertical", "grid"].includes(node.layout)
        )
          throw new Error("容器布局无效。");
        for (const key of ["gap", "padding"]) range(node[key], 0, 2000, key);
        for (const key of [
          "rowGap",
          "columnGap",
          "paddingTop",
          "paddingRight",
          "paddingBottom",
          "paddingLeft",
        ])
          if (node[key] !== undefined) range(node[key], 0, 2000, key);
        optionalEnum(node, "layoutWrap", ["none", "wrap", "wrap-reverse"]);
        if (node.layoutReverse !== undefined && typeof node.layoutReverse !== "boolean")
          throw new Error("反向布局无效。");
        if (
          !["start", "center", "end", "stretch", "baseline"].includes(node.alignItems) ||
          !["start", "center", "end", "space-between"].includes(node.justifyContent)
        )
          throw new Error("布局对齐无效。");
        if (node.clipContent !== undefined && typeof node.clipContent !== "boolean")
          throw new Error("裁剪属性无效。");
        for (const child of node.children) visit(child, depth + 1, counter);
        if (node.layout === "grid") CodeShellFigmaGrid.nativeGridPlan(node);
      } else if (node.children !== undefined) throw new Error("基础图层不能包含 children。");
    };
    const pageIds = new Set();
    for (const page of value.pages) {
      if (
        !object(page) ||
        !string(page.id, 64) ||
        pageIds.has(page.id) ||
        !string(page.name, 120) ||
        !Array.isArray(page.children)
      )
        throw new Error("页面无效。");
      pageIds.add(page.id);
      const counter = { count: 0 };
      for (const child of page.children) visit(child, 0, counter);
    }
    return total;
  }

  const rgb = (hex) => ({
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
  });
  const paints = (hex, stack, width, height) =>
    stack
      ? CodeShellFigmaPaint.designPaintsToFigma({ fill: hex, fillPaints: stack, width, height })
      : hex === "transparent" ? [] : [{ type: "SOLID", color: rgb(hex) }];
  function retainCssLinearSource(node, source) {
    const snapshot = CodeShellFigmaPaint.cssLinearSourceSnapshot(source);
    node.setPluginData("codeshellCssLinearSource", snapshot ? JSON.stringify(snapshot) : "");
  }
  const lineBoxY = (node) => node.y - (node.type === "text" ? node.layoutBaselineOffset ?? 0 : 0);
  function transform(source, parent) {
    const radians = (source.rotation * Math.PI) / 180,
      c = Math.cos(radians),
      s = Math.sin(radians);
    const x = source.x - (parent?.x ?? 0),
      y = lineBoxY(source) - (parent?.y ?? 0);
    return [
      [c, -s, x + source.width / 2 - (c * source.width) / 2 + (s * source.height) / 2],
      [s, c, y + source.height / 2 - (s * source.width) / 2 - (c * source.height) / 2],
    ];
  }

  async function importTransfer(value, hooks = {}) {
    const count = validateTransfer(value); // Complete validation before the first document mutation.
    const warnings = [],
      created = [],
      fonts = new Map();
    const imageBytes = validateAssets(value.assets),
      imageHashes = new Map();
    const warn = (message) => {
      if (warnings.length < 200) warnings.push(message);
    };
    async function loadFont(source) {
      const wanted = patchFont(source, true);
      const exact = iconOrPrivateUseText(source);
      const key = `${wanted.family}\u0000${wanted.style}\u0000${exact}`;
      if (!fonts.has(key))
        fonts.set(
          key,
          (async () => {
            try {
              await figma.loadFontAsync(wanted);
              if (wanted.family !== (source.fontFamily || "Inter"))
                warn(
                  `${source.fontFamily} 的内嵌字库为 Font Awesome 6.7.2；已使用 ${wanted.family} ${wanted.style}。`,
                );
              return wanted;
            } catch {
              if (exact)
                throw new Error(
                  `${wanted.family} ${wanted.style} 不可用；图标或私用区文字不能回退到 Inter。请在 Figma 中安装或启用原字体后重试。`,
                );
              warn(`${wanted.family} ${wanted.style} 不可用，已回退到 Inter Regular。`);
              const fallback = { family: "Inter", style: "Regular" };
              await figma.loadFontAsync(fallback);
              return fallback;
            }
          })(),
        );
      return fonts.get(key);
    }
    function applyLayout(node, source) {
      const manual =
        source.layoutReverse ||
        source.layoutWrap === "wrap-reverse" ||
        (source.layout === "vertical" && source.layoutWrap === "wrap");
      if (manual) {
        warn(`${source.name}: 此布局按固定几何创建。`);
        return;
      }
      if (source.layout === "grid") return CodeShellFigmaGrid.configureNativeGrid(node, source);
      node.layoutMode = { horizontal: "HORIZONTAL", vertical: "VERTICAL" }[source.layout] || "NONE";
      if (node.layoutMode === "NONE") return;
      node.primaryAxisSizingMode = "FIXED";
      node.counterAxisSizingMode = "FIXED";
      node.itemSpacing = source.gap;
      for (const side of ["Top", "Right", "Bottom", "Left"])
        node[`padding${side}`] = source[`padding${side}`] ?? source.padding;
      node.primaryAxisAlignItems = {
        start: "MIN",
        center: "CENTER",
        end: "MAX",
        "space-between": "SPACE_BETWEEN",
      }[source.justifyContent];
      node.counterAxisAlignItems = {
        start: "MIN",
        center: "CENTER",
        end: "MAX",
        baseline: "BASELINE",
        stretch: "MIN",
      }[source.alignItems];
      if (node.layoutMode === "HORIZONTAL") {
        node.layoutWrap = source.layoutWrap === "wrap" ? "WRAP" : "NO_WRAP";
        if (node.layoutWrap === "WRAP") {
          node.counterAxisSpacing = source.rowGap ?? source.gap;
          node.counterAxisAlignContent =
            source.alignContent === "space-between" ? "SPACE_BETWEEN" : "AUTO";
        }
      }
      if (source.layout === "horizontal" && source.columnGap !== undefined)
        node.itemSpacing = source.columnGap;
      if (source.layout === "vertical" && source.rowGap !== undefined)
        node.itemSpacing = source.rowGap;
    }
    function applySizing(node, source, parent, parentSource) {
      if (node.type === "TEXT") {
        const plan = CodeShellFigmaText.nativeTextPlan(source);
        node.textAutoResize = plan.autoResize;
        node.textTruncation = plan.truncation;
        node.maxLines = plan.maxLines;
      }
      const parentAuto = parent?.layoutMode && parent.layoutMode !== "NONE";
      let stretchAxis = null;
      if (parentAuto && parent.layoutMode !== "GRID") {
        node.layoutPositioning = source.layoutPositioning === "absolute" ? "ABSOLUTE" : "AUTO";
        const followsParent = !source.layoutAlignSelf || source.layoutAlignSelf === "auto";
        const stretches =
          source.layoutAlignSelf === "stretch" ||
          (followsParent && parentSource?.alignItems === "stretch");
        if (stretches && source.layoutPositioning !== "absolute")
          stretchAxis = parent.layoutMode === "HORIZONTAL" ? "Vertical" : "Horizontal";
        node.layoutAlign = stretchAxis ? "STRETCH" : "INHERIT";
      }
      for (const axis of ["Horizontal", "Vertical"]) {
        // Effective stretch owns this axis in the editor too. Assigning HUG
        // afterwards would undo native STRETCH; explicit self alignment opts out.
        if (axis === stretchAxis) continue;
        const gridStretch =
          parent?.layoutMode === "GRID" &&
          source.layoutPositioning !== "absolute" &&
          (source.layoutAlignSelf === "stretch" ||
            ((!source.layoutAlignSelf || source.layoutAlignSelf === "auto") &&
              parentSource?.alignItems === "stretch"));
        const sizing = gridStretch ? "fill" : source[`layoutSizing${axis}`];
        if (!sizing || sizing === "fixed") {
          if (parent?.layoutMode === "GRID") node[`layoutSizing${axis}`] = "FIXED";
          continue;
        }
        if (
          (sizing === "fill" && (!parentAuto || source.layoutPositioning === "absolute")) ||
          (sizing === "hug" &&
            node.type !== "TEXT" &&
            (!node.layoutMode || node.layoutMode === "NONE"))
        ) {
          warn(`${source.name}: ${axis} ${sizing} 使用固定尺寸。`);
          continue;
        }
        node[`layoutSizing${axis}`] = sizing.toUpperCase();
      }
      for (const key of ["minWidth", "maxWidth", "minHeight", "maxHeight"])
        if (source[key] !== undefined) node[key] = source[key];
    }
    async function createNode(source, parent, parentSource) {
      if (source.fillPaints?.some(CodeShellFigmaPaint.cssLinearNeedsNativeWarning))
        warn(`${source.name}: CSS 角度/像素色标仅按当前尺寸创建为可编辑原生渐变；Figma 内改变尺寸可能改变外观。原始意图已保留。`);
      const font = source.type === "text" ? await loadFont(source) : null;
      const node = containers.has(source.type)
        ? figma.createFrame()
        : source.type === "text"
          ? figma.createText()
          : source.type === "ellipse"
            ? figma.createEllipse()
            : figma.createRectangle();
      parent.appendChild(node);
      if (parent.layoutMode === "GRID")
        node.layoutPositioning = source.layoutPositioning === "absolute" ? "ABSOLUTE" : "AUTO";
      node.name = source.name;
      if (node.type === "TEXT") {
        node.fontName = font;
        node.fontSize = source.fontSize;
        node.characters = CodeShellFigmaText.nativeTextContent(source);
        node.lineHeight = { unit: "PERCENT", value: source.lineHeight * 100 };
        node.textAlignHorizontal = source.textAlign.toUpperCase();
        node.letterSpacing = { unit: "PIXELS", value: source.letterSpacing ?? 0 };
        node.textDecoration =
          { underline: "UNDERLINE", "line-through": "STRIKETHROUGH" }[source.textDecoration] ||
          "NONE";
        node.textAutoResize = "NONE";
      }
      node.resize(source.width, source.height);
      if (source.type === "image") {
        if (!imageHashes.has(source.imageRef))
          imageHashes.set(source.imageRef, figma.createImage(imageBytes.get(source.imageRef)).hash);
        node.fills = [
          {
            type: "IMAGE",
            imageHash: imageHashes.get(source.imageRef),
            scaleMode: source.objectFit === "contain" ? "FIT" : "FILL",
          },
        ];
      } else node.fills = paints(source.fill, source.fillPaints, source.width, source.height);
      retainCssLinearSource(node, source);
      node.strokes = paints(source.stroke);
      node.strokeWeight = source.strokeWidth;
      node.strokeAlign = "CENTER";
      if (node.type === "FRAME" || node.type === "RECTANGLE")
        setCorners(node, source);
      node.opacity = source.opacity;
      node.visible = source.visible;
      if (node.type === "FRAME") {
        node.clipsContent = source.type === "group" ? false : source.clipContent === true;
        node.layoutMode = "NONE";
      }
      if (source.shadow)
        node.effects = [
          {
            type: "DROP_SHADOW",
            color: { ...rgb(source.shadow.color), a: source.shadow.opacity },
            offset: { x: source.shadow.x, y: source.shadow.y },
            radius: source.shadow.blur,
            spread: 0,
            visible: true,
            blendMode: "NORMAL",
          },
        ];
      node.relativeTransform = transform(source, parentSource);
      node.setPluginData("codeshellNodeId", source.id);
      if (source.sourceId) node.setPluginData("figmaSourceId", source.sourceId);
      if (source.notes) node.setPluginData("codeshellNotes", source.notes);
      if (containers.has(source.type)) {
        if (source.layout === "grid") {
          const plan = applyLayout(node, source);
          for (const child of source.children) {
            const created = await createNode(child, node, source);
            CodeShellFigmaGrid.positionNativeGridChild(created, child, source, plan);
          }
          CodeShellFigmaGrid.finishNativeGrid(node, source);
        } else {
          for (const child of source.children) await createNode(child, node, source);
          applyLayout(node, source);
        }
        // Enabling native Auto Layout can immediately hug the existing children.
        // Restore the authored frame before FILL children consume its inner size;
        // this frame's own HUG/FILL is applied afterwards by its parent.
        if (node.layoutMode !== "NONE")
          node.resizeWithoutConstraints(source.width, source.height);
        for (let index = 0; index < source.children.length; index += 1) {
          const child = node.children[index],
            childSource = source.children[index];
          applySizing(child, childSource, node, source);
          if (
            node.layoutMode === "NONE" ||
            childSource.layoutPositioning === "absolute" ||
            childSource.visible === false
          )
            child.relativeTransform = transform(childSource, source);
        }
      }
      node.locked = source.locked;
      if (source.constraintHorizontal || source.constraintVertical)
        node.constraints = {
          horizontal:
            { start: "MIN", center: "CENTER", end: "MAX", stretch: "STRETCH", scale: "SCALE" }[
              source.constraintHorizontal
            ] ?? "MIN",
          vertical:
            { start: "MIN", center: "CENTER", end: "MAX", stretch: "STRETCH", scale: "SCALE" }[
              source.constraintVertical
            ] ?? "MIN",
        };
      return node;
    }
    if (hooks.factoryOnly) return { createNode, applySizing, applyLayout, loadFont, warnings };
    const preflightFonts = async (nodes) => {
      for (const node of nodes) {
        if (node.type === "text") await loadFont(node);
        if (node.children) await preflightFonts(node.children);
      }
    };
    for (const page of value.pages) await preflightFonts(page.children);
    try {
      for (const source of value.pages) {
        const page = figma.createPage();
        created.push(page);
        page.name = `${source.name} · CodeShell`;
        if (value.canvas) page.backgrounds = paints(value.canvas.background);
        page.setPluginData("codeshellPageId", source.id);
        for (const child of source.children) {
          const node = await createNode(child, page, null);
          applySizing(node, child, page);
        }
      }
      await figma.setCurrentPageAsync(created[0]);
      figma.viewport.scrollAndZoomIntoView(created[0].children);
      return { pages: created.length, nodes: count, warnings };
    } catch (error) {
      // These pages are owned by this import. Never remove or modify pre-existing pages.
      for (const page of created.reverse()) page.remove();
      throw error;
    }
  }

  function setCorners(node, source) {
    node.cornerRadius = source.cornerRadius;
    if (source.cornerRadii) {
      [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius] = source.cornerRadii;
    }
  }

  const PATCH_KEYS = new Set([
    "name",
    "notes",
    "x",
    "y",
    "width",
    "height",
    "rotation",
    "fill",
    "fillPaints",
    "stroke",
    "strokeWidth",
    "opacity",
    "cornerRadius",
    "cornerRadii",
    "visible",
    "locked",
    "shadow",
    "clipContent",
    "text",
    "fontSize",
    "fontWeight",
    "fontFamily",
    "fontStyle",
    "lineHeight",
    "textAlign",
    "letterSpacing",
    "textDecoration",
    "imageRef",
    "objectFit",
    "layout",
    "layoutWrap",
    "layoutReverse",
    "gap",
    "rowGap",
    "columnGap",
    "padding",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "alignItems",
    "justifyContent",
    "alignContent",
    "layoutSizingHorizontal",
    "layoutSizingVertical",
    "layoutPositioning",
    "layoutAlignSelf",
    "minWidth",
    "maxWidth",
    "minHeight",
    "maxHeight",
    "constraintHorizontal",
    "constraintVertical",
    "constraintLeft",
    "constraintRight",
    "constraintTop",
    "constraintBottom",
    "constraintBaseWidth",
    "constraintBaseHeight",
    "parentId",
    "textSource",
    "textFlow",
    "textFlowWidth",
    "textMeasurement",
    "textOverflow",
    "layoutBaselineOffset",
    "fontRef",
    "effectClipping",
    "contentClipping",
  ]);
  PATCH_KEYS.add("pageId");
  PATCH_KEYS.add("siblingIndex");
  const GEOMETRY_KEYS = new Set(["x", "y", "width", "height", "rotation", "parentId", "pageId"]);
  const LAYOUT_KEYS = new Set([
    "layout",
    "layoutWrap",
    "layoutReverse",
    "gap",
    "rowGap",
    "columnGap",
    "padding",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "alignItems",
    "justifyContent",
    "alignContent",
  ]);
  const FONT_KEYS = new Set([
    "text",
    "textSource",
    "textFlow",
    "textOverflow",
    "fontSize",
    "fontWeight",
    "fontFamily",
    "fontStyle",
    "lineHeight",
    "textAlign",
    "letterSpacing",
    "textDecoration",
  ]);
  const canonical = (value) =>
    JSON.stringify(value === undefined ? null : value, (_key, entry) =>
      object(entry)
        ? Object.fromEntries(
            Object.keys(entry)
              .sort()
              .map((key) => [key, entry[key]]),
          )
        : entry,
    );
  const restCorners = (node) => ({
    radii: node.rectangleCornerRadii ?? Array(4).fill(node.cornerRadius ?? 0),
    smoothing: node.cornerSmoothing ?? 0,
  });
  function comparableRest(node) {
    if (!object(node)) return node;
    const copy = { ...node };
    if (["RECTANGLE", "FRAME", "COMPONENT", "INSTANCE", "COMPONENT_SET", "SECTION"].includes(node.type)) {
      copy.rectangleCornerRadii = restCorners(node).radii;
      copy.cornerSmoothing = node.cornerSmoothing ?? 0;
      delete copy.cornerRadius;
    }
    if (Array.isArray(node.children)) copy.children = node.children.map(comparableRest);
    return copy;
  }
  const restKeys = (key) =>
    GEOMETRY_KEYS.has(key)
      ? ["absoluteBoundingBox", "size", "relativeTransform", "rotation"]
      : FONT_KEYS.has(key)
        ? ["text", "textSource"].includes(key)
          ? ["characters", "characterStyleOverrides", "styleOverrideTable"]
          : ["style", "characterStyleOverrides", "styleOverrideTable"]
        : LAYOUT_KEYS.has(key)
          ? [
              "layoutMode",
              "layoutWrap",
              "itemSpacing",
              "counterAxisSpacing",
              "paddingTop",
              "paddingRight",
              "paddingBottom",
              "paddingLeft",
              "counterAxisAlignItems",
              "primaryAxisAlignItems",
              "counterAxisAlignContent",
            ]
          : ({
              fill: ["fills", "codeshellCssLinearSource"],
              fillPaints: ["fills", "codeshellCssLinearSource"],
              imageRef: ["fills"],
              objectFit: ["fills"],
              stroke: ["strokes"],
              strokeWidth: ["strokeWeight"],
              cornerRadius: ["cornerRadius", "rectangleCornerRadii", "cornerSmoothing"],
              cornerRadii: ["cornerRadius", "rectangleCornerRadii", "cornerSmoothing"],
              shadow: ["effects"],
              clipContent: ["clipsContent"],
              constraintHorizontal: ["constraints"],
              constraintVertical: ["constraints"],
              layoutAlignSelf: ["layoutAlign"],
              layoutPositioning: ["layoutPositioning"],
              notes: [],
              siblingIndex: [],
            }[key] ?? [key]);
  // JSON_REST_V1 can lag the native Grid API. Read actual live values so the
  // source record and later conflict checks retain the same native semantics.
  function preserveNativeGrid(raw, node) {
    const cssSource = node.getPluginData?.("codeshellCssLinearSource");
    if (cssSource && utf8Length(cssSource) <= 32768) {
      try {
        raw.codeshellCssLinearSource = CodeShellFigmaPaint.normalizeCssLinearSource(JSON.parse(cssSource));
      } catch { /* Never reinterpret unvalidated plugin data as active geometry. */ }
    }
    const radii = [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius];
    if (radii.every((value) => finite(value))) {
      raw.rectangleCornerRadii = radii;
      if (radii.every((value) => value === radii[0])) raw.cornerRadius = radii[0];
      else delete raw.cornerRadius;
    }

    const keys = node.layoutMode === "GRID"
      ? [
          "layoutMode", "layoutSizingHorizontal", "layoutSizingVertical",
          "gridRowCount", "gridColumnCount", "gridRowGap", "gridColumnGap",
          "gridRowSizes", "gridColumnSizes", "gridAutoTracks", "gridItemsPositioning",
        ]
      : [];
    if (node.parent?.layoutMode === "GRID")
      keys.push(
        "layoutPositioning", "layoutSizingHorizontal", "layoutSizingVertical",
        "gridRowAnchorIndex", "gridColumnAnchorIndex", "gridRowSpan", "gridColumnSpan",
        "gridChildHorizontalAlign", "gridChildVerticalAlign",
      );
    for (const key of keys) {
      const value = node[key];
      if (value !== undefined)
        raw[key] = key.endsWith("Sizes")
          ? value.map((track) => ({
              type: track.type,
              ...(track.type !== "HUG" && track.value !== undefined ? { value: track.value } : {}),
            }))
          : value;
    }
    if (node.type === "TEXT") {
      // Preserve native truncation when JSON_REST_V1 omits these newer fields.
      // Do not inject defaults into legacy snapshots used for conflict checks.
      const style = object(raw.style) ? raw.style : {};
      if (node.textTruncation === "ENDING" || hasOwn(style, "textTruncation"))
        style.textTruncation = node.textTruncation;
      if (node.maxLines != null || hasOwn(style, "maxLines")) style.maxLines = node.maxLines;
      if (Object.keys(style).length) raw.style = style;
    }
    const children = new Map((node.children ?? []).map((child) => [child.id, child]));
    for (const child of raw.children ?? [])
      if (children.has(child.id)) preserveNativeGrid(child, children.get(child.id));
    return raw;
  }
  async function nodeRest(node) {
    if (node.type === "PAGE") await node.loadAsync();
    const response = await node.exportAsync({ format: "JSON_REST_V1" });
    const document = response?.document ?? response?.nodes?.[node.id]?.document;
    if (!object(document)) throw new Error(`无法读取原图层 ${node.id}。`);
    return preserveNativeGrid(document, node);
  }
  function patchIndexes(value) {
    const current = new Map(),
      baseline = new Map(),
      pages = new Map(),
      sourceIds = new Map(),
      mapping = new Map(),
      pageMappings = new Map(),
      siblings = new Map(),
      baselineOrder = new Map();
    const walk = (nodes, target, parentId, pageId) => {
      for (const node of nodes ?? []) {
        target.set(node.id, { ...node, ...(parentId ? { parentId } : {}), pageId });
        walk(node.children, target, node.id, pageId);
      }
    };
    for (const page of value.pages) {
      pages.set(page.id, page);
      walk(page.children, current, null, page.id);
    }
    for (const page of value.patch?.baseline?.pages ?? [])
      walk(page.children ?? page.nodes, baseline, null, page.id);
    for (const op of value.patch?.operations ?? [])
      if (op.baseline) baseline.set(op.designId, op.baseline);
    for (const entry of value.patch?.mapping ?? []) {
      sourceIds.set(entry.designId, entry.sourceId);
      mapping.set(entry.designId, entry);
    }
    if (!Array.isArray(value.patch?.mapping))
      for (const node of current.values())
        if (node.sourceId && !sourceIds.has(node.id)) sourceIds.set(node.id, node.sourceId);
    for (const op of value.patch?.operations ?? [])
      if (op.sourceId && op.designId) sourceIds.set(op.designId, op.sourceId);
    for (const entry of value.patch?.pageMappings ?? []) {
      sourceIds.set(entry.designId, entry.sourceId);
      pageMappings.set(entry.designId, entry);
    }
    for (const node of current.values()) {
      const key = JSON.stringify([node.pageId, node.parentId ?? null]);
      if (!siblings.has(key)) siblings.set(key, []);
      siblings.get(key).push(node);
    }
    for (const node of baseline.values()) {
      const entry = mapping.get(node.id),
        parent =
          entry?.sourceParentId ??
          sourceIds.get(node.parentId) ??
          pageMappings.get(node.pageId)?.sourceId;
      if (entry && parent) {
        if (!baselineOrder.has(parent)) baselineOrder.set(parent, []);
        baselineOrder.get(parent).push(entry.sourceId);
      }
    }
    return { current, baseline, pages, sourceIds, mapping, pageMappings, siblings, baselineOrder };
  }
  const IDENTITY = [
    [1, 0, 0],
    [0, 1, 0],
  ];
  const multiply = (a, b) => [
    [
      a[0][0] * b[0][0] + a[0][1] * b[1][0],
      a[0][0] * b[0][1] + a[0][1] * b[1][1],
      a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2],
    ],
    [
      a[1][0] * b[0][0] + a[1][1] * b[1][0],
      a[1][0] * b[0][1] + a[1][1] * b[1][1],
      a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2],
    ],
  ];
  const inverse = (matrix) => {
    const determinant = matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];
    if (Math.abs(determinant) < 0.000001) throw new Error("选区父级变换不可逆。");
    const a = matrix[1][1] / determinant,
      b = -matrix[0][1] / determinant,
      c = -matrix[1][0] / determinant,
      d = matrix[0][0] / determinant;
    return [
      [a, b, -a * matrix[0][2] - b * matrix[1][2]],
      [c, d, -c * matrix[0][2] - d * matrix[1][2]],
    ];
  };
  const absolute = (node, depth = 0) => {
    if (!node || depth > 34 || node.type === "PAGE" || !node.relativeTransform) return IDENTITY;
    return (
      node.absoluteTransform ?? multiply(absolute(node.parent, depth + 1), node.relativeTransform)
    );
  };
  function designWorld(node, index, pageMap) {
    let x = node.x + node.width / 2,
      y = lineBoxY(node) + node.height / 2,
      rotation = node.rotation;
    for (
      let parent = index.get(node.parentId), depth = 0;
      parent && depth++ <= 32;
      parent = index.get(parent.parentId)
    ) {
      const cx = parent.x + parent.width / 2,
        cy = parent.y + parent.height / 2,
        radians = (parent.rotation * Math.PI) / 180,
        dx = x - cx,
        dy = y - cy;
      x = cx + dx * Math.cos(radians) - dy * Math.sin(radians);
      y = cy + dx * Math.sin(radians) + dy * Math.cos(radians);
      rotation += parent.rotation;
    }
    return { x: x - (pageMap?.offsetX ?? 0), y: y - (pageMap?.offsetY ?? 0), rotation };
  }
  let preview = null,
    previewSerial = 0;
  async function preflightPatch(value) {
    const assets = validateAssets(value.assets);
    validateTransfer(value, assets);
    const patch = value.patch;
    if (
      !object(patch) ||
      patch.format !== "codeshell.figma.patch" ||
      patch.version !== 1 ||
      !Array.isArray(patch.operations) ||
      patch.operations.length > MAX_TOTAL
    )
      throw new Error("没有有效的增量修改记录。");
    if (patch.fileKey && figma.fileKey && patch.fileKey !== figma.fileKey)
      throw new Error("当前 Figma 文件与来源文件不一致。");
    const validMatrix = (value) =>
      Array.isArray(value) &&
      value.length === 2 &&
      value.every((row) => Array.isArray(row) && row.length === 3 && row.every(finite));
    for (const entry of patch.mapping ?? [])
      if (
        entry.selectionRoot &&
        (!string(entry.sourceParentId, 160) || !validMatrix(entry.sourceParentTransform))
      )
        throw new Error("选区来源父级上下文无效。");
    const indexes = patchIndexes(value),
      targets = new Map(),
      currentRaw = new Map(),
      geometryBefore = new Map(),
      conflicts = [],
      report = [],
      createdIds = new Set();
    let deletions = 0;
    const requireTarget = async (id) => {
      if (!string(id, 160)) throw new Error("增量操作缺少来源图层 ID。");
      if (!targets.has(id)) {
        const node = await figma.getNodeByIdAsync(id);
        if (!node || node.removed) throw new Error(`来源图层 ${id} 不存在。`);
        targets.set(id, node);
        currentRaw.set(id, await nodeRest(node));
        if (node.relativeTransform)
          geometryBefore.set(id, {
            width: node.width,
            height: node.height,
            matrix: node.relativeTransform.map((row) => [...row]),
          });
      }
      return targets.get(id);
    };
    const validateNode = (node, id) => {
      if (!object(node) || node.id !== id) throw new Error("增量操作的设计图层 ID 不匹配。");
      const copy = { ...node, ...(containers.has(node.type) ? { children: [] } : {}) };
      validateTransfer(
        {
          format: "codeshell.figma.transfer",
          version: 1,
          name: "Patch validation",
          pages: [{ id: "validate", name: "Patch", children: [copy] }],
        },
        assets,
      );
    };
    for (const operation of patch.operations) {
      if (
        !object(operation) ||
        !["update", "create", "delete", "create-page", "rename-page", "delete-page"].includes(
          operation.op,
        )
      )
        throw new Error("未知的增量操作。");
      if (operation.op === "create" || operation.op === "update")
        validateNode(operation.after, operation.designId);
      if (operation.op === "create" || operation.op === "create-page") {
        if (
          !string(operation.designId, 160) ||
          createdIds.has(operation.designId) ||
          indexes.sourceIds.has(operation.designId)
        )
          throw new Error("新增设计 ID 重复或已绑定来源。");
        createdIds.add(operation.designId);
        if (operation.op === "create-page" && !string(operation.after?.name ?? operation.name, 120))
          throw new Error("新增页面名称无效。");
      } else {
        const target = await requireTarget(operation.sourceId),
          raw = currentRaw.get(operation.sourceId);
        if (
          !object(operation.before) ||
          (operation.op !== "rename-page" && operation.before.id !== operation.sourceId)
        )
          throw new Error("缺少可核对的来源快照。");
        if (operation.op === "update") {
          if (
            !object(operation.baseline) ||
            !Array.isArray(operation.changed) ||
            !operation.changed.length ||
            operation.changed.some((key) => !PATCH_KEYS.has(key)) ||
            new Set(operation.changed).size !== operation.changed.length
          )
            throw new Error("增量修改字段无效或暂不支持。");
          if (
            operation.changed.includes("siblingIndex") &&
            (!Number.isInteger(operation.after.siblingIndex) ||
              operation.after.siblingIndex < 0 ||
              operation.after.siblingIndex >= 10000)
          )
            throw new Error("图层顺序无效。");
          for (const key of operation.changed) {
            if (key === "cornerRadius" || key === "cornerRadii") {
              if (canonical(restCorners(operation.before)) !== canonical(restCorners(raw)))
                conflicts.push(`${operation.sourceId} · 圆角已在 Figma 中变化。`);
            } else for (const property of restKeys(key))
              if (canonical(operation.before[property]) !== canonical(raw[property]))
                conflicts.push(`${operation.sourceId} · ${property} 已在 Figma 中变化。`);
          }
          // Resizing an authored CSS gradient also changes its native paint
          // snapshot. Guard concurrent palette/geometry/source edits first.
          if (operation.changed.some((key) => key === "width" || key === "height") &&
              operation.after.fillPaints?.some((paint) => paint.cssLinear && !paint.cssLinear.sourceOnly)) {
            for (const property of ["fills", "codeshellCssLinearSource"])
              if (canonical(operation.before[property]) !== canonical(raw[property]))
                conflicts.push(`${operation.sourceId} · ${property} 已在 Figma 中变化，不能重算 CSS 渐变。`);
          }
          if (operation.changed.includes("parentId") || operation.changed.includes("pageId")) {
            const entry = indexes.mapping.get(operation.designId);
            const parentId =
              indexes.sourceIds.get(operation.baseline.parentId) ??
              entry?.sourceParentId ??
              entry?.sourcePageId;
            if (parentId && target.parent?.id !== parentId)
              conflicts.push(`${operation.sourceId} · 所属容器已变化。`);
          }
          if (
            operation.changed.some((key) => LAYOUT_KEYS.has(key)) &&
            !["FRAME", "COMPONENT", "INSTANCE", "COMPONENT_SET"].includes(target.type)
          )
            throw new Error("此来源图层不支持 Auto Layout 修改。");
          if (
            operation.changed.some((key) => LAYOUT_KEYS.has(key)) &&
            (operation.after.layout === "grid" ||
              operation.after.layoutReverse ||
              operation.after.layoutWrap === "wrap-reverse" ||
              (operation.after.layout === "vertical" && operation.after.layoutWrap === "wrap"))
          )
            throw new Error("此增量布局不能直接对应 Figma，请使用新页面转换或在 Figma 中修改。");
          if (
            operation.changed.includes("layoutAlignSelf") &&
            operation.after.layoutAlignSelf !== undefined &&
            !["auto", "stretch"].includes(operation.after.layoutAlignSelf)
          )
            throw new Error("Figma 单项对齐仅支持继承或拉伸，请使用新页面副本核对其他单项对齐。");
          if (operation.changed.some((key) => FONT_KEYS.has(key)) && target.type !== "TEXT")
            throw new Error("此来源图层不是可编辑文字；请先在 Figma 中编辑复杂文字。");
          if (
            operation.changed.some((key) => ["cornerRadius", "cornerRadii"].includes(key)) &&
            !["RECTANGLE", "FRAME", "COMPONENT", "INSTANCE", "COMPONENT_SET"].includes(target.type)
          )
            throw new Error("此来源图层不支持圆角修改。");
          if (
            target.type === "TEXT" &&
            operation.changed.some(
              (key) =>
                FONT_KEYS.has(key) ||
                ["width", "height", "fill", "stroke", "strokeWidth",
                  "layoutSizingHorizontal", "layoutSizingVertical"].includes(key),
            )
          ) {
            const fonts =
              typeof target.getRangeAllFontNames === "function"
                ? target.getRangeAllFontNames(0, target.characters.length)
                : object(target.fontName)
                  ? [target.fontName]
                  : [];
            for (const font of fonts) await figma.loadFontAsync(font);
            if (
              operation.changed.some((key) =>
                ["fontFamily", "fontWeight", "fontStyle"].includes(key),
              )
            )
              await figma.loadFontAsync(patchFont(operation.after));
          }
          if (
            operation.changed.some(
              (key) => key === "constraintHorizontal" || key === "constraintVertical",
            ) &&
            ["GROUP", "BOOLEAN_OPERATION", "SECTION"].includes(target.type)
          )
            throw new Error("此来源图层不支持直接设置约束，请修改内部可编辑图层。");
        } else if (operation.op === "rename-page") {
          if (indexes.pageMappings.get(operation.designId)?.partial)
            throw new Error("选区来源没有完整页面，不能重命名原页面。");
          if (target.type !== "PAGE" || !string(operation.after?.name ?? operation.name, 120))
            throw new Error("页面重命名操作无效。");
          if (operation.before.name !== raw.name)
            conflicts.push(`${operation.sourceId} · 页面名称已变化。`);
        } else {
          if (
            operation.op === "delete-page" &&
            indexes.pageMappings.get(operation.designId)?.partial
          )
            throw new Error("选区来源没有完整页面，不能删除原页面。");
          if (canonical(comparableRest(operation.before)) !== canonical(comparableRest(raw)))
            conflicts.push(`${operation.sourceId} · 删除目标或其子树已变化。`);
          if (
            (operation.op === "delete-page" && target.type !== "PAGE") ||
            (operation.op === "delete" && target.type === "PAGE")
          )
            throw new Error("删除目标类型不匹配。");
          deletions += 1;
        }
      }
      if (
        operation.op === "create" ||
        operation.changed?.some((key) => key === "parentId" || key === "pageId")
      )
        for (const sourceId of [operation.parentSourceId, operation.pageSourceId])
          if (sourceId) await requireTarget(sourceId);
      if (operation.op === "create" || operation.changed?.includes("siblingIndex")) {
        const parent =
          operation.op === "create"
            ? targets.get(operation.parentSourceId ?? operation.pageSourceId)
            : targets.get(operation.sourceId)?.parent;
        if (parent) {
          if (parent.type === "PAGE") await parent.loadAsync();
          if (typeof parent.insertChild !== "function")
            throw new Error("此来源容器不支持图层排序。");
          for (let ancestor = parent; ancestor; ancestor = ancestor.parent)
            if (ancestor.type === "INSTANCE")
              throw new Error("Figma 实例内部图层不允许新增或重新排序，请使用新页面副本。");
          if (operation.op === "create" && parent.type === "COMPONENT_SET")
            throw new Error("组件集合只接受原生组件；请使用新页面副本。");
          const actual = parent.children.map((child) => child.id);
          for (const id of [operation.previousSiblingSourceId, operation.nextSiblingSourceId])
            if (id) {
              const sibling = await figma.getNodeByIdAsync(id);
              if (
                sibling &&
                sibling.parent !== parent &&
                indexes.mapping.get(operation.designId)?.selectionRoot
              )
                throw new Error("选区图层来自不同容器；跨容器排序请完整导出页面后修改。");
            }
          if (operation.beforeSiblingSourceIds !== undefined) {
            if (
              !Array.isArray(operation.beforeSiblingSourceIds) ||
              operation.beforeSiblingSourceIds.some((id) => !string(id, 160))
            )
              throw new Error("原始图层顺序快照无效。");
            if (canonical(actual) !== canonical(operation.beforeSiblingSourceIds))
              conflicts.push(`${parent.id} · 原始图层顺序已变化。`);
          } else if (operation.baseline) {
            const expected = indexes.baselineOrder.get(parent.id) ?? [];
            const expectedIds = new Set(expected);
            if (canonical(actual.filter((id) => expectedIds.has(id))) !== canonical(expected))
              conflicts.push(`${parent.id} · 已导入图层顺序已变化。`);
          }
        }
      }
      report.push({
        op: operation.op,
        sourceId: operation.sourceId ?? null,
        designId: operation.designId ?? null,
        name: operation.after?.name ?? operation.before?.name ?? operation.name ?? "",
        changed: operation.changed ?? [],
      });
    }
    for (const operation of patch.operations)
      if (
        operation.op === "create" ||
        operation.changed?.includes("parentId") ||
        operation.changed?.includes("pageId")
      ) {
        const parentDesignId =
          operation.parentDesignId ?? operation.after.parentId ?? operation.pageDesignId;
        if (
          !operation.parentSourceId &&
          !operation.pageSourceId &&
          !createdIds.has(parentDesignId) &&
          !indexes.sourceIds.has(parentDesignId)
        )
          throw new Error("新增或移动图层没有可核对的目标容器。");
        const sourceId = indexes.sourceIds.get(parentDesignId);
        if (sourceId) await requireTarget(sourceId);
      }
    const removedPages = patch.operations.filter((op) => op.op === "delete-page").length;
    if (
      figma.root.children.length +
        patch.operations.filter((op) => op.op === "create-page").length -
        removedPages <
      1
    )
      throw new Error("不能删除 Figma 的最后一个页面。");
    return {
      value,
      indexes,
      targets,
      currentRaw,
      geometryBefore,
      conflicts: [...new Set(conflicts)],
      report,
      deletions,
      identity: {
        verified: Boolean(patch.fileKey && figma.fileKey),
        message:
          patch.fileKey && figma.fileKey
            ? "来源文件已匹配。"
            : "来源文件无法自动确认，请确认当前打开原 Figma 文件；本次按图层 ID 和属性快照核对。",
      },
    };
  }
  function patchFont(source, bundledAlias = false) {
    let family = source.fontFamily || "Inter";
    if (
      bundledAlias &&
      ((family === "Font Awesome 5 Free" &&
        /^builtin-fa-(?:solid|regular)-5-\d+-normal$/u.test(source.fontRef || "")) ||
        (family === "Font Awesome 5 Brands" &&
          /^builtin-fa-brands-5-\d+-normal$/u.test(source.fontRef || "")))
    )
      family = family.replace(" 5 ", " 6 ");
    if (/^Font Awesome [56] (Free|Brands)$/u.test(family))
      return {
        family,
        style: family.endsWith(" Brands") || source.fontWeight < 600 ? "Regular" : "Solid",
      };
    const base = {
      100: "Thin",
      200: "Extra Light",
      300: "Light",
      400: "Regular",
      500: "Medium",
      600: "Semi Bold",
      700: "Bold",
      800: "Extra Bold",
      900: "Black",
    }[source.fontWeight];
    return {
      family,
      style:
        source.fontStyle === "italic" ? (base === "Regular" ? "Italic" : `${base} Italic`) : base,
    };
  }
  function iconOrPrivateUseText(source) {
    return (
      /font\s*awesome|material\s*(?:icons|symbols)|ionicons|icomoon|glyphicons|iconfont/iu.test(
        source.fontFamily || "",
      ) || /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/u.test(CodeShellFigmaText.nativeTextContent(source))
    );
  }
  async function applyPatch(plan, allowDeletes) {
    if (plan.conflicts.length) throw new Error("原设计已变化，请重新导出后核对。");
    if (plan.deletions && !allowDeletes)
      throw new Error("此更新包含删除，请在核对列表后明确勾选允许删除。");
    if (typeof figma.commitUndo !== "function" || typeof figma.triggerUndo !== "function")
      throw new Error("当前 Figma 版本缺少安全撤销能力。");
    const { value, indexes, targets } = plan,
      created = new Map(),
      warnings = [];
    const factory = await importTransfer(value, { factoryOnly: true });
    for (const operation of value.patch.operations)
      if (operation.op === "create" && operation.after.type === "text")
        await factory.loadFont(operation.after);
    const imageBytes = validateAssets(value.assets),
      imageHashes = new Map();
    const resolvedDesign = new Map();
    const resolveDesign = async (id) => {
      if (created.has(id)) return created.get(id);
      if (!resolvedDesign.has(id)) {
        const sourceId = indexes.sourceIds.get(id);
        resolvedDesign.set(
          id,
          sourceId ? (targets.get(sourceId) ?? (await figma.getNodeByIdAsync(sourceId))) : null,
        );
      }
      return resolvedDesign.get(id);
    };
    const parentFor = async (operation) => {
      const parent = operation.parentSourceId
        ? targets.get(operation.parentSourceId)
        : (operation.parentDesignId ?? operation.after?.parentId)
          ? await resolveDesign(operation.parentDesignId ?? operation.after.parentId)
          : operation.pageSourceId
            ? targets.get(operation.pageSourceId)
            : await resolveDesign(operation.pageDesignId);
      if (!parent || typeof parent.appendChild !== "function")
        throw new Error("找不到可写入的目标页面或容器。");
      return parent;
    };
    let mutated = false;
    figma.commitUndo();
    try {
      for (const operation of value.patch.operations) {
        const after = operation.after;
        if (operation.op === "create-page") {
          mutated = true;
          const page = figma.createPage();
          page.name = after?.name ?? operation.name;
          if (value.canvas) page.backgrounds = paints(value.canvas.background);
          created.set(operation.designId, page);
          continue;
        }
        if (operation.op === "create") {
          const parent = await parentFor(operation),
            parentSource = indexes.current.get(operation.parentDesignId ?? after.parentId);
          const pageMap = indexes.pageMappings.get(operation.pageDesignId);
          const source = { ...after, ...(containers.has(after.type) ? { children: [] } : {}) };
          if (parent.type === "PAGE" && pageMap) {
            source.x -= pageMap.offsetX;
            source.y -= pageMap.offsetY;
          }
          mutated = true;
          const node = await factory.createNode(source, parent, parentSource);
          factory.applySizing(node, source, parent, parentSource);
          created.set(operation.designId, node);
          continue;
        }
        const node = targets.get(operation.sourceId);
        if (operation.op === "rename-page") {
          mutated = true;
          node.name = after?.name ?? operation.name;
          continue;
        }
        if (operation.op === "delete" || operation.op === "delete-page") {
          mutated = true;
          node.remove();
          continue;
        }
        const changed = new Set(operation.changed),
          baseline = operation.baseline;
        const parentAfter = indexes.current.get(after.parentId),
          parentBefore = indexes.baseline.get(baseline.parentId);
        const oldGeometry = plan.geometryBefore.get(operation.sourceId),
          oldMatrix = oldGeometry?.matrix;
        if (changed.has("parentId") || changed.has("pageId")) {
          const parent = await parentFor({
            ...operation,
            parentDesignId: after.parentId,
            pageDesignId: operation.pageDesignId ?? indexes.mapping.get(operation.designId)?.pageId,
          });
          mutated = true;
          parent.appendChild(node);
        }
        if (operation.changed.some((key) => GEOMETRY_KEYS.has(key))) {
          if (!oldMatrix) throw new Error("此图层缺少可编辑变换矩阵。");
          const width = changed.has("width")
              ? (oldGeometry.width * after.width) / baseline.width
              : node.width,
            height = changed.has("height")
              ? (oldGeometry.height * after.height) / baseline.height
              : node.height;
          mutated = true;
          if (changed.has("width") || changed.has("height")) node.resize(width, height);
          const angle = ((after.rotation - baseline.rotation) * Math.PI) / 180,
            c = Math.cos(angle),
            s = Math.sin(angle);
          const a = c * oldMatrix[0][0] - s * oldMatrix[1][0],
            b = c * oldMatrix[0][1] - s * oldMatrix[1][1],
            d = s * oldMatrix[0][0] + c * oldMatrix[1][0],
            e = s * oldMatrix[0][1] + c * oldMatrix[1][1];
          const oldPage = indexes.pageMappings.get(baseline.pageId),
            nextPage = indexes.pageMappings.get(after.pageId);
          const offsetX =
              (parentBefore ? 0 : (oldPage?.offsetX ?? 0)) -
              (parentAfter ? 0 : (nextPage?.offsetX ?? 0)),
            offsetY =
              (parentBefore ? 0 : (oldPage?.offsetY ?? 0)) -
              (parentAfter ? 0 : (nextPage?.offsetY ?? 0));
          const centerX =
            oldMatrix[0][2] +
            (oldMatrix[0][0] * oldGeometry.width) / 2 +
            (oldMatrix[0][1] * oldGeometry.height) / 2 +
            after.x +
            after.width / 2 -
            (parentAfter?.x ?? 0) -
            baseline.x -
            baseline.width / 2 +
            (parentBefore?.x ?? 0) +
            offsetX;
          const centerY =
            oldMatrix[1][2] +
            (oldMatrix[1][0] * oldGeometry.width) / 2 +
            (oldMatrix[1][1] * oldGeometry.height) / 2 +
            lineBoxY(after) +
            after.height / 2 -
            (parentAfter?.y ?? 0) -
            lineBoxY(baseline) -
            baseline.height / 2 +
            (parentBefore?.y ?? 0) +
            offsetY;
          const selection = indexes.mapping.get(operation.designId);
          if (selection?.selectionRoot) {
            const desired = designWorld(
              after,
              indexes.current,
              nextPage ?? indexes.pageMappings.get(operation.pageDesignId),
            );
            const original = designWorld(baseline, indexes.baseline, oldPage),
              angle = ((desired.rotation - original.rotation) * Math.PI) / 180;
            const rotation = [
                [Math.cos(angle), -Math.sin(angle), 0],
                [Math.sin(angle), Math.cos(angle), 0],
              ],
              parentInverse = inverse(absolute(node.parent));
            const oldGlobal = multiply(selection.sourceParentTransform, oldMatrix),
              nextLocal = multiply(
                parentInverse,
                multiply(rotation, [
                  [oldGlobal[0][0], oldGlobal[0][1], 0],
                  [oldGlobal[1][0], oldGlobal[1][1], 0],
                ]),
              );
            const x =
                parentInverse[0][0] * desired.x +
                parentInverse[0][1] * desired.y +
                parentInverse[0][2],
              y =
                parentInverse[1][0] * desired.x +
                parentInverse[1][1] * desired.y +
                parentInverse[1][2];
            node.relativeTransform = [
              [
                nextLocal[0][0],
                nextLocal[0][1],
                x - (nextLocal[0][0] * width) / 2 - (nextLocal[0][1] * height) / 2,
              ],
              [
                nextLocal[1][0],
                nextLocal[1][1],
                y - (nextLocal[1][0] * width) / 2 - (nextLocal[1][1] * height) / 2,
              ],
            ];
          } else
            node.relativeTransform = [
              [a, b, centerX - (a * width) / 2 - (b * height) / 2],
              [d, e, centerY - (d * width) / 2 - (e * height) / 2],
            ];
        }
        if (changed.has("cornerRadius") || changed.has("cornerRadii")) {
          mutated = true;
          setCorners(node, after);
        }
        if (
          node.type === "TEXT" &&
          operation.changed.some((key) => key === "text" || key === "textSource")
        ) {
          mutated = true;
          node.characters = CodeShellFigmaText.nativeTextContent(after, baseline);
        }
        // This explicit Design Studio edit authorizes resolving its active CSS
        // source at the new size. Native-only resizing never enters this path.
        if ((changed.has("width") || changed.has("height")) &&
            after.fillPaints?.some((paint) => paint.cssLinear && !paint.cssLinear.sourceOnly)) {
          mutated = true;
          node.fills = paints(after.fill, after.fillPaints, node.width, node.height);
          retainCssLinearSource(node, { ...after, width: node.width, height: node.height });
        }
        for (const key of operation.changed) {
          if (GEOMETRY_KEYS.has(key) || ["cornerRadius", "cornerRadii", "text", "textSource"].includes(key)) continue;
          if (key === "opacity") {
            mutated = true;
            node.opacity =
              baseline.opacity > 0
                ? Math.min(1, Math.max(0, (node.opacity * after.opacity) / baseline.opacity))
                : after.opacity;
          } else if (
            [
              "name",
              "visible",
              "locked",
              "cornerRadius",
              "minWidth",
              "maxWidth",
              "minHeight",
              "maxHeight",
            ].includes(key)
          ) {
            mutated = true;
            node[key] =
              after[key] ??
              (["minWidth", "maxWidth", "minHeight", "maxHeight"].includes(key)
                ? null
                : after[key]);
          } else if (key === "notes") {
            mutated = true;
            node.setPluginData("codeshellNotes", after.notes ?? "");
          } else if (key === "fill" || key === "fillPaints") {
            mutated = true;
            node.fills = paints(after.fill, after.fillPaints, after.width, after.height);
            retainCssLinearSource(node, after);
          } else if (key === "stroke") {
            mutated = true;
            node.strokes = paints(after.stroke);
          } else if (key === "strokeWidth") {
            mutated = true;
            node.strokeWeight = after.strokeWidth;
          } else if (key === "clipContent") {
            mutated = true;
            node.clipsContent = after.clipContent === true;
          } else if (key === "shadow") {
            mutated = true;
            node.effects = after.shadow
              ? [
                  {
                    type: "DROP_SHADOW",
                    color: { ...rgb(after.shadow.color), a: after.shadow.opacity },
                    offset: { x: after.shadow.x, y: after.shadow.y },
                    radius: after.shadow.blur,
                    spread: 0,
                    visible: true,
                    blendMode: "NORMAL",
                  },
                ]
              : [];
          } else if (key === "imageRef" || key === "objectFit") {
            if (!imageHashes.has(after.imageRef))
              imageHashes.set(
                after.imageRef,
                figma.createImage(imageBytes.get(after.imageRef)).hash,
              );
            mutated = true;
            node.fills = [
              {
                type: "IMAGE",
                imageHash: imageHashes.get(after.imageRef),
                scaleMode: after.objectFit === "contain" ? "FIT" : "FILL",
              },
            ];
          } else if (["fontFamily", "fontWeight", "fontStyle"].includes(key)) {
            mutated = true;
            node.fontName = patchFont(after);
          } else if (key === "fontSize") {
            mutated = true;
            node.fontSize = after.fontSize;
          } else if (key === "lineHeight") {
            mutated = true;
            node.lineHeight = { unit: "PERCENT", value: after.lineHeight * 100 };
          } else if (key === "textAlign") {
            mutated = true;
            node.textAlignHorizontal = after.textAlign.toUpperCase();
          } else if (key === "letterSpacing") {
            mutated = true;
            node.letterSpacing = { unit: "PIXELS", value: after.letterSpacing ?? 0 };
          } else if (key === "textDecoration") {
            mutated = true;
            node.textDecoration =
              { underline: "UNDERLINE", "line-through": "STRIKETHROUGH" }[after.textDecoration] ??
              "NONE";
          }
        }
        for (const key of operation.changed)
          if (LAYOUT_KEYS.has(key)) {
            mutated = true;
            if (key === "layout")
              node.layoutMode =
                { horizontal: "HORIZONTAL", vertical: "VERTICAL" }[after.layout] ?? "NONE";
            else if (key === "layoutWrap") {
              if (node.layoutMode !== "HORIZONTAL")
                throw new Error("Figma 仅水平自动布局支持换行。");
              node.layoutWrap = after.layoutWrap === "wrap" ? "WRAP" : "NO_WRAP";
            } else if (key === "gap") node.itemSpacing = after.gap;
            else if (key === "rowGap") {
              if (node.layoutMode === "HORIZONTAL" && node.layoutWrap === "WRAP")
                node.counterAxisSpacing = after.rowGap ?? after.gap;
              else if (node.layoutMode === "VERTICAL") node.itemSpacing = after.rowGap ?? after.gap;
            } else if (key === "columnGap" && node.layoutMode === "HORIZONTAL")
              node.itemSpacing = after.columnGap ?? after.gap;
            else if (key === "padding")
              for (const side of ["Top", "Right", "Bottom", "Left"])
                node[`padding${side}`] = after[`padding${side}`] ?? after.padding;
            else if (key.startsWith("padding")) node[key] = after[key] ?? after.padding;
            else if (key === "alignItems")
              node.counterAxisAlignItems = {
                start: "MIN",
                center: "CENTER",
                end: "MAX",
                baseline: "BASELINE",
                stretch: "MIN",
              }[after.alignItems];
            else if (key === "justifyContent")
              node.primaryAxisAlignItems = {
                start: "MIN",
                center: "CENTER",
                end: "MAX",
                "space-between": "SPACE_BETWEEN",
              }[after.justifyContent];
            else if (key === "alignContent" && node.layoutWrap === "WRAP")
              node.counterAxisAlignContent =
                after.alignContent === "space-between" ? "SPACE_BETWEEN" : "AUTO";
          }
        for (const key of operation.changed) {
          if (key === "layoutSizingHorizontal" || key === "layoutSizingVertical") {
            mutated = true;
            node[key] = (after[key] ?? "fixed").toUpperCase();
          } else if (key === "layoutPositioning") {
            mutated = true;
            node.layoutPositioning = after.layoutPositioning === "absolute" ? "ABSOLUTE" : "AUTO";
          } else if (key === "layoutAlignSelf") {
            mutated = true;
            node.layoutAlign = after.layoutAlignSelf === "stretch" ? "STRETCH" : "INHERIT";
          }
        }
        if (node.type === "TEXT" && changed.has("textOverflow")) {
          const plan = CodeShellFigmaText.nativeTextPlan(after, baseline);
          mutated = true;
          node.textTruncation = plan.truncation;
          node.maxLines = plan.maxLines;
        }
        if (changed.has("constraintHorizontal") || changed.has("constraintVertical")) {
          mutated = true;
          node.constraints = {
            horizontal:
              { start: "MIN", center: "CENTER", end: "MAX", stretch: "STRETCH", scale: "SCALE" }[
                after.constraintHorizontal
              ] ?? "MIN",
            vertical:
              { start: "MIN", center: "CENTER", end: "MAX", stretch: "STRETCH", scale: "SCALE" }[
                after.constraintVertical
              ] ?? "MIN",
          };
        }
        const metadata = operation.changed.filter((key) =>
          [
            "textSource",
            "textFlow",
            "textFlowWidth",
            "textMeasurement",
            "textOverflow",
            "layoutBaselineOffset",
            "fontRef",
            "effectClipping",
            "contentClipping",
            "constraintLeft",
            "constraintRight",
            "constraintTop",
            "constraintBottom",
            "constraintBaseWidth",
            "constraintBaseHeight",
          ].includes(key),
        );
        if (metadata.length) {
          mutated = true;
          node.setPluginData(
            "codeshellDesignMetadata",
            JSON.stringify(Object.fromEntries(metadata.map((key) => [key, after[key] ?? null]))),
          );
          warnings.push(
            `${after.name}: ${metadata.join(", ")} 为设计面板的排版元数据，已作为插件数据保留。`,
          );
        }
      }
      // Reconcile each touched sibling group after creates exist. Unknown layers retain their slots.
      const orderGroups = new Map();
      for (const operation of value.patch.operations)
        if (
          operation.op === "create" ||
          operation.changed?.some((key) => ["siblingIndex", "parentId", "pageId"].includes(key))
        ) {
          const node =
              operation.op === "create"
                ? created.get(operation.designId)
                : targets.get(operation.sourceId),
            parent = node?.parent;
          if (!node || !parent || typeof parent.insertChild !== "function")
            throw new Error("图层排序目标不可用。");
          const key = JSON.stringify([
            operation.after.pageId ?? operation.pageDesignId,
            operation.after.parentId ?? null,
          ]);
          orderGroups.set(parent.id, { parent, desired: indexes.siblings.get(key) ?? [] });
        }
      for (const { parent, desired } of orderGroups.values()) {
        const known = [];
        for (const candidate of desired) {
          const node = await resolveDesign(candidate.id);
          if (node?.parent === parent) known.push(node);
        }
        const knownSet = new Set(known),
          actual = [...parent.children];
        let cursor = 0;
        const target = actual.map((node) => (knownSet.has(node) ? known[cursor++] : node));
        for (let index = target.length - 1; index >= 0; index -= 1) {
          const node = target[index];
          if (!knownSet.has(node) || actual[index] === node) continue;
          const previous = actual.indexOf(node);
          mutated = true;
          parent.appendChild(node);
          if (index < actual.length - 1) parent.insertChild(index, node);
          actual.splice(previous, 1);
          actual.splice(index, 0, node);
        }
      }
      figma.commitUndo();
      warnings.push(...factory.warnings);
      return { operations: value.patch.operations.length, warnings };
    } catch (error) {
      if (mutated) {
        figma.commitUndo();
        figma.triggerUndo();
      }
      throw new Error(`增量更新失败${mutated ? "，已请求撤销本次操作" : ""}：${error.message}`);
    }
  }

  async function exportJson(scope) {
    const page = figma.currentPage;
    await page.loadAsync();
    const selection = [...page.selection];
    if (scope === "selection" && !selection.length) throw new Error("请先选择要导出的图层。");
    const roots =
      scope === "selection"
        ? selection.filter((node) => {
            let parent = node.parent;
            while (parent && parent !== page) {
              if (selection.includes(parent)) return false;
              parent = parent.parent;
            }
            return true;
          })
        : [page];
    const nodes = {};
    for (const node of roots) {
      const response = await node.exportAsync({ format: "JSON_REST_V1" });
      if (!object(response)) throw new Error("Figma 返回了不支持的 JSON_REST_V1 结果。");
      // The plugin API returns a direct { document, ... } export. REST responses may wrap nodes.
      const exported = object(response.document) ? { [node.id]: response } : response.nodes;
      if (!object(exported)) throw new Error("Figma 返回了不支持的 JSON_REST_V1 结果。");
      for (const [id, entry] of Object.entries(exported)) {
        if (!object(entry?.document)) throw new Error("Figma 导出没有包含 document。");
        const native = id === node.id ? node : await figma.getNodeByIdAsync(id);
        if (native) preserveNativeGrid(entry.document, native);
        nodes[id] = entry;
      }
    }
    const assets = {},
      previews = {},
      warnings = [];
    let assetBytes = 0,
      visited = 0,
      previewCount = 0;
    const addAsset = (id, bytes) => {
      if (hasOwn(assets, id)) return;
      const mime = imageMime(bytes);
      if (!mime) {
        warnings.push(`${id}: 图片格式不受支持。`);
        return;
      }
      if (
        bytes.length > MAX_ASSET ||
        assetBytes + bytes.length > MAX_ASSETS_TOTAL ||
        Object.keys(assets).length >= 2048
      )
        throw new Error("本地图片超过资源上限；请分页面或选区导出。");
      assets[id] = { mime, base64: encode64(bytes) };
      assetBytes += bytes.length;
    };
    const collect = async (node, depth = 0, ancestorPreview = false) => {
      if (++visited > MAX_TOTAL || depth > 34) throw new Error("导出图层超过数量或深度上限。");
      const fills = Array.isArray(node.fills)
        ? node.fills.filter((paint) => paint.visible !== false)
        : [];
      const strokes = Array.isArray(node.strokes)
        ? node.strokes.filter((paint) => paint.visible !== false)
        : [];
      for (const paint of [...fills, ...strokes])
        if (paint.type === "IMAGE" && paint.imageHash && !hasOwn(assets, paint.imageHash)) {
          const image = figma.getImageByHash(paint.imageHash);
          if (image) addAsset(paint.imageHash, await image.getBytesAsync());
          else warnings.push(`${node.name}: 无法读取图片 ${paint.imageHash}。`);
        }
      const children = Array.isArray(node.children) ? node.children : [];
      const plain = [
        "PAGE",
        "FRAME",
        "GROUP",
        "COMPONENT",
        "COMPONENT_SET",
        "INSTANCE",
        "SECTION",
        "RECTANGLE",
        "ELLIPSE",
        "TEXT",
      ].includes(node.type);
      const complex =
        !plain ||
        (fills.some(paint => paint.type === "IMAGE")
          ? fills.length > 1
          : (fills.length > 0 && !CodeShellFigmaPaint.figmaFillPaints(fills))) ||
        fills.some((paint) => !["SOLID", "IMAGE", "GRADIENT_LINEAR"].includes(paint.type)) ||
        children.some((child) => child.isMask) ||
        node.isMask ||
        (node.type === "TEXT" &&
          (node.fontName === figma.mixed ||
            node.fontSize === figma.mixed ||
            node.fills === figma.mixed)) ||
        (node.type === "ELLIPSE" &&
          node.arcData &&
          (node.arcData.innerRadius ||
            Math.abs(node.arcData.endingAngle - node.arcData.startingAngle - Math.PI * 2) >
              0.0001));
      if (complex && node.type !== "PAGE" && !ancestorPreview) {
        if (++previewCount > 256) throw new Error("复杂图层超过 256 个；请缩小导出选区。");
        const id = `preview-${node.id}`;
        const box = node.absoluteRenderBounds ?? node.absoluteBoundingBox;
        if (box && box.width > 0 && box.height > 0) {
          const scale = Math.min(1, 4096 / Math.max(box.width, box.height));
          addAsset(
            id,
            await node.exportAsync({
              format: "PNG",
              constraint: { type: "SCALE", value: scale },
              useAbsoluteBounds: true,
            }),
          );
          const svg = await node.exportAsync({ format: "SVG_STRING", svgOutlineText: true });
          previews[node.id] = {
            assetId: id,
            bounds: { x: box.x, y: box.y, width: box.width, height: box.height },
            ...(typeof svg === "string" && utf8Length(svg) <= 1024 * 1024 ? { svg } : {}),
          };
        } else warnings.push(`${node.name}: 缺少预览边界。`);
      }
      for (const child of children)
        await collect(child, depth + 1, ancestorPreview || (complex && node.type !== "PAGE"));
    };
    for (const node of roots) await collect(node);
    const context =
      scope === "selection"
        ? {
            pageId: page.id,
            pageName: page.name,
            roots: Object.fromEntries(
              roots.map((node) => [
                node.id,
                {
                  parentId: node.parent.id,
                  parentTransform: absolute(node.parent),
                  absoluteTransform: absolute(node),
                  width: node.width,
                  height: node.height,
                },
              ]),
            ),
          }
        : null;
    const value = {
      format: "codeshell.figma.source",
      version: 1,
      name: `${page.name}${scope === "selection" ? " Selection" : ""}`,
      ...(figma.fileKey ? { fileKey: figma.fileKey } : {}),
      nodes,
      assets,
      previews,
      ...(context ? { selection: context } : {}),
      warnings: warnings.slice(0, 200),
    };
    const content = JSON.stringify(value, null, 2);
    if (utf8Length(content) > MAX_BYTES)
      throw new Error("导出超过 16 MiB；请改为选择少量图层后导出。");
    return { content, filename: "figma-design.json" };
  }

  figma.ui.onmessage = async (message) => {
    if (busy) {
      post({ type: "error", message: "请等待当前操作完成。" });
      return;
    }
    if (
      !object(message) ||
      !["import-transfer", "export-json", "preview-patch", "apply-patch"].includes(message.type)
    )
      return;
    busy = true;
    try {
      if (message.type === "import-transfer" || message.type === "preview-patch") {
        preview = null;
        if (typeof message.content !== "string" || utf8Length(message.content) > MAX_BYTES)
          throw new Error("传输包过大；上限 16 MiB。");
        let value;
        try {
          value = JSON.parse(message.content);
        } catch {
          throw new Error("传输包 JSON 无法解析。");
        }
        if (message.type === "preview-patch") {
          const plan = await preflightPatch(value),
            token = `preview-${++previewSerial}`;
          if (!plan.conflicts.length) preview = { token, value };
          post({
            type: "patch-preview",
            token,
            operations: plan.report,
            conflicts: plan.conflicts,
            deletions: plan.deletions,
            identity: plan.identity,
          });
        } else post({ type: "imported", ...(await importTransfer(value)) });
      } else if (message.type === "apply-patch") {
        if (!preview || message.token !== preview.token)
          throw new Error("请先预览并核对原设计修改。");
        const value = preview.value;
        preview = null;
        const plan = await preflightPatch(value);
        post({ type: "patched", ...(await applyPatch(plan, message.allowDeletes === true)) });
      } else {
        if (!["page", "selection"].includes(message.scope)) throw new Error("未知的导出范围。");
        post({ type: "exported", ...(await exportJson(message.scope)) });
      }
    } catch (error) {
      post({ type: "error", message: error?.message || String(error) });
    } finally {
      busy = false;
    }
  };
})();
