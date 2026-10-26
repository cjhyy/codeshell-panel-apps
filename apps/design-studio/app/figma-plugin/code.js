/* BEGIN GENERATED SPACING RUNTIME */
"use strict";var CodeShellFigmaSpacing=(()=>{var u=Object.defineProperty;var w=Object.getOwnPropertyDescriptor;var m=Object.getOwnPropertyNames;var g=Object.prototype.hasOwnProperty;var v=(t,r)=>{for(var i in r)u(t,i,{get:r[i],enumerable:!0})},y=(t,r,i,a)=>{if(r&&typeof r=="object"||typeof r=="function")for(let o of m(r))!g.call(t,o)&&o!==i&&u(t,o,{get:()=>r[o],enumerable:!(a=w(r,o))||a.enumerable});return t};var h=t=>y(u({},"__esModule",{value:!0}),t);var G={};v(G,{mainAxisGap:()=>n,nativeMainGap:()=>s,validateLayoutSpacing:()=>l,validateNativeLayoutSpacing:()=>c});var n=t=>t?.[t.layout==="vertical"?"rowGap":"columnGap"]??t?.gap??0;function l(t){for(let i of["gap","rowGap","columnGap"])if(t[i]!==void 0&&(!Number.isFinite(t[i])||t[i]<-2e3||t[i]>2e3))throw new Error(`${i} 必须为 -2000–2000 的有限间距`);if(!["gap","rowGap","columnGap"].some(i=>t[i]<0))return;let r=t.layout==="horizontal";if(!["horizontal","vertical"].includes(t.layout))throw new Error("负间距只支持水平或垂直主轴；Grid 和自由布局不能使用负间距");if(t.layoutWrap&&t.layoutWrap!=="none")throw new Error("负间距换行尚不能可靠映射到原生与 CSS 布局");if(t.layoutReverse)throw new Error("负间距反向布局尚不支持");if(t[r?"rowGap":"columnGap"]<0)throw new Error("交叉轴间距不能为负数");if(t[r?"layoutSizingHorizontal":"layoutSizingVertical"]==="hug")throw new Error("负间距主轴的 Hug 尺寸尚未验证；请使用固定或 Fill 尺寸")}function s(t,r=t.children??[]){let i=n(t);if(!Array.isArray(r)||r.length>1e4)throw new Error("原生间距子项必须为有界数组");let a=r.filter(e=>e.visible!==!1&&e.layoutPositioning!=="absolute");if(i>=0||a.length<2)return{requested:i,effective:i,minimum:null};let o=t.layout==="vertical"?"height":"width",f=a.map(e=>e[o]);if(f.some(e=>!Number.isFinite(e)||e<=0))throw new Error("原生负间距需要可核对的可见 AUTO 子项主轴尺寸");let p=Math.min(...f);return{requested:i,effective:Math.max(i,-p),minimum:p}}function c(t,r=t.children??[]){l(t);let i=s(t,r);if(n(t)<0&&(t.rotation||r.some(a=>a.visible!==!1&&a.layoutPositioning!=="absolute"&&a.rotation)))throw Object.assign(new Error("旋转子项的原生负间距主轴尺寸尚未验证"),{code:"NATIVE_NEGATIVE_SPACING"});if(i.effective-i.requested>1e-4)throw Object.assign(new Error(`原生负间距 ${i.requested}px 会被最小可见 AUTO 子项 ${i.minimum}px 限制为 ${i.effective}px；请调整间距或使用已验证的流关系`),{code:"NATIVE_NEGATIVE_SPACING"});return i}return h(G);})();
/* END GENERATED SPACING RUNTIME */
/* BEGIN GENERATED GRID RUNTIME */
"use strict";var CodeShellFigmaGrid=(()=>{var H=Object.defineProperty;var W=Object.getOwnPropertyDescriptor;var U=Object.getOwnPropertyNames;var X=Object.prototype.hasOwnProperty;var j=(t,r)=>{for(var e in r)H(t,e,{get:r[e],enumerable:!0})},B=(t,r,e,o)=>{if(r&&typeof r=="object"||typeof r=="function")for(let l of U(r))!X.call(t,l)&&l!==e&&H(t,l,{get:()=>r[l],enumerable:!(o=W(r,l))||o.enumerable});return t};var D=t=>B(H({},"__esModule",{value:!0}),t);var Y={};j(Y,{configureNativeGrid:()=>b,finishNativeGrid:()=>M,nativeGridPlan:()=>R,positionNativeGridChild:()=>L,validateGridFields:()=>G});function k(t){return Number.isFinite(t.lineHeight)?t.lineHeightUnit===void 0?t.lineHeight>=.7&&t.lineHeight<=3:t.lineHeightUnit==="pixels"&&t.lineHeight>=.7&&t.lineHeight<=720:!1}var O=t=>t.lineHeightUnit==="pixels"?t.lineHeight:(t.fontSize??16)*(t.lineHeight??1.2),v=t=>O(t)/(t.fontSize??16);var V=Object.freeze(["gridRows","gridColumnSizes","gridRowSizes","gridItemsPositioning","gridAutoTracks"]),rt=Object.freeze(["gridRowAnchorIndex","gridColumnAnchorIndex","gridChildHorizontalAlign","gridChildVerticalAlign"]),E=(t,r,e)=>Number.isInteger(t)&&t>=r&&t<=e;function q(t){if(!Array.isArray(t)||!t.length||t.length>24)throw new Error("Grid tracks 必须为 1–24 项");return t.map(r=>{if(!r||typeof r!="object"||Array.isArray(r)||Object.keys(r).some(o=>!["type","value"].includes(o))||!["fixed","flex","hug"].includes(r.type))throw new Error("Grid track 类型无效");if(r.type==="hug"){if(r.value!==void 0)throw new Error("HUG track 不接受 value");return{type:"hug"}}let e=r.value??(r.type==="flex"?1:void 0);if(!Number.isFinite(e)||e<0||r.type==="flex"&&e===0||e>2e4)throw new Error("Grid track value 超出范围");return{type:r.type,value:e}})}function G(t,r=!1){for(let e of["gridRows","gridColumns","gridColumnSpan","gridRowSpan"])if(t[e]!==void 0&&!E(t[e],1,24))throw new Error(`${e} 必须为 1–24`);for(let e of["gridRowAnchorIndex","gridColumnAnchorIndex"])if(t[e]!==void 0&&!E(t[e],0,9999))throw new Error(`${e} 必须为 0–9999`);if(t.gridRowAnchorIndex===void 0!=(t.gridColumnAnchorIndex===void 0))throw new Error("Grid manual anchors 必须同时包含行和列");for(let e of["gridChildHorizontalAlign","gridChildVerticalAlign"])if(t[e]!==void 0&&!["auto","start","center","end"].includes(t[e]))throw new Error(`${e} 无效`);if(!r&&V.some(e=>t[e]!==void 0))throw new Error("Grid container 字段只适用于容器");if(t.gridItemsPositioning!==void 0&&!["manual","row-auto-flow"].includes(t.gridItemsPositioning))throw new Error("gridItemsPositioning 无效");if(t.gridAutoTracks!==void 0&&!["none","rows"].includes(t.gridAutoTracks))throw new Error("gridAutoTracks 无效");for(let[e,o]of[["gridColumnSizes",t.gridColumns],["gridRowSizes",t.gridRows]])if(t[e]!==void 0){let l=q(t[e]);if(o===void 0||l.length!==o)throw new Error(`${e} 数量与 grid count 不一致`)}if(r&&t.layout==="grid"&&t.gridItemsPositioning==="manual"&&Array.isArray(t.children)){let e=P(t.children,t.gridColumns??1,t);if(t.gridAutoTracks!=="rows"&&t.gridRows!==void 0&&e.rowCount>t.gridRows)throw new Error("Grid manual anchors/spans 超出 gridRows")}}function P(t,r,e={}){if(!E(r,1,24))throw new Error("Grid columns 必须为 1–24");let o=new Set,l=[],a=0,h=(n,u,f,g)=>{if(u+g>r)return!1;for(let y=n;y<n+f;y++)for(let p=u;p<u+g;p++)if(o.has(y*r+p))return!1;return!0};for(let n of t){if(!n||typeof n!="object")throw new Error("Grid 子项无效");for(let w of["gridColumnSpan","gridRowSpan"])if(n[w]!==void 0&&!E(n[w],1,24))throw new Error(`${w} 必须为 1–24`);for(let w of["gridRowAnchorIndex","gridColumnAnchorIndex"])if(n[w]!==void 0&&!E(n[w],0,9999))throw new Error(`${w} 必须为 0–9999`);if(n.visible===!1||n.layoutPositioning==="absolute")continue;let u=Math.min(r,Math.max(1,n.gridColumnSpan??1)),f=Math.max(1,n.gridRowSpan??1),g=e.gridItemsPositioning==="manual"&&Number.isInteger(n.gridRowAnchorIndex)&&Number.isInteger(n.gridColumnAnchorIndex),y=e.gridItemsPositioning==="row-auto-flow"?a:0,p=g?n.gridRowAnchorIndex:Math.floor(y/r),m=g?n.gridColumnAnchorIndex:y%r;if(g&&!h(p,m,f,u))throw new Error(`${n.name??n.id}: Grid placement 重叠或超出列范围`);for(;!g&&!h(p,m,f,u);)y++,p=Math.floor(y/r),m=y%r;for(let w=p;w<p+f;w++)for(let S=m;S<m+u;S++)o.add(w*r+S);a=p*r+m+u,l.push({child:n,row:p,column:m,rowSpan:f,columnSpan:u})}return{placements:l,rowCount:Math.max(0,...l.map(n=>n.row+n.rowSpan))}}function J(t,r,e=r?.children,o,l){let a=i=>["minWidth","maxWidth","minHeight","maxHeight"].every(d=>i[d]===void 0),h=i=>!(i.strokeWidth>0)&&(i.strokeSides===void 0||Array.isArray(i.strokeSides)&&Array.from(i.strokeSides).every(d=>d&&d.width===0))&&!i.strokeLayoutExcluded,n=i=>(i.paddingTop??i.padding??0)+(i.paddingBottom??i.padding??0),u=i=>["Top","Right","Bottom","Left"].every(d=>{let s=i[`padding${d}`]??i.padding??0;return Number.isFinite(s)&&s>=0&&s<=2e3}),f=i=>i.rowGap??i.gap??0,g=i=>Number.isFinite(f(i))&&f(i)>=0&&f(i)<=2e3,y=t?.layoutSizingHorizontal==="fill"&&o?.layout==="vertical"&&o.layoutSizingHorizontal==="fixed"&&Number.isFinite(o.width)&&o.width>=1&&o.width<=2e4&&a(o)&&!o.rotation&&!o.layoutReverse&&(!o.layoutWrap||o.layoutWrap==="none")&&t.layoutPositioning!=="absolute"&&!t.layoutMarginBefore&&a(t),p=(()=>{if(y&&(!l||l(t)===o))return!0;if(t?.layoutSizingHorizontal!=="fill"||typeof l!="function")return!1;let i=new Set([t]),d=t,s=o;for(let A=0;A<32;A+=1){if(!s||typeof s!="object"||i.has(s)||l(d)!==s||s.type!=="frame"||s.layout!=="vertical"||[d,s].some(c=>c.visible===!1||c.rotation||c.layoutPositioning==="absolute"||c.layoutReverse||c.layoutMarginBefore||c.layoutWrap&&c.layoutWrap!=="none"||!a(c))||!Number.isFinite(s.width)||s.width<1||s.width>2e4||!u(s)||!g(s)||!h(s)||![void 0,"start","stretch"].includes(s.alignItems)||![void 0,"auto","start","stretch"].includes(d.layoutAlignSelf))return!1;i.add(s);let x=l(s);if(s.layoutSizingHorizontal==="fixed"||s.layoutSizingHorizontal===void 0&&x===null)return!0;if(s.layoutSizingHorizontal!=="fill")return!1;d=s,s=x}return!1})(),m=t?.strokeAlign==="inside"&&!t.strokeLayoutExcluded&&Array.isArray(t.strokeSides)&&t.strokeSides.length===4&&Array.from(t.strokeSides).every((i,d)=>i&&i.width===(d===2?1:0))&&["Top","Right","Left"].every(i=>(t[`padding${i}`]??t.padding??0)===0)&&(t.paddingBottom??t.padding??0)===1,w=t?.strokeAlign==="center"&&!t.strokeLayoutExcluded&&Array.isArray(t.strokeSides)&&t.strokeSides.length===4&&Array.from(t.strokeSides).every((i,d)=>i&&i.width===(d===2?1:0))&&["Top","Right","Bottom","Left"].every(i=>(t[`padding${i}`]??t.padding??0)===0);if(!t||!r||t.layout!=="grid"||t.layoutSizingHorizontal!=="fixed"&&!p||t.layoutSizingVertical!=="hug"||t.gridRows!==1||t.gridRowSizes?.length!==1||t.gridRowSizes[0].type!=="hug"||t.gridColumnSizes?.some(i=>!["fixed","flex"].includes(i.type))||t.rotation||t.layoutReverse||t.layoutWrap&&t.layoutWrap!=="none"||t.justifyContent&&t.justifyContent!=="start"||t.alignContent&&t.alignContent!=="start"||t.alignItems&&t.alignItems!=="start"||n(t)!==0&&!m||!a(t)||!h(t)&&!m&&!w||r.type!=="frame"||r.layout!=="vertical"||r.layoutSizingHorizontal!=="fill"||r.layoutSizingVertical!=="fill"||(r.gridRowSpan??1)!==1||r.visible===!1||r.layoutPositioning==="absolute"||r.rotation||r.layoutReverse||r.layoutWrap&&r.layoutWrap!=="none"||r.layoutMarginBefore||r.justifyContent&&r.justifyContent!=="start"||r.alignItems&&r.alignItems!=="start"||!g(r)||!u(r)||!a(r)||!h(r))return null;let S=i=>typeof e=="function"?e(i):i===r?e:i.children,F=i=>i.type==="text"&&i.layoutSizingVertical==="hug"&&i.layoutSizingHorizontal==="fill"&&i.textFlow==="wrap"&&i.textOverflow===void 0&&typeof i.textSource=="string"&&i.textSource.length<=4e3&&/[^\t\n\f\r ]/u.test(i.textSource)&&Number.isFinite(i.fontSize)&&i.fontSize>=6&&i.fontSize<=240&&k(i)&&v(i)>=.7&&v(i)<=3&&(i.letterSpacing??0)===0&&(i.textAlign??"left")==="left"&&(i.textDecoration??"none")==="none",C=i=>i.children===void 0&&i.visible!==!1&&i.layoutPositioning!=="absolute"&&!i.rotation&&!i.layoutMarginBefore&&Number.isFinite(i.height)&&i.height>=1&&i.height<=2e4&&a(i)&&h(i),z=S(r);if(!Array.isArray(z)||!z.length)return null;let I=z[0];if(z.length===1&&I?.type==="rectangle")return!w&&I.layoutSizingVertical==="fixed"&&["fixed","fill"].includes(I.layoutSizingHorizontal)&&n(r)===0&&(r.gap??0)===0&&(r.rowGap??0)===0&&C(I)?I.height:null;let T=new Set([r]),_=1,$=(i,d)=>!i||typeof i!="object"||T.has(i)||d>4||++_>32?null:(T.add(i),F(i)?C(i)?i.height:null:i.type!=="frame"||i.layout!=="vertical"||i.layoutSizingVertical!=="hug"||!["fixed","fill"].includes(i.layoutSizingHorizontal)||!Number.isFinite(i.width)||i.width<1||i.width>2e4||i.visible===!1||i.layoutPositioning==="absolute"||i.rotation||i.layoutReverse||i.layoutMarginBefore||i.layoutWrap&&i.layoutWrap!=="none"||i.justifyContent&&i.justifyContent!=="start"||i.alignItems&&i.alignItems!=="start"||![void 0,"auto","start"].includes(i.layoutAlignSelf)&&!(i.layoutAlignSelf==="stretch"&&i.layoutSizingHorizontal==="fill")||!u(i)||!g(i)||!a(i)||!h(i)?null:N(i,d)),N=(i,d)=>{let s=i===r?z:S(i);if(!Array.isArray(s)||!s.length||s.length>16||!Array.from(s).every(x=>x&&(x.type==="frame"||s.length===1&&x.type==="text")))return null;let A=n(i)+f(i)*(s.length-1);for(let x of s){let c=$(x,d+1);if(c===null)return null;A+=c}return A>=1&&A<=2e4?A:null};return N(r,0)}function K(t,r){return t.gridAutoTracks==="rows"?Math.max(1,r):Math.max(1,t.gridRows??r,r)}function Q(t,r){return t.gridRowSizes?Array.from({length:r},(e,o)=>t.gridRowSizes[o]??{type:"hug"}):void 0}function R(t,r,e){G(t,!0);let o=t.gridColumns??1,l=P(t.children??[],o,t),a=K(t,l.rowCount);if(a>24)throw new Error("原生 Grid 互换最多保留 24 行；请拆分网格");if(l.rowCount>a)throw new Error("Grid children 超出 gridRows；请增加行数");if(t.gridAutoTracks==="rows"&&t.gridItemsPositioning==="manual"){let u=new Set;for(let f of l.placements)for(let g=f.row;g<f.row+f.rowSpan;g++)u.add(g);if(u.size&&u.size!==a)throw new Error("自动 Grid 行中的空白手动行不能保留；请移除空行或关闭自动行")}let h=t.gridColumnSizes??Array.from({length:o},()=>({type:"flex",value:1})),n=Q(t,a)??Array.from({length:a},()=>({type:"hug"}));for(let[u,f]of[["Horizontal",h],["Vertical",n]]){for(let g of l.placements){let y=g.child,p=y.layoutAlignSelf==="stretch"||(!y.layoutAlignSelf||y.layoutAlignSelf==="auto")&&t.alignItems==="stretch",m=u==="Horizontal"?g.column:g.row,w=u==="Horizontal"?g.columnSpan:g.rowSpan;if((y[`layoutSizing${u}`]==="fill"||p)&&f.slice(m,m+w).some(S=>S.type==="hug")&&!(u==="Vertical"&&J(t,y,y.children,r,e)!==null))throw new Error(`Grid ${u}: FILL 子项与 HUG track 的内在尺寸循环尚不能保留；请改为固定 track 或 HUG/固定子项`)}if(t[`layoutSizing${u}`]==="hug"&&f.some(g=>g.type==="flex"))throw new Error(`Grid ${u}: HUG 容器不能包含 FLEX track；请改为 FIXED/HUG track 或固定容器尺寸`)}if(t.layoutReverse||t.layoutWrap&&t.layoutWrap!=="none"||t.justifyContent!=="start"||t.alignContent&&t.alignContent!=="start")throw new Error("Grid 反向/换行/track 分布不能对应 Figma；请使用 start 分布");return{columns:o,rows:a,columnSizes:h,rowSizes:n,...l}}function b(t,r,e,o){let l=R(r,e,o);for(let a of["gridColumnCount","gridRowCount","gridRowSizes","gridColumnSizes","gridAutoTracks","gridItemsPositioning"])if(!(a in t))throw new Error(`${r.name}: 当前 Figma 不支持原生 GRID API (${a})，请更新 Figma 后重试`);t.layoutMode="GRID",t.layoutSizingHorizontal="FIXED",t.layoutSizingVertical="FIXED",t.gridAutoTracks="NONE",t.gridItemsPositioning="MANUAL",t.gridColumnCount=l.columns,t.gridRowCount=l.rows,t.gridColumnGap=r.columnGap??r.gap,t.gridRowGap=r.rowGap??r.gap;for(let a of["Top","Right","Bottom","Left"])t[`padding${a}`]=r[`padding${a}`]??r.padding;for(let[a,h]of[["gridColumnSizes",l.columnSizes],["gridRowSizes",l.rowSizes]]){let n=t[a];if(n.length!==h.length)throw new Error(`${r.name}: Figma Grid track 数量不匹配`);h.forEach((u,f)=>{n[f].type=u.type.toUpperCase(),u.type!=="hug"&&(n[f].value=u.value??1)})}return l}function L(t,r,e,o){if(t.layoutPositioning=r.layoutPositioning==="absolute"?"ABSOLUTE":"AUTO",r.layoutPositioning==="absolute")return;let l=r.visible===!1,a=l?{row:o.rows,column:0,rowSpan:r.gridRowSpan??1,columnSpan:Math.min(o.columns,r.gridColumnSpan??1)}:o.placements.find(h=>h.child===r);if(typeof t.setGridChildPosition!="function")throw new Error("当前 Figma 不支持 Grid 子项位置；请更新后重试");l&&(t.parent.gridRowCount=Math.max(t.parent.gridRowCount,a.row+a.rowSpan),t.visible=!0),t.setGridChildPosition(a.row,a.column),t.gridColumnSpan=a.columnSpan,t.gridRowSpan=a.rowSpan,l&&(t.visible=!1);for(let h of["Horizontal","Vertical"]){let n=`gridChild${h}Align`,u=r[n]??(r.layoutAlignSelf&&r.layoutAlignSelf!=="auto"?r.layoutAlignSelf:e.alignItems);t[n]={start:"MIN",center:"CENTER",end:"MAX",stretch:"MIN",auto:"AUTO"}[u]??"MIN"}}function M(t,r,e,o){t.gridRowCount=R(r,e,o).rows,t.gridItemsPositioning=r.gridItemsPositioning==="row-auto-flow"?"ROW_AUTO_FLOW":"MANUAL",t.gridAutoTracks=r.gridAutoTracks==="rows"?"ROWS":"NONE"}return D(Y);})();
/* END GENERATED GRID RUNTIME */
/* BEGIN GENERATED PAINT RUNTIME */
"use strict";var CodeShellFigmaPaint=(()=>{var A=Object.defineProperty;var at=Object.getOwnPropertyDescriptor;var lt=Object.getOwnPropertyNames;var ct=Object.prototype.hasOwnProperty;var ut=(t,r)=>{for(var e in r)A(t,e,{get:r[e],enumerable:!0})},ft=(t,r,e,o)=>{if(r&&typeof r=="object"||typeof r=="function")for(let s of lt(r))!ct.call(t,s)&&s!==e&&A(t,s,{get:()=>r[s],enumerable:!(o=at(r,s))||o.enumerable});return t};var ht=t=>ft(A({},"__esModule",{value:!0}),t);var $t={};ut($t,{assertNativeImageFill:()=>st,cssLinearNeedsNativeWarning:()=>L,cssLinearSourceSnapshot:()=>Z,designPaintsToFigma:()=>J,figmaFillPaints:()=>X,hasDesignStroke:()=>ot,nativeDesignStroke:()=>nt,nativeInactiveStrokePlan:()=>P,nativeShadowStackEffects:()=>tt,normalizeCssLinearSource:()=>C,normalizeDesignPaints:()=>w,normalizeShadowStack:()=>N,normalizeStrokeSides:()=>G,validateDesignStroke:()=>T,validateShadowStack:()=>x});var dt=t=>t&&typeof t=="object"&&!Array.isArray(t),v=t=>typeof t=="number"&&Number.isFinite(t),$=(t,r)=>{if(!dt(t)||Object.keys(t).some(e=>!r.includes(e)))throw new Error("CSS 渐变几何包含未知字段")};function F(t,r){$(t,["direction","positions","sourceOnly"]);let e=t.direction;$(e,["angle","corner"]);let o;if(Object.keys(e).length!==1)throw new Error("CSS 渐变方向必须唯一");if(e.angle!==void 0){if(!v(e.angle)||e.angle<0||e.angle>=360)throw new Error("CSS 渐变角度必须为 0–360（不含 360）");o={angle:e.angle}}else{if(!Array.isArray(e.corner)||e.corner.length!==2||!Array.from(e.corner).every(i=>i===-1||i===1))throw new Error("CSS 渐变角方向必须为两个 ±1");o={corner:[...e.corner]}}if(t.sourceOnly!==void 0&&t.sourceOnly!==!0)throw new Error("CSS 渐变 sourceOnly 只能为 true");if(!Array.isArray(t.positions)||t.positions.length<2||t.positions.length>16||!t.sourceOnly&&t.positions.length!==r.length)throw new Error("CSS 渐变位置必须为 2–16 项且与可编辑色标对应");let s=Array.from(t.positions,(i,n)=>{if(i===null)return null;if(i==="previous"){if(!n||t.positions[n-1]==="previous"||!t.sourceOnly&&(r[n].opacity!==0||r[n-1].opacity!==0))throw new Error("CSS 透明色标重复位置无效");return"previous"}if($(i,["unit","value"]),!["px","percent"].includes(i.unit)||!v(i.value)||Math.abs(i.value)>2e4)throw new Error("CSS 色标只支持有界 px/percent 坐标");return{unit:i.unit,value:i.value}});if(s.filter(i=>i!=="previous").length<2)throw new Error("CSS 渐变至少需要两个原始色标");return{direction:o,positions:s,...t.sourceOnly?{sourceOnly:!0}:{}}}function gt(t,r,e){if(t.corner){let i=Math.hypot(r,e);return{x:t.corner[0]*e/i,y:t.corner[1]*r/i}}let o=t.angle*Math.PI/180,s=i=>Math.abs(i)<1e-12?0:Math.abs(Math.abs(i)-1)<1e-12?Math.sign(i):i;return{x:s(Math.sin(o)),y:s(-Math.cos(o))}}function _(t,r,e){var H,j;let o=t.cssLinear;if(!o||o.sourceOnly||!(r>0&&e>0)||![r,e].every(v))return t;let s=gt(o.direction,r,e),i=Math.abs(r*s.x)+Math.abs(e*s.y),n=o.positions.flatMap((u,h)=>u==="previous"?[]:[{index:h,value:u===null?null:u.value/(u.unit==="percent"?100:i)}]);(H=n[0]).value??(H.value=0),(j=n.at(-1)).value??(j.value=1);let a=-1/0;for(let u of n)u.value!==null&&(u.value=Math.max(a,u.value),a=u.value);for(let u=0;u<n.length-1;u++){let h=u+1;for(;n[h].value===null;)h++;for(let p=u+1;p<h;p++)n[p].value=n[u].value+(n[h].value-n[u].value)*(p-u)/(h-u);u=h-1}let l=[];for(let u of n)l[u.index]=u.value;o.positions.forEach((u,h)=>{u==="previous"&&(l[h]=l[h-1])});let c=Math.min(0,l[0]),d=Math.max(1,l.at(-1)),E=(u,h=0)=>({x:.5+((u-.5)*i*s.x-h*i*s.y)/r,y:.5+((u-.5)*i*s.y+h*i*s.x)/e});return{...t,handles:[E(c),E(d),E(c,(d-c)/2)],stops:t.stops.map((u,h)=>({...u,position:(l[h]-c)/(d-c)}))}}function L(t){let r=t.cssLinear;return!!(r&&(r.sourceOnly||r.direction.angle!==void 0&&Math.abs(r.direction.angle%90)>1e-9||r.positions.some(e=>e&&e.unit==="px"&&e.value!==0)))}function U(t,r){if(!t.sourceOnly)for(let e=1;e<r.length;e++){let o=r[e-1],s=r[e],i=t.positions[e-1],n=t.positions[e];if(!(n==="previous"||i&&n&&typeof i=="object"&&typeof n=="object"&&i.unit===n.unit&&i.value>=n.value)&&o.opacity!==s.opacity&&o.color!==s.color)throw new Error("不同颜色且透明度变化的 CSS 预乘插值无法由当前原生渐变无损表示")}}var pt=t=>t!==null&&typeof t=="object"&&!Array.isArray(t),R=t=>typeof t=="string"&&/^#[a-f\d]{6}$/iu.test(t),g=t=>typeof t=="number"&&Number.isFinite(t),y=t=>Math.max(0,Math.min(1,t));var B=t=>`#${[t.r,t.g,t.b].map(r=>Math.round(y(r)*255).toString(16).padStart(2,"0")).join("")}`,V=t=>[1,3,5].map(r=>parseInt(t.slice(r,r+2),16)/255);function m(t,r){if(!pt(t)||Object.keys(t).some(e=>!r.includes(e)))throw new Error("绘制包含未知字段")}function b(t){if(!g(t)||t<0||t>1)throw new Error("绘制透明度必须在 0–1 之间");return t}function yt(t){let[r,e,o]=t;return[[e.x-r.x,2*(o.x-r.x),2*r.x-o.x],[e.y-r.y,2*(o.y-r.y),2*r.y-o.y]]}function M(t){let[[r,e,o],[s,i,n]]=yt(t),a=r*i-e*s;if(Math.abs(a)<1e-8)throw new Error("线性渐变坐标不可逆");return[[i/a,-e/a,(e*n-i*o)/a],[-s/a,r/a,(s*o-r*n)/a]]}function w(t){if(!Array.isArray(t)||!t.length||t.length>8)throw new Error("填充绘制必须为 1–8 层");return t.map(r=>{m(r,r?.type==="SOLID"?["type","color","opacity"]:["type","opacity","handles","stops","cssLinear"]);let e=b(r.opacity);if(r.type==="SOLID"){if(!R(r.color))throw new Error("纯色绘制必须是六位十六进制颜色");return{type:"SOLID",color:r.color.toLowerCase(),opacity:e}}if(r.type!=="GRADIENT_LINEAR"||!Array.isArray(r.handles)||r.handles.length!==3||!Array.isArray(r.stops)||r.stops.length<2||r.stops.length>16)throw new Error("仅支持有界纯色/线性渐变；渐变必须有三个控制点与 2–16 个色标");let o=r.handles.map(n=>{if(m(n,["x","y"]),![n.x,n.y].every(a=>g(a)&&Math.abs(a)<=100))throw new Error("渐变控制点超出范围");return{x:n.x,y:n.y}});M(o);let s=r.stops.map(n=>{if(m(n,["position","color","opacity"]),!R(n.color))throw new Error("渐变色标颜色无效");return{position:b(n.position),color:n.color.toLowerCase(),opacity:b(n.opacity)}});if(s.some((n,a)=>a&&n.position<s[a-1].position))throw new Error("渐变色标必须按位置排序");let i=r.cssLinear===void 0?void 0:F(r.cssLinear,s);return i&&U(i,s),{type:"GRADIENT_LINEAR",opacity:e,handles:o,stops:s,...i?{cssLinear:i}:{}}})}function mt(t){if(!Array.isArray(t)||t.length!==2||!t.every(c=>Array.isArray(c)&&c.length===3&&c.every(g)))throw new Error("渐变矩阵无效");let[[r,e,o],[s,i,n]]=t,a=r*i-e*s;if(Math.abs(a)<1e-8)throw new Error("渐变矩阵不可逆");let l=(c,d)=>({x:(i*(c-o)-e*(d-n))/a,y:(-s*(c-o)+r*(d-n))/a});return[l(0,.5),l(1,.5),l(0,1)]}function X(t,r=()=>{}){if(!Array.isArray(t))return null;let e=t.filter(o=>o?.visible!==!1);if(!e.length||e.length>8||e.some(o=>!["SOLID","GRADIENT_LINEAR"].includes(o?.type)))return null;try{let o=e.map(s=>{if(s.blendMode&&s.blendMode!=="NORMAL")throw new Error("非 NORMAL 混合绘制需本地预览资源");let i=g(s.opacity)?y(s.opacity):1;if(s.type==="SOLID")return{type:"SOLID",color:B(s.color),opacity:i*(g(s.color?.a)?y(s.color.a):1)};let n=s.gradientStops?.map(l=>({position:l.position,color:B(l.color),opacity:g(l.color?.a)?y(l.color.a):1})),a=s.gradientHandlePositions??mt(s.gradientTransform);try{M(a)}catch{if(!n?.length)throw new Error("缺少渐变色标");r("退化线性渐变没有可逆控制点；按零长度渐变的末色标保留，不猜测方向。");let l=n.at(-1);return{type:"SOLID",color:l.color,opacity:i*l.opacity}}return{type:"GRADIENT_LINEAR",opacity:i,handles:a,stops:n}});return w(o)}catch(o){return r(`绘制无法无损转换：${o.message}`),null}}function wt(t){let r=t.fillPaints??(R(t.fill)?[{type:"SOLID",color:t.fill,opacity:1}]:[]);return r.some(e=>e.cssLinear&&!e.cssLinear.sourceOnly)?r.map(e=>e.cssLinear?_(e,t.width,t.height):e):r}function J(t){let r=wt(t);if(r.some(e=>e.cssLinear&&!e.cssLinear.sourceOnly&&e.handles.some(o=>Math.abs(o.x)>100||Math.abs(o.y)>100)))throw new Error("当前 CSS 渐变尺寸/像素色标产生超出 ±100 的原生控制点；请调整尺寸或色标后再导出。原始 CSS 意图仍可在 Design Studio 中编辑。");return r.map(e=>e.type==="SOLID"?{type:"SOLID",color:Object.fromEntries(["r","g","b"].map((o,s)=>[o,V(e.color)[s]])),opacity:e.opacity}:{type:"GRADIENT_LINEAR",opacity:e.opacity,gradientTransform:M(e.handles),gradientStops:e.stops.map(o=>({position:o.position,color:{...Object.fromEntries(["r","g","b"].map((s,i)=>[s,V(o.color)[i]])),a:o.opacity}}))})}function C(t){if(m(t,["version","width","height","paints"]),t.version!==1||![t.width,t.height].every(o=>g(o)&&o>=1&&o<=2e4))throw new Error("CSS 渐变来源尺寸无效");let r=w(t.paints);if(!r.some(o=>o.cssLinear))throw new Error("CSS 渐变来源缺少几何意图");let e={version:1,width:t.width,height:t.height,paints:r};if(JSON.stringify(e).length>32768)throw new Error("CSS 渐变来源超过 32 KiB");return e}function Z(t){return t.fillPaints?.some(r=>r.cssLinear)?C({version:1,width:t.width,height:t.height,paints:t.fillPaints}):null}var Ct=Object.freeze(["border-top-left-radius","border-top-right-radius","border-bottom-right-radius","border-bottom-left-radius"]);function St(t){return t.cornerRadii??Array(4).fill(t.cornerRadius??0)}function S(t){let r=St(t),[e,o,s,i]=r,n=Math.min(1,...[[t.width,e+o],[t.width,i+s],[t.height,e+i],[t.height,o+s]].filter(([,a])=>a>0).map(([a,l])=>Math.max(0,a)/l));return r.map(a=>a*n)}var K=t=>t&&typeof t=="object"&&!Array.isArray(t),q=(t,r)=>Object.keys(t).every(e=>r.includes(e)),k=(t,r,e)=>typeof t=="number"&&Number.isFinite(t)&&t>=r&&t<=e;function N(t){if(!K(t)||!q(t,["basis","layers"])||t.basis!=="css-box"||!Array.isArray(t.layers)||t.layers.length<1||t.layers.length>8)throw Error("shadowStack 只支持 css-box 几何蒙版与 1–8 个有序阴影；native-paint 原始效果暂保留在来源中");return{basis:"css-box",layers:Array.from(t.layers,r=>{if(!K(r)||!q(r,["kind","color","opacity","x","y","blur","spread","visible"])||!["inner","outer"].includes(r.kind)||typeof r.color!="string"||!/^#[\da-f]{6}$/iu.test(r.color)||!k(r.opacity,0,1)||!k(r.x,-500,500)||!k(r.y,-500,500)||!k(r.blur,0,200)||r.spread!==0||typeof r.visible!="boolean")throw Error("阴影层需要 inner/outer、六位 RGB、0–1 透明度、±500px 偏移、0–200px 模糊、spread:0 与 visible 布尔值");return{kind:r.kind,color:r.color.toLowerCase(),opacity:r.opacity,x:r.x,y:r.y,blur:r.blur,spread:0,visible:r.visible}})}}function x(t){if(t.shadowStack===void 0)return;if(N(t.shadowStack),!["frame","rectangle","component"].includes(t.type)||t.shadow!==void 0)throw Error("shadowStack 只适用于 Frame/Rectangle/Component，且不能与旧 shadow 同时设置");let r=Y(t);if(r.some(e=>e>0)&&t.strokeAlign!=="inside")throw Error("CSS 阴影几何蒙版只支持 inside 边框；center/outside 描边暂不能作为 CSS 边缘");if(r.some(e=>e>0)&&S(t).some(e=>e>0))throw Error("带边框圆角的 CSS 阴影蒙版接合暂不能无损保留；请使用方角或移除边框，未近似内边缘曲线")}var Q=(t,r)=>(t.shadowStack?.layers??[]).filter(e=>e.visible&&e.opacity>0&&(!r||e.kind===r));var Y=t=>W(t).map(r=>t.strokeSides!==void 0||t.strokeAlign!==void 0||t.stroke!=="transparent"?r.width:0);var O=t=>Object.assign(Error(t),{code:"NATIVE_CSS_SHADOW_MASK"});function tt(t){if(!t.shadowStack)return;x(t);let r=Q(t,"inner");if(r.length&&(Y(t).some(e=>e>0)||t.fill==="transparent"||t.fillPaints?.some(e=>e.type!=="SOLID"||e.opacity!==1)))throw O("CSS 内阴影的透明/无填充或边框几何蒙版不能无损映射 Figma INNER_SHADOW；请保留 Panel/CSS 版本");if(new Set(r.map(e=>e.color)).size>1)throw O("多色 CSS 内阴影的原生可视顺序尚未验证；保留 Panel/CSS 完整层序");if(Q(t,"outer").length)throw O("CSS 外阴影几何蒙版暂不能无损映射 Figma painted-alpha DROP_SHADOW");return t.shadowStack.layers.map(e=>({type:e.kind==="inner"?"INNER_SHADOW":"DROP_SHADOW",color:{r:parseInt(e.color.slice(1,3),16)/255,g:parseInt(e.color.slice(3,5),16)/255,b:parseInt(e.color.slice(5,7),16)/255,a:e.opacity},offset:{x:e.x,y:e.y},radius:e.blur,spread:0,visible:e.visible,blendMode:"NORMAL"}))}var Ht=Object.freeze(["gridRows","gridColumnSizes","gridRowSizes","gridItemsPositioning","gridAutoTracks"]),jt=Object.freeze(["gridRowAnchorIndex","gridColumnAnchorIndex","gridChildHorizontalAlign","gridChildVerticalAlign"]);var rt=["top","right","bottom","left"],kt=["frame","component","rectangle","text"],et=t=>Number.isFinite(t)&&t>=0&&t<=100,z=t=>t&&typeof t=="object"&&!Array.isArray(t);function I(t,r){if(!z(t)||!Object.keys(t).some(e=>e!=="sourceOnly")||Object.keys(t).some(e=>!["strokeAlign","strokeWeight","individualStrokeWeights","strokesIncludedInLayout","strokesIncludedInLayoutDefault","sourceOnly"].includes(e)))throw Error("空描边样式包含未知字段或缺少来源样式");if(t.strokeAlign!==void 0&&!["INSIDE","CENTER","OUTSIDE"].includes(t.strokeAlign))throw Error("空描边对齐无效");if(t.strokeWeight!==void 0&&!et(t.strokeWeight))throw Error("空描边宽度必须为 0–100");if(t.individualStrokeWeights!==void 0&&(!z(t.individualStrokeWeights)||Object.keys(t.individualStrokeWeights).length!==4||!rt.every(e=>et(t.individualStrokeWeights[e]))))throw Error("空描边侧宽必须为完整的上右下左 0–100 数值");if(t.strokesIncludedInLayout!==void 0&&typeof t.strokesIncludedInLayout!="boolean")throw Error("空描边布局选择必须为布尔值");if(t.strokesIncludedInLayoutDefault!==void 0&&(t.strokesIncludedInLayoutDefault!==!1||t.strokesIncludedInLayout!==void 0))throw Error("空描边 REST 默认只支持独立保存的 false");if(t.sourceOnly!==void 0&&t.sourceOnly!==!0)throw Error("空描边 sourceOnly 只能为 true");if(t.individualStrokeWeights&&t.strokeWeight!==void 0&&rt.some(e=>t.individualStrokeWeights[e]!==t.strokeWeight)&&t.sourceOnly!==!0)throw Error("混合侧宽与标量宽度不一致，必须保留为仅来源样式");if(r&&(!kt.includes(r.type)||r.stroke!=="transparent"||r.strokeWidth!==0||r.strokeSides!==void 0||r.strokeAlign!==void 0||r.strokeLayoutExcluded!==void 0||t.individualStrokeWeights!==void 0&&r.type==="text"||(t.strokesIncludedInLayout!==void 0||t.strokesIncludedInLayoutDefault!==void 0)&&!["frame","component"].includes(r.type)))throw Error("空描边样式只适用于无描边绘制的 Frame/Component/Rectangle/Text");return Object.fromEntries(Object.entries(t).map(([e,o])=>[e,z(o)?{...o}:o]))}function P(t){let r=I(t.nativeStrokeInactive,t);if(r.sourceOnly)throw Error("此空描边包含尚不能原生重建的特殊样式；请保留来源绑定");let e=t.layoutReverse||t.layoutWrap==="wrap-reverse"||t.layout==="vertical"&&t.layoutWrap==="wrap";if((r.strokesIncludedInLayout!==void 0||r.strokesIncludedInLayoutDefault!==void 0)&&(e||!["horizontal","vertical","grid"].includes(t.layout)))throw Error("自由布局中的描边布局选择尚不能安全重建；请保留来源绑定，不猜测原生布局状态");return r}var Yt=Object.freeze(["top","right","bottom","left"]),it=t=>typeof t=="number"&&Number.isFinite(t),D=t=>typeof t=="string"&&/^#[a-f\d]{6}$/iu.test(t),xt=["frame","rectangle","component"],It=t=>["frame","component"].includes(t?.type)&&["horizontal","vertical"].includes(t.layout)&&t.strokeAlign==="inside";function G(t){if(!Array.isArray(t)||t.length!==4)throw new Error("strokeSides 必须为上右下左四项");return Array.from(t,r=>{if(!r||typeof r!="object"||Array.isArray(r)||Object.keys(r).some(e=>!["width","color","opacity"].includes(e))||!it(r.width)||r.width<0||r.width>100||!D(r.color)||!it(r.opacity)||r.opacity<0||r.opacity>1)throw new Error("边框只支持 0–100px、六位 RGB 与 0–1 透明度的有界实线侧边");return{width:r.width,color:r.color.toLowerCase(),opacity:r.opacity}})}function W(t){return t.strokeSides??Array.from({length:4},()=>({width:t.strokeWidth??0,color:D(t.stroke)?t.stroke:"#000000",opacity:D(t.stroke)?1:0}))}var Et=t=>t.every(r=>r.width===t[0].width&&(!r.width||r.opacity===t[0].opacity&&(!r.opacity||r.color===t[0].color)));function T(t){if(t.nativeStrokeInactive!==void 0&&I(t.nativeStrokeInactive,t),t.strokeLayoutExcluded!==void 0&&(t.strokeLayoutExcluded!==!0||!It(t)))throw new Error("strokeLayoutExcluded 只能为 true，且只适用于水平/垂直 Auto Layout Frame/Component 的 inside 描边");if(t.strokeAlign!==void 0&&!["inside","center","outside"].includes(t.strokeAlign))throw new Error("strokeAlign 只支持 inside/center/outside");let r=t.strokeSides===void 0?null:G(t.strokeSides);if((t.strokeSides!==void 0||t.strokeAlign!==void 0)&&!xt.includes(t.type))throw new Error("独立边框/对齐暂只适用于矩形与 Frame 表面");if(r&&!Et(r)&&S(t).some(e=>e>0))throw new Error("不同侧边的圆角接合暂不能无损保留；请使用方角或统一边框");if(r?.some((e,o)=>e.width>0&&r[(o+1)%4].width>0&&e.opacity!==r[(o+1)%4].opacity))throw new Error("相接侧边的不同透明度暂不能保留；请使用相同透明度或不相接的侧边")}var ot=t=>t.strokeSides!==void 0||t.strokeAlign!==void 0;function nt(t){T(t);let r=W(t),e=r.filter(s=>s.width>0),o=e[0]??{color:"#000000",opacity:0};if(e.some(s=>(s.opacity||o.opacity)&&(s.color!==o.color||s.opacity!==o.opacity)))throw new Error("Figma 原生侧边只支持同一颜色/透明度；多色边框请保留 v3 源文档，不能无损导出");return{align:(t.strokeAlign??"center").toUpperCase(),weights:r.map(s=>s.width),paint:{type:"SOLID",color:Object.fromEntries(["r","g","b"].map((s,i)=>[s,parseInt(o.color.slice(1+i*2,3+i*2),16)/255])),opacity:o.opacity}}}var f=(t="")=>{let r=new Error(`原生 fill 图片需要可验证的 PNG/JPEG/GIF 字节尺寸${t?`：${t}`:""}`);throw r.code="NATIVE_IMAGE_FILL",r};function At(t){if(!(t instanceof Uint8Array)||t.length<10||t.length>8*1024*1024)return f();let r=new DataView(t.buffer,t.byteOffset,t.byteLength),e=(i,n=!1)=>r.getUint16(i,n),o=(i,n)=>String.fromCharCode(...t.subarray(i,i+n)),s=(i,n)=>!Number.isInteger(i)||!Number.isInteger(n)||i<1||n<1||i>32768||n>32768||i*n>16777216?f():{width:i,height:n};if(o(0,8)===`PNG\r

`){if(t.length<45||r.getUint32(8)!==13||o(12,4)!=="IHDR"||!{0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]}[t[25]]?.includes(t[24])||t[26]!==0||t[27]!==0||![0,1].includes(t[28]))return f();let n=8,a=!1;for(let l=0;l<4096&&n+12<=t.length;l++){let c=r.getUint32(n),d=o(n+4,4);if(c>t.length-n-12||!/^[A-Za-z]{4}$/u.test(d)||d==="IHDR"&&n!==8)return f();if(d==="eXIf")return f("EXIF 方向对原生解码尺寸的影响尚未证明");if(d==="IDAT"&&c>0&&(a=!0),d==="IEND")return c!==0||n+12!==t.length||!a?f():s(r.getUint32(16),r.getUint32(20));n+=c+12}return f()}if(["GIF87a","GIF89a"].includes(o(0,6))){if(t.length<14||t[12]!==0)return f("GIF 像素宽高比元数据尚未证明");let i=13+(t[10]&128?3*2**((t[10]&7)+1):0),n=!1,a=()=>{for(let l=0;l<t.length&&i<t.length;l++){let c=t[i++];if(!c)return;if(i+c>t.length)return f();i+=c}return f()};for(let l=0;l<4096&&i<t.length;l++){let c=t[i++];if(c===59)return n&&i===t.length?s(e(6,!0),e(8,!0)):f();if(c===33){if(i>=t.length)return f();i++,a()}else if(c===44){if(i+10>t.length)return f();let d=t[i+8];if(!e(i+4,!0)||!e(i+6,!0)||e(i,!0)+e(i+4,!0)>e(6,!0)||e(i+2,!0)+e(i+6,!0)>e(8,!0)||(i+=9+(d&128?3*2**((d&7)+1):0),i>=t.length||t[i]<2||t[i]>8))return f();i++,a(),n=!0}else return f()}return f()}if(t[0]===255&&t[1]===216&&t.at(-2)===255&&t.at(-1)===217){let i=2,n;for(let a=0;a<4096&&i+3<t.length;a++){if(t[i++]!==255)return f();for(;t[i]===255;)i++;let l=t[i++];if(i+2>t.length||[0,216,217].includes(l))return f();let c=e(i);if(c<2||c>t.length-i)return f();if(l===225)return f("JPEG APP1/EXIF 方向对原生解码尺寸的影响尚未证明");if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(l)){if(c<11||![1,3,4].includes(t[i+7])||c!==8+3*t[i+7]||n)return f();n=s(e(i+5),e(i+3))}if(l===218)return n&&i+c<t.length-2?n:f();i+=c}}return f()}function st(t,r){if(t.type!=="image"||t.objectFit!=="fill")return;let e=At(r);if(!Number.isFinite(t.width)||!Number.isFinite(t.height)||t.width<=0||t.height<=0||t.width*e.height!==t.height*e.width){let o=new Error("object-fit:fill 的图像与内容框宽高比不同；原生 FILL 会裁剪，已拒绝而未改为 cover");throw o.code="NATIVE_IMAGE_FILL",o}}return ht($t);})();
/* END GENERATED PAINT RUNTIME */
/* BEGIN GENERATED TEXT RUNTIME */
"use strict";var CodeShellFigmaText=(()=>{var Ct=Object.defineProperty;var qn=Object.getOwnPropertyDescriptor;var Zn=Object.getOwnPropertyNames;var Qn=Object.prototype.hasOwnProperty;var ei=(e,t)=>{for(var n in t)Ct(e,n,{get:t[n],enumerable:!0})},ti=(e,t,n,i)=>{if(t&&typeof t=="object"||typeof t=="function")for(let o of Zn(t))!Qn.call(e,o)&&o!==n&&Ct(e,o,{get:()=>t[o],enumerable:!(i=qn(t,o))||i.enumerable});return e};var ni=e=>ti(Ct({},"__esModule",{value:!0}),e);var qi={};ei(qi,{applyCreatedNativeTextRanges:()=>fn,assertNativeTextRangeBoundary:()=>ln,createNativeExistingUpdateCapture:()=>$n,createNativeNotesExportCapture:()=>Jn,createNativeNotesPatchCapture:()=>Kn,createNativeTextExportCapture:()=>jn,finalizeCreatedNativeTextRanges:()=>wn,nativeTextContent:()=>Me,nativeTextLineHeight:()=>ne,nativeTextPlan:()=>an,nativeTextRangeCreationPlan:()=>Xe,preloadNativeTextRangeFonts:()=>un,validTextLineHeight:()=>ge,validateTextRanges:()=>Y});function ge(e){return Number.isFinite(e.lineHeight)?e.lineHeightUnit===void 0?e.lineHeight>=.7&&e.lineHeight<=3:e.lineHeightUnit==="pixels"&&e.lineHeight>=.7&&e.lineHeight<=720:!1}function ne(e){if(!ge(e))throw Error("文字行高或单位无效。");return e.lineHeightUnit==="pixels"?{unit:"PIXELS",value:e.lineHeight}:{unit:"PERCENT",value:e.lineHeight*100}}var ii=new Set(["serif","sans-serif","monospace","cursive","fantasy","system-ui","ui-serif","ui-sans-serif","ui-monospace","ui-rounded","emoji","math","fangsong"]),ri=new Set(["inherit","initial","unset","revert","revert-layer"]),et=e=>/[\t\n\f\r ]/u.test(e);function tt(e){if(typeof e!="string"||e.length>120||!e.trim()||/[\u0000-\u001f\u007f]/u.test(e))return null;let t=0,n=[],i=()=>{if(t+=1,t>=e.length)throw Error("Incomplete CSS escape");let o=/^[\da-f]{1,6}/iu.exec(e.slice(t));if(!o)return e[t++];t+=o[0].length,t<e.length&&et(e[t])&&(t+=1);let r=Number.parseInt(o[0],16);return String.fromCodePoint(r===0||r>1114111||r>=55296&&r<=57343?65533:r)};try{for(;t<e.length;){for(;t<e.length&&et(e[t]);)t+=1;if(t===e.length)return null;let o=['"',"'"].includes(e[t])?e[t++]:null,r="",s=!o,a=!1;for(;t<e.length;){let c=e[t];if(o&&c===o){t+=1,s=!0;break}if(!o&&c===",")break;if(!o&&et(c)){a=r.length>0,t+=1;continue}a&&(r+=" ",a=!1),r+=c==="\\"?i():e[t++]}if(!s||!r||/[\u0000-\u001f\u007f]/u.test(r)||!o&&ri.has(r.toLowerCase()))return null;for(;t<e.length&&et(e[t]);)t+=1;if(n.push({name:r,generic:!o&&ii.has(r.toLowerCase()),quoted:!!o}),t===e.length)break;if(e[t++]!==","||t===e.length)return null}return n.length?n:null}catch{return null}}var Lt=64,qt=32*1024,oi=4e3,si=Object.freeze(["fontSize","fontFamily","fontWeight","fontStyle"]),nt=[...si,"fill","textDecoration","textDecorationThickness","textUnderlineOffset","textDecorationSkipInk","href"],en=e=>e!==null&&typeof e=="object"&&[Object.prototype,null].includes(Object.getPrototypeOf(e)),L=(e,t="TEXT_RANGES_INVALID")=>{let n=new Error(e);throw n.code=t,n},it=(e,t)=>Object.hasOwn(e,t),rt=(e,t)=>en(e)&&Object.keys(e).every(n=>t.includes(n));function Zt(e){let t=JSON.stringify(e),n=0;for(let i=0;i<t.length;i++){let o=t.charCodeAt(i);n+=o<128?1:o<2048?2:kt(o)&&ot(t.charCodeAt(i+1))?(i++,4):3}return n}function Dt(e,t=new Set,n=0){if(e===null||typeof e!="object")return e;(n>64||t.has(e)||!Array.isArray(e)&&!en(e))&&L("文字编辑仅接受有界无环纯数据"),t.add(e);let i=Array.isArray(e)?e.map(o=>Dt(o,t,n+1)):Object.fromEntries(Object.entries(e).map(([o,r])=>[o,Dt(r,t,n+1)]));return t.delete(e),i}var kt=e=>e>=55296&&e<=56319,ot=e=>e>=56320&&e<=57343;function _e(e){if(typeof e!="string"||e.length>oi)return!1;for(let t=0;t<e.length;t++){let n=e.charCodeAt(t);if(kt(n)){if(!ot(e.charCodeAt(++t)))return!1}else if(ot(n))return!1}return!0}function Qt(e,t){return Number.isInteger(t)&&t>=0&&t<=e.length&&!(t>0&&t<e.length&&kt(e.charCodeAt(t-1))&&ot(e.charCodeAt(t)))}function be(e){return _e(e)||L("范围文字必须是最多4000个 UTF16 单元的完整 Unicode 字符串"),JSON.stringify([e])}var tn=e=>typeof e.textSource=="string"?e.textSource:e.text,ai=(e,t)=>JSON.stringify(e)===JSON.stringify(t),Pt=e=>Object.fromEntries(nt.filter(t=>it(e,t)).map(t=>[t,Dt(e[t])]));function ci(e,t,n){if(rt(e,["unit","value"])||L("文字装饰长度包含未知字段"),e.unit==="auto")return it(e,"value")&&L("auto 装饰长度不能包含数值"),{unit:"auto"};let i=e.unit==="em"?10:e.unit==="px"?100:NaN,o=e.value,r=e.unit==="em"?o*t:o;return(!Number.isFinite(i)||typeof o!="number"||!Number.isFinite(o)||Math.abs(o)>i||n&&o<=0||!Number.isFinite(r)||Math.abs(r)>100)&&L("文字装饰长度超出有限 px/em 范围"),{unit:e.unit,value:o}}function Fe(e){if(typeof e!="string"||!e||e.length>2048||/[\u0000-\u0020\u007f]/u.test(e[0])||/[\u0000-\u0020\u007f]/u.test(e.at(-1))||/[\u0000-\u001f\u007f]/u.test(e)||!_e(e))return!1;if(e.startsWith("#")||/^(?:mailto|tel):[^\s\\]+$/iu.test(e))return!0;let t=/^https?:\/\/([^/?#]+)(?:[/?#][^\\]*)?$/iu.exec(e);if(!t||/\s|\\/u.test(e))return!1;let n=/^(\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([0-9]+))?$/iu.exec(t[1]);return!!(n&&!n[1].includes("..")&&(!n[2]||Number(n[2])<=65535))}function li(e,t){rt(e,nt)||L("文字范围样式包含未知字段");let n={};for(let i of nt){if(!it(e,i))continue;let o=e[i];i==="fontSize"?((!Number.isFinite(o)||o<1||o>240)&&L("文字范围字号必须是1到240的有限数字"),n[i]=o):i==="fontFamily"?(tt(o)||L("文字范围字体必须是有效的CSS字族，最多120个字符"),n[i]=o):i==="fontWeight"?([100,200,300,400,500,600,700,800,900].includes(o)||L("文字范围字重必须是100到900的百位整数"),n[i]=o):i==="fontStyle"?(["normal","italic"].includes(o)||L("文字范围字体样式必须是normal或italic"),n[i]=o):i==="fill"?((typeof o!="string"||!/^#[0-9a-f]{6}$/iu.test(o))&&L("文字范围填色必须是不透明六位十六进制颜色"),n.fill=o.toLowerCase()):i==="textDecoration"?(["none","underline","line-through"].includes(o)||L("文字范围装饰无效"),n[i]=o):i==="textDecorationThickness"||i==="textUnderlineOffset"?n[i]=ci(o,e.fontSize??t,i==="textDecorationThickness"):i==="textDecorationSkipInk"?(["auto","none"].includes(o)||L("文字范围 skip-ink 无效"),n[i]=o):(Fe(o)||L("文字范围链接目标无效"),n.href=o)}return["textDecorationThickness","textUnderlineOffset","textDecorationSkipInk"].some(i=>it(n,i))&&n.textDecoration!=="underline"&&L("范围下划线参数需要同一范围显式 underline"),n}function fi(e){let t=[];for(let n of e){let i=Pt(n);if(!Object.keys(i).length)continue;let o=t.at(-1);o?.end===n.start&&ai(Pt(o),i)?o.end=n.end:t.push({start:n.start,end:n.end,...i})}return t}function nn(e){if(e?.textRanges===void 0)return;e.type!=="text"&&L("textRanges 仅用于文字图层");let t=tn(e),n=e.textRanges;(!_e(t)||!_e(e.text))&&L("范围文字来源或显示内容无效"),(!rt(n,["version","sourceSignature","ranges"])||n.version!==1||typeof n.sourceSignature!="string"||n.sourceSignature.length>24004||!Array.isArray(n.ranges)||n.ranges.length>Lt||Zt(n)>qt)&&L("textRanges 版本、字段或预算无效"),n.sourceSignature!==be(t)&&L("textRanges 与当前完整文字来源签名不一致","TEXT_RANGES_STALE"),e.textOverflow!==void 0&&L("范围文字暂不支持截断","TEXT_RANGES_UNSUPPORTED_TRUNCATION"),e.fillPaints!==void 0&&n.ranges.length&&L("范围文字暂不支持基础 paint stack；请先显式选择纯色","TEXT_RANGES_UNSUPPORTED_BASE_PAINT");let i=0,o=Array.from(n.ranges,(s,a)=>((!rt(s,["start","end",...nt])||!Qt(t,s.start)||!Qt(t,s.end)||s.start>=s.end||a>0&&s.start<i)&&L("文字范围必须排序、不重叠并位于 UTF16 字符边界"),i=s.end,{start:s.start,end:s.end,...li(Pt(s),e.fontSize)})),r={version:1,sourceSignature:n.sourceSignature,ranges:fi(o)};return Zt(r)>qt&&L("textRanges 超出字节预算"),r.ranges.length?r:void 0}function rn(e){let t=tn(e),n=e.text;(!_e(t)||!_e(n))&&L("范围文字来源或显示内容无效");let i=[],o=0,r=0;for(;r<n.length;){let s=String.fromCodePoint(n.codePointAt(r));if(t.startsWith(s,o)){let a=i.at(-1);a?.kind==="source"&&a.sourceEnd===o&&a.displayEnd===r?(a.sourceEnd+=s.length,a.displayEnd+=s.length):i.push({kind:"source",sourceStart:o,sourceEnd:o+s.length,displayStart:r,displayEnd:r+s.length}),o+=s.length}else s===`
`&&e.textFlow==="wrap"?i.push({kind:"soft-break",sourceOffset:o,displayStart:r,displayEnd:r+1}):L("范围显示文字必须保留每个来源字符；仅允许添加软换行","TEXT_RANGES_DISPLAY_MISMATCH");r+=s.length}return o!==t.length&&L("范围显示文字丢失来源字符","TEXT_RANGES_DISPLAY_MISMATCH"),{sourceText:t,displayText:n,sourceSignature:be(t),segments:i}}function Y(e){let t=nn(e);return e?.textRanges!==void 0&&rn(e),t}function st(e){return nn(e),rn(e)}var ui=Object.freeze([{id:"roboto",file:"fonts/Roboto-Variable.ttf",mime:"font/ttf",families:["Roboto"],style:"normal",variable:!0,bytes:488584,sha256:"d7598e12c5dbef095ff8272cfc55da0250bd07fbdecbac8a530b9b277872a134",source:"https://raw.githubusercontent.com/google/fonts/bf7c667ae010c0ffb39944ae85097021478cb91d/ofl/roboto/Roboto%5Bwdth,wght%5D.ttf"},{id:"roboto-italic",file:"fonts/Roboto-Italic-Variable.ttf",mime:"font/ttf",families:["Roboto"],style:"italic",variable:!0,bytes:530944,sha256:"9725a847af6b460ffca162ae66d20dad48b01876137947180b42d7dcd7887182",source:"https://raw.githubusercontent.com/google/fonts/bf7c667ae010c0ffb39944ae85097021478cb91d/ofl/roboto/Roboto-Italic%5Bwdth,wght%5D.ttf"},{id:"inter",file:"fonts/InterVariable.woff2",mime:"font/woff2",families:["Inter"],style:"normal",variable:!0,bytes:352240,sha256:"693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3",source:"https://raw.githubusercontent.com/rsms/inter/v4.1/docs/font-files/InterVariable.woff2"},{id:"inter-italic",file:"fonts/InterVariable-Italic.woff2",mime:"font/woff2",families:["Inter"],style:"italic",variable:!0,bytes:387976,sha256:"e564f652916db6c139570fefb9524a77c4d48f30c92928de9db19b6b5c7a262a",source:"https://raw.githubusercontent.com/rsms/inter/v4.1/docs/font-files/InterVariable-Italic.woff2"},{id:"fa-solid",file:"fonts/fa-solid-900.woff2",mime:"font/woff2",families:["Font Awesome 5 Free","Font Awesome 6 Free"],style:"normal",variable:!1,bytes:158220,sha256:"6a3b4536c389c82a2a2e160e7ab15f6c8acef77f42e04d4c697f1cbfa9e90026",source:"https://raw.githubusercontent.com/FortAwesome/Font-Awesome/6.7.2/webfonts/fa-solid-900.woff2"},{id:"fa-regular",file:"fonts/fa-regular-400.woff2",mime:"font/woff2",families:["Font Awesome 5 Free","Font Awesome 6 Free"],style:"normal",variable:!1,bytes:25472,sha256:"dc9e5038a1401446549f7eb3c23911cfac844b3b4a3a3b76c33c34962ee652cb",source:"https://raw.githubusercontent.com/FortAwesome/Font-Awesome/6.7.2/webfonts/fa-regular-400.woff2"},{id:"fa-brands",file:"fonts/fa-brands-400.woff2",mime:"font/woff2",families:["Font Awesome 5 Brands","Font Awesome 6 Brands"],style:"normal",variable:!1,bytes:118680,sha256:"b10a049b201da5518120d35dc74ad7f5ef328ca1e8b7f9d3f6ad11bc76115eeb",source:"https://raw.githubusercontent.com/FortAwesome/Font-Awesome/6.7.2/webfonts/fa-brands-400.woff2"}]);var or=16*1024*1024;var sr=new Uint32Array([1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298]);function on(e){return!!(e&&typeof e=="object"&&!Array.isArray(e)&&Object.keys(e).every(t=>["version","signature","sourceSignature","lineWidths","lineInkBounds","lineHeights","lineOffsets","alphabeticBaseline","height","fontAvailable"].includes(t))&&e.version===1&&typeof e.signature=="string"&&e.signature.length<=49152&&(e.sourceSignature===void 0||typeof e.sourceSignature=="string"&&e.sourceSignature.length<=49152)&&Array.isArray(e.lineWidths)&&e.lineWidths.length>=1&&e.lineWidths.length<=4001&&e.lineWidths.every(t=>Number.isFinite(t)&&t>=0&&t<=1e6)&&Array.isArray(e.lineInkBounds)&&e.lineInkBounds.length===e.lineWidths.length&&e.lineInkBounds.every(t=>t&&typeof t=="object"&&!Array.isArray(t)&&Object.keys(t).length===4&&["x","y","width","height"].every(n=>Number.isFinite(t[n])&&Math.abs(t[n])<=1e6)&&t.width>=0&&t.height>=0)&&["lineHeights","lineOffsets"].every(t=>e[t]===void 0||Array.isArray(e[t])&&e[t].length===e.lineWidths.length&&e[t].every(n=>Number.isFinite(n)&&Math.abs(n)<=1e6&&(t!=="lineHeights"||n>0)))&&(e.alphabeticBaseline===void 0||Number.isFinite(e.alphabeticBaseline)&&Math.abs(e.alphabeticBaseline)<=1e3)&&Number.isFinite(e.height)&&e.height>=0&&e.height<=1e6&&typeof e.fontAvailable=="boolean")}var sn=e=>{try{let t=JSON.parse(e);return Array.isArray(t)&&(t.length===8||t.length===9&&t[8]==="pixels")&&typeof t[0]=="string"?t[0]:void 0}catch{return}};function pi(e,t){let n=0;for(let i of e)if(t.startsWith(i,n))n+=i.length;else if(i!==`
`)return!1;return n===t.length}function Me(e,t){if(e.textRanges!==void 0)return Y(e),st(e).sourceText;let n=e.text??"",i=e.textSource;if(typeof i!="string"||n===i)return n;if(on(e.textMetrics)){let o=sn(e.textMetrics.signature),r=sn(e.textMetrics.sourceSignature);if(n===o)return i;if(o!==void 0&&(r===void 0||i===r))return n}return t&&n===t.text&&i!==t.textSource||e.textFlow==="wrap"&&pi(n,i)||e.textOverflow==="ellipsis"&&n.endsWith("…")&&i.startsWith(n.slice(0,-1).trimEnd())?i:n}function an(e,t){return{characters:Me(e,t),autoResize:e.layoutSizingHorizontal==="hug"?"WIDTH_AND_HEIGHT":e.layoutSizingVertical==="hug"?"HEIGHT":"NONE",truncation:e.textOverflow==="ellipsis"?"ENDING":"DISABLED",maxLines:e.textOverflow==="ellipsis"?1:null}}function fe(e){let t=e.fontFamily??"Inter",n=e.fontWeight??400,i=e.fontStyle??"normal";if(typeof t!="string"||!t.length||t.length>120||t!==t.trim()||/[\u0000-\u001f\u007f,"'\\]/u.test(t)||![100,200,300,400,500,600,700,800,900].includes(n)||!["normal","italic"].includes(i)){let r=new Error("Native range fonts require one literal family and a supported weight/style tuple.");throw r.code="TEXT_RANGES_NATIVE_UNSUPPORTED_FONT",r}if(/^Font Awesome [56] (Free|Brands)$/u.test(t)){if(i!=="normal"){let r=new Error("Native icon font ranges do not support an italic face.");throw r.code="TEXT_RANGES_NATIVE_UNSUPPORTED_FONT",r}return{family:t,style:t.endsWith(" Brands")||n<600?"Regular":"Solid"}}let o={100:"Thin",200:"Extra Light",300:"Light",400:"Regular",500:"Medium",600:"Semi Bold",700:"Bold",800:"Extra Bold",900:"Black"}[n];return{family:t,style:i==="italic"?o==="Regular"?"Italic":`${o} Italic`:o}}var Cr=Lt*2+1,at=["textDecorationThickness","textUnderlineOffset","textDecorationSkipInk"],Ie=(e,t)=>Object.hasOwn(e,t),cn=new WeakSet,H=(e,t)=>{let n=new Error(t);throw n.code=e,cn.add(n),n},ct="Native range planning requires a valid complete content-bound Text source.",gi=new Set(["TEXT_RANGES_INVALID","TEXT_RANGES_STALE","TEXT_RANGES_DISPLAY_MISMATCH","TEXT_RANGES_UNSUPPORTED_TRUNCATION","TEXT_RANGES_UNSUPPORTED_BASE_PAINT"]),hi=["type","text","textSource","textFlow","textRanges","fill","fillPaints","textDecoration",...at,"textOverflow","fontSize","fontFamily","fontWeight","fontStyle"];function yi(e){let t=()=>H("TEXT_RANGES_NATIVE_INVALID_SOURCE",ct),n=u=>u!==null&&typeof u=="object"&&!Array.isArray(u)&&[Object.prototype,null].includes(Object.getPrototypeOf(u));n(e)||H("TEXT_RANGES_NATIVE_INVALID_NODE","Native range planning requires a canonical Text node.");let i=0,o=0,r=u=>{for(let N of JSON.stringify(u)){let A=N.codePointAt(0);o+=A<128?1:A<2048?2:A<65536?3:4}o>96*1024&&t()},s=(u,N=new Set,A=0)=>{if((++i>2048||A>8)&&t(),u===null||typeof u=="boolean"||typeof u=="number"&&Number.isFinite(u))return r(u),u;if(typeof u=="string")return u.length>32768&&t(),r(u),u;let S=Array.isArray(u);(!S&&!n(u)||N.has(u))&&t();let E=Object.getOwnPropertyDescriptors(u),p=Reflect.ownKeys(E),T=S?E.length?.value:void 0;(p.some(m=>typeof m!="string")||S&&(!Number.isInteger(T)||T>64))&&t();let x=S?p.filter(m=>m!=="length"):p;(x.length>16&&!S||S&&(x.length!==T||x.some((m,l)=>m!==String(l))))&&t(),N.add(u);let g=S?[]:{};for(let m of x){let l=E[m];(!Ie(l,"value")||!l.enumerable)&&t(),r(m),Object.defineProperty(g,m,{value:s(l.value,N,A+1),enumerable:!0,writable:!0,configurable:!0})}return N.delete(u),g},a=Object.getOwnPropertyDescriptors(e),c={};for(let u of hi){if(!Ie(a,u))continue;let N=a[u];(!Ie(N,"value")||!N.enumerable)&&t(),at.includes(u)&&H("TEXT_RANGES_NATIVE_UNSUPPORTED_DECORATION","Native range planning currently supports no text decoration or CSS underline geometry."),u==="fillPaints"&&N.value!==void 0&&H("TEXT_RANGES_NATIVE_UNSUPPORTED_PAINT","Native text range planning supports one opaque hex base fill only."),N.value!==void 0&&(c[u]=s(N.value))}return c}function Ti(e){try{return{ranges:Y(e)?.ranges??[],characters:st(e).sourceText}}catch(t){let n;try{n=t&&typeof t=="object"?Object.getOwnPropertyDescriptor(t,"code")?.value:void 0}catch{}H(gi.has(n)?n:"TEXT_RANGES_NATIVE_INVALID_SOURCE",ct)}}function Ei(e){let t=()=>H("TEXT_RANGES_NATIVE_UNSUPPORTED_LINK","Native range links support conservative absolute HTTP(S) URLs and bare ASCII mailto addresses only.");if(Fe(e)||t(),/^https?:\/\//iu.test(e)){let o=/^https?:\/\/([^/?#]+)/iu.exec(e)[1].replace(/:[0-9]+$/u,""),r=o.split(".");return(o.length>253||r.some(s=>!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(s)))&&t(),/^(?:[0-9]+|0x[0-9a-f]*)$/iu.test(r.at(-1))&&!(r.length===4&&r.every(s=>/^(?:0|[1-9][0-9]{0,2})$/u.test(s)&&Number(s)<=255))&&t(),{type:"URL",value:e}}let n=/^mailto:([a-z0-9_+.-]{1,64})@([a-z0-9.-]{1,253})$/iu.exec(e);return(!n||n[1].startsWith(".")||n[1].endsWith(".")||n[1].includes("..")||n[2].split(".").length<2||n[2].split(".").some(i=>!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(i)))&&t(),{type:"URL",value:e}}function Ni(e){(!e||typeof e!="object"||Array.isArray(e)||e.type!=="text")&&H("TEXT_RANGES_NATIVE_INVALID_NODE","Native range planning requires a canonical Text node."),e.textSource!==void 0&&typeof e.textSource!="string"&&H("TEXT_RANGES_NATIVE_INVALID_SOURCE",ct),(typeof e.fill!="string"||!/^#[0-9a-f]{6}$/iu.test(e.fill)||e.fillPaints!==void 0)&&H("TEXT_RANGES_NATIVE_UNSUPPORTED_PAINT","Native text range planning supports one opaque hex base fill only."),(e.textDecoration!==void 0&&e.textDecoration!=="none"||at.some(u=>Ie(e,u)))&&H("TEXT_RANGES_NATIVE_UNSUPPORTED_DECORATION","Native range planning currently supports no text decoration or CSS underline geometry."),e.textOverflow!==void 0&&H("TEXT_RANGES_UNSUPPORTED_TRUNCATION","Native range planning does not support truncated text.");let{characters:t,ranges:n}=Ti(e),i=["fontSize","fontFamily","fontWeight","fontStyle"],o=n.some(u=>i.some(N=>Ie(u,N))),r=u=>{if(!o)return{};let N={...e,...u};(!Number.isFinite(N.fontSize)||N.fontSize<1||N.fontSize>240)&&H("TEXT_RANGES_NATIVE_UNSUPPORTED_FONT","Native range font sizes must be within1..240.");try{return{fontName:fe(N),fontSize:N.fontSize}}catch{H("TEXT_RANGES_NATIVE_UNSUPPORTED_FONT","Native range fonts require one literal supported family/weight/style tuple.")}},s=e.fill.toLowerCase(),a=[],c=0;for(let u of n)(u.textDecoration!==void 0&&u.textDecoration!=="none"||at.some(N=>Ie(u,N)))&&H("TEXT_RANGES_NATIVE_UNSUPPORTED_DECORATION","Native range planning currently supports no text decoration or CSS underline geometry."),c<u.start&&a.push({start:c,end:u.start,fill:s,hyperlink:null,...r({})}),a.push({start:u.start,end:u.end,fill:u.fill??s,hyperlink:u.href===void 0?null:Ei(u.href),...r(u)}),c=u.end;return c<t.length&&a.push({start:c,end:t.length,fill:s,hyperlink:null,...r({})}),{characters:t,runs:a}}function he(e){try{return Ni(yi(e))}catch(t){if(t!==null&&typeof t=="object"&&cn.has(t))throw t;H("TEXT_RANGES_NATIVE_INVALID_SOURCE",ct)}}function ln(e){if(e?.textRanges===void 0)return;let t=(typeof e.name=="string"?e.name:typeof e.id=="string"?e.id:"Text").slice(0,120),n=new Error(t+"：范围文字的此项原生互转尚未完成验证；已阻止互转，未丢弃范围样式。");throw n.code="TEXT_RANGES_NATIVE_UNSUPPORTED",n}function Xe(e){if(e?.textRanges!==void 0)try{return he(e)}catch(t){let n={TEXT_RANGES_NATIVE_UNSUPPORTED_LINK:"范围文字的原生链接目前只支持完整 HTTP(S) 地址和简单 mailto 地址",TEXT_RANGES_NATIVE_UNSUPPORTED_DECORATION:"范围文字的原生装饰仍待验证；请先移除下划线和删除线",TEXT_RANGES_NATIVE_UNSUPPORTED_PAINT:"范围文字的原生填充目前只支持不透明纯色",TEXT_RANGES_NATIVE_UNSUPPORTED_FONT:"范围文字的原生字体需要单个明确字体名、100–900字重、normal/italic和1–240字号"},i=typeof t?.code=="string"?t.code:"TEXT_RANGES_NATIVE_INVALID_SOURCE",o=new Error(n[i]??"范围文字的完整来源或区间无效，已阻止创建副本");throw o.code=i,o}}function fn(e,t){let n=Xe(t);if(!n)return;let i=n.runs.some(c=>c.fontName!==void 0),o=["setRangeHyperlink","setRangeFills","setRangeTextDecoration",...i?["setRangeFontName","setRangeFontSize"]:[]];if(e?.type!=="TEXT"||e.characters!==n.characters||o.some(c=>typeof e[c]!="function")){let c=new Error("范围文字的原生写入能力或完整来源不匹配，已阻止创建副本");throw c.code="TEXT_RANGES_NATIVE_WRITE_UNAVAILABLE",c}let[r,s,a]=o.map(c=>e[c]);for(let c of n.runs){i&&(e.setRangeFontName(c.start,c.end,c.fontName),e.setRangeFontSize(c.start,c.end,c.fontSize)),r.call(e,c.start,c.end,c.hyperlink);let u=[1,3,5].map(N=>parseInt(c.fill.slice(N,N+2),16)/255);s.call(e,c.start,c.end,[{type:"SOLID",color:{r:u[0],g:u[1],b:u[2]}}]),a.call(e,c.start,c.end,"NONE")}return n}async function un(e,t,n=new Map){let i=Xe(e);for(let o of i?.runs??[]){if(!o.fontName)continue;let r=JSON.stringify(o.fontName);n.has(r)||n.set(r,(async()=>{try{if(typeof t!="function")throw new Error("Native font loader unavailable");await t(o.fontName)}catch{let s=new Error(`${o.fontName.family} ${o.fontName.style} 不可用；范围字体不能无声回退，请安装或启用原字体后重试。`);throw s.code="TEXT_RANGES_NATIVE_FONT_UNAVAILABLE",s}})()),await n.get(r)}return i}var xi=Object.freeze(["textDecoration","textDecorationStyle","textDecorationOffset","textDecorationThickness","textDecorationColor","textDecorationSkipInk","hyperlink"]),lt=(e,t)=>Object.prototype.hasOwnProperty.call(e,t),Ue=e=>{try{let t=e&&typeof e=="object"?Object.getOwnPropertyDescriptor(e,"message"):void 0;return t&&lt(t,"value")&&typeof t.value=="string"?t.value.slice(0,240):"Native getter failed"}catch{return"Native getter failed"}},ue=e=>{throw new Error(e)},pn=new WeakSet,dn=e=>e!==null&&typeof e=="object"&&pn.has(e),je=e=>{let t=new Error(e);throw pn.add(t),t};function Vt(e){let t=0;for(let n of e){let i=n.codePointAt(0);t+=i<128?1:i<2048?2:i<65536?3:4}return t}function ft(e,t,{fields:n,scalarFields:i=[]}={}){let o=[],r=(E,p)=>({status:"unsupported",diagnostics:[...o,{code:E,message:p}]});if(!e||e.type!=="TEXT")return r("NATIVE_TEXT_CAPTURE_TYPE","Native source must be TEXT");if(typeof t!="symbol")return r("NATIVE_TEXT_CAPTURE_MIXED","Native mixed identity is unavailable");if(!Array.isArray(n)||!n.length||n.length>64||!Array.isArray(i)||i.length>64||[...n,...i].some(E=>typeof E!="string"||!/^[a-zA-Z][a-zA-Z0-9]*$/u.test(E))||new Set(n).size!==n.length||new Set(i).size!==i.length)return r("NATIVE_TEXT_CAPTURE_FIELDS","Native field catalog is invalid");let s;try{s=e.characters}catch(E){return r("NATIVE_TEXT_CAPTURE_CHARACTERS",Ue(E))}if(typeof s!="string"||s.length>4e3)return r("NATIVE_TEXT_CAPTURE_BUDGET","Native text exceeds the complete 4000 UTF16 source budget");let a=0,c=0,u=E=>{(c+=E)>262144&&je("Complete native observations exceed 256 KiB")},N=(E,p=new Set,T=0)=>{if((++a>4e4||T>12)&&je("Native observation exceeds its data budget"),E===null||typeof E=="boolean")return u(E===null||E?4:5),E;if(typeof E=="number")return Number.isFinite(E)||ue("Nonfinite native number"),u(String(E).length),E;if(typeof E=="string")return E.length>262144&&je("Native string exceeds its data budget"),u(Vt(JSON.stringify(E))),E;(typeof E!="object"||E===t)&&ue("Unsupported native host value"),p.has(E)&&ue("Cyclic native observation");let x=Array.isArray(E),g=Object.getPrototypeOf(E);!x&&g!==Object.prototype&&g!==null&&ue("Unsupported native object prototype");let m=Object.getOwnPropertyDescriptors(E),l=Reflect.ownKeys(m);l.some(d=>typeof d!="string")&&ue("Native symbol key is not JSON data"),x&&(!Number.isInteger(E.length)||E.length>1024)&&je("Native array exceeds its data budget");let f=x?l.filter(d=>d!=="length"):l;f.length>512&&je("Native object exceeds its data budget"),x&&f.length!==E.length&&ue("Native object is sparse"),x&&f.some((d,h)=>d!==String(h))&&ue("Native array has extra properties"),p.add(E),u(2);let y=x?[]:{};for(let d of f){let h=m[d];(!lt(h,"value")||!h.enumerable)&&ue("Native observation has an accessor or hidden field"),u((x?0:Vt(JSON.stringify(d))+1)+1),Object.defineProperty(y,d,{value:N(h.value,p,T+1),enumerable:!0,configurable:!0,writable:!0})}return p.delete(E),y},A=E=>{try{let p=E();return p===t?{kind:"mixed"}:p===void 0?{kind:"missing"}:{kind:"value",value:N(p)}}catch(p){if(dn(p))throw p;return{kind:"error",message:Ue(p)}}},S=()=>{let E={};for(let d of new Set([...n,...i]))E[d]=A(()=>e[d]);let p;try{p=e.getStyledTextSegments([...n])}catch(d){return r("NATIVE_TEXT_CAPTURE_SEGMENTS",Ue(d))}if(!Array.isArray(p)||p.length>256)return r("NATIVE_TEXT_CAPTURE_BUDGET","Native segments exceed their complete source budget");let T=Object.getOwnPropertyDescriptors(p),x=Reflect.ownKeys(T);if(x.some(d=>typeof d!="string"||d!=="length"&&!/^(0|[1-9][0-9]*)$/u.test(d))||x.length!==p.length+1)return r("NATIVE_TEXT_CAPTURE_SEGMENTS","Native segment array is not dense owned data");let g=[],m=[],l=0;for(let d=0;d<p.length;d++){let h=T[String(d)];if(!h||!lt(h,"value")||!h.enumerable)return r("NATIVE_TEXT_CAPTURE_SEGMENTS","Native segment entry is not owned data");let _=h.value;if(!_||typeof _!="object"||Array.isArray(_)||![Object.prototype,null].includes(Object.getPrototypeOf(_)))return r("NATIVE_TEXT_CAPTURE_SEGMENTS","Native segment is not a plain record");let C=Object.getOwnPropertyDescriptors(_);if(Reflect.ownKeys(C).some(O=>typeof O!="string"||!lt(C[O],"value")||!C[O].enumerable))return r("NATIVE_TEXT_CAPTURE_SEGMENTS","Native segment contains accessors or hidden data");let v=C.start?.value,I=C.end?.value,D=C.characters?.value;if(!Number.isInteger(v)||!Number.isInteger(I)||v!==l||I<=v||I>s.length||D!==s.slice(v,I)||v>0&&/[\uD800-\uDBFF]/u.test(s[v-1])&&/[\uDC00-\uDFFF]/u.test(s[v])||I<s.length&&/[\uD800-\uDBFF]/u.test(s[I-1])&&/[\uDC00-\uDFFF]/u.test(s[I]))return r("NATIVE_TEXT_CAPTURE_SEGMENTS","Native segments do not cover exact UTF16 source boundaries");let F={},U={};for(let O of n)F[O]=A(()=>C[O]?.value);for(let O of xi){let G=`getRange${O[0].toUpperCase()}${O.slice(1)}`;U[O]=A(()=>{let M=e[G];return typeof M=="function"?M.call(e,v,I):void 0})}g.push({start:v,end:I,characters:D,values:F}),m.push({start:v,end:I,values:U}),l=I}if(l!==s.length)return r("NATIVE_TEXT_CAPTURE_SEGMENTS","Native segments leave an uncaptured source suffix");let f;try{f=e.characters}catch(d){return r("NATIVE_TEXT_CAPTURE_CHARACTERS",Ue(d))}if(f!==s)return r("NATIVE_TEXT_CAPTURE_RACE","Native characters changed during source capture");let y={characters:s,scalars:E,segments:g,rangeChecks:m};return Vt(JSON.stringify(y))>262144?r("NATIVE_TEXT_CAPTURE_BUDGET","Complete native source exceeds 256 KiB"):{status:"captured",observations:y,diagnostics:o}};try{return S()}catch(E){return r(dn(E)?"NATIVE_TEXT_CAPTURE_BUDGET":"NATIVE_TEXT_CAPTURE_DATA",Ue(E))}}var Ee=256*1024,mi=256,Si=256,Q=Object.freeze(["fontName","fontSize","fontWeight","fontStyle","lineHeight","letterSpacing","fills","textDecoration","textDecorationStyle","textDecorationOffset","textDecorationThickness","textDecorationColor","textDecorationSkipInk","hyperlink","textCase","openTypeFeatures","textStyleId","fillStyleId","listOptions","listSpacing","indentation","paragraphIndent","paragraphSpacing","textStyleOverrides","boundVariables","textWrapStyle"]),oe=Object.freeze(["hasMissingFont","textTruncation","maxLines","leadingTrim","hangingPunctuation","hangingList","textAlignHorizontal","textAlignVertical","textAutoResize","layoutSizingHorizontal","layoutSizingVertical"]),gn=["id","type","characters","style","characterStyleOverrides","styleOverrideTable","fills","lineTypes","lineIndentations","textTruncation","maxLines","textAutoResize","layoutSizingHorizontal","layoutSizingVertical","hasMissingFont","leadingTrim","hangingPunctuation","hangingList"],j=(e,t)=>Object.hasOwn(e,t),ye=(e,t,n)=>j(e,t)?e[t]:n,B=e=>e!==null&&typeof e=="object"&&[Object.prototype,null].includes(Object.getPrototypeOf(e)),Te=(e,t,n={})=>({code:e,message:t,...n}),b=(e,t="NATIVE_TEXT_RANGES_INVALID")=>{let n=new Error(e);throw n.code=t,n},J=(e,t)=>B(e)&&Object.keys(e).every(n=>t.includes(n)),re=(e,t)=>Oe(e)===Oe(t);function hn(e){let t=0;for(let n=0;n<e.length;n++){let i=e.charCodeAt(n);t+=i<128?1:i<2048?2:i>=55296&&i<=56319&&e.charCodeAt(n+1)>=56320&&e.charCodeAt(n+1)<=57343?(n++,4):3}return t}function ve(e,t={size:0,seen:new Set},n=0){n>12&&b("Native text source exceeds depth12","NATIVE_TEXT_RANGES_BUDGET");let i=a=>{(t.size+=a)>Ee&&b("Native text source exceeds256KiB","NATIVE_TEXT_RANGES_BUDGET")};if(e===null||typeof e=="boolean")return i(e===null||e?4:5),e;if(typeof e=="string")return i(hn(JSON.stringify(e))),e;if(typeof e=="number"&&Number.isFinite(e))return i(String(e).length),e;(!Array.isArray(e)&&!B(e)||t.seen.has(e))&&b("Native text source must be acyclic plain JSON"),t.seen.add(e),i(2),Array.isArray(e)&&e.length*2+1>Ee&&b("Native array exceeds minimum JSON byte budget","NATIVE_TEXT_RANGES_BUDGET");let o=Object.getOwnPropertyDescriptors(e),r=[];Reflect.ownKeys(e).some(a=>typeof a!="string")&&b("Native text source contains symbol keys"),Array.isArray(e)&&e.length>Ee&&b("Native array exceeds budget","NATIVE_TEXT_RANGES_BUDGET");let s=Array.isArray(e)?Array.from({length:e.length},(a,c)=>String(c)):Object.keys(o);if(Array.isArray(e)){let a=new Set(s);Object.keys(o).some(c=>c!=="length"&&!a.has(c))&&b("Native text source array is not JSON")}for(let a of s){let c=o[a];(!c||!j(c,"value")||!c.enumerable)&&b("Native text source contains holes or accessors"),i((Array.isArray(e)?0:hn(JSON.stringify(a))+1)+(r.length?1:0)),r.push([a,ve(c.value,t,n+1)])}return t.seen.delete(e),Array.isArray(e)?r.map(a=>a[1]):Object.fromEntries(r)}function Oe(e){return e===null||typeof e!="object"?JSON.stringify(e):Array.isArray(e)?`[${e.map(Oe).join(",")}]`:`{${Object.keys(e).sort().map(t=>`${JSON.stringify(t)}:${Oe(e[t])}`).join(",")}}`}function Tn(e){B(e)||b("Native source must be plain JSON"),["type","id","characters"].some(n=>{let i=Object.getOwnPropertyDescriptor(e,n);return i&&!j(i,"value")})&&b("REST source contains accessors"),(e.type!=="TEXT"||typeof e.id!="string"||!e.id||e.id.length>160)&&b("Native source is not an identified TEXT");let t=Object.getOwnPropertyDescriptors(e);return gn.some(n=>j(t,n)&&!j(t[n],"value"))&&b("REST source contains accessors"),be(e.characters),Oe(ve(Object.fromEntries(gn.filter(n=>j(e,n)).map(n=>[n,e[n]]))))}function Ai(e){B(e)||b("Native observation must have an explicit kind"),!(e.kind==="value"&&J(e,["kind","value"])&&j(e,"value"))&&(["mixed","missing"].includes(e.kind)&&J(e,["kind"])||e.kind==="error"&&J(e,["kind","message"])&&typeof e.message=="string"&&e.message.length<=2e3||b("Malformed native observation"))}function Ft(e,t=!1){J(e,t?[...Q,...oe]:Q)||b("Unknown native observation field");for(let n of Object.values(e))Ai(n)}var ut=(e,t)=>Number.isInteger(t)&&t>=0&&t<=e.length&&!(t>0&&t<e.length&&/[\ud800-\udbff]/u.test(e[t-1])&&/[\udc00-\udfff]/u.test(e[t]));function En(e){(!J(e,["version","nodeId","characters","restSignature","scalars","segments","rangeChecks"])||e.version!==1||typeof e.nodeId!="string"||typeof e.restSignature!="string")&&b("Malformed native text source version"),be(e.characters),Ft(e.scalars,!0),(!Array.isArray(e.segments)||e.segments.length>mi||!Array.isArray(e.rangeChecks)||e.rangeChecks.length>Si)&&b("Native text source exceeds segment/check budget","NATIVE_TEXT_RANGES_BUDGET");let t=0;for(let n of e.segments)(!J(n,["start","end","characters","values"])||!ut(e.characters,n.start)||!ut(e.characters,n.end)||n.start!==t||n.end<=n.start||n.characters!==e.characters.slice(n.start,n.end))&&b("Native segments do not cover exact authored UTF16 text"),Ft(n.values),t=n.end;t!==e.characters.length&&b("Native segments omit authored text");for(let n of e.rangeChecks)(!J(n,["start","end","values"])||!ut(e.characters,n.start)||!ut(e.characters,n.end)||n.start>=n.end)&&b("Invalid native getter range"),Ft(n.values)}var q=(e,t)=>e[t]?.kind==="value"?e[t].value:void 0;function yn(e){return Array.isArray(e)?e.map(t=>({type:t.type,visible:ye(t,"visible",!0),opacity:ye(t,"opacity",1),blendMode:ye(t,"blendMode","NORMAL"),boundVariables:j(t,"boundVariables")?t.boundVariables:{},color:t.color&&{r:t.color.r,g:t.color.g,b:t.color.b,a:ye(t.color,"a",1)}})):e}function Z(e,t=!1){if(e===null)return null;if(J(e,["type",t?"url":"value"])&&e.type==="URL"&&typeof e[t?"url":"value"]=="string")return e[t?"url":"value"]}function _i(e,t){let n=e.characterStyleOverrides??[],i=e.styleOverrideTable??{},o=Array.from(t.characters).length;e.style!==void 0&&!B(e.style)&&b("Malformed REST text style"),(!Array.isArray(n)||n.length>o||!B(i)||n.some(a=>!Number.isInteger(a)||a<0||a!==0&&!B(i[a])))&&b("Malformed REST character styles");let r=()=>b("REST and live native style differ; source may have changed during capture","NATIVE_TEXT_RANGES_CAPTURE_RACE");for(let a of oe){let c=t.scalars[a];c?.kind==="value"&&(j(e,a)&&!re(e[a],c.value)||j(e.style??{},a)&&!re(e.style[a],c.value))&&r()}let s=0;for(let a of t.segments){let c=a.values;for(let u=a.start;u<a.end;u+=t.characters.codePointAt(u)>65535?2:1){let N=n[s++]??0,A={...e.style??{},...N===0?{}:i[N]};for(let x of["fontSize","fontWeight","textDecoration","textCase"])j(A,x)&&c[x]?.kind==="value"&&!re(A[x],q(c,x))&&r();let S=q(c,"fontName");S&&(j(A,"fontFamily")&&A.fontFamily!==S.family||j(A,"fontStyle")&&A.fontStyle!==S.style)&&r();let E=A.fills??e.fills;E!==void 0&&c.fills?.kind==="value"&&!re(yn(E),yn(q(c,"fills")))&&r(),j(A,"hyperlink")&&c.hyperlink?.kind==="value"&&Z(A.hyperlink,!0)!==void 0&&Z(q(c,"hyperlink"))!==void 0&&Z(A.hyperlink,!0)!==Z(q(c,"hyperlink"))&&r();let p=q(c,"lineHeight");A.lineHeightUnit==="PIXELS"&&p&&(p.unit!=="PIXELS"||A.lineHeightPx!==p.value)&&r(),["FONT_SIZE_%","PERCENT"].includes(A.lineHeightUnit)&&p&&(p.unit!=="PERCENT"||A.lineHeightPercentFontSize!==p.value&&!(typeof p.value=="number"&&typeof A.lineHeightPercentFontSize=="number"&&A.lineHeightPercentFontSize===Math.fround(p.value)))&&r();let T=q(c,"letterSpacing");if(j(A,"letterSpacing")&&T&&["PIXELS","PERCENT"].includes(T.unit)){let x=T.unit==="PIXELS"?T.value:T.value*q(c,"fontSize")/100;A.letterSpacing!==x&&r()}}}}function bi(e){let t=[];for(let[n,i]of Object.entries(e.scalars)){if(["error","missing"].includes(i.kind)&&t.push(Te("NATIVE_TEXT_RANGES_SCALAR_OBSERVATION","Native scalar observation remains raw",{field:n,kind:i.kind})),n==="hyperlink"&&i.kind==="value"&&Z(i.value)!==void 0){let o=e.segments.map(r=>r.values.hyperlink);if(o.length&&o.every(r=>r?.kind==="value"&&Z(r.value)!==void 0)){let r=[...new Set(o.map(a=>Z(a.value)).filter(a=>a!==null))],s=r.length===0?null:r.length===1?r[0]:void 0;(s===void 0||Z(i.value)!==s)&&b("Native scalar hyperlink conflicts with complete styled segments","NATIVE_TEXT_RANGES_CAPTURE_RACE")}}n==="hyperlink"&&i.kind==="value"&&Z(i.value)===void 0&&t.push(Te("NATIVE_TEXT_RANGES_HYPERLINK_UNKNOWN","Native scalar hyperlink is not interpreted as no-link",{field:n,value:i.value}))}for(let[n,i]of Object.entries(e.scalars)){if(i.kind!=="value"||!Q.includes(n)||n==="hyperlink")continue;let o=e.segments.map(r=>r.values[n]);o.length&&o.every(r=>r?.kind==="value")&&o.every(r=>re(r.value,o[0].value))&&!re(i.value,o[0].value)&&b("Native scalar conflicts with uniform styled segments","NATIVE_TEXT_RANGES_CAPTURE_RACE")}for(let[n,i]of e.rangeChecks.entries())for(let[o,r]of Object.entries(i.values)){if(r.kind!=="value"){t.push(Te("NATIVE_TEXT_RANGES_GETTER_OBSERVATION","Native getter observation remains raw",{field:o,index:n,kind:r.kind}));continue}if(o==="hyperlink"&&Z(r.value)===void 0){t.push(Te("NATIVE_TEXT_RANGES_HYPERLINK_UNKNOWN","Native hyperlink getter value is not interpreted as no-link",{field:o,index:n,value:r.value}));continue}let a=e.segments.filter(c=>c.start<i.end&&c.end>i.start).map(c=>c.values[o]);a.length&&a.every(c=>c?.kind==="value")&&a.every(c=>re(c.value,a[0].value))&&!re(r.value,a[0].value)&&b("Valid native range getter conflicts with styled segments","NATIVE_TEXT_RANGES_CAPTURE_RACE")}return t}var Mt=e=>({status:e.code==="NATIVE_TEXT_RANGES_STALE"?"stale":"invalid",diagnostics:[Te(e.code??"NATIVE_TEXT_RANGES_INVALID",e.message)]});function ie(e,t,n){B(e)||b("Native codec input must be plain data");let i=Object.getOwnPropertyDescriptor(e,t);return i?(j(i,"value")||b("Native codec input contains accessors"),i.value):n}function dt(e){try{let t=ie(e,"rest"),n=ie(e,"characters"),i=ie(e,"scalars"),o=ie(e,"segments"),r=ie(e,"rangeChecks",[]),s=Tn(t),a=ve({version:1,nodeId:t.id,characters:n,restSignature:s,scalars:i,segments:o,rangeChecks:r});return we(t,a)}catch(t){return Mt(t)}}function we(e,t){try{if(t===void 0&&(t=ie(e,"codeshellNativeTextRanges")),t===void 0)return{status:"absent",diagnostics:[]};let n=ve(t);En(n);let i=Tn(e);return(n.nodeId!==e.id||n.characters!==e.characters||n.restSignature!==i)&&b("Native text evidence is stale for this REST node","NATIVE_TEXT_RANGES_STALE"),_i(e,n),{status:"bound",source:n,diagnostics:bi(n)}}catch(n){return Mt(n)}}function de(e){let t=ve(e);En(t);let{restSignature:n,...i}=t;return Oe(i)}function X(e,t){return e[t]?.kind!=="value"&&b(`Native ${t} is missing/mixed/unknown`,"NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS"),e[t].value}function Ii(e){(!Array.isArray(e)||e.length!==1)&&b("Native range requires one opaque normal SOLID paint","NATIVE_TEXT_RANGES_UNSUPPORTED_PAINT");let t=e[0],n=t?.color;return(!J(t,["type","visible","opacity","blendMode","color","boundVariables"])||t.type!=="SOLID"||j(t,"visible")&&t.visible!==!0||ye(t,"opacity",1)!==1||ye(t,"blendMode","NORMAL")!=="NORMAL"||!J(n,["r","g","b","a"])||ye(n,"a",1)!==1||j(t,"boundVariables")&&(!B(t.boundVariables)||Object.keys(t.boundVariables).length))&&b("Native range paint is not supported","NATIVE_TEXT_RANGES_UNSUPPORTED_PAINT"),`#${[n.r,n.g,n.b].map(o=>{for(let r=0;r<=255;r++)if(o===r/255||o===Math.fround(r/255))return r;b("Native color cannot be represented exactly as sRGB8; raw channels were retained","NATIVE_TEXT_RANGES_COLOR_QUANTIZATION")}).map(o=>o.toString(16).padStart(2,"0")).join("")}`}var Nn=["fontName","fontSize","lineHeight","letterSpacing"];function Oi(e,t){if(!B(e)||!Number.isFinite(e.value)||!ge(t))return!1;let n=ne(t);return e.unit===n.unit&&(e.value===n.value||n.unit==="PERCENT"&&e.value===Math.fround(n.value/100)*100)}function vi(e){for(let i of Nn)X(e,i);for(let[i,o]of[["textCase","ORIGINAL"],["listSpacing",0],["indentation",0],["paragraphIndent",0],["paragraphSpacing",0]])X(e,i)!==o&&b(`Native ${i} changes paragraph metrics`,"NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");let t=X(e,"listOptions");(!B(t)||t.type!=="NONE"||Object.keys(t).some(i=>i!=="type"))&&b("Native lists are not supported","NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");for(let i of["openTypeFeatures","boundVariables"]){let o=X(e,i);(!B(o)||Object.keys(o).length)&&b("Native features/variables require a separate model","NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS")}let n=X(e,"textStyleOverrides");(!Array.isArray(n)||n.some(i=>!J(i,["type"])||!["HYPERLINK","TEXT_DECORATION"].includes(i.type)))&&b("Native semantic font overrides require a separate model","NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS"),X(e,"textWrapStyle")!=="AUTO"&&b("Native text-wrap style is unsupported","NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS")}function Re(e){let t,n,i;try{t=ie(e,"rest"),n=ie(e,"source"),i=ve(ie(e,"canonicalNode"))}catch(a){return{...Mt(a),status:"unsupported",pixelsVerified:!1}}let o=we(t,n),r=[...o.diagnostics],s=a=>({status:"unsupported",diagnostics:[...r,Te(a.code??"NATIVE_TEXT_RANGES_INVALID",a.message)],pixelsVerified:!1});if(o.status!=="bound")return{status:"unsupported",diagnostics:r,pixelsVerified:!1};try{let a=o.source;(i?.type!=="text"||(i.textSource??i.text)!==a.characters)&&b("Canonical text does not preserve native authored source","NATIVE_TEXT_RANGES_SOURCE_MISMATCH");for(let p of a.segments)for(let T of["textDecorationStyle","textDecorationOffset","textDecorationThickness","textDecorationColor","textDecorationSkipInk"])p.values[T]?.kind==="value"&&p.values[T].value!==null&&b("Native underline geometry has no proven CSS basis; whole range admission refused","NATIVE_TEXT_RANGES_NATIVE_DECORATION_BASIS");let c=a.scalars;for(let[p,T]of[["hasMissingFont",!1],["leadingTrim","NONE"],["hangingPunctuation",!1],["hangingList",!1],["textAlignVertical","TOP"],["textTruncation","DISABLED"],["maxLines",null]])X(c,p)!==T&&b(`Native ${p} applicability is unsupported`,"NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");({LEFT:"left",CENTER:"center",RIGHT:"right"})[X(c,"textAlignHorizontal")]!==(i.textAlign??"left")&&b("Canonical text alignment differs from native","NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");let u=["fontFamily","fontSize","fontWeight","fontStyle"],N=i.textRanges?.ranges?.some(p=>u.some(T=>j(p,T))),A=a.segments[0]?.values,S=[];for(let p of a.segments){let T=p.values;vi(T);for(let I of N?["lineHeight","letterSpacing"]:Nn)re(q(T,I),q(A,I))||b("Native metric variants cannot be split into paint ranges","NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");let x=X(T,"fontName"),g=X(T,"lineHeight"),m=X(T,"letterSpacing");(!B(x)||!N&&(x.family!==i.fontFamily||q(T,"fontSize")!==i.fontSize||X(T,"fontWeight")!==i.fontWeight||X(T,"fontStyle")!==(i.fontStyle==="italic"?"ITALIC":"REGULAR"))||!Oi(g,i)||!B(m)||!(m.value===0&&i.letterSpacing===0||m.unit==="PIXELS"&&m.value===i.letterSpacing))&&b("Canonical font metrics differ from native","NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");let l=N?{fontFamily:x.family,fontSize:X(T,"fontSize"),fontWeight:X(T,"fontWeight"),fontStyle:X(T,"fontStyle")==="ITALIC"?"italic":"normal"}:null;N&&(!Number.isFinite(l.fontSize)||l.fontSize<1||l.fontSize>240||!["REGULAR","ITALIC"].includes(X(T,"fontStyle")))&&b("Native font tuple is outside supported range metrics","NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");let f=N?fe(l).style:null;(!J(x,["family","style","variationSettings"])||!(N?x.style===f||x.style==="Regular"&&x.variationSettings?.wght===l.fontWeight&&l.fontStyle==="normal":["Regular","Bold","Italic","Bold Italic"].includes(x.style))||j(x,"variationSettings")&&(!B(x.variationSettings)||Object.entries(x.variationSettings).some(([I,D])=>I==="wght"?D!==(l?.fontWeight??i.fontWeight):I==="slnt"?D!==0:!0)))&&b("Native font axis/style is outside canonical uniform metrics","NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");let y=Ii(X(T,"fills")),d=X(T,"textDecoration");["NONE","UNDERLINE","STRIKETHROUGH"].includes(d)||b("Native decoration is unsupported","NATIVE_TEXT_RANGES_UNSUPPORTED_DECORATION");for(let I of["textDecorationStyle","textDecorationOffset","textDecorationThickness","textDecorationColor","textDecorationSkipInk"])X(T,I)!==null&&b("Native underline geometry has no proven CSS basis; whole range admission refused","NATIVE_TEXT_RANGES_NATIVE_DECORATION_BASIS");let h=X(T,"hyperlink"),_=Z(h);(_===void 0||typeof _=="string"&&(_.startsWith("#")||!Fe(_)))&&b("Native hyperlink target is unsupported; raw value retained","NATIVE_TEXT_RANGES_UNSUPPORTED_HYPERLINK");let C={start:p.start,end:p.end};if(l)for(let I of u)l[I]!==(i[I]??(I==="fontFamily"?"Inter":I==="fontWeight"?400:I==="fontStyle"?"normal":void 0))&&(C[I]=l[I]);let v={NONE:"none",UNDERLINE:"underline",STRIKETHROUGH:"line-through"}[d];y!==i.fill?.toLowerCase()&&(C.fill=y),v!==(i.textDecoration??"none")&&(C.textDecoration=v),_!==null&&(C.href=_),Object.keys(C).length>2&&S.push(C)}let E=Y({...i,textRanges:{version:1,sourceSignature:be(a.characters),ranges:S}});return r.push(Te("NATIVE_TEXT_RANGES_PIXELS_UNVERIFIED","Native color/link/decoration/font intent recovered; cross-renderer pixels are not verified")),{status:E?"admitted-intent":"uniform",...E?{textRanges:E}:{},diagnostics:r,pixelsVerified:!1}}catch(a){return s(a)}}var wi=64*1024,Ri=1e5,mn=new WeakSet,se=(e,t)=>{let n=new Error(t);throw n.code=e,mn.add(n),n},z=()=>se("NATIVE_TEXT_RANGE_HINT_INVALID","Native author hints require bounded owned plain data."),Ne=(e,t)=>Object.hasOwn(e,t),Xt=e=>e!==null&&typeof e=="object"&&!Array.isArray(e)&&[Object.prototype,null].includes(Object.getPrototypeOf(e)),Ci=["id","type","characters","style","characterStyleOverrides","styleOverrideTable","fills","lineTypes","lineIndentations","textTruncation","maxLines","textAutoResize","layoutSizingHorizontal","layoutSizingVertical","hasMissingFont","leadingTrim","hangingPunctuation","hangingList"],Ut=["type","text","textSource","textFlow","textRanges","fill","fillPaints","textDecoration","textDecorationThickness","textUnderlineOffset","textDecorationSkipInk","textOverflow","fontFamily","fontSize","fontWeight","fontStyle","lineHeight","lineHeightUnit","letterSpacing","textAlign"];function pt(e){let t=0;for(let n of e){let i=n.codePointAt(0);t+=i<128?1:i<2048?2:i<65536?3:4}return t}function yt(e,t={seen:new Set,bytes:0,count:0},n=0){let i=N=>{(t.bytes+=pt(N))>524288&&z()};if((++t.count>1e5||n>16)&&z(),e===null||typeof e=="boolean"||typeof e=="number"&&Number.isFinite(e))return i(String(e)),e;if(typeof e=="string")return e.length>512*1024&&z(),i(JSON.stringify(e)),e;let o=Array.isArray(e);(!o&&!Xt(e)||t.seen.has(e))&&z();let r=Object.getOwnPropertyDescriptors(e),s=Reflect.ownKeys(r),a=o?r.length?.value:void 0;(s.some(N=>typeof N!="string")||o&&(!Number.isInteger(a)||a>4096))&&z();let c=o?s.filter(N=>N!=="length"):s;(c.length>4096||o&&(c.length!==a||c.some((N,A)=>N!==String(A))))&&z(),t.seen.add(e),i("[]");let u=o?[]:{};for(let N of c){let A=r[N];(!Ne(A,"value")||!A.enumerable)&&z(),i(JSON.stringify(N)+":,"),Object.defineProperty(u,N,{value:yt(A.value,t,n+1),enumerable:!0,writable:!0,configurable:!0})}return t.seen.delete(e),u}function gt(e,t){Xt(e)||z();let n=Object.getOwnPropertyDescriptors(e);return Reflect.ownKeys(n).some(i=>typeof i!="string"||!t.includes(i)||!Ne(n[i],"value")||!n[i].enumerable)&&z(),Object.fromEntries(Object.keys(n).map(i=>[i,n[i].value]))}function ht(e,t,n=!1){Xt(e)||z();let i=Object.getOwnPropertyDescriptors(e),o={};for(let r of t){if(!Ne(i,r))continue;let s=i[r];(!Ne(s,"value")||!s.enumerable)&&z(),!(s.value===void 0&&n)&&(o[r]=yt(s.value))}return o}function Sn(e,t,n){[t,n].every(r=>typeof r=="string"&&r.length<=1e5&&/^[a-z0-9_.-]+$/iu.test(r))||z();let i=typeof e=="string"?e:JSON.stringify(e),o=pt(i);return(o>wi||o+pt(t)+pt(n)>Ri)&&se("NATIVE_TEXT_RANGE_HINT_BUDGET","The complete native author hint or plugin-data entry exceeds its byte budget."),i}function xn(e,t,n){let i=[];for(let o of e.runs){let r=n?{...o,fontName:o.fontName??fe(t),fontSize:o.fontSize??t.fontSize}:o,s=i.at(-1);s&&s.end===r.start&&s.fill===r.fill&&JSON.stringify(s.fontName)===JSON.stringify(r.fontName)&&s.fontSize===r.fontSize&&JSON.stringify(s.hyperlink)===JSON.stringify(r.hyperlink)?s.end=r.end:i.push({...r,hyperlink:r.hyperlink&&{...r.hyperlink}})}return JSON.stringify({characters:e.characters,runs:i})}function An(e,t,n){let i=ht(e,Ci),o=yt(t),r=we(i,o);r.status!=="bound"&&se("NATIVE_TEXT_RANGE_HINT_SOURCE","Author hints require a complete independently bound current native source.");let s=ht(n,Ut,!0),a=Re({rest:i,source:r.source,canonicalNode:s});["uniform","admitted-intent"].includes(a.status)||se("NATIVE_TEXT_RANGE_HINT_EFFECTIVE","Current native text cannot independently prove the supported color/link/font plan."),delete s.textRanges,a.textRanges&&(s.textRanges=a.textRanges);let c=he(s);return{rest:i,source:r.source,plan:c,canonical:s,snapshot:de(r.source)}}function _n(e,t){let n=he(e),i=[...n.runs,...t.plan.runs].some(o=>o.fontName);xn(n,e,i)!==xn(t.plan,t.canonical,i)&&se("NATIVE_TEXT_RANGE_HINT_EFFECTIVE","The hinted author state would change current native characters, colors, links, or fonts.")}function bn(e){try{return e()}catch(t){if(t!==null&&typeof t=="object"&&mn.has(t))throw t;se("NATIVE_TEXT_RANGE_HINT_INVALID","Native author hint validation failed without restoring any author state.")}}function In(e){return bn(()=>{let t=gt(e,["rest","source","authorNode","pluginId","key"]),n=ht(t.authorNode,Ut,!0),i=Y(n);i||se("NATIVE_TEXT_RANGE_HINT_NO_INTENT","Only a nonempty explicit canonical range payload needs an author hint.");let o=An(t.rest,t.source,n);_n(n,o);let r={version:1,nodeId:o.rest.id,fill:n.fill.toLowerCase(),textRanges:i,snapshot:o.snapshot};return i.ranges.some(s=>["fontFamily","fontSize","fontWeight","fontStyle"].some(a=>Ne(s,a)))&&(r.fontBase={fontFamily:n.fontFamily??"Inter",fontSize:n.fontSize,fontWeight:n.fontWeight??400,fontStyle:n.fontStyle??"normal"},fe(r.fontBase)),Sn(r,t.pluginId,t.key),r})}function On(e){return bn(()=>{let t=gt(e,["rest","source","canonicalNode","hint","pluginId","key"]),n=typeof t.hint=="string"?t.hint:yt(t.hint);Sn(n,t.pluginId,t.key);let i=gt(typeof n=="string"?JSON.parse(n):n,["version","nodeId","fill","textRanges","snapshot","fontBase"]);(Object.keys(i).length!==(Ne(i,"fontBase")?6:5)||i.version!==1||typeof i.nodeId!="string"||typeof i.fill!="string"||typeof i.snapshot!="string")&&z();let o=ht(t.canonicalNode,Ut,!0),r=An(t.rest,t.source,o);(i.nodeId!==r.rest.id||i.snapshot!==r.snapshot)&&se("NATIVE_TEXT_RANGE_HINT_STALE","The author hint does not match this complete current native text snapshot.");let s={};Ne(i,"fontBase")&&(s=gt(i.fontBase,["fontFamily","fontSize","fontWeight","fontStyle"]),(Object.keys(s).length!==4||!Number.isFinite(s.fontSize)||s.fontSize<1||s.fontSize>240)&&z(),fe(s));let a={...o,...s,fill:i.fill,textRanges:i.textRanges},c=Y(a);return c||se("NATIVE_TEXT_RANGE_HINT_NO_INTENT","An author hint cannot restore an empty or partial range payload."),_n(a,r),{...s,fill:i.fill.toLowerCase(),textRanges:c}})}var vn="codeshellTextRangeIntent",Di=16*1024*1024,Ce=(e,t)=>{let n=new Error(t);throw n.code=e,n};function Pi(e){let t=0;for(let n of e){let i=n.codePointAt(0);t+=i<128?1:i<2048?2:i<65536?3:4}return t}function Ge(e,t,n){let i=ft(e,n,{fields:Q,scalarFields:oe});return i.status!=="captured"?i:dt({rest:t,...i.observations})}async function wn(e,{mixed:t,pluginId:n,assertOwned:i}){(!Array.isArray(e)||e.length>1e4||typeof i!="function")&&Ce("TEXT_RANGES_NATIVE_FINALIZE_INPUT","范围文字的最终校验上下文无效，已阻止创建副本");let o=[],r=0;for(let{target:s,source:a}of e){i(s),(s?.type!=="TEXT"||typeof s.exportAsync!="function"||typeof s.setPluginData!="function")&&Ce("TEXT_RANGES_NATIVE_FINALIZE_UNAVAILABLE","范围文字的最终读取或意图保存能力不可用，已阻止创建副本");let c=await s.exportAsync({format:"JSON_REST_V1"});i(s);let u=c?.document??c?.nodes?.[s.id]?.document;(u?.id!==s.id||u?.type!=="TEXT")&&Ce("TEXT_RANGES_NATIVE_FINALIZE_IDENTITY","范围文字的最终来源身份不匹配，已阻止创建副本");let N=Ge(s,u,t);N.status!=="bound"&&Ce("TEXT_RANGES_NATIVE_FINALIZE_SOURCE","无法完整校验新建范围文字的最终原生状态，已阻止创建副本");let A=In({rest:u,source:N.source,authorNode:a,pluginId:n,key:vn}),S=JSON.stringify(A);(r+=Pi(S))>Di&&Ce("TEXT_RANGES_NATIVE_FINALIZE_BUDGET","范围文字的完整意图快照合计超过 16 MiB，已阻止创建副本"),o.push({target:s,rest:u,text:S,snapshot:de(N.source)})}for(let s of o){i(s.target);let a=Ge(s.target,s.rest,t);(a.status!=="bound"||de(a.source)!==s.snapshot)&&Ce("TEXT_RANGES_NATIVE_FINALIZE_RACE","范围文字在最终读取期间发生变化，已阻止创建副本")}for(let s of o)s.target.setPluginData(vn,s.text);return{texts:o.length,bytes:r}}var Nt="codeshellTextRangeIntent",Li="nativeTextRanges",ki=Object.freeze(["codeshellNativeTextRanges","codeshellNativeTextRangeHint","codeshellTextRangeIntent",Li]),Vi=new Set(["serif","sans-serif","monospace","cursive","fantasy","system-ui","ui-serif","ui-sans-serif","ui-monospace","ui-rounded","emoji","math","fangsong"]),Fi=["textDecoration","textDecorationStyle","textDecorationOffset","textDecorationThickness","textDecorationColor","textDecorationSkipInk","hyperlink"],Rn=(e,t)=>Object.hasOwn(e,t),pe=e=>e!==null&&typeof e=="object"&&!Array.isArray(e)&&[Object.prototype,null].includes(Object.getPrototypeOf(e)),jt=(e,t)=>pe(e)&&Object.keys(e).length===t.length&&t.every(n=>Rn(e,n)),Gt=(e,t)=>JSON.stringify(e)===JSON.stringify(t),K=(e,t)=>{if(e[t]?.kind!=="value")throw Error("Native "+t+" is not a complete supported value");return e[t].value},Mi=e=>{let t=0;for(let n of e){let i=n.codePointAt(0);t+=i<128?1:i<2048?2:i<65536?3:4}return t};function Et(e,t,n={bytes:0,steps:0,seen:new Set},i=0,o={steps:1e5,depth:20,keys:8192}){let r=S=>{if((n.bytes+=Mi(S))>t)throw Error("Owned native data exceeds its complete byte budget")};if(++n.steps>o.steps||i>o.depth)throw Error("Owned native data exceeds its structural budget");if(e===null||typeof e=="boolean"||typeof e=="number"&&Number.isFinite(e)||typeof e=="string")return r(JSON.stringify(e)),e;let s=Array.isArray(e);if(!s&&!pe(e)||n.seen.has(e))throw Error("Native import requires acyclic owned JSON");let a=Object.getOwnPropertyDescriptors(e),c=Reflect.ownKeys(a),u=s?a.length?.value:void 0,N=s?c.filter(S=>S!=="length"):c;if(c.some(S=>typeof S!="string")||N.length>o.keys||s&&(!Number.isInteger(u)||N.length!==u||N.some((S,E)=>S!==String(E))))throw Error("Native import requires dense bounded JSON");n.seen.add(e),r(s?"[":"{");let A=s?[]:{};for(let[S,E]of N.entries()){let p=a[E];if(!Object.hasOwn(p,"value")||!p.enumerable)throw Error("Native import refuses accessors and hidden fields");r((S?",":"")+(s?"":JSON.stringify(E)+":")),Object.defineProperty(A,E,{value:Et(p.value,t,n,i+1,o),enumerable:!0,configurable:!0,writable:!0})}return r(s?"]":"}"),n.seen.delete(e),A}function xe(e){return Et(e,16*1024*1024,void 0,0,{steps:1e6,depth:128,keys:1e6})}function Tt(e,t){if(!pe(e))throw Error("Native import arguments must be an owned record");let n=Object.getOwnPropertyDescriptor(e,t);if(n){if(!Object.hasOwn(n,"value")||!n.enumerable)throw Error("Native import argument accessor refused");return n.value}}function xt(e){return pe(e)&&jt(e.scalars,[...Q,...oe])&&Array.isArray(e.segments)&&Array.isArray(e.rangeChecks)&&e.segments.every(t=>jt(t.values,Q))&&e.rangeChecks.length===e.segments.length&&e.rangeChecks.every((t,n)=>t.start===e.segments[n].start&&t.end===e.segments[n].end&&jt(t.values,Fi))}function Ht(e){return ki.some(t=>Rn(e,t))}function Xi(e,t){return e.type!=="TEXT"||e.isMask===!0||e.children!==void 0&&(!Array.isArray(e.children)||e.children.length)||![void 0,"NORMAL","PASS_THROUGH"].includes(e.blendMode)||!Array.isArray(e.fills)||e.fills.filter(n=>n.visible!==!1).length>1||e.fills.some(n=>n.visible!==!1&&n.type!=="SOLID")||e.strokes!==void 0&&(!Array.isArray(e.strokes)||e.strokes.some(n=>n.visible!==!1))||e.effects!==void 0&&(!Array.isArray(e.effects)||e.effects.some(n=>n.visible!==!1))?!1:t.scalars.fills.kind==="mixed"&&t.scalars.fontName.kind==="value"&&t.scalars.fontSize.kind==="value"}function Cn(e){let t=[],n=i=>({status:"unsupported",diagnostics:[...t,{code:"NATIVE_TEXT_IMPORT_UNSUPPORTED",message:i}],pixelsVerified:!1});try{let i=Tt(e,"rest"),o=Tt(e,"source"),r=o===void 0?null:Et({rest:i,source:o},Ee);if(r&&({rest:i,source:o}=r),!pe(i)||o===void 0||Ht(i))return n("A fresh explicit supplemental source without raw collisions is required");if(i.children!==void 0&&(!Array.isArray(i.children)||i.children.length))return n("A native Text must be a leaf");let s=we(i,o);if(t.push(...s.diagnostics),s.status!=="bound"||!xt(s.source))return n("The native source is stale, invalid or incomplete");let a=s.source,c=a.segments,u=c[0]?.values;if(!u)return n("A nonempty complete metric segment is required");let N=["fontName","fontSize","fontWeight","fontStyle","lineHeight","letterSpacing"];for(let C of N){let v=K(u,C);if(!c.every(I=>Gt(K(I.values,C),v)))return n("Native metric variants cannot become paint/link ranges");if(C!=="fontStyle"&&!Gt(K(a.scalars,C),v))return n("Scalar and complete segment metrics disagree");if(C==="fontStyle"&&a.scalars[C].kind==="value"&&!Gt(K(a.scalars,C),v))return n("Scalar and complete segment fontStyle disagree")}let A=K(u,"fontName"),S=K(u,"fontSize"),E=K(u,"fontWeight"),p=K(u,"fontStyle"),T=K(u,"lineHeight"),x=K(u,"letterSpacing");if(!pe(A)||typeof A.family!="string"||!A.family.length||A.family!==A.family.trim()||A.family.length>120||/[\u0000-\u001f\u007f,"'\\]/u.test(A.family)||Vi.has(A.family.toLowerCase())||!Number.isFinite(S)||S<1||S>240||![100,200,300,400,500,600,700,800,900].includes(E)||!["REGULAR","ITALIC"].includes(p)||!["Regular","Bold","Italic","Bold Italic"].includes(A.style)||(["Italic","Bold Italic"].includes(A.style)?"ITALIC":"REGULAR")!==p||A.variationSettings?.wght!==E&&(["Bold","Bold Italic"].includes(A.style)?700:400)!==E)return n("Native font metrics are outside the canonical uniform subset");let g={text:a.characters,textSource:a.characters,fontFamily:A.family,fontSize:S,fontWeight:E,fontStyle:p==="ITALIC"?"italic":"normal",fill:"#000000",textDecoration:"none"};if(!pe(T)||!Number.isFinite(T.value))return n("Native line height is not explicit");if(T.unit==="PIXELS")Object.assign(g,{lineHeight:T.value,lineHeightUnit:"pixels"});else if(T.unit==="PERCENT")g.lineHeight=T.value/100;else return n("Native automatic or unknown line-height units require a separate model");if(!ge(g)||ne(g).unit!==T.unit||ne(g).value!==T.value)return n("Native line height has no exact in-envelope canonical unit conversion");if(!pe(x)||!Number.isFinite(x.value)||!(x.unit==="PIXELS"||x.unit==="PERCENT"&&x.value===0)||x.value<-20||x.value>100)return n("Native letter spacing is unsupported");g.letterSpacing=x.value;let m={LEFT:"left",CENTER:"center",RIGHT:"right"}[K(a.scalars,"textAlignHorizontal")];if(!m)return n("Native horizontal alignment is unsupported");g.textAlign=m;let l=K(a.scalars,"textAutoResize");if(!["NONE","HEIGHT","WIDTH_AND_HEIGHT"].includes(l))return n("Native text resize mode is unsupported");a.characters.length&&l!=="WIDTH_AND_HEIGHT"&&(g.textFlow="wrap");let f={type:"text",...g},y=Re({rest:i,source:a,canonicalNode:f});if(t.push(...y.diagnostics),!["uniform","admitted-intent"].includes(y.status))return n("The complete native paint/link/decoration context is unsupported");y.textRanges&&(g.textRanges=y.textRanges);let d=!1;try{he({type:"text",...g}),d=!0}catch{}let h,_;try{h=Tt(e,"hint"),_=Tt(e,"pluginId"),h!==void 0&&(h=Et(h,64*1024))}catch{t.push({code:"NATIVE_TEXT_IMPORT_HINT_INVALID",message:"Author hint data was refused; independently admitted native intent retained"}),h=void 0}if(h!==void 0)if(typeof _!="string"||!_)t.push({code:"NATIVE_TEXT_IMPORT_HINT_UNAVAILABLE",message:"Actual pluginId is unavailable; native intent retained"});else try{Object.assign(g,On({rest:i,source:a,canonicalNode:{type:"text",...g},hint:h,pluginId:_,key:Nt}))}catch(C){t.push({code:C.code??"NATIVE_TEXT_IMPORT_HINT_INVALID",message:"Author hint was refused; independently admitted native intent retained"})}return{status:y.status,patch:g,paintLinkOnly:d,ownMixedPreview:d&&Xi(i,a),diagnostics:t,pixelsVerified:!1}}catch(i){return n(i.message)}}var Ui=e=>e&&typeof e=="object"&&!Array.isArray(e),Dn=e=>typeof e=="number"&&Number.isFinite(e),Bt=(e,t)=>{if(!Ui(e)||Object.keys(e).some(n=>!t.includes(n)))throw new Error("CSS 渐变几何包含未知字段")};function Pn(e,t){Bt(e,["direction","positions","sourceOnly"]);let n=e.direction;Bt(n,["angle","corner"]);let i;if(Object.keys(n).length!==1)throw new Error("CSS 渐变方向必须唯一");if(n.angle!==void 0){if(!Dn(n.angle)||n.angle<0||n.angle>=360)throw new Error("CSS 渐变角度必须为 0–360（不含 360）");i={angle:n.angle}}else{if(!Array.isArray(n.corner)||n.corner.length!==2||!Array.from(n.corner).every(r=>r===-1||r===1))throw new Error("CSS 渐变角方向必须为两个 ±1");i={corner:[...n.corner]}}if(e.sourceOnly!==void 0&&e.sourceOnly!==!0)throw new Error("CSS 渐变 sourceOnly 只能为 true");if(!Array.isArray(e.positions)||e.positions.length<2||e.positions.length>16||!e.sourceOnly&&e.positions.length!==t.length)throw new Error("CSS 渐变位置必须为 2–16 项且与可编辑色标对应");let o=Array.from(e.positions,(r,s)=>{if(r===null)return null;if(r==="previous"){if(!s||e.positions[s-1]==="previous"||!e.sourceOnly&&(t[s].opacity!==0||t[s-1].opacity!==0))throw new Error("CSS 透明色标重复位置无效");return"previous"}if(Bt(r,["unit","value"]),!["px","percent"].includes(r.unit)||!Dn(r.value)||Math.abs(r.value)>2e4)throw new Error("CSS 色标只支持有界 px/percent 坐标");return{unit:r.unit,value:r.value}});if(o.filter(r=>r!=="previous").length<2)throw new Error("CSS 渐变至少需要两个原始色标");return{direction:i,positions:o,...e.sourceOnly?{sourceOnly:!0}:{}}}function Ln(e,t){if(!e.sourceOnly)for(let n=1;n<t.length;n++){let i=t[n-1],o=t[n],r=e.positions[n-1],s=e.positions[n];if(!(s==="previous"||r&&s&&typeof r=="object"&&typeof s=="object"&&r.unit===s.unit&&r.value>=s.value)&&i.opacity!==o.opacity&&i.color!==o.color)throw new Error("不同颜色且透明度变化的 CSS 预乘插值无法由当前原生渐变无损表示")}}var ji=e=>e!==null&&typeof e=="object"&&!Array.isArray(e),kn=e=>typeof e=="string"&&/^#[a-f\d]{6}$/iu.test(e),De=e=>typeof e=="number"&&Number.isFinite(e),mt=e=>Math.max(0,Math.min(1,e));var Vn=e=>`#${[e.r,e.g,e.b].map(t=>Math.round(mt(t)*255).toString(16).padStart(2,"0")).join("")}`;function zt(e,t){if(!ji(e)||Object.keys(e).some(n=>!t.includes(n)))throw new Error("绘制包含未知字段")}function $t(e){if(!De(e)||e<0||e>1)throw new Error("绘制透明度必须在 0–1 之间");return e}function Gi(e){let[t,n,i]=e;return[[n.x-t.x,2*(i.x-t.x),2*t.x-i.x],[n.y-t.y,2*(i.y-t.y),2*t.y-i.y]]}function Fn(e){let[[t,n,i],[o,r,s]]=Gi(e),a=t*r-n*o;if(Math.abs(a)<1e-8)throw new Error("线性渐变坐标不可逆");return[[r/a,-n/a,(n*s-r*i)/a],[-o/a,t/a,(o*i-t*s)/a]]}function Hi(e){if(!Array.isArray(e)||!e.length||e.length>8)throw new Error("填充绘制必须为 1–8 层");return e.map(t=>{zt(t,t?.type==="SOLID"?["type","color","opacity"]:["type","opacity","handles","stops","cssLinear"]);let n=$t(t.opacity);if(t.type==="SOLID"){if(!kn(t.color))throw new Error("纯色绘制必须是六位十六进制颜色");return{type:"SOLID",color:t.color.toLowerCase(),opacity:n}}if(t.type!=="GRADIENT_LINEAR"||!Array.isArray(t.handles)||t.handles.length!==3||!Array.isArray(t.stops)||t.stops.length<2||t.stops.length>16)throw new Error("仅支持有界纯色/线性渐变；渐变必须有三个控制点与 2–16 个色标");let i=t.handles.map(s=>{if(zt(s,["x","y"]),![s.x,s.y].every(a=>De(a)&&Math.abs(a)<=100))throw new Error("渐变控制点超出范围");return{x:s.x,y:s.y}});Fn(i);let o=t.stops.map(s=>{if(zt(s,["position","color","opacity"]),!kn(s.color))throw new Error("渐变色标颜色无效");return{position:$t(s.position),color:s.color.toLowerCase(),opacity:$t(s.opacity)}});if(o.some((s,a)=>a&&s.position<o[a-1].position))throw new Error("渐变色标必须按位置排序");let r=t.cssLinear===void 0?void 0:Pn(t.cssLinear,o);return r&&Ln(r,o),{type:"GRADIENT_LINEAR",opacity:n,handles:i,stops:o,...r?{cssLinear:r}:{}}})}function Bi(e){if(!Array.isArray(e)||e.length!==2||!e.every(u=>Array.isArray(u)&&u.length===3&&u.every(De)))throw new Error("渐变矩阵无效");let[[t,n,i],[o,r,s]]=e,a=t*r-n*o;if(Math.abs(a)<1e-8)throw new Error("渐变矩阵不可逆");let c=(u,N)=>({x:(r*(u-i)-n*(N-s))/a,y:(-o*(u-i)+t*(N-s))/a});return[c(0,.5),c(1,.5),c(0,1)]}function Mn(e,t=()=>{}){if(!Array.isArray(e))return null;let n=e.filter(i=>i?.visible!==!1);if(!n.length||n.length>8||n.some(i=>!["SOLID","GRADIENT_LINEAR"].includes(i?.type)))return null;try{let i=n.map(o=>{if(o.blendMode&&o.blendMode!=="NORMAL")throw new Error("非 NORMAL 混合绘制需本地预览资源");let r=De(o.opacity)?mt(o.opacity):1;if(o.type==="SOLID")return{type:"SOLID",color:Vn(o.color),opacity:r*(De(o.color?.a)?mt(o.color.a):1)};let s=o.gradientStops?.map(c=>({position:c.position,color:Vn(c.color),opacity:De(c.color?.a)?mt(c.color.a):1})),a=o.gradientHandlePositions??Bi(o.gradientTransform);try{Fn(a)}catch{if(!s?.length)throw new Error("缺少渐变色标");t("退化线性渐变没有可逆控制点；按零长度渐变的末色标保留，不猜测方向。");let c=s.at(-1);return{type:"SOLID",color:c.color,opacity:r*c.opacity}}return{type:"GRADIENT_LINEAR",opacity:r,handles:a,stops:s}});return Hi(i)}catch(i){return t(`绘制无法无损转换：${i.message}`),null}}var Wt=16*1024*1024,St=e=>e!==null&&typeof e=="object"&&!Array.isArray(e)&&[Object.prototype,null].includes(Object.getPrototypeOf(e)),k=(e,t)=>{let n=Error(t);throw n.code=e,n},me=e=>{let t=0;for(let n of e){let i=n.codePointAt(0);t+=i<128?1:i<2048?2:i<65536?3:4}return t};function He(e,t=new Set,n=0){if(e===null||typeof e=="boolean"||typeof e=="string"||typeof e=="number"&&Number.isFinite(e))return JSON.stringify(e);(n>40||typeof e!="object"||t.has(e)||!Array.isArray(e)&&!St(e))&&k("NATIVE_TEXT_EXPORT_DATA","Source export requires complete owned JSON");let i=Object.getOwnPropertyDescriptors(e),o=Array.isArray(e),r=Reflect.ownKeys(i).filter(a=>!o||a!=="length");(r.some(a=>typeof a!="string"||!Object.hasOwn(i[a],"value")||!i[a].enumerable)||o&&(r.length!==e.length||r.some((a,c)=>a!==String(c))))&&k("NATIVE_TEXT_EXPORT_DATA","Source export cannot interpret hidden/accessor/sparse data"),t.add(e);let s=o?"["+r.map(a=>He(i[a].value,t,n+1)).join(",")+"]":"{"+r.sort().map(a=>JSON.stringify(a)+":"+He(i[a].value,t,n+1)).join(",")+"}";return t.delete(e),me(s)>Wt&&k("NATIVE_TEXT_EXPORT_BUDGET","Complete export exceeds16MiB"),s}function zi(e,t){let n=i=>i===t?{mixed:!0}:i??null;return He({type:e.type,isMask:e.isMask===!0,blendMode:e.blendMode??null,fills:n(e.fills),strokes:n(e.strokes),effects:n(e.effects),mixedFontName:e.fontName===t,mixedFontSize:e.fontSize===t,childMasks:Array.isArray(e.children)?e.children.map(i=>[i.id,i.isMask===!0]):[]})}var Xn=e=>Array.isArray(e)&&e.every(t=>St(t)&&t.visible===!1),$i=new Set(["FRAME","GROUP","COMPONENT","COMPONENT_SET","INSTANCE","SECTION"]);function Un(e,t,n){if(Cn({rest:e,source:t}).ownMixedPreview)for(let[i,o]of n.entries()){let r=JSON.parse(o.context);if(r.childMasks.some(([,N])=>N)&&k("NATIVE_TEXT_EXPORT_PREVIEW_CONTEXT","Actual native ancestor has a known mask child; editable range preview bypass was refused"),i&&["PAGE","DOCUMENT"].includes(r.type))continue;let s=!r.isMask&&["NORMAL","PASS_THROUGH"].includes(r.blendMode)&&Xn(r.strokes)&&Xn(r.effects)&&r.childMasks.every(([,N])=>!N),a=i===0&&r.type==="TEXT"&&St(r.fills)&&r.fills.mixed===!0&&Object.keys(r.fills).length===1&&!r.mixedFontName&&!r.mixedFontSize,c=Array.isArray(r.fills)?r.fills.filter(N=>N.visible!==!1):null,u=i>0&&$i.has(r.type)&&c&&(c.length===0||!!Mn(c));(!s||!(a||u))&&k("NATIVE_TEXT_EXPORT_PREVIEW_CONTEXT","Actual native Text or ancestor has an independent preview cause; editable range preview bypass was refused")}}function jn({roots:e,mixed:t,pluginId:n}={}){(!Array.isArray(e)||e.length>1e4||new Set(e).size!==e.length||typeof t!="symbol")&&k("NATIVE_TEXT_EXPORT_CONTEXT","Export capture requires exact current native roots and mixed identity");let i=new Map,o=[],r=new Set(e),s=new Map,a=new Map,c=0,u=0,N=0,A=(g,m)=>{if(!g)return{values:[],indices:new Map};if(!m.has(g)){let l=Array.isArray(g.children)?[...g.children]:[],f=new Map;for(let[y,d]of l.entries())f.has(d)&&k("NATIVE_TEXT_EXPORT_TOPOLOGY","Native children contain aliased objects"),f.set(d,y);m.set(g,{values:l,indices:f})}return m.get(g)},S=(g,m,l)=>{if(!m.has(g)){let f=g.parent,d=A(f,l).indices.get(g)??-1;f&&d<0&&k("NATIVE_TEXT_EXPORT_TOPOLOGY","Native source left its original parent");let h=zi(g,t);(N+=me(h))>Wt&&k("NATIVE_TEXT_EXPORT_BUDGET","Complete native preview contexts exceed16MiB"),m.set(g,{current:g,parent:f,id:g.id,index:d,children:A(g,l).values,context:h})}return m.get(g)},E=(g,m=s,l=a)=>{let f=[],y=new Set,d=!1;for(let h=g;h;h=h.parent)(y.has(h)||f.length>35||h.removed===!0)&&k("NATIVE_TEXT_EXPORT_TOPOLOGY","Native source identity or ancestry is unavailable"),y.add(h),r.has(h)&&(d=!0),f.push(S(h,m,l));return d||k("NATIVE_TEXT_EXPORT_TOPOLOGY","Native Text is outside the exported roots"),f},p=(g,m)=>g.length===m.length&&g.every((l,f)=>{let y=m[f];return l.current===y.current&&l.parent===y.parent&&l.id===y.id&&l.index===y.index&&l.context===y.context&&l.children.length===y.children.length&&l.children.every((d,h)=>d===y.children[h])}),T=(g,m,l=0)=>{if((!St(g)||!m||m.id!==g.id||l>34||++u>5e4)&&k("NATIVE_TEXT_EXPORT_IDENTITY","Official REST and exact native source ownership disagree"),g.type!==(m.type==="PAGE"?"CANVAS":m.type)&&k("NATIVE_TEXT_EXPORT_IDENTITY","Official REST and native source types disagree"),Ht(g)&&k("NATIVE_TEXT_EXPORT_COLLISION","Official REST contains a reserved supplemental lookalike; raw data was not overwritten"),g.children!==void 0&&!Array.isArray(g.children)&&k("NATIVE_TEXT_EXPORT_DATA","Official REST children must remain an array"),m.type==="TEXT"){(g.type!=="TEXT"||g.children?.length)&&k("NATIVE_TEXT_EXPORT_IDENTITY","Text source must remain a native leaf");let d=He(g),h=i.get(g.id);if(h){(h.target!==m||h.fingerprint!==d||!p(h.lineage,E(m)))&&k("NATIVE_TEXT_EXPORT_OVERLAP","Repeated Text source ownership or complete raw data disagree");return}let _=Ge(m,g,t),C=_.status==="bound"&&xt(_.source);C?(me(JSON.stringify({rest:g,source:_.source}))>Ee&&k("NATIVE_TEXT_EXPORT_NODE_BUDGET","The complete Text proof exceeds256KiB"),c+=me(JSON.stringify(_.source)),c>Wt&&k("NATIVE_TEXT_EXPORT_BUDGET","Complete native sources exceed16MiB")):o.push(g.id+": complete native range source unavailable; existing fallback retained");let v=E(m);C&&Un(g,_.source,v),i.set(g.id,{rest:g,target:m,fingerprint:d,lineage:v,bound:C,source:C?_.source:void 0,snapshot:C?de(_.source):null});return}let f=Array.isArray(m.children)?m.children:[],y=new Map;for(let d of f)y.has(d.id)&&k("NATIVE_TEXT_EXPORT_OVERLAP","Native children contain repeated identity"),y.set(d.id,d);((g.children??[]).length!==f.length||(g.children??[]).some((d,h)=>d?.id!==f[h]?.id))&&k("NATIVE_TEXT_EXPORT_IDENTITY","Official and native child topology disagree");for(let d of g.children??[]){let h=y.get(d?.id);h||k("NATIVE_TEXT_EXPORT_IDENTITY","Official descendant has no exact native owner"),T(d,h,l+1)}};return{add:T,finalize:()=>{let g=new Map,m=typeof n=="string"&&/^[a-z0-9_.-]+$/iu.test(n)?n:void 0;for(let d of i.values())if(d.bound&&m&&typeof d.target.getPluginData=="function"){let h;try{h=d.target.getPluginData(Nt)}catch{o.push(d.target.id+": optional author hint unavailable; independent native source retained");continue}typeof h!="string"&&k("NATIVE_TEXT_EXPORT_HINT","Native plugin data did not return a string"),h&&(me(h)+me(m)+me(Nt)>1e5&&k("NATIVE_TEXT_EXPORT_HINT_BUDGET","The complete native plugin-data entry exceeds100000bytes"),g.set(d.target.id,h))}let l={},f=new Map,y=new Map;N=0;for(let d of i.values()){(!p(d.lineage,E(d.target,f,y))||He(d.rest)!==d.fingerprint)&&k("NATIVE_TEXT_EXPORT_RACE","Native source identity/topology/preview cause changed during awaited export");let h=Ge(d.target,d.rest,t),_=h.status==="bound"&&xt(h.source);(_!==d.bound||_&&de(h.source)!==d.snapshot)&&k("NATIVE_TEXT_EXPORT_RACE","Complete observed native Text changed during awaited export"),_&&Un(d.rest,h.source,E(d.target,f,y)),_&&Object.defineProperty(l,d.target.id,{enumerable:!0,configurable:!0,writable:!0,value:{source:h.source,...g.has(d.target.id)?{hint:g.get(d.target.id)}:{}}})}return{supplement:Object.keys(l).length?{version:1,...m?{pluginId:m}:{},nodes:l}:void 0,warnings:o,observedTextNodes:i.size}}}}var Be="codeshellNotes",Wi=16*1024,At=(e,t)=>Object.hasOwn(e,t),ze=e=>e!==null&&typeof e=="object"&&!Array.isArray(e)&&[Object.prototype,null].includes(Object.getPrototypeOf(e)),Pe=(e,t)=>ze(e)&&Object.keys(e).length===t.length&&t.every(n=>At(e,n)),Le=e=>{let t=0;for(let n of e){let i=n.codePointAt(0);t+=i<128?1:i<2048?2:i<65536?3:4}return t},ae=(e,t)=>{throw Object.assign(Error(t),{code:e})},$e=e=>typeof e=="string"&&e.length>0&&e.length<=160&&!/[\u0000-\u001f\u007f]/u.test(e);function _t(e,t){return(typeof t!="string"||!/^[a-z0-9_.-]{1,256}$/iu.test(t)||typeof e!="string"||e.length>2e3||Le(t)+Le(Be)+Le(e)>1e5)&&ae("NATIVE_NOTES_VALUE","Native notes exceed the exact string or plugin-data entry budget"),e===""?{kind:"absent"}:{kind:"value",value:e}}function bt(e){if(e===void 0)return;let t=xe(e);(!Pe(t,["version","pluginId","nodes"])||t.version!==1||typeof t.pluginId!="string"||!/^[a-z0-9_.-]{1,256}$/iu.test(t.pluginId)||!ze(t.nodes)||Object.keys(t.nodes).length>5e4)&&ae("NATIVE_NOTES_TABLE","Native notes require a bounded versioned metadata table");for(let[n,i]of Object.entries(t.nodes))(!$e(n)||!Pe(i,["type","notes"])||typeof i.type!="string"||!/^[A-Z][A-Z0-9_]{0,79}$/u.test(i.type)||!(Pe(i.notes,["kind"])&&i.notes.kind==="absent"||Pe(i.notes,["kind","value"])&&i.notes.kind==="value"&&typeof i.notes.value=="string"&&i.notes.value.length>0))&&ae("NATIVE_NOTES_ENTRY","Native notes entry has invalid fields or absence semantics"),_t(i.notes.kind==="value"?i.notes.value:"",t.pluginId),Le(JSON.stringify({id:n,...i}))>Wi&&ae("NATIVE_NOTES_ENTRY_BUDGET","Complete native notes entry exceeds16KiB");return t}function Yt(e,t,n){let i=(a,c)=>{if(!ze(a))return;let u=Object.getOwnPropertyDescriptor(a,c);if(u)return(!At(u,"value")||!u.enumerable)&&ae("NATIVE_NOTES_RAW_CONFLICT","Own-plugin raw notes must remain owned data"),u.value},o=i(i(e,"pluginData"),n);if(!ze(o)||!At(o,Be))return;let r=i(o,Be),s=t.kind==="value"?t.value:"";(typeof r!="string"||r!==s)&&ae("NATIVE_NOTES_RAW_CONFLICT","Explicit own-plugin raw notes contradict the independent current observation")}var Jt=e=>e.op==="delete"||e.op==="delete-page"||e.op==="update"&&e.changed?.includes("notes");function Gn(e){if(e===void 0)return;let t=xe(e),n={};(!Pe(t,["version","pluginId","nodes"])||!ze(t.nodes))&&ae("NATIVE_NOTES_PATCH_BASELINE","Notes patch requires an explicit complete metadata/catalog baseline");let i=0;for(let[o,r]of Object.entries(t.nodes))(!Pe(r,["type","notes","children"])||!Array.isArray(r.children)||new Set(r.children).size!==r.children.length||r.children.some(s=>!$e(s))||(i+=r.children.length)>5e4)&&ae("NATIVE_NOTES_PATCH_BASELINE","Notes patch child catalog is invalid or exceeds its budget"),Object.defineProperty(n,o,{enumerable:!0,configurable:!0,writable:!0,value:{type:r.type,notes:r.notes}});bt({version:t.version,pluginId:t.pluginId,nodes:n});for(let o of Object.values(t.nodes))o.children.some(r=>!At(t.nodes,r))&&ae("NATIVE_NOTES_PATCH_BASELINE","Notes patch omits a catalog descendant");return t}var Ae=(e,t)=>{throw Object.assign(Error(t),{code:e})},Hn=Number.isFinite,ce=(e,t)=>Object.hasOwn(e,t),Ke=e=>e!==null&&typeof e=="object"&&!Array.isArray(e)&&[Object.prototype,null].includes(Object.getPrototypeOf(e)),Ye=new Set(["text","textSource","fontFamily","fontWeight","fontStyle","fontSize","lineHeight","lineHeightUnit","textAlign","letterSpacing","textDecoration"]),Yi=new Set(["notes","name","visible","locked","opacity","fill",...Ye]),Bn=new WeakMap,P=e=>e===null||typeof e!="object"?JSON.stringify(e):Array.isArray(e)?`[${e.map(P).join(",")}]`:`{${Object.keys(e).sort().map(t=>`${JSON.stringify(t)}:${P(e[t])}`).join(",")}}`,Je=e=>{let t=0;for(let n of e){let i=n.codePointAt(0);t+=i<128?1:i<2048?2:i<65536?3:4}return t},$=e=>{let t=xe(e);return Je(JSON.stringify(t))>256*1024&&Ae("NATIVE_UPDATE_BUDGET","Complete native update observation exceeds256KiB"),t},We=()=>Ae("NATIVE_UPDATE_CONFLICT","Native update fields or identity no longer match the prepared snapshot"),w=()=>Ae("NATIVE_UPDATE_UNSUPPORTED","This existing update requires complete plain native SDK fields and matching own REST evidence"),Se=e=>{(!Array.isArray(e)||e.length!==1)&&w();let t=e[0];return(!Ke(t)||Object.keys(t).some(n=>!["type","color","opacity","visible","blendMode","boundVariables"].includes(n))||t.type!=="SOLID"||(t.opacity??1)!==1||(t.visible??!0)!==!0||(t.blendMode??"NORMAL")!=="NORMAL"||t.boundVariables!==void 0&&P(t.boundVariables)!=="{}"||!Ke(t.color)||Object.keys(t.color).some(n=>!["r","g","b","a"].includes(n))||![t.color.r,t.color.g,t.color.b].every(n=>Hn(n)&&n>=0&&n<=1)||(t.color.a??1)!==1)&&w(),{r:t.color.r,g:t.color.g,b:t.color.b}},Ji=e=>e.type==="PAGE"?"CANVAS":e.type,Ki=e=>{let{scalars:t,segments:n,rangeChecks:i}=e;(!n.length||n.length!==i.length)&&w();let o=new Set(["fontStyle","listOptions","indentation","textStyleOverrides"]),r=["textDecoration","textDecorationStyle","textDecorationOffset","textDecorationThickness","textDecorationColor","textDecorationSkipInk","hyperlink"],s=n[0].values;for(let a of Q){s[a]?.kind!=="value"&&w();let c=t[a];!(o.has(a)&&c?.kind==="missing")&&(c?.kind!=="value"||P(c)!==P(s[a]))&&w()}for(let a of oe)t[a]?.kind!=="value"&&w();(s.textDecoration.value!=="NONE"||s.hyperlink.value!==null||s.textStyleId.value!==""||s.fillStyleId.value!==""||P(s.textStyleOverrides.value)!=="[]"||!["NONE","HEIGHT","WIDTH_AND_HEIGHT"].includes(t.textAutoResize.value)||["layoutSizingHorizontal","layoutSizingVertical"].some(a=>!["FIXED","FILL","HUG"].includes(t[a].value)))&&w();for(let a=0;a<n.length;a++){let c=n[a],u=i[a];(P(c.values)!==P(s)||u.start!==c.start||u.end!==c.end)&&w();for(let N of r)(u.values[N]?.kind!=="value"||P(u.values[N])!==P(c.values[N]))&&w()}},zn=(e,t)=>Bn.get(e)===t;function $n({patch:e,mixed:t}){if(!e.operations.length||!e.operations.every(l=>l.op==="update"&&Array.isArray(l.changed)&&l.changed.length&&l.changed.every(f=>Yi.has(f)))||e.operations.every(l=>l.changed.every(f=>f==="notes"))||e.operations.some(l=>l.changed.some(f=>Ye.has(f)||f==="fill")&&[l.after,l.baseline].some(f=>f.fillPaints!==void 0||f.shadowStack!==void 0))||e.operations.some(l=>l.changed.some(f=>Ye.has(f))&&![400,700].includes(l.after.fontWeight)))return null;let n=new Map;for(let l of e.operations)n.has(l.sourceId)&&w(),n.set(l.sourceId,l),l.changed.some(f=>Ye.has(f))&&(l.after.type!=="text"||l.after.textDecoration&&l.after.textDecoration!=="none")&&w(),l.changed.includes("fill")&&(!/^#[0-9a-f]{6}$/iu.test(l.after.fill)||l.after.fillPaints!==void 0)&&w();let i=new Map,o=new Map,r=0,s=0,a=0,c=0,u=l=>typeof l=="string"&&l.length>0&&l.length<=160&&!/[\u0000-\u001f\u007f]/u.test(l),N=l=>{let f=new Set;for(let y=l,d=0;y;y=y.parent,d++)if((d>35||f.has(y)||y.removed===!0)&&w(),f.add(y),!o.has(y)){(!u(y.id)||typeof y.type!="string"||!/^[A-Z][A-Z0-9_]{0,79}$/u.test(y.type)||y.children!==void 0&&!Array.isArray(y.children)||o.size>=50036)&&w();let h=[...y.children??[]];(h.length>5e4||(r+=h.length)>1e5||new Set(h).size!==h.length||new Set(h.map(_=>_.id)).size!==h.length||h.some(_=>!u(_?.id))||y.parent&&!(y.parent.children??[]).includes(y))&&w(),o.set(y,{id:y.id,type:y.type,parent:y.parent,children:h})}},A=(l,f)=>{let y={};for(let d of f.changed)if(["name","visible","locked","opacity"].includes(d)){let h=l[d];(d==="name"?typeof h!="string":d==="opacity"?!Hn(h)||h<0||h>1:typeof h!="boolean")&&w(),y[d]=h}if(f.changed.some(d=>["fill","opacity"].includes(d))&&(y.boundVariables=$(l.boundVariables),P(y.boundVariables)!=="{}"&&w()),f.changed.includes("fill")){y.fills=$(l.fills),y.fillStyleId=l.fillStyleId,Se(y.fills),y.fillStyleId!==""&&w(),typeof l.getPluginData!="function"&&w();for(let d of["codeshellCssLinearSource","codeshellCssShadowStack"]){let h=l.getPluginData(d);h!==""&&w(),y[d]=h}}if(l.type==="TEXT"&&f.changed.some(d=>Ye.has(d)||d==="fill")){let d=ft(l,t,{fields:Q,scalarFields:oe});if(d.status!=="captured"&&w(),Ki(d.observations),["fontName","fontSize","fontWeight","lineHeight","letterSpacing","fills","textDecoration"].some(h=>d.observations.scalars[h]?.kind!=="value")&&w(),y.text=d.observations,f.changed.includes("textSource")){typeof l.getPluginData!="function"&&w();let h=l.getPluginData("codeshellDesignMetadata");(typeof h!="string"||Je(h)>16*1024)&&w();let _;try{_=h?JSON.parse(h):{}}catch{w()}Ke(_)||w(),y.metadataText=h,y.metadata=$(_)}}return $(y)},S=(l,f)=>{let y=n.get(l);if(!y)return;(i.has(l)||f?.id!==l||f.removed===!0||i.size>=5e4)&&w(),N(f);let d=A(f,y),h=P(d);(s+=Je(h))>16*1024*1024&&Ae("NATIVE_UPDATE_BUDGET","Complete native update observations exceed16MiB"),i.set(l,{target:f,operation:y,fields:d,snapshot:h,corroborated:!1})},E=(l,f)=>{let y=i.get(l);if(!y)return;let{target:d,operation:h,fields:_}=y,C=Object.getOwnPropertyDescriptors(f),v={},I=new Set(["id","type",...Object.keys(_).filter(D=>["name","visible","locked","opacity","boundVariables"].includes(D))]);if(ce(_,"fills"))for(let D of["fills","fillStyleId","styles","codeshellCssLinearSource","codeshellCssShadowStack"])I.add(D);if(_.text)for(let D of["characters","style","fills","styles","textStyleId","fillStyleId","characterStyleOverrides","styleOverrideTable","lineTypes","lineIndentations","textTruncation","maxLines","textAutoResize","layoutSizingHorizontal","layoutSizingVertical","hasMissingFont","leadingTrim","hangingPunctuation","hangingList"])I.add(D);for(let D of I)if(ce(C,D)){let F=C[D];(!ce(F,"value")||!F.enumerable)&&w(),Object.defineProperty(v,D,{value:F.value,enumerable:!0})}f=$(v),(f.id!==d.id||f.type!==Ji(d))&&We();for(let D of["name","visible","locked","opacity"])ce(_,D)&&(f[D]??{visible:!0,locked:!1,opacity:1}[D])!==_[D]&&We();if(ce(_,"boundVariables")&&f.boundVariables!==void 0&&P($(f.boundVariables))!=="{}"&&w(),ce(_,"fills")&&(P(Se($(f.fills)))!==P(Se(_.fills))&&We(),(f.fillStyleId!==void 0&&f.fillStyleId!==""||f.styles?.fill!==void 0&&f.styles.fill!=="")&&w(),(f.codeshellCssLinearSource!==void 0||f.codeshellCssShadowStack!==void 0)&&w()),_.text){(f.textStyleId!==void 0&&f.textStyleId!==""||f.fillStyleId!==void 0&&f.fillStyleId!==""||[f.styles?.text,f.styles?.fill].some(U=>U!==void 0&&U!==""))&&w();let D=new Set(["fontFamily","fontPostScriptName","fontStyle","fontWeight","fontSize","italic","textCase","textDecoration","textAutoResize","textTruncation","maxLines","textAlignHorizontal","textAlignVertical","letterSpacing","lineHeightPx","lineHeightPercent","lineHeightPercentFontSize","lineHeightUnit","fills","hyperlink"]);(!Ke(f.style)||Object.keys(f.style).some(U=>!D.has(U)))&&w(),(f.characterStyleOverrides!==void 0&&(!Array.isArray(f.characterStyleOverrides)||f.characterStyleOverrides.some(U=>U!==0))||f.styleOverrideTable!==void 0&&(!Ke(f.styleOverrideTable)||Object.keys(f.styleOverrideTable).length))&&w();let F=dt({rest:f,..._.text});(F.status!=="bound"||Re({rest:f,source:F.source,canonicalNode:h.baseline}).status!=="uniform")&&w()}y.corroborated=!0},p=()=>{for(let[l,f]of o){let y=l.children??[];(c+=y.length+1)>2e5&&Ae("NATIVE_UPDATE_WORK_BUDGET","Native update context rechecks exceed200000 references"),(l.removed===!0||l.id!==f.id||l.type!==f.type||l.parent!==f.parent||y.length!==f.children.length||y.some((d,h)=>d!==f.children[h]))&&We()}},T=l=>{let f=A(l.target,l.operation);return(a+=Je(P(f)))>64*1024*1024&&Ae("NATIVE_UPDATE_WORK_BUDGET","Native update rechecks exceed64MiB of observations"),f},x=(l=!0)=>{l&&([...n.keys()].some(f=>!i.has(f))||[...i.values()].some(f=>!f.corroborated))&&w(),p();for(let f of i.values())P(T(f))!==f.snapshot&&We()},m={captureTarget:S,corroborateOwnRest:E,assertCurrent:x,compile:({fontFor:l})=>{x();let f=[],y=[];for(let d of i.values()){let{target:h,operation:_,fields:C}=d,{after:v,baseline:I,changed:D}=_,F=new Map,U=(O,G)=>{let M=$(G);F.set(O,M),f.push(()=>{h[O]=M})};for(let O of D)if(["name","visible","locked"].includes(O))U(O,v[O]);else if(O==="opacity")U(O,I.opacity>0?Math.min(1,Math.max(0,C.opacity*v.opacity/I.opacity)):v.opacity);else if(O==="fill")U("fills",[{type:"SOLID",color:Object.fromEntries(["r","g","b"].map((G,M)=>[G,parseInt(v.fill.slice(1+M*2,3+M*2),16)/255]))}]);else if(O==="notes"){let G=h.setPluginData,M=v.notes??"";typeof G!="function"&&w(),f.push(()=>G.call(h,"codeshellNotes",M))}if(D.some(O=>O==="text"||O==="textSource")&&U("characters",Me(v,I)),D.some(O=>["fontFamily","fontWeight","fontStyle"].includes(O))){let O=$(l(v));["Regular","Bold","Italic","Bold Italic"].includes(O.style)||w(),U("fontName",O)}if(D.includes("fontSize")&&U("fontSize",v.fontSize),D.some(O=>O==="lineHeight"||O==="lineHeightUnit")&&U("lineHeight",ne(v)),D.includes("textAlign")&&U("textAlignHorizontal",v.textAlign.toUpperCase()),D.includes("letterSpacing")&&U("letterSpacing",{unit:"PIXELS",value:v.letterSpacing??0}),D.includes("textDecoration")&&U("textDecoration","NONE"),D.includes("textSource")){let O=h.setPluginData;typeof O!="function"&&w();let G=$({...C.metadata,textSource:v.textSource??null}),M=JSON.stringify(G);Je(M)>16*1024&&w(),f.push(()=>O.call(h,"codeshellDesignMetadata",M)),F.set("metadataText",M),F.set("metadata",G)}y.push(()=>{let O=T(d),G=$(C),M=(ee="fields")=>Ae("NATIVE_UPDATE_READBACK",`Native update ${ee} readback differs from the exact prepared intent; undo was requested`);for(let[ee,le]of F)ce(G,ee)&&ee!=="fills"&&(G[ee]=le);if(F.has("fills")&&(P(Se(O.fills))!==P(Se(F.get("fills")))&&M(),G.fills=O.fills),G.text){let ee=G.text,le=O.text;(!le||le.characters!==(F.get("characters")??ee.characters))&&M();let ke=$(ee.scalars),Ot=$(ee.segments[0]?.values??{}),vt=$(ee.rangeChecks[0]?.values??{}),wt=(V,W)=>{ke[V]?.kind==="value"&&(ke[V]={kind:"value",value:W}),ce(Ot,V)&&(Ot[V]={kind:"value",value:W}),ce(vt,V)&&(vt[V]={kind:"value",value:W})};for(let V of["fontName","fontSize","lineHeight","letterSpacing","textDecoration","fills","textAlignHorizontal"])F.has(V)&&wt(V,F.get(V));F.has("fontName")&&(wt("fontWeight",v.fontWeight),wt("fontStyle",v.fontStyle==="italic"?"ITALIC":"REGULAR"));let Kt=(V,W,te)=>{if(V==="fills"&&W?.kind==="value"&&te?.kind==="value")return P(Se(W.value))===P(Se(te.value));if(V==="lineHeight"&&W?.kind==="value"&&te?.kind==="value"){let Qe=W.value,Ve=te.value;return P(Object.keys(Qe).sort())==='["unit","value"]'&&P(Object.keys(Ve).sort())==='["unit","value"]'&&Qe.unit===Ve.unit&&(Qe.value===Ve.value||Ve.unit==="PERCENT"&&Qe.value===Math.fround(Ve.value/100)*100)}return P(W)===P(te)},Rt=(V,W)=>P(Object.keys(V).sort())===P(Object.keys(W).sort())&&Object.keys(W).every(te=>Kt(te,V[te],W[te]));Rt(le.scalars,ke)||M("scalar "+Object.keys(ke).find(V=>!Kt(V,le.scalars[V],ke[V]))),le.segments.some(V=>!Rt(V.values,Ot))&&M("segment"),le.rangeChecks.some(V=>!Rt(V.values,vt))&&M("range getter"),G.text=O.text}P(O)!==P(G)&&M()})}return{mutations:f,assertApplied:()=>{p();for(let d of y)d()}}}};return Bn.set(m,e),m}var R=(e,t)=>{throw Object.assign(Error(t),{code:e})},Wn=e=>e.type==="PAGE"?"CANVAS":e.type,It=e=>{let t=n=>Array.isArray(n)?n.map(t):n!==null&&typeof n=="object"?Object.fromEntries(Object.keys(n).sort().map(i=>[i,t(n[i])])):n;return JSON.stringify(t(xe(e)))};function Yn(){let e=new Map,t=0,n=r=>{if(!e.has(r)){(!r||r.removed===!0)&&R("NATIVE_NOTES_IDENTITY","Notes source was removed");let s=Array.isArray(r.children)?r.children:[];(!$e(r.id)||typeof r.type!="string"||!/^[A-Z][A-Z0-9_]{0,79}$/u.test(r.type)||s.length>5e4||(t+=s.length)>1e5)&&R("NATIVE_NOTES_CONTEXT_BUDGET","Native notes identity context exceeds its bounded catalog");let a=[...s];(new Set(a).size!==a.length||new Set(a.map(c=>c.id)).size!==a.length)&&R("NATIVE_NOTES_IDENTITY","Notes source children have duplicate identities"),a.some(c=>!$e(c?.id))&&R("NATIVE_NOTES_IDENTITY","Notes source child has an invalid native ID"),e.set(r,{target:r,id:r.id,type:r.type,parent:r.parent,children:a,indices:new Map(a.map((c,u)=>[c,u]))})}return e.get(r)};return{lineage:r=>{let s=[],a=new Set;for(let c=r;c;c=c.parent){(a.has(c)||s.length>35)&&R("NATIVE_NOTES_IDENTITY","Notes ancestry is cyclic or exceeds its budget"),a.add(c);let u=n(c);u.parent&&!n(u.parent).indices.has(c)&&R("NATIVE_NOTES_IDENTITY","Notes source is no longer in its parent"),s.push(u)}return s},assertCurrent:()=>{for(let r of e.values()){let s=r.target,a=Array.isArray(s.children)?s.children:[];(s.removed===!0||s.id!==r.id||s.type!==r.type||s.parent!==r.parent||a.length!==r.children.length||a.some((c,u)=>c!==r.children[u]))&&R("NATIVE_NOTES_RACE","Notes source identity/topology changed during an awaited operation")}}}}function qe(e,t){let n;try{if(typeof e.getPluginData!="function")throw Error();n=e.getPluginData(Be)}catch{R("NATIVE_NOTES_UNAVAILABLE","Current own-plugin notes getter is unavailable")}return _t(n,t)}var Ze=(e,t)=>e.kind===t.kind&&e.value===t.value;function Jn({roots:e,pluginId:t}){typeof t!="string"&&R("NATIVE_NOTES_CONTEXT","Actual plugin identity is unavailable; current notes cannot be exported"),bt({version:1,pluginId:t,nodes:{}}),(!Array.isArray(e)||e.length>1e4||new Set(e).size!==e.length)&&R("NATIVE_NOTES_CONTEXT","Notes export requires exact current native roots");let n=new Set(e),i=new Map,o=[],r=Yn(),s=0,a=0,c=(S,E,p=0)=>{(!S||typeof S!="object"||!E||S.id!==E.id||S.type!==Wn(E)||p>34||++s>5e4)&&R("NATIVE_NOTES_IDENTITY","Official source and current notes target disagree"),r.lineage(E).some(l=>n.has(l.target))||R("NATIVE_NOTES_IDENTITY","Notes target is outside the exported roots");let x=qe(E,t),g=i.get(S.id);if(Yt(S,x,t),g){(g.target!==E||!Ze(g.notes,x)||It(g.rest)!==It(S))&&R("NATIVE_NOTES_OVERLAP","Repeated notes source identity/raw data/metadata disagree");return}i.set(S.id,{rest:S,target:E,type:S.type,notes:x});let m=Array.isArray(E.children)?E.children:[];(S.children!==void 0&&!Array.isArray(S.children)||(S.children??[]).length!==m.length||(S.children??[]).some((l,f)=>l?.id!==m[f]?.id))&&R("NATIVE_NOTES_IDENTITY","Official source and current notes subtree disagree");for(let[l,f]of(S.children??[]).entries())c(f,m[l],p+1)},u=(S,E)=>{let p=It(S);(a+=Le(p))>16*1024*1024&&R("NATIVE_NOTES_BUDGET","Complete official notes source exceeds16MiB"),o.push({rest:S,before:p}),c(S,E)},N=()=>{for(let S of i.values())Ze(S.notes,qe(S.target,t))||R("NATIVE_NOTES_RACE","Current native notes changed during awaited export");r.assertCurrent();for(let S of o)It(S.rest)!==S.before&&R("NATIVE_NOTES_RACE","Official notes source changed during export")};return{add:u,finalize:()=>{N();let S={};for(let[E,p]of i)Object.defineProperty(S,E,{enumerable:!0,configurable:!0,writable:!0,value:{type:p.type,notes:p.notes}});return bt({version:1,pluginId:t,nodes:S})},assertCurrent:N}}function Kn({patch:e,indexes:t,pluginId:n,existingUpdates:i}){if(!e.operations.some(Jt))return null;!zn(i,e)&&e.operations.some(p=>!(p.op==="update"&&p.changed?.length===1&&p.changed[0]==="notes"||p.op==="delete"||p.op==="delete-page"))&&R("NATIVE_NOTES_ASYNC_PATCH","Notes-sensitive patches currently require notes-only updates/deletions; mixed asynchronous operations are refused");let o=Gn(e.nativeNotesBefore);(!o||o.pluginId!==n)&&R("NATIVE_NOTES_BASELINE_REQUIRED","Existing notes writes/deletions require a fresh matching own-plugin baseline");let r=Yn(),s=new Map,a=new Map,c=new Map;for(let p of e.operations.filter(Jt))a.has(p.sourceId)&&R("NATIVE_NOTES_PATCH","Notes patch repeats a target"),a.set(p.sourceId,p);let u=(p,T,x=0)=>{let g=o.nodes[p];(!T||!g||p!==T.id||g.type!==Wn(T)||x>34||s.size>=5e4)&&R("NATIVE_NOTES_BASELINE_REQUIRED","Every affected native descendant requires a matching notes baseline");let m=s.get(p);m&&m.target!==T&&R("NATIVE_NOTES_IDENTITY","Notes patch aliases a native target"),r.lineage(T);let l=qe(T,n);Ze(g.notes,l)||R("NATIVE_NOTES_CONFLICT","Notes changed in Figma; export the current source before replacing, clearing or deleting them"),s.set(p,{target:T,expected:g});let f=Array.isArray(T.children)?T.children:[];(f.length!==g.children.length||f.some((y,d)=>y.id!==g.children[d]))&&R("NATIVE_NOTES_IDENTITY","Affected notes subtree topology no longer matches its source");for(let[y,d]of g.children.entries())u(d,f[y],x+1)},N=(p,T)=>{let x=a.get(p);if(!x)return;let g=t.mapping.get(x.designId),m=t.baseline.get(x.designId);(x.op==="delete-page"?t.pageMappings.get(x.designId)?.sourceId!==p:!g||g.sourceId!==p||!m)&&R("NATIVE_NOTES_IDENTITY","Notes metadata cannot replace the original source mapping/baseline");let l=g?.selectionRoot?g.sourceParentId:m?.parentId?t.sourceIds.get(m.parentId):t.pageMappings.get(m?.pageId)?.sourceId;(l&&T.parent?.id!==l||x.op==="delete-page"&&T.parent?.type!=="DOCUMENT")&&R("NATIVE_NOTES_IDENTITY","Notes target moved outside its source parent"),x.op!=="delete-page"&&!l&&R("NATIVE_NOTES_IDENTITY","Notes target has no complete source parent context"),(x.before?.id!==p||x.before.type!==o.nodes[p]?.type)&&R("NATIVE_NOTES_IDENTITY","Notes catalog root does not match the original source snapshot"),u(p,T)},A=(p,T)=>{if(!a.has(p))return;let x=0,g=(l,f)=>{(!l||typeof l!="object"||Array.isArray(l))&&R("NATIVE_NOTES_RAW_CONFLICT","Current official notes source must be an owned record");let y=Object.getOwnPropertyDescriptor(l,f);return y&&(!Object.hasOwn(y,"value")||!y.enumerable)&&R("NATIVE_NOTES_RAW_CONFLICT","Current official notes source contains an accessor or hidden field"),y?.value},m=(l,f,y=0)=>{let d=s.get(l);(!d||y>34||++x>6e4||g(f,"id")!==l||g(f,"type")!==d.expected.type)&&R("NATIVE_NOTES_RAW_CONFLICT","Current official notes source and captured native identity disagree"),Yt(f,d.expected.notes,n);let h=g(f,"children")??[];(!Array.isArray(h)||h.length!==d.expected.children.length)&&R("NATIVE_NOTES_RAW_CONFLICT","Current official notes subtree does not cover every captured descendant");let _=Object.getOwnPropertyDescriptors(h);Reflect.ownKeys(_).length!==h.length+1&&R("NATIVE_NOTES_RAW_CONFLICT","Current official notes child array is not dense owned data");for(let[C,v]of d.expected.children.entries()){let I=_[String(C)];(!I||!Object.hasOwn(I,"value")||!I.enumerable)&&R("NATIVE_NOTES_RAW_CONFLICT","Current official notes child is not owned data"),m(v,I.value,y+1)}};m(p,T),c.set(p,T)};return{captureTarget:N,corroborateOwnRest:A,assertCurrent:(p=!0)=>{p&&[...a.keys()].some(T=>!s.has(T))&&R("NATIVE_NOTES_IDENTITY","Notes patch did not capture every original target"),p&&Object.keys(o.nodes).some(T=>!s.has(T))&&R("NATIVE_NOTES_IDENTITY","Notes patch contains an unrelated catalog record"),p&&[...a.keys()].some(T=>!c.has(T))&&R("NATIVE_NOTES_RAW_CONFLICT","Every notes-sensitive target requires its own current official source");for(let T of s.values())Ze(T.expected.notes,qe(T.target,n))||R("NATIVE_NOTES_CONFLICT","Native notes changed after preflight; no notes were written");if(r.assertCurrent(),p)for(let[T,x]of c)A(T,x);for(let[T]of a){if(!s.has(T))continue;let x=0;for(let g=s.get(T).target.parent;g;g=g.parent)(++x>35||["delete","delete-page"].includes(a.get(g.id)?.op))&&R("NATIVE_NOTES_IDENTITY","Notes patch contains overlapping or cyclic deletion targets")}},assertApplied:()=>{r.assertCurrent();for(let[p,T]of s){let x=a.get(p),g=x?.op==="update"?x.after.notes??"":T.expected.notes.kind==="value"?T.expected.notes.value:"";Ze(_t(g,n),qe(T.target,n))||R("NATIVE_NOTES_READBACK","Native notes readback differs from the exact prepared intent")}}}}return ni(qi);})();
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

  function validateTransfer(value, validatedAssets, { gridParents = new WeakMap(), copying = true } = {}) {
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
        (value.canvas.mode !== undefined && value.canvas.mode !== "infinite") ||
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
    const coordinateLimit = value.canvas?.mode === "infinite" ? 1000000 : 20000;
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
    const visit = (node, depth, counter, parentSource) => {
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
      if (copying) CodeShellFigmaText.nativeTextRangeCreationPlan(node);
      else CodeShellFigmaText.assertNativeTextRangeBoundary(node);
      if (++total > MAX_TOTAL || ++counter.count > 10000)
        throw new Error("传输包图层数量超出上限。");
      for (const [key, min, max] of [
        ["x", -coordinateLimit, coordinateLimit],
        ["y", -coordinateLimit, coordinateLimit],
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
      CodeShellFigmaPaint.validateDesignStroke(node);
      if (copying && node.nativeStrokeInactive) CodeShellFigmaPaint.nativeInactiveStrokePlan(node);
      if (CodeShellFigmaPaint.hasDesignStroke(node)) CodeShellFigmaPaint.nativeDesignStroke(node);
      if (containers.has(node.type)) nativeStrokeLayoutPlan(null, node);
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
      if (node.type === "image") CodeShellFigmaPaint.assertNativeImageFill(node, assets.get(node.imageRef));
      if (node.shadowStack !== undefined) CodeShellFigmaPaint.nativeShadowStackEffects(node);
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
      if (node.type !== "text" && node.lineHeightUnit !== undefined)
        throw new Error("行高单位只适用于文字图层。");
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
        if ((node.textFlow || node.textOverflow) && typeof node.textSource !== "string")
          throw new Error("响应式文字缺少原始内容。");
        range(node.fontSize, 1, 240, "fontSize");
        range(node.fontWeight, 100, 900, "fontWeight");
        if (!CodeShellFigmaText.validTextLineHeight(node)) throw new Error("文字行高或单位无效。");
        if (
          ![100, 200, 300, 400, 500, 600, 700, 800, 900].includes(node.fontWeight) ||
          !["left", "center", "right"].includes(node.textAlign)
        )
          throw new Error("文字样式无效。");
        optionalEnum(node, "fontStyle", ["normal", "italic"]);
        optionalEnum(node, "textDecoration", ["none", "underline", "line-through"]);
        if (node.letterSpacing !== undefined) range(node.letterSpacing, -20, 100, "letterSpacing");
      }
      gridParents.set(node, parentSource ?? null);
      if (containers.has(node.type)) {
        if (
          !Array.isArray(node.children) ||
          !["none", "horizontal", "vertical", "grid"].includes(node.layout)
        )
          throw new Error("容器布局无效。");
        range(node.gap, -2000, 2000, "gap");
        range(node.padding, 0, 2000, "padding");
        for (const key of [
          "rowGap",
          "columnGap",
          "paddingTop",
          "paddingRight",
          "paddingBottom",
          "paddingLeft",
        ])
          if (node[key] !== undefined) range(node[key], ["rowGap", "columnGap"].includes(key) ? -2000 : 0, 2000, key);
        CodeShellFigmaSpacing.validateLayoutSpacing(node);
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
        for (const child of node.children) visit(child, depth + 1, counter, node);
        if (["horizontal", "vertical"].includes(node.layout))
          CodeShellFigmaSpacing.validateNativeLayoutSpacing(node);
        if (node.layout === "grid") CodeShellFigmaGrid.nativeGridPlan(node, parentSource, (entry) => gridParents.get(entry));
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
  function nodeShadowEffects(source) {
    return source.shadowStack?CodeShellFigmaPaint.nativeShadowStackEffects(source):source.shadow?[{type:"DROP_SHADOW",color:{...rgb(source.shadow.color),a:source.shadow.opacity},offset:{x:source.shadow.x,y:source.shadow.y},radius:source.shadow.blur,spread:0,visible:true,blendMode:"NORMAL"}]:[];
  }
  function cssShadowSnapshot(node) {
    return JSON.stringify({width:node.width,height:node.height,fills:node.fills,strokes:node.strokes,effects:node.effects,radii:[node.topLeftRadius,node.topRightRadius,node.bottomRightRadius,node.bottomLeftRadius],clip:node.clipsContent});
  }
  function retainCssShadowStack(node,source) {
    node.setPluginData("codeshellCssShadowStack",source.shadowStack?JSON.stringify({stack:source.shadowStack,snapshot:cssShadowSnapshot(node)}):"");
  }
  const hasActiveCssGradient = (node) => node.fillPaints?.some(
    (paint) => paint.cssLinear && !paint.cssLinear.sourceOnly,
  );
  const refreshCssGradient = (operation) => hasActiveCssGradient(operation.after) &&
    operation.changed.some((key) =>
      ["width", "height", "fill", "fillPaints", "layoutSizingHorizontal", "layoutSizingVertical"].includes(key) ||
      LAYOUT_KEYS.has(key) ||
      operation.after.type === "text" && ["text", "textSource", "textOverflow", "fontFamily", "fontWeight", "fontStyle", "fontSize", "lineHeight", "lineHeightUnit", "letterSpacing"].includes(key),
    );
  const strokeSideNames = ["Top", "Right", "Bottom", "Left"];
  const includesStrokeInLayout = (node) => ["HORIZONTAL", "VERTICAL", "GRID"].includes(node.layoutMode) && node.strokesIncludedInLayout === true;
  function liveStrokeWeights(node) {
    return strokeSideNames.map(side=>finite(node[`stroke${side}Weight`]) ? node[`stroke${side}Weight`] : finite(node.strokeWeight) ? node.strokeWeight : 0);
  }
  const effectiveStrokeWeights = (node) => Array.isArray(node.strokes) && node.strokes.length
    ? liveStrokeWeights(node) : [0, 0, 0, 0];
  const strokeLayoutKeys = ["stroke", "strokeWidth", "strokeAlign", "strokeSides", "strokeLayoutExcluded", "nativeStrokeInactive"];
  const changesStrokeLayout = (keys) => keys.some(key => strokeLayoutKeys.includes(key) || key === "layout" || key.startsWith("padding"));
  function nativeStrokeLayoutPlan(node, source, { layoutChanged = false, alignmentChanged = false } = {}) {
    const manual = source.layoutReverse || source.layoutWrap === "wrap-reverse" || source.layout === "vertical" && source.layoutWrap === "wrap";
    const sourceMode = manual ? "NONE" : { horizontal: "HORIZONTAL", vertical: "VERTICAL", grid: "GRID" }[source.layout] ?? "NONE";
    const mode = !node || layoutChanged ? sourceMode : node.layoutMode;
    if (!["HORIZONTAL", "VERTICAL", "GRID"].includes(mode)) return null;
    if (source.nativeStrokeInactive) return { mode,
      included: source.nativeStrokeInactive.strokesIncludedInLayout ?? source.nativeStrokeInactive.strokesIncludedInLayoutDefault ?? (node ? includesStrokeInLayout(node) : false),
      padding: strokeSideNames.map(side => source[`padding${side}`] ?? source.padding ?? 0) };
    const stroke = CodeShellFigmaPaint.hasDesignStroke(source) ? CodeShellFigmaPaint.nativeDesignStroke(source) : null;
    const weights = stroke?.weights ?? Array(4).fill(source.stroke === "transparent" ? 0 : source.strokeWidth ?? 0);
    const align = stroke?.align ?? "CENTER";
    const included = mode === "GRID" && node ? includesStrokeInLayout(node) :
      source.strokeAlign === "inside" ? source.strokeLayoutExcluded !== true :
      !alignmentChanged && node && node.layoutMode !== "NONE" ? includesStrokeInLayout(node) : false;
    if (included && weights.some(weight => weight > 0) && align !== "INSIDE")
      throw new Error("参与布局的描边暂只支持 INSIDE；请先在 Figma 关闭描边参与布局或改为 INSIDE 后重新导入");
    const padding = strokeSideNames.map((side, index) => {
      const value = (source[`padding${side}`] ?? source.padding ?? 0) - (included ? weights[index] : 0);
      if (value < 0) throw new Error("有效内容缩进小于参与布局的描边；请增加 padding 或关闭原生描边参与布局");
      return value;
    });
    return { mode, included, padding };
  }
  function applyNativeStrokeLayout(node, plan, source = null) {
    if (!plan) {
      // A deactivated Frame may retain authored padding for a later activation;
      // its inclusion setter is inapplicable and must never be touched here.
      if (source && node.layoutMode === "NONE") for (const side of strokeSideNames)
        node[`padding${side}`] = source[`padding${side}`] ?? source.padding ?? 0;
      return;
    }
    if (node.layoutMode !== plan.mode) throw new Error("描边布局模式在应用前变化");
    if ("strokesIncludedInLayout" in node) node.strokesIncludedInLayout = plan.included;
    strokeSideNames.forEach((side, index) => { node[`padding${side}`] = plan.padding[index]; });
  }
  function nativePadding(node,source,side) {
    const weights = includesStrokeInLayout(node) ? effectiveStrokeWeights(node) : [0, 0, 0, 0];
    if(weights.some(weight=>weight>0) && node.strokeAlign!=="INSIDE")throw new Error("参与布局的描边暂只支持 INSIDE；请先在 Figma 关闭描边参与布局或改为 INSIDE 后重新导入");
    const weight=weights[strokeSideNames.indexOf(side)];
    const value=(source[`padding${side}`]??source.padding??0)-weight;
    if(value<0)throw new Error("有效内容缩进小于参与布局的描边；请增加 padding 或关闭原生描边参与布局");
    return value;
  }
  function setNodeStroke(node,source,{ projectPadding = true } = {}) {
    if (source.nativeStrokeInactive) {
      const saved = CodeShellFigmaPaint.nativeInactiveStrokePlan(source);
      if (saved.individualStrokeWeights && strokeSideNames.some(side => !(`stroke${side}Weight` in node)))
        throw Error("当前 Figma 不支持保存的独立描边宽度；请更新后重试");
      node.strokes = [];
      if (saved.strokeAlign !== undefined) node.strokeAlign = saved.strokeAlign;
      if (saved.strokeWeight !== undefined) node.strokeWeight = saved.strokeWeight;
      if (saved.individualStrokeWeights) for (const side of strokeSideNames)
        node[`stroke${side}Weight`] = saved.individualStrokeWeights[side.toLowerCase()];
      return;
    }
    if (!CodeShellFigmaPaint.hasDesignStroke(source)) {
      node.strokes=paints(source.stroke);node.strokeWeight=source.strokeWidth;node.strokeAlign="CENTER";
      if(projectPadding && includesStrokeInLayout(node))for(const side of strokeSideNames)node[`padding${side}`]=nativePadding(node,source,side);
      return;
    }
    const plan=CodeShellFigmaPaint.nativeDesignStroke(source),unequal=plan.weights.some(w=>w!==plan.weights[0]);
    if(unequal && strokeSideNames.some(side=>!(`stroke${side}Weight` in node)))throw new Error("当前 Figma 不支持独立侧边描边；请更新 Figma 后重试");
    node.strokes=plan.weights.some(w=>w>0)?[plan.paint]:[];node.strokeAlign=plan.align;
    node.strokeJoin="MITER";node.dashPattern=[];
    node.strokeWeight=unequal?0:plan.weights[0];
    if(unequal)strokeSideNames.forEach((side,i)=>{node[`stroke${side}Weight`]=plan.weights[i];});
    if(projectPadding && includesStrokeInLayout(node))for(const side of strokeSideNames)node[`padding${side}`]=nativePadding(node,source,side);
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
    const gridParents = new WeakMap();
    const gridParentOf = (source) => gridParents.get(source);
    const count = validateTransfer(value, undefined, { gridParents, copying: hooks.factoryOnly !== true }); // Complete validation before the first document mutation.

    const warnings = [],
      created = [],
      fonts = new Map();
    const ownedNodes = new Set(), ownedPages = new Set(),
      ownedParents = new WeakMap(), ownedChildren = new WeakMap(), createdRangeTexts = [];
    const rememberOwned = (node, parent) => {
      if (hooks.factoryOnly) return;
      ownedNodes.add(node);
      ownedParents.set(node, parent);
      ownedChildren.set(node, []);
      if (ownedChildren.has(parent)) ownedChildren.get(parent).push(node);
    };
    const assertOwned = (node) => {
      if (hooks.factoryOnly) return;
      const seen = new Set();
      for (let depth = 0; depth < 36; depth += 1) {
        if (!node || node.removed || !ownedNodes.has(node) || seen.has(node)) break;
        seen.add(node);
        const parent = node.parent;
        if (parent !== ownedParents.get(node)) break;
        if (ownedPages.has(node) && parent === figma.root) return;
        node = parent;
      }
      throw new Error("新建图层在导入期间被移动或删除，已停止创建副本。");
    };
    const assertOwnedContents = (root, deep = true) => {
      if (hooks.factoryOnly) return;
      assertOwned(root);
      const pending = [root], seen = new Set();
      while (pending.length) {
        const node = pending.pop();
        if (!ownedNodes.has(node) || node.removed || node.parent !== ownedParents.get(node) ||
            seen.has(node) || seen.size > MAX_TOTAL + created.length)
          throw new Error("新建图层在导入期间被移动或删除，已停止创建副本。");
        seen.add(node);
        const expected = ownedChildren.get(node), actual = node.children ?? [];
        if (actual.length !== expected.length || actual.some((child, index) => child !== expected[index]))
          throw new Error("新建页面的图层顺序或内容在导入期间发生变化，已停止创建副本。");
        if (deep) pending.push(...actual);
      }
    };
    const assertOwnedTree = () => { for (const page of created) assertOwnedContents(page); };
    const assertOwnedMutation = (node, deep = true) => {
      if (hooks.factoryOnly) return;
      assertOwned(node);
      let owner = node;
      // An enabled ancestor (notably Grid, enabled before its children) may
      // resize other descendants when this node changes after an await.
      for (let parent = node.parent; ownedNodes.has(parent); parent = parent.parent)
        if (parent.layoutMode && parent.layoutMode !== "NONE") owner = parent;
      assertOwnedContents(owner, owner !== node || deep);
    };
    // A user may insert an existing layer while an SDK export is awaited. Never
    // remove a page containing that layer, even when the import itself fails.
    const removableOwnedPage = (page) => {
      const seen = new Set(), pending = [{ node: page, parent: figma.root, depth: 0 }];
      while (pending.length) {
        const { node, parent, depth } = pending.pop();
        if (!node || node.removed || !ownedNodes.has(node) || node.parent !== parent ||
            seen.has(node) || depth > 35 || seen.size > MAX_TOTAL + created.length) return false;
        seen.add(node);
        const children = node.children ?? [];
        if (children.length > MAX_TOTAL + created.length) return false;
        for (const child of children) pending.push({ node: child, parent: node, depth: depth + 1 });
      }
      return true;
    };
    const imageBytes = validateAssets(value.assets),
      imageHashes = new Map(), createdImageFills = [];
    const warn = (message) => {
      if (warnings.length < 200) warnings.push(message);
    };
    const rangeFonts = new Map();
    const loadRangeFonts = source => CodeShellFigmaText.preloadNativeTextRangeFonts(source, font => figma.loadFontAsync(font), rangeFonts);
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
    function applyLayout(node, source, parentSource) {
      const manual =
        source.layoutReverse ||
        source.layoutWrap === "wrap-reverse" ||
        (source.layout === "vertical" && source.layoutWrap === "wrap");
      if (manual) {
        warn(`${source.name}: 此布局按固定几何创建。`);
        return;
      }
      if (source.layout === "grid") {
        const plan = CodeShellFigmaGrid.configureNativeGrid(node, source, parentSource, gridParentOf);
        applyNativeStrokeLayout(node, nativeStrokeLayoutPlan(null, source));
        return plan;
      }
      node.layoutMode = { horizontal: "HORIZONTAL", vertical: "VERTICAL" }[source.layout] || "NONE";
      if (node.layoutMode === "NONE") return;
      // This native setter is invalid on a newly created freeform Frame.
      // Enable Auto Layout before configuring its live inclusion setter.
      applyNativeStrokeLayout(node, nativeStrokeLayoutPlan(null, source));
      node.primaryAxisSizingMode = "FIXED";
      node.counterAxisSizingMode = "FIXED";
      node.itemSpacing = CodeShellFigmaSpacing.mainAxisGap(source);
      if (node.itemSpacing < 0) node.itemReverseZIndex = false;
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
      if(source.shadowStack?.layers.some(layer=>layer.visible&&layer.blur>0))warnings.push(`${source.name}: 保留可编辑 CSS 内阴影参数；原生模糊像素与 CSS 的差异未消除。`);
      if (source.fillPaints?.some(CodeShellFigmaPaint.cssLinearNeedsNativeWarning))
        warn(`${source.name}: CSS 角度/像素色标仅按当前尺寸创建为可编辑原生渐变；Figma 内改变尺寸可能改变外观。原始意图已保留。`);
      if (source.type === "text") await loadRangeFonts(source);
      const font = source.type === "text" ? await loadFont(source) : null;
      assertOwnedMutation(parent, Boolean(parent.layoutMode && parent.layoutMode !== "NONE"));
      const node = containers.has(source.type)
        ? figma.createFrame()
        : source.type === "text"
          ? figma.createText()
          : source.type === "ellipse"
            ? figma.createEllipse()
            : figma.createRectangle();
      rememberOwned(node, parent);
      try { parent.appendChild(node); }
      catch (error) { node.remove(); throw error; }
      if (parent.layoutMode === "GRID")
        node.layoutPositioning = source.layoutPositioning === "absolute" ? "ABSOLUTE" : "AUTO";
      node.name = source.name;
      if (node.type === "TEXT") {
        node.fontName = font;
        node.fontSize = source.fontSize;
        node.characters = CodeShellFigmaText.nativeTextContent(source);
        node.lineHeight = CodeShellFigmaText.nativeTextLineHeight(source);
        node.textAlignHorizontal = source.textAlign.toUpperCase();
        node.letterSpacing = { unit: "PIXELS", value: source.letterSpacing ?? 0 };
        node.textDecoration =
          { underline: "UNDERLINE", "line-through": "STRIKETHROUGH" }[source.textDecoration] ||
          "NONE";
        node.textAutoResize = "NONE";
      }
      node.resize(source.width, source.height);
      if (source.type === "image") {
        if (source.objectFit === "fill") createdImageFills.push({ node, source });
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
      if (node.type === "TEXT" && CodeShellFigmaText.applyCreatedNativeTextRanges(node, source) &&
          CodeShellFigmaText.validateTextRanges(source))
        // Transfer omits zero letter spacing. Use the exact default written by
        // this factory when independently proving its final native metrics.
        createdRangeTexts.push({ target: node, source: { ...source, letterSpacing: source.letterSpacing ?? 0 } });
      retainCssLinearSource(node, source);
      setNodeStroke(node,source);
      if (node.type === "FRAME" || node.type === "RECTANGLE")
        setCorners(node, source);
      node.opacity = source.opacity;
      node.visible = source.visible;
      if (node.type === "FRAME") {
        node.clipsContent = source.type === "group" ? false : source.clipContent === true;
        node.layoutMode = "NONE";
      }
      if(source.shadowStack)node.effects=CodeShellFigmaPaint.nativeShadowStackEffects(source);
      else if (source.shadow)
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
        const children = [];
        if (source.layout === "grid") {
          const plan = applyLayout(node, source, parentSource);
          for (const child of source.children) {
            const created = await createNode(child, node, source);
            assertOwnedMutation(node);
            assertOwned(created);
            children.push(created);
            CodeShellFigmaGrid.positionNativeGridChild(created, child, source, plan);
          }
          CodeShellFigmaGrid.finishNativeGrid(node, source, parentSource, gridParentOf);
        } else {
          for (const child of source.children) children.push(await createNode(child, node, source));
          assertOwnedMutation(node);
          applyLayout(node, source);
        }
        assertOwned(node);
        // Enabling native Auto Layout can immediately hug the existing children.
        // Restore the authored frame before FILL children consume its inner size;
        // this frame's own HUG/FILL is applied afterwards by its parent.
        if (node.layoutMode !== "NONE")
          node.resizeWithoutConstraints(source.width, source.height);
        for (let index = 0; index < source.children.length; index += 1) {
          const child = children[index],
            childSource = source.children[index];
          assertOwned(child);
          applySizing(child, childSource, node, source);
          if(childSource.shadowStack)retainCssShadowStack(child,childSource);
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
      if(source.shadowStack)retainCssShadowStack(node,source);
      return node;
    }
    const validateImageFills = () => {
      for (const { node, source } of createdImageFills)
        CodeShellFigmaPaint.assertNativeImageFill({ ...source, width: node.width, height: node.height }, imageBytes.get(source.imageRef));
    };
    if (hooks.factoryOnly) return { createNode, applySizing, applyLayout, loadFont, warnings, validateImageFills };
    const preflightFonts = async (nodes) => {
      for (const node of nodes) {
        if (node.type === "text") { await loadRangeFonts(node); await loadFont(node); }
        if (node.children) await preflightFonts(node.children);
      }
    };
    for (const page of value.pages) await preflightFonts(page.children);
    let returnPage;
    try {
      for (const source of value.pages) {
        const page = figma.createPage();
        created.push(page);
        ownedPages.add(page);
        rememberOwned(page, figma.root);
        page.name = `${source.name} · CodeShell`;
        if (value.canvas) page.backgrounds = paints(value.canvas.background);
        page.setPluginData("codeshellPageId", source.id);
        for (const child of source.children) {
          const node = await createNode(child, page, null);
          assertOwnedMutation(node);
          applySizing(node, child, page);
        }
      }
      // Ancestor Auto Layout can resize Fill descendants after their creation.
      // Check their actual final box before exposing any newly owned page.
      assertOwnedTree();
      validateImageFills();
      if (createdRangeTexts.length)
        await CodeShellFigmaText.finalizeCreatedNativeTextRanges(createdRangeTexts, {
          mixed: figma.mixed, pluginId: figma.pluginId, assertOwned,
        });
      assertOwnedTree();
      validateImageFills();
      returnPage = figma.currentPage;
      await figma.setCurrentPageAsync(created[0]);
      assertOwnedTree();
      validateImageFills();
      if (figma.currentPage !== created[0])
        throw new Error("当前页面在导入完成期间发生变化，已停止显示创建副本。");
      figma.viewport.scrollAndZoomIntoView(created[0].children);
      return { pages: created.length, nodes: count, warnings };
    } catch (error) {
      const cleanup = [];
      if (returnPage && !returnPage.removed && !ownedPages.has(returnPage) && figma.currentPage === created[0]) {
        try { await figma.setCurrentPageAsync(returnPage); }
        catch { cleanup.push("无法返回先前页面"); }
      }
      for (const page of [...created].reverse()) {
        if (page.removed) continue;
        if (!removableOwnedPage(page)) { cleanup.push("含有外部图层的新建页面已保留"); continue; }
        try { page.remove(); }
        catch { cleanup.push("无法清理新建页面"); }
      }
      if (cleanup.length) {
        const failure = new Error(`${error.message} ${[...new Set(cleanup)].join("；")}。`);
        if (error.code) failure.code = error.code;
        throw failure;
      }
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
    "nativeStrokeInactive",
    "strokeSides",
    "strokeAlign",
    "strokeLayoutExcluded",
    "opacity",
    "cornerRadius",
    "cornerRadii",
    "visible",
    "locked",
    "shadow",
    "shadowStack",
    "clipContent",
    "text",
    "fontSize",
    "fontWeight",
    "fontFamily",
    "fontStyle",
    "lineHeight",
    "lineHeightUnit",
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
    "strokeLayoutExcluded",
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
    "lineHeightUnit",
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
  const restStroke = (node) => ({
    paints:node.strokes??[],align:node.strokeAlign??"CENTER",included:includesStrokeInLayout(node),
    join:node.strokeJoin??"MITER",dash:node.dashPattern??[],miter:finite(node.strokeMiterLimit) && node.strokeMiterLimit<Math.SQRT2?node.strokeMiterLimit:null,
    weights:node.strokes?.length ? strokeSideNames.map(side=>node[`stroke${side}Weight`]??node.individualStrokeWeights?.[side.toLowerCase()]??node.strokeWeight??0) : [0,0,0,0],
    inactive: Array.isArray(node.strokes) && !node.strokes.length ? Object.fromEntries(
      ["strokeAlign", "strokeWeight", "individualStrokeWeights", "strokesIncludedInLayout"].filter(key => Object.hasOwn(node, key)).map(key => [key, node[key]])) : null,
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
              shadowStack: ["effects","fills","strokes","rectangleCornerRadii","cornerRadius","clipsContent","absoluteBoundingBox"],
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
    const weights=liveStrokeWeights(node);
    if(strokeSideNames.every(side=>`stroke${side}Weight` in node)) {
      if(weights.some(w=>w!==weights[0]) || raw.individualStrokeWeights)raw.individualStrokeWeights=Object.fromEntries(strokeSideNames.map((side,i)=>[side.toLowerCase(),weights[i]]));
      if(weights.every(w=>w===weights[0]))raw.strokeWeight=weights[0];else delete raw.strokeWeight;
      strokeSideNames.forEach((side,i)=>{if(raw[`stroke${side}Weight`]!==undefined)raw[`stroke${side}Weight`]=weights[i];});
    }
    if(node.strokeAlign && (node.strokeAlign!=="CENTER" || raw.strokeAlign!==undefined))raw.strokeAlign=node.strokeAlign;
    if(includesStrokeInLayout(node) || raw.strokesIncludedInLayout!==undefined)raw.strokesIncludedInLayout=node.strokesIncludedInLayout===true;
    if(typeof node.strokeJoin === "string" && (node.strokeJoin!=="MITER" || raw.strokeJoin!==undefined))raw.strokeJoin=node.strokeJoin;
    if(Array.isArray(node.dashPattern) && (node.dashPattern.length || raw.dashPattern!==undefined))raw.dashPattern=[...node.dashPattern];
    if(finite(node.strokeMiterLimit) && (node.strokeMiterLimit<Math.SQRT2 || raw.strokeMiterLimit!==undefined))raw.strokeMiterLimit=node.strokeMiterLimit;
    const cssShadowSource=node.getPluginData?.("codeshellCssShadowStack");
    if(cssShadowSource && utf8Length(cssShadowSource)<=16384)try{
      const saved=JSON.parse(cssShadowSource);
      if(saved.snapshot===cssShadowSnapshot(node))raw.codeshellCssShadowStack=CodeShellFigmaPaint.normalizeShadowStack(saved.stack);
    }catch{/* Unvalidated or stale shadow metadata never overrides live paint getters. */}
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

    if (["HORIZONTAL", "VERTICAL"].includes(node.layoutMode)) {
      for (const key of ["itemSpacing", "itemReverseZIndex", "layoutSizingHorizontal", "layoutSizingVertical", "layoutWrap", "counterAxisSpacing"])
        if (node[key] !== undefined) raw[key] = node[key];
    }
    if (["HORIZONTAL", "VERTICAL"].includes(node.parent?.layoutMode))
      for (const key of ["layoutPositioning", "layoutSizingHorizontal", "layoutSizingVertical", "layoutGrow", "layoutAlign"])
        if (node[key] !== undefined) raw[key] = node[key];
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
  async function nodeRest(node, afterAwait = () => {}) {
    if (node.type === "PAGE") { await node.loadAsync(); afterAwait(); }
    const response = await node.exportAsync({ format: "JSON_REST_V1" });
    afterAwait();
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
        // Check each supplied snapshot before an operation-specific baseline
        // with the same ID can replace it in the lookup map.
        CodeShellFigmaText.assertNativeTextRangeBoundary(node);
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
    validateTransfer(value, assets, { copying: false });
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
      strokeLayoutPlans = new Map(),
      conflicts = [],
      report = [],
      createdIds = new Set();
    for (const node of indexes.baseline.values())
      CodeShellFigmaText.assertNativeTextRangeBoundary(node);
    const existingUpdates = CodeShellFigmaText.createNativeExistingUpdateCapture({ patch, mixed: figma.mixed });
    const notesCommit = CodeShellFigmaText.createNativeNotesPatchCapture({ patch, indexes, pluginId: figma.pluginId, existingUpdates });
    const assertCaptured = () => { existingUpdates?.assertCurrent(false); if (existingUpdates) notesCommit?.assertCurrent(false); };
    let deletions = 0;
    const requireTarget = async (id) => {
      if (!string(id, 160)) throw new Error("增量操作缺少来源图层 ID。");
      if (!targets.has(id)) {
        const node = await figma.getNodeByIdAsync(id);
        assertCaptured();
        if (!node || node.removed) throw new Error(`来源图层 ${id} 不存在。`);
        targets.set(id, node);
        // Keep these exact native references before REST/font/page awaits.
        notesCommit?.captureTarget(id, node);
        existingUpdates?.captureTarget(id, node);
        const raw = await nodeRest(node, assertCaptured);
        assertCaptured();
        existingUpdates?.corroborateOwnRest(id, raw);
        notesCommit?.corroborateOwnRest(id, raw);
        currentRaw.set(id, raw);
        if (node.relativeTransform)
          geometryBefore.set(id, {
            width: node.width,
            height: node.height,
            matrix: node.relativeTransform.map((row) => [...row]),
          });
      }
      return targets.get(id);
    };
    const validateNode = (node, id, copying) => {
      if (!object(node) || node.id !== id) throw new Error("增量操作的设计图层 ID 不匹配。");
      const copy = { ...node, ...(containers.has(node.type) ? { children: [] } : {}) };
      validateTransfer(
        {
          format: "codeshell.figma.transfer",
          version: 1,
          name: "Patch validation",
          canvas: value.canvas,
          pages: [{ id: "validate", name: "Patch", children: [copy] }],
        },
        assets,
        { copying },
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
      CodeShellFigmaText.assertNativeTextRangeBoundary(operation.baseline);
      if (operation.op === "create" || operation.op === "update")
        validateNode(operation.after, operation.designId, operation.op === "create");
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
          if (!operation.changed.includes("shadowStack")) {
            if (canonical(operation.after.shadowStack) !== canonical(operation.baseline.shadowStack))
              throw new Error("CSS 阴影意图的变更必须包含 shadowStack 修改记录。");
            if (canonical(operation.after.shadowStack) !== canonical(raw.codeshellCssShadowStack))
              conflicts.push(`${operation.sourceId} · CSS 阴影蒙版意图与当前来源不一致，不能省略或伪造阴影快照。`);
          }
          if (
            operation.changed.includes("siblingIndex") &&
            (!Number.isInteger(operation.after.siblingIndex) ||
              operation.after.siblingIndex < 0 ||
              operation.after.siblingIndex >= 10000)
          )
            throw new Error("图层顺序无效。");
          for (const key of operation.changed) {
            if (strokeLayoutKeys.includes(key)) {
              if (operation.after.nativeStrokeInactive) {
                if (operation.baseline.nativeStrokeInactive?.sourceOnly && !operation.after.nativeStrokeInactive.sourceOnly)
                  throw Error("来源特殊描边仍未被受支持的完整样式替换，不能仅移除保留标记后重建");
                CodeShellFigmaPaint.nativeInactiveStrokePlan(operation.after);
                if (!operation.baseline.nativeStrokeInactive && Array.isArray(operation.before.strokes) && operation.before.strokes.length) {
                  if (["strokeJoin", "strokeMiterLimit", "strokeCap", "dashPattern", "strokeGeometry"].some(field => Object.hasOwn(operation.before, field)))
                    throw Error("来源描边含特殊接合、线段或轮廓样式，暂不能保存为可重新激活的空描边；请保留来源状态");
                  if (operation.before.type === "TEXT" && operation.before.strokeAlign && operation.before.strokeAlign !== "CENTER")
                    throw Error("来源文字描边为内侧或外侧对齐，暂不能从已近似的绘制中推断可再激活样式；请保留来源描边状态");
                }
              }
              if(canonical(restStroke(operation.before))!==canonical(restStroke(raw)))conflicts.push(`${operation.sourceId} · 描边已在 Figma 中变化。`);
            } else if (key === "cornerRadius" || key === "cornerRadii") {
              if (canonical(restCorners(operation.before)) !== canonical(restCorners(raw)))
                conflicts.push(`${operation.sourceId} · 圆角已在 Figma 中变化。`);
            } else for (const property of restKeys(key))
              if (canonical(operation.before[property]) !== canonical(raw[property]))
                conflicts.push(`${operation.sourceId} · ${property} 已在 Figma 中变化。`);
          }
          if(operation.after.shadowStack || operation.baseline.shadowStack || operation.changed.includes("shadowStack")) {
            for(const property of ["effects","fills"])if(canonical(operation.before[property]??[])!==canonical(raw[property]??[]))conflicts.push(`${operation.sourceId} · ${property} 已在 Figma 中变化，不能覆盖 CSS 阴影蒙版。`);
            if(canonical(restCorners(operation.before))!==canonical(restCorners(raw)) || canonical(restStroke(operation.before))!==canonical(restStroke(raw)) || (operation.before.clipsContent??false)!==(raw.clipsContent??false))conflicts.push(`${operation.sourceId} · CSS 阴影蒙版的边缘/裁剪已变化。`);
          }
          // Resizing an authored CSS gradient also changes its native paint
          // snapshot. Guard concurrent palette/geometry/source edits first.
          if (refreshCssGradient(operation)) {
            for (const property of ["fills", "codeshellCssLinearSource"])
              if (canonical(operation.before[property]) !== canonical(raw[property]))
                conflicts.push(`${operation.sourceId} · ${property} 已在 Figma 中变化，不能重算 CSS 渐变。`);
          }
          if (containers.has(operation.after.type) && changesStrokeLayout(operation.changed)) {
            if ((operation.before.layoutMode ?? "NONE") !== (raw.layoutMode ?? "NONE"))
              conflicts.push(`${operation.sourceId} · layoutMode 已在 Figma 中变化。`);
            const finalPlan = nativeStrokeLayoutPlan(target, operation.after, {
              layoutChanged: operation.changed.includes("layout"),
              alignmentChanged: operation.changed.includes("strokeAlign"),
            });
            strokeLayoutPlans.set(operation.sourceId, finalPlan);
            if (canonical(restStroke(operation.before)) !== canonical(restStroke(raw)))
              conflicts.push(`${operation.sourceId} · 描边已在 Figma 中变化。`);
            for (const side of strokeSideNames) {
              const property = `padding${side}`;
              if (canonical(operation.before[property] ?? 0) !== canonical(raw[property] ?? 0))
                conflicts.push(`${operation.sourceId} · ${property} 已在 Figma 中变化。`);
            }
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
          if (containers.has(operation.after.type)) {
            CodeShellFigmaSpacing.validateLayoutSpacing(operation.after);
            if (CodeShellFigmaSpacing.mainAxisGap(operation.after) < 0 && target.itemReverseZIndex === true)
              throw new Error("来源负间距的堆叠顺序不能无损修改。");
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
            for (const font of fonts) { await figma.loadFontAsync(font); assertCaptured(); }
            if (
              operation.changed.some((key) =>
                ["fontFamily", "fontWeight", "fontStyle"].includes(key),
              )
            )
              { await figma.loadFontAsync(patchFont(operation.after)); assertCaptured(); }
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
      assertCaptured();
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
    const explicitGapEdits = new Set(patch.operations.filter((operation) => operation.op === "update" &&
      operation.changed.some((key) => ["gap", "rowGap", "columnGap"].includes(key))).map((operation) => operation.designId));
    const spacingGeometryKeys = new Set(["width", "height", "rotation", "visible", "parentId", "pageId", "siblingIndex",
      "layout", "layoutWrap", "layoutSizingHorizontal", "layoutSizingVertical", "layoutPositioning",
      "minWidth", "maxWidth", "minHeight", "maxHeight", "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
      "strokeWidth", "strokeAlign", "strokeLayoutExcluded", "nativeStrokeInactive", ...FONT_KEYS]);
    const changesSpacingGeometry = (operation) => operation.changed.some((key) => spacingGeometryKeys.has(key)) ||
      operation.changed.includes("strokeSides") && canonical(
        CodeShellFigmaPaint.nativeDesignStroke(indexes.baseline.get(operation.designId)).weights) !== canonical(
        CodeShellFigmaPaint.nativeDesignStroke(indexes.current.get(operation.designId)).weights);
    const spacingParents = new Set();
    for (const operation of patch.operations) {
      if (operation.op === "update" && !changesSpacingGeometry(operation)) continue;
      if (!["update", "create", "delete"].includes(operation.op)) continue;
      for (const id of [operation.designId, operation.parentDesignId,
        indexes.current.get(operation.designId)?.parentId, indexes.baseline.get(operation.designId)?.parentId])
        if (id) spacingParents.add(id);
    }
    for (const node of indexes.current.values()) {
      if (!spacingParents.has(node.id) || !["horizontal", "vertical"].includes(node.layout) || CodeShellFigmaSpacing.mainAxisGap(node) >= 0) continue;
      const sourceId = indexes.sourceIds.get(node.id);
      if (!sourceId || explicitGapEdits.has(node.id)) continue;
      const target = await requireTarget(sourceId);
      if (!finite(target.itemSpacing) || target.itemSpacing >= 0) continue;
      const key = node.layout === "vertical" ? "rowGap" : "columnGap";
      const plan = CodeShellFigmaSpacing.nativeMainGap({ ...node, gap: target.itemSpacing, [key]: target.itemSpacing });
      if (plan.minimum !== null && Math.abs(plan.effective - CodeShellFigmaSpacing.mainAxisGap(node)) > 0.0001)
        throw new Error("来源请求负间距的有效值会随本次子项尺寸/可见性变化；请明确调整主轴间距后重试，不能静默覆盖原始请求。");
    }
    const removedPages = patch.operations.filter((op) => op.op === "delete-page").length;
    if (
      figma.root.children.length +
        patch.operations.filter((op) => op.op === "create-page").length -
        removedPages <
      1
    )
      throw new Error("不能删除 Figma 的最后一个页面。");
    // Every awaited preflight operation has finished. The notes-only commit
    // below repeats this synchronous identity/metadata check before writes.
    notesCommit?.assertCurrent();
    existingUpdates?.assertCurrent();
    return {
      value,
      indexes,
      targets,
      currentRaw,
      geometryBefore,
      strokeLayoutPlans,
      notesCommit,
      existingUpdates,
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
    if (plan.existingUpdates) {
      // The caller has returned from all awaited preflight/font work. Compile
      // exact setter values first, then a synchronous guarded original commit.
      const prepared = plan.existingUpdates.compile({ fontFor: patchFont });
      const assertCurrent = () => { plan.existingUpdates.assertCurrent(); plan.notesCommit?.assertCurrent(); };
      assertCurrent();
      let mutated = false;
      figma.commitUndo();
      try {
        assertCurrent();
        for (const mutate of prepared.mutations) { mutated = true; mutate(); }
        prepared.assertApplied();
        plan.notesCommit?.assertApplied();
        figma.commitUndo();
        return { operations: plan.value.patch.operations.length, warnings: [] };
      } catch (error) {
        const cleanup = [];
        if (mutated) {
          try { figma.commitUndo(); } catch (failure) { cleanup.push(`undo checkpoint: ${failure.message}`); }
          try { figma.triggerUndo(); } catch (failure) { cleanup.push(`undo request: ${failure.message}`); }
        }
        throw new Error(`增量更新失败${mutated ? "，已请求撤销本次操作" : ""}：${error.message}${cleanup.length ? `; ${cleanup.join("; ")}` : ""}`);
      }
    }
    if (plan.notesCommit) {
      // This branch contains no await, factory, font load, parent lookup or
      // layout setter. Unsupported mixed patches were refused in preflight.
      const mutations = plan.value.patch.operations.map(operation => {
        const target = plan.targets.get(operation.sourceId);
        const method = operation.op === "update" ? target?.setPluginData : target?.remove;
        if (typeof method !== "function") throw new Error("原图层缺少同步备注修改或删除能力。");
        return { operation, target, method };
      });
      plan.notesCommit.assertCurrent();
      let mutated = false;
      figma.commitUndo();
      try {
        plan.notesCommit.assertCurrent();
        for (const { operation, target, method } of mutations) {
          mutated = true;
          if (operation.op === "update") method.call(target, "codeshellNotes", operation.after.notes ?? "");
          else method.call(target);
        }
        if (mutations.every(({ operation }) => operation.op === "update"))
          plan.notesCommit.assertApplied();
        figma.commitUndo();
        return { operations: mutations.length, warnings: [] };
      } catch (error) {
        if (mutated) { figma.commitUndo(); figma.triggerUndo(); }
        throw error;
      }
    }
    const { value, indexes, targets } = plan,
      created = new Map(),
      cssGradients = new Map(),
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
        if (refreshCssGradient(operation)) cssGradients.set(node, after);
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
            if (!hasActiveCssGradient(after)) {
              mutated = true;
              node.fills = paints(after.fill, after.fillPaints, after.width, after.height);
              retainCssLinearSource(node, after);
            }
          } else if (["stroke","strokeWidth","strokeAlign","strokeSides","nativeStrokeInactive"].includes(key)) {
            mutated = true;
            setNodeStroke(node,after,{ projectPadding: !plan.strokeLayoutPlans.has(operation.sourceId) });
          } else if (key === "clipContent") {
            mutated = true;
            node.clipsContent = after.clipContent === true;
          } else if (key === "shadowStack" || key === "shadow") {
            mutated=true;node.effects=nodeShadowEffects(after);
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
          } else if (key === "lineHeight" || key === "lineHeightUnit") {
            mutated = true;
            node.lineHeight = CodeShellFigmaText.nativeTextLineHeight(after);
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
            if (key === "layout") {
              const wasFreeform = node.layoutMode === "NONE";
              node.layoutMode =
                { horizontal: "HORIZONTAL", vertical: "VERTICAL" }[after.layout] ?? "NONE";
              if (wasFreeform && node.layoutMode !== "NONE" && "strokesIncludedInLayout" in node)
                node.strokesIncludedInLayout = false;
            } else if (key === "layoutWrap") {
              if (node.layoutMode !== "HORIZONTAL")
                throw new Error("Figma 仅水平自动布局支持换行。");
              node.layoutWrap = after.layoutWrap === "wrap" ? "WRAP" : "NO_WRAP";
            } else if (key === "gap") node.itemSpacing = CodeShellFigmaSpacing.mainAxisGap(after);
            else if (key === "rowGap") {
              if (node.layoutMode === "HORIZONTAL" && node.layoutWrap === "WRAP")
                node.counterAxisSpacing = after.rowGap ?? after.gap;
              else if (node.layoutMode === "VERTICAL") node.itemSpacing = after.rowGap ?? after.gap;
            } else if (key === "columnGap" && node.layoutMode === "HORIZONTAL")
              node.itemSpacing = after.columnGap ?? after.gap;
            else if (key.startsWith("padding") && plan.strokeLayoutPlans.has(operation.sourceId)) {
              // The complete final inclusion/weights/padding plan was checked
              // before writes; apply it once after layout activation below.
            } else if (key === "padding")
              for (const side of ["Top", "Right", "Bottom", "Left"])
                node[`padding${side}`] = nativePadding(node,after,side);
            else if (key.startsWith("padding")) node[key] = nativePadding(node,after,key.slice(7));
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
        if (plan.strokeLayoutPlans.has(operation.sourceId)) {
          mutated = true;
          applyNativeStrokeLayout(node, plan.strokeLayoutPlans.get(operation.sourceId), after);
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
      // Typography setters and descendant edits can resize HUG nodes after the
      // geometry pass. Resolve reviewed CSS paints once their native size settles.
      for (const [node, after] of cssGradients) {
        mutated = true;
        node.fills = paints(after.fill, after.fillPaints, node.width, node.height);
        retainCssLinearSource(node, { ...after, width: node.width, height: node.height });
      }
      for(const operation of value.patch.operations)if(operation.after?.shadowStack || operation.changed?.includes("shadowStack")){const node=plan.targets.get(operation.sourceId);if(node)retainCssShadowStack(node,operation.after);}
      factory.validateImageFills();
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
    const nativeTextCapture = CodeShellFigmaText.createNativeTextExportCapture({
      roots, mixed: figma.mixed, pluginId: figma.pluginId,
    });
    const nativeNotesCapture = CodeShellFigmaText.createNativeNotesExportCapture({ roots, pluginId: figma.pluginId });
    for (const node of roots) {
      const response = await node.exportAsync({ format: "JSON_REST_V1" });
      if (!object(response)) throw new Error("Figma 返回了不支持的 JSON_REST_V1 结果。");
      // The plugin API returns a direct { document, ... } export. REST responses may wrap nodes.
      const exported = object(response.document) ? { [node.id]: response } : response.nodes;
      if (!object(exported)) throw new Error("Figma 返回了不支持的 JSON_REST_V1 结果。");
      for (const [id, entry] of Object.entries(exported)) {
        if (!object(entry?.document)) throw new Error("Figma 导出没有包含 document。");
        const native = id === node.id ? node : await figma.getNodeByIdAsync(id);
        if (!native) throw new Error("导出来源图层已不可用；请重新导出。");
        preserveNativeGrid(entry.document, native);
        nativeTextCapture.add(entry.document, native);
        nativeNotesCapture.add(entry.document, native);
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
    // All awaited REST/image/PNG/SVG work has ended. Metadata and text remain
    // independent observations within the final synchronous capture sequence.
    const exportName = page.name, exportFileKey = figma.fileKey;
    const capturedNotes = nativeNotesCapture.finalize();
    const capturedText = nativeTextCapture.finalize();
    nativeNotesCapture.assertCurrent();
    const value = {
      format: "codeshell.figma.source",
      version: 1,
      name: `${exportName}${scope === "selection" ? " Selection" : ""}`,
      ...(exportFileKey ? { fileKey: exportFileKey } : {}),
      nodes,
      assets,
      previews,
      ...(capturedText.supplement ? { nativeTextRanges: capturedText.supplement } : {}),
      nativeNotes: capturedNotes,
      ...(context ? { selection: context } : {}),
      warnings: [...warnings, ...capturedText.warnings].slice(0, 200),
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
