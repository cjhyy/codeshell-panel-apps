/* BEGIN GENERATED SPACING RUNTIME */
"use strict";var CodeShellFigmaSpacing=(()=>{var u=Object.defineProperty;var w=Object.getOwnPropertyDescriptor;var m=Object.getOwnPropertyNames;var g=Object.prototype.hasOwnProperty;var v=(t,r)=>{for(var i in r)u(t,i,{get:r[i],enumerable:!0})},y=(t,r,i,a)=>{if(r&&typeof r=="object"||typeof r=="function")for(let o of m(r))!g.call(t,o)&&o!==i&&u(t,o,{get:()=>r[o],enumerable:!(a=w(r,o))||a.enumerable});return t};var h=t=>y(u({},"__esModule",{value:!0}),t);var G={};v(G,{mainAxisGap:()=>n,nativeMainGap:()=>s,validateLayoutSpacing:()=>l,validateNativeLayoutSpacing:()=>c});var n=t=>t?.[t.layout==="vertical"?"rowGap":"columnGap"]??t?.gap??0;function l(t){for(let i of["gap","rowGap","columnGap"])if(t[i]!==void 0&&(!Number.isFinite(t[i])||t[i]<-2e3||t[i]>2e3))throw new Error(`${i} 必须为 -2000–2000 的有限间距`);if(!["gap","rowGap","columnGap"].some(i=>t[i]<0))return;let r=t.layout==="horizontal";if(!["horizontal","vertical"].includes(t.layout))throw new Error("负间距只支持水平或垂直主轴；Grid 和自由布局不能使用负间距");if(t.layoutWrap&&t.layoutWrap!=="none")throw new Error("负间距换行尚不能可靠映射到原生与 CSS 布局");if(t.layoutReverse)throw new Error("负间距反向布局尚不支持");if(t[r?"rowGap":"columnGap"]<0)throw new Error("交叉轴间距不能为负数");if(t[r?"layoutSizingHorizontal":"layoutSizingVertical"]==="hug")throw new Error("负间距主轴的 Hug 尺寸尚未验证；请使用固定或 Fill 尺寸")}function s(t,r=t.children??[]){let i=n(t);if(!Array.isArray(r)||r.length>1e4)throw new Error("原生间距子项必须为有界数组");let a=r.filter(e=>e.visible!==!1&&e.layoutPositioning!=="absolute");if(i>=0||a.length<2)return{requested:i,effective:i,minimum:null};let o=t.layout==="vertical"?"height":"width",f=a.map(e=>e[o]);if(f.some(e=>!Number.isFinite(e)||e<=0))throw new Error("原生负间距需要可核对的可见 AUTO 子项主轴尺寸");let p=Math.min(...f);return{requested:i,effective:Math.max(i,-p),minimum:p}}function c(t,r=t.children??[]){l(t);let i=s(t,r);if(n(t)<0&&(t.rotation||r.some(a=>a.visible!==!1&&a.layoutPositioning!=="absolute"&&a.rotation)))throw Object.assign(new Error("旋转子项的原生负间距主轴尺寸尚未验证"),{code:"NATIVE_NEGATIVE_SPACING"});if(i.effective-i.requested>1e-4)throw Object.assign(new Error(`原生负间距 ${i.requested}px 会被最小可见 AUTO 子项 ${i.minimum}px 限制为 ${i.effective}px；请调整间距或使用已验证的流关系`),{code:"NATIVE_NEGATIVE_SPACING"});return i}return h(G);})();
/* END GENERATED SPACING RUNTIME */
/* BEGIN GENERATED GRID RUNTIME */
"use strict";var CodeShellFigmaGrid=(()=>{var H=Object.defineProperty;var W=Object.getOwnPropertyDescriptor;var U=Object.getOwnPropertyNames;var X=Object.prototype.hasOwnProperty;var j=(t,r)=>{for(var e in r)H(t,e,{get:r[e],enumerable:!0})},B=(t,r,e,o)=>{if(r&&typeof r=="object"||typeof r=="function")for(let l of U(r))!X.call(t,l)&&l!==e&&H(t,l,{get:()=>r[l],enumerable:!(o=W(r,l))||o.enumerable});return t};var D=t=>B(H({},"__esModule",{value:!0}),t);var Y={};j(Y,{configureNativeGrid:()=>P,finishNativeGrid:()=>M,nativeGridPlan:()=>R,positionNativeGridChild:()=>L,validateGridFields:()=>G});function b(t){return Number.isFinite(t.lineHeight)?t.lineHeightUnit===void 0?t.lineHeight>=.7&&t.lineHeight<=3:t.lineHeightUnit==="pixels"&&t.lineHeight>=4.2&&t.lineHeight<=720:!1}var O=t=>t.lineHeightUnit==="pixels"?t.lineHeight:(t.fontSize??16)*(t.lineHeight??1.2),v=t=>O(t)/(t.fontSize??16);var V=Object.freeze(["gridRows","gridColumnSizes","gridRowSizes","gridItemsPositioning","gridAutoTracks"]),rt=Object.freeze(["gridRowAnchorIndex","gridColumnAnchorIndex","gridChildHorizontalAlign","gridChildVerticalAlign"]),E=(t,r,e)=>Number.isInteger(t)&&t>=r&&t<=e;function q(t){if(!Array.isArray(t)||!t.length||t.length>24)throw new Error("Grid tracks 必须为 1–24 项");return t.map(r=>{if(!r||typeof r!="object"||Array.isArray(r)||Object.keys(r).some(o=>!["type","value"].includes(o))||!["fixed","flex","hug"].includes(r.type))throw new Error("Grid track 类型无效");if(r.type==="hug"){if(r.value!==void 0)throw new Error("HUG track 不接受 value");return{type:"hug"}}let e=r.value??(r.type==="flex"?1:void 0);if(!Number.isFinite(e)||e<0||r.type==="flex"&&e===0||e>2e4)throw new Error("Grid track value 超出范围");return{type:r.type,value:e}})}function G(t,r=!1){for(let e of["gridRows","gridColumns","gridColumnSpan","gridRowSpan"])if(t[e]!==void 0&&!E(t[e],1,24))throw new Error(`${e} 必须为 1–24`);for(let e of["gridRowAnchorIndex","gridColumnAnchorIndex"])if(t[e]!==void 0&&!E(t[e],0,9999))throw new Error(`${e} 必须为 0–9999`);if(t.gridRowAnchorIndex===void 0!=(t.gridColumnAnchorIndex===void 0))throw new Error("Grid manual anchors 必须同时包含行和列");for(let e of["gridChildHorizontalAlign","gridChildVerticalAlign"])if(t[e]!==void 0&&!["auto","start","center","end"].includes(t[e]))throw new Error(`${e} 无效`);if(!r&&V.some(e=>t[e]!==void 0))throw new Error("Grid container 字段只适用于容器");if(t.gridItemsPositioning!==void 0&&!["manual","row-auto-flow"].includes(t.gridItemsPositioning))throw new Error("gridItemsPositioning 无效");if(t.gridAutoTracks!==void 0&&!["none","rows"].includes(t.gridAutoTracks))throw new Error("gridAutoTracks 无效");for(let[e,o]of[["gridColumnSizes",t.gridColumns],["gridRowSizes",t.gridRows]])if(t[e]!==void 0){let l=q(t[e]);if(o===void 0||l.length!==o)throw new Error(`${e} 数量与 grid count 不一致`)}if(r&&t.layout==="grid"&&t.gridItemsPositioning==="manual"&&Array.isArray(t.children)){let e=k(t.children,t.gridColumns??1,t);if(t.gridAutoTracks!=="rows"&&t.gridRows!==void 0&&e.rowCount>t.gridRows)throw new Error("Grid manual anchors/spans 超出 gridRows")}}function k(t,r,e={}){if(!E(r,1,24))throw new Error("Grid columns 必须为 1–24");let o=new Set,l=[],a=0,h=(n,u,f,g)=>{if(u+g>r)return!1;for(let y=n;y<n+f;y++)for(let p=u;p<u+g;p++)if(o.has(y*r+p))return!1;return!0};for(let n of t){if(!n||typeof n!="object")throw new Error("Grid 子项无效");for(let w of["gridColumnSpan","gridRowSpan"])if(n[w]!==void 0&&!E(n[w],1,24))throw new Error(`${w} 必须为 1–24`);for(let w of["gridRowAnchorIndex","gridColumnAnchorIndex"])if(n[w]!==void 0&&!E(n[w],0,9999))throw new Error(`${w} 必须为 0–9999`);if(n.visible===!1||n.layoutPositioning==="absolute")continue;let u=Math.min(r,Math.max(1,n.gridColumnSpan??1)),f=Math.max(1,n.gridRowSpan??1),g=e.gridItemsPositioning==="manual"&&Number.isInteger(n.gridRowAnchorIndex)&&Number.isInteger(n.gridColumnAnchorIndex),y=e.gridItemsPositioning==="row-auto-flow"?a:0,p=g?n.gridRowAnchorIndex:Math.floor(y/r),m=g?n.gridColumnAnchorIndex:y%r;if(g&&!h(p,m,f,u))throw new Error(`${n.name??n.id}: Grid placement 重叠或超出列范围`);for(;!g&&!h(p,m,f,u);)y++,p=Math.floor(y/r),m=y%r;for(let w=p;w<p+f;w++)for(let S=m;S<m+u;S++)o.add(w*r+S);a=p*r+m+u,l.push({child:n,row:p,column:m,rowSpan:f,columnSpan:u})}return{placements:l,rowCount:Math.max(0,...l.map(n=>n.row+n.rowSpan))}}function J(t,r,e=r?.children,o,l){let a=i=>["minWidth","maxWidth","minHeight","maxHeight"].every(d=>i[d]===void 0),h=i=>!(i.strokeWidth>0)&&(i.strokeSides===void 0||Array.isArray(i.strokeSides)&&Array.from(i.strokeSides).every(d=>d&&d.width===0))&&!i.strokeLayoutExcluded,n=i=>(i.paddingTop??i.padding??0)+(i.paddingBottom??i.padding??0),u=i=>["Top","Right","Bottom","Left"].every(d=>{let s=i[`padding${d}`]??i.padding??0;return Number.isFinite(s)&&s>=0&&s<=2e3}),f=i=>i.rowGap??i.gap??0,g=i=>Number.isFinite(f(i))&&f(i)>=0&&f(i)<=2e3,y=t?.layoutSizingHorizontal==="fill"&&o?.layout==="vertical"&&o.layoutSizingHorizontal==="fixed"&&Number.isFinite(o.width)&&o.width>=1&&o.width<=2e4&&a(o)&&!o.rotation&&!o.layoutReverse&&(!o.layoutWrap||o.layoutWrap==="none")&&t.layoutPositioning!=="absolute"&&!t.layoutMarginBefore&&a(t),p=(()=>{if(y&&(!l||l(t)===o))return!0;if(t?.layoutSizingHorizontal!=="fill"||typeof l!="function")return!1;let i=new Set([t]),d=t,s=o;for(let A=0;A<32;A+=1){if(!s||typeof s!="object"||i.has(s)||l(d)!==s||s.type!=="frame"||s.layout!=="vertical"||[d,s].some(c=>c.visible===!1||c.rotation||c.layoutPositioning==="absolute"||c.layoutReverse||c.layoutMarginBefore||c.layoutWrap&&c.layoutWrap!=="none"||!a(c))||!Number.isFinite(s.width)||s.width<1||s.width>2e4||!u(s)||!g(s)||!h(s)||![void 0,"start","stretch"].includes(s.alignItems)||![void 0,"auto","start","stretch"].includes(d.layoutAlignSelf))return!1;i.add(s);let x=l(s);if(s.layoutSizingHorizontal==="fixed"||s.layoutSizingHorizontal===void 0&&x===null)return!0;if(s.layoutSizingHorizontal!=="fill")return!1;d=s,s=x}return!1})(),m=t?.strokeAlign==="inside"&&!t.strokeLayoutExcluded&&Array.isArray(t.strokeSides)&&t.strokeSides.length===4&&Array.from(t.strokeSides).every((i,d)=>i&&i.width===(d===2?1:0))&&["Top","Right","Left"].every(i=>(t[`padding${i}`]??t.padding??0)===0)&&(t.paddingBottom??t.padding??0)===1,w=t?.strokeAlign==="center"&&!t.strokeLayoutExcluded&&Array.isArray(t.strokeSides)&&t.strokeSides.length===4&&Array.from(t.strokeSides).every((i,d)=>i&&i.width===(d===2?1:0))&&["Top","Right","Bottom","Left"].every(i=>(t[`padding${i}`]??t.padding??0)===0);if(!t||!r||t.layout!=="grid"||t.layoutSizingHorizontal!=="fixed"&&!p||t.layoutSizingVertical!=="hug"||t.gridRows!==1||t.gridRowSizes?.length!==1||t.gridRowSizes[0].type!=="hug"||t.gridColumnSizes?.some(i=>!["fixed","flex"].includes(i.type))||t.rotation||t.layoutReverse||t.layoutWrap&&t.layoutWrap!=="none"||t.justifyContent&&t.justifyContent!=="start"||t.alignContent&&t.alignContent!=="start"||t.alignItems&&t.alignItems!=="start"||n(t)!==0&&!m||!a(t)||!h(t)&&!m&&!w||r.type!=="frame"||r.layout!=="vertical"||r.layoutSizingHorizontal!=="fill"||r.layoutSizingVertical!=="fill"||(r.gridRowSpan??1)!==1||r.visible===!1||r.layoutPositioning==="absolute"||r.rotation||r.layoutReverse||r.layoutWrap&&r.layoutWrap!=="none"||r.layoutMarginBefore||r.justifyContent&&r.justifyContent!=="start"||r.alignItems&&r.alignItems!=="start"||!g(r)||!u(r)||!a(r)||!h(r))return null;let S=i=>typeof e=="function"?e(i):i===r?e:i.children,F=i=>i.type==="text"&&i.layoutSizingVertical==="hug"&&i.layoutSizingHorizontal==="fill"&&i.textFlow==="wrap"&&i.textOverflow===void 0&&typeof i.textSource=="string"&&i.textSource.length<=4e3&&/[^\t\n\f\r ]/u.test(i.textSource)&&Number.isFinite(i.fontSize)&&i.fontSize>=6&&i.fontSize<=240&&b(i)&&v(i)>=.7&&v(i)<=3&&(i.letterSpacing??0)===0&&(i.textAlign??"left")==="left"&&(i.textDecoration??"none")==="none",C=i=>i.children===void 0&&i.visible!==!1&&i.layoutPositioning!=="absolute"&&!i.rotation&&!i.layoutMarginBefore&&Number.isFinite(i.height)&&i.height>=1&&i.height<=2e4&&a(i)&&h(i),z=S(r);if(!Array.isArray(z)||!z.length)return null;let I=z[0];if(z.length===1&&I?.type==="rectangle")return!w&&I.layoutSizingVertical==="fixed"&&["fixed","fill"].includes(I.layoutSizingHorizontal)&&n(r)===0&&(r.gap??0)===0&&(r.rowGap??0)===0&&C(I)?I.height:null;let T=new Set([r]),_=1,$=(i,d)=>!i||typeof i!="object"||T.has(i)||d>4||++_>32?null:(T.add(i),F(i)?C(i)?i.height:null:i.type!=="frame"||i.layout!=="vertical"||i.layoutSizingVertical!=="hug"||!["fixed","fill"].includes(i.layoutSizingHorizontal)||!Number.isFinite(i.width)||i.width<1||i.width>2e4||i.visible===!1||i.layoutPositioning==="absolute"||i.rotation||i.layoutReverse||i.layoutMarginBefore||i.layoutWrap&&i.layoutWrap!=="none"||i.justifyContent&&i.justifyContent!=="start"||i.alignItems&&i.alignItems!=="start"||![void 0,"auto","start"].includes(i.layoutAlignSelf)&&!(i.layoutAlignSelf==="stretch"&&i.layoutSizingHorizontal==="fill")||!u(i)||!g(i)||!a(i)||!h(i)?null:N(i,d)),N=(i,d)=>{let s=i===r?z:S(i);if(!Array.isArray(s)||!s.length||s.length>16||!Array.from(s).every(x=>x&&(x.type==="frame"||s.length===1&&x.type==="text")))return null;let A=n(i)+f(i)*(s.length-1);for(let x of s){let c=$(x,d+1);if(c===null)return null;A+=c}return A>=1&&A<=2e4?A:null};return N(r,0)}function K(t,r){return t.gridAutoTracks==="rows"?Math.max(1,r):Math.max(1,t.gridRows??r,r)}function Q(t,r){return t.gridRowSizes?Array.from({length:r},(e,o)=>t.gridRowSizes[o]??{type:"hug"}):void 0}function R(t,r,e){G(t,!0);let o=t.gridColumns??1,l=k(t.children??[],o,t),a=K(t,l.rowCount);if(a>24)throw new Error("原生 Grid 互换最多保留 24 行；请拆分网格");if(l.rowCount>a)throw new Error("Grid children 超出 gridRows；请增加行数");if(t.gridAutoTracks==="rows"&&t.gridItemsPositioning==="manual"){let u=new Set;for(let f of l.placements)for(let g=f.row;g<f.row+f.rowSpan;g++)u.add(g);if(u.size&&u.size!==a)throw new Error("自动 Grid 行中的空白手动行不能保留；请移除空行或关闭自动行")}let h=t.gridColumnSizes??Array.from({length:o},()=>({type:"flex",value:1})),n=Q(t,a)??Array.from({length:a},()=>({type:"hug"}));for(let[u,f]of[["Horizontal",h],["Vertical",n]]){for(let g of l.placements){let y=g.child,p=y.layoutAlignSelf==="stretch"||(!y.layoutAlignSelf||y.layoutAlignSelf==="auto")&&t.alignItems==="stretch",m=u==="Horizontal"?g.column:g.row,w=u==="Horizontal"?g.columnSpan:g.rowSpan;if((y[`layoutSizing${u}`]==="fill"||p)&&f.slice(m,m+w).some(S=>S.type==="hug")&&!(u==="Vertical"&&J(t,y,y.children,r,e)!==null))throw new Error(`Grid ${u}: FILL 子项与 HUG track 的内在尺寸循环尚不能保留；请改为固定 track 或 HUG/固定子项`)}if(t[`layoutSizing${u}`]==="hug"&&f.some(g=>g.type==="flex"))throw new Error(`Grid ${u}: HUG 容器不能包含 FLEX track；请改为 FIXED/HUG track 或固定容器尺寸`)}if(t.layoutReverse||t.layoutWrap&&t.layoutWrap!=="none"||t.justifyContent!=="start"||t.alignContent&&t.alignContent!=="start")throw new Error("Grid 反向/换行/track 分布不能对应 Figma；请使用 start 分布");return{columns:o,rows:a,columnSizes:h,rowSizes:n,...l}}function P(t,r,e,o){let l=R(r,e,o);for(let a of["gridColumnCount","gridRowCount","gridRowSizes","gridColumnSizes","gridAutoTracks","gridItemsPositioning"])if(!(a in t))throw new Error(`${r.name}: 当前 Figma 不支持原生 GRID API (${a})，请更新 Figma 后重试`);t.layoutMode="GRID",t.layoutSizingHorizontal="FIXED",t.layoutSizingVertical="FIXED",t.gridAutoTracks="NONE",t.gridItemsPositioning="MANUAL",t.gridColumnCount=l.columns,t.gridRowCount=l.rows,t.gridColumnGap=r.columnGap??r.gap,t.gridRowGap=r.rowGap??r.gap;for(let a of["Top","Right","Bottom","Left"])t[`padding${a}`]=r[`padding${a}`]??r.padding;for(let[a,h]of[["gridColumnSizes",l.columnSizes],["gridRowSizes",l.rowSizes]]){let n=t[a];if(n.length!==h.length)throw new Error(`${r.name}: Figma Grid track 数量不匹配`);h.forEach((u,f)=>{n[f].type=u.type.toUpperCase(),u.type!=="hug"&&(n[f].value=u.value??1)})}return l}function L(t,r,e,o){if(t.layoutPositioning=r.layoutPositioning==="absolute"?"ABSOLUTE":"AUTO",r.layoutPositioning==="absolute")return;let l=r.visible===!1,a=l?{row:o.rows,column:0,rowSpan:r.gridRowSpan??1,columnSpan:Math.min(o.columns,r.gridColumnSpan??1)}:o.placements.find(h=>h.child===r);if(typeof t.setGridChildPosition!="function")throw new Error("当前 Figma 不支持 Grid 子项位置；请更新后重试");l&&(t.parent.gridRowCount=Math.max(t.parent.gridRowCount,a.row+a.rowSpan),t.visible=!0),t.setGridChildPosition(a.row,a.column),t.gridColumnSpan=a.columnSpan,t.gridRowSpan=a.rowSpan,l&&(t.visible=!1);for(let h of["Horizontal","Vertical"]){let n=`gridChild${h}Align`,u=r[n]??(r.layoutAlignSelf&&r.layoutAlignSelf!=="auto"?r.layoutAlignSelf:e.alignItems);t[n]={start:"MIN",center:"CENTER",end:"MAX",stretch:"MIN",auto:"AUTO"}[u]??"MIN"}}function M(t,r,e,o){t.gridRowCount=R(r,e,o).rows,t.gridItemsPositioning=r.gridItemsPositioning==="row-auto-flow"?"ROW_AUTO_FLOW":"MANUAL",t.gridAutoTracks=r.gridAutoTracks==="rows"?"ROWS":"NONE"}return D(Y);})();
/* END GENERATED GRID RUNTIME */
/* BEGIN GENERATED PAINT RUNTIME */
"use strict";var CodeShellFigmaPaint=(()=>{var A=Object.defineProperty;var at=Object.getOwnPropertyDescriptor;var lt=Object.getOwnPropertyNames;var ct=Object.prototype.hasOwnProperty;var ut=(t,r)=>{for(var e in r)A(t,e,{get:r[e],enumerable:!0})},ft=(t,r,e,o)=>{if(r&&typeof r=="object"||typeof r=="function")for(let s of lt(r))!ct.call(t,s)&&s!==e&&A(t,s,{get:()=>r[s],enumerable:!(o=at(r,s))||o.enumerable});return t};var ht=t=>ft(A({},"__esModule",{value:!0}),t);var $t={};ut($t,{assertNativeImageFill:()=>st,cssLinearNeedsNativeWarning:()=>L,cssLinearSourceSnapshot:()=>Z,designPaintsToFigma:()=>J,figmaFillPaints:()=>X,hasDesignStroke:()=>ot,nativeDesignStroke:()=>nt,nativeInactiveStrokePlan:()=>P,nativeShadowStackEffects:()=>tt,normalizeCssLinearSource:()=>C,normalizeDesignPaints:()=>w,normalizeShadowStack:()=>N,normalizeStrokeSides:()=>G,validateDesignStroke:()=>T,validateShadowStack:()=>x});var dt=t=>t&&typeof t=="object"&&!Array.isArray(t),v=t=>typeof t=="number"&&Number.isFinite(t),$=(t,r)=>{if(!dt(t)||Object.keys(t).some(e=>!r.includes(e)))throw new Error("CSS 渐变几何包含未知字段")};function F(t,r){$(t,["direction","positions","sourceOnly"]);let e=t.direction;$(e,["angle","corner"]);let o;if(Object.keys(e).length!==1)throw new Error("CSS 渐变方向必须唯一");if(e.angle!==void 0){if(!v(e.angle)||e.angle<0||e.angle>=360)throw new Error("CSS 渐变角度必须为 0–360（不含 360）");o={angle:e.angle}}else{if(!Array.isArray(e.corner)||e.corner.length!==2||!Array.from(e.corner).every(i=>i===-1||i===1))throw new Error("CSS 渐变角方向必须为两个 ±1");o={corner:[...e.corner]}}if(t.sourceOnly!==void 0&&t.sourceOnly!==!0)throw new Error("CSS 渐变 sourceOnly 只能为 true");if(!Array.isArray(t.positions)||t.positions.length<2||t.positions.length>16||!t.sourceOnly&&t.positions.length!==r.length)throw new Error("CSS 渐变位置必须为 2–16 项且与可编辑色标对应");let s=Array.from(t.positions,(i,n)=>{if(i===null)return null;if(i==="previous"){if(!n||t.positions[n-1]==="previous"||!t.sourceOnly&&(r[n].opacity!==0||r[n-1].opacity!==0))throw new Error("CSS 透明色标重复位置无效");return"previous"}if($(i,["unit","value"]),!["px","percent"].includes(i.unit)||!v(i.value)||Math.abs(i.value)>2e4)throw new Error("CSS 色标只支持有界 px/percent 坐标");return{unit:i.unit,value:i.value}});if(s.filter(i=>i!=="previous").length<2)throw new Error("CSS 渐变至少需要两个原始色标");return{direction:o,positions:s,...t.sourceOnly?{sourceOnly:!0}:{}}}function gt(t,r,e){if(t.corner){let i=Math.hypot(r,e);return{x:t.corner[0]*e/i,y:t.corner[1]*r/i}}let o=t.angle*Math.PI/180,s=i=>Math.abs(i)<1e-12?0:Math.abs(Math.abs(i)-1)<1e-12?Math.sign(i):i;return{x:s(Math.sin(o)),y:s(-Math.cos(o))}}function _(t,r,e){var H,j;let o=t.cssLinear;if(!o||o.sourceOnly||!(r>0&&e>0)||![r,e].every(v))return t;let s=gt(o.direction,r,e),i=Math.abs(r*s.x)+Math.abs(e*s.y),n=o.positions.flatMap((u,h)=>u==="previous"?[]:[{index:h,value:u===null?null:u.value/(u.unit==="percent"?100:i)}]);(H=n[0]).value??(H.value=0),(j=n.at(-1)).value??(j.value=1);let a=-1/0;for(let u of n)u.value!==null&&(u.value=Math.max(a,u.value),a=u.value);for(let u=0;u<n.length-1;u++){let h=u+1;for(;n[h].value===null;)h++;for(let p=u+1;p<h;p++)n[p].value=n[u].value+(n[h].value-n[u].value)*(p-u)/(h-u);u=h-1}let l=[];for(let u of n)l[u.index]=u.value;o.positions.forEach((u,h)=>{u==="previous"&&(l[h]=l[h-1])});let c=Math.min(0,l[0]),d=Math.max(1,l.at(-1)),E=(u,h=0)=>({x:.5+((u-.5)*i*s.x-h*i*s.y)/r,y:.5+((u-.5)*i*s.y+h*i*s.x)/e});return{...t,handles:[E(c),E(d),E(c,(d-c)/2)],stops:t.stops.map((u,h)=>({...u,position:(l[h]-c)/(d-c)}))}}function L(t){let r=t.cssLinear;return!!(r&&(r.sourceOnly||r.direction.angle!==void 0&&Math.abs(r.direction.angle%90)>1e-9||r.positions.some(e=>e&&e.unit==="px"&&e.value!==0)))}function U(t,r){if(!t.sourceOnly)for(let e=1;e<r.length;e++){let o=r[e-1],s=r[e],i=t.positions[e-1],n=t.positions[e];if(!(n==="previous"||i&&n&&typeof i=="object"&&typeof n=="object"&&i.unit===n.unit&&i.value>=n.value)&&o.opacity!==s.opacity&&o.color!==s.color)throw new Error("不同颜色且透明度变化的 CSS 预乘插值无法由当前原生渐变无损表示")}}var pt=t=>t!==null&&typeof t=="object"&&!Array.isArray(t),R=t=>typeof t=="string"&&/^#[a-f\d]{6}$/iu.test(t),g=t=>typeof t=="number"&&Number.isFinite(t),y=t=>Math.max(0,Math.min(1,t));var B=t=>`#${[t.r,t.g,t.b].map(r=>Math.round(y(r)*255).toString(16).padStart(2,"0")).join("")}`,V=t=>[1,3,5].map(r=>parseInt(t.slice(r,r+2),16)/255);function m(t,r){if(!pt(t)||Object.keys(t).some(e=>!r.includes(e)))throw new Error("绘制包含未知字段")}function b(t){if(!g(t)||t<0||t>1)throw new Error("绘制透明度必须在 0–1 之间");return t}function yt(t){let[r,e,o]=t;return[[e.x-r.x,2*(o.x-r.x),2*r.x-o.x],[e.y-r.y,2*(o.y-r.y),2*r.y-o.y]]}function M(t){let[[r,e,o],[s,i,n]]=yt(t),a=r*i-e*s;if(Math.abs(a)<1e-8)throw new Error("线性渐变坐标不可逆");return[[i/a,-e/a,(e*n-i*o)/a],[-s/a,r/a,(s*o-r*n)/a]]}function w(t){if(!Array.isArray(t)||!t.length||t.length>8)throw new Error("填充绘制必须为 1–8 层");return t.map(r=>{m(r,r?.type==="SOLID"?["type","color","opacity"]:["type","opacity","handles","stops","cssLinear"]);let e=b(r.opacity);if(r.type==="SOLID"){if(!R(r.color))throw new Error("纯色绘制必须是六位十六进制颜色");return{type:"SOLID",color:r.color.toLowerCase(),opacity:e}}if(r.type!=="GRADIENT_LINEAR"||!Array.isArray(r.handles)||r.handles.length!==3||!Array.isArray(r.stops)||r.stops.length<2||r.stops.length>16)throw new Error("仅支持有界纯色/线性渐变；渐变必须有三个控制点与 2–16 个色标");let o=r.handles.map(n=>{if(m(n,["x","y"]),![n.x,n.y].every(a=>g(a)&&Math.abs(a)<=100))throw new Error("渐变控制点超出范围");return{x:n.x,y:n.y}});M(o);let s=r.stops.map(n=>{if(m(n,["position","color","opacity"]),!R(n.color))throw new Error("渐变色标颜色无效");return{position:b(n.position),color:n.color.toLowerCase(),opacity:b(n.opacity)}});if(s.some((n,a)=>a&&n.position<s[a-1].position))throw new Error("渐变色标必须按位置排序");let i=r.cssLinear===void 0?void 0:F(r.cssLinear,s);return i&&U(i,s),{type:"GRADIENT_LINEAR",opacity:e,handles:o,stops:s,...i?{cssLinear:i}:{}}})}function mt(t){if(!Array.isArray(t)||t.length!==2||!t.every(c=>Array.isArray(c)&&c.length===3&&c.every(g)))throw new Error("渐变矩阵无效");let[[r,e,o],[s,i,n]]=t,a=r*i-e*s;if(Math.abs(a)<1e-8)throw new Error("渐变矩阵不可逆");let l=(c,d)=>({x:(i*(c-o)-e*(d-n))/a,y:(-s*(c-o)+r*(d-n))/a});return[l(0,.5),l(1,.5),l(0,1)]}function X(t,r=()=>{}){if(!Array.isArray(t))return null;let e=t.filter(o=>o?.visible!==!1);if(!e.length||e.length>8||e.some(o=>!["SOLID","GRADIENT_LINEAR"].includes(o?.type)))return null;try{let o=e.map(s=>{if(s.blendMode&&s.blendMode!=="NORMAL")throw new Error("非 NORMAL 混合绘制需本地预览资源");let i=g(s.opacity)?y(s.opacity):1;if(s.type==="SOLID")return{type:"SOLID",color:B(s.color),opacity:i*(g(s.color?.a)?y(s.color.a):1)};let n=s.gradientStops?.map(l=>({position:l.position,color:B(l.color),opacity:g(l.color?.a)?y(l.color.a):1})),a=s.gradientHandlePositions??mt(s.gradientTransform);try{M(a)}catch{if(!n?.length)throw new Error("缺少渐变色标");r("退化线性渐变没有可逆控制点；按零长度渐变的末色标保留，不猜测方向。");let l=n.at(-1);return{type:"SOLID",color:l.color,opacity:i*l.opacity}}return{type:"GRADIENT_LINEAR",opacity:i,handles:a,stops:n}});return w(o)}catch(o){return r(`绘制无法无损转换：${o.message}`),null}}function wt(t){let r=t.fillPaints??(R(t.fill)?[{type:"SOLID",color:t.fill,opacity:1}]:[]);return r.some(e=>e.cssLinear&&!e.cssLinear.sourceOnly)?r.map(e=>e.cssLinear?_(e,t.width,t.height):e):r}function J(t){let r=wt(t);if(r.some(e=>e.cssLinear&&!e.cssLinear.sourceOnly&&e.handles.some(o=>Math.abs(o.x)>100||Math.abs(o.y)>100)))throw new Error("当前 CSS 渐变尺寸/像素色标产生超出 ±100 的原生控制点；请调整尺寸或色标后再导出。原始 CSS 意图仍可在 Design Studio 中编辑。");return r.map(e=>e.type==="SOLID"?{type:"SOLID",color:Object.fromEntries(["r","g","b"].map((o,s)=>[o,V(e.color)[s]])),opacity:e.opacity}:{type:"GRADIENT_LINEAR",opacity:e.opacity,gradientTransform:M(e.handles),gradientStops:e.stops.map(o=>({position:o.position,color:{...Object.fromEntries(["r","g","b"].map((s,i)=>[s,V(o.color)[i]])),a:o.opacity}}))})}function C(t){if(m(t,["version","width","height","paints"]),t.version!==1||![t.width,t.height].every(o=>g(o)&&o>=1&&o<=2e4))throw new Error("CSS 渐变来源尺寸无效");let r=w(t.paints);if(!r.some(o=>o.cssLinear))throw new Error("CSS 渐变来源缺少几何意图");let e={version:1,width:t.width,height:t.height,paints:r};if(JSON.stringify(e).length>32768)throw new Error("CSS 渐变来源超过 32 KiB");return e}function Z(t){return t.fillPaints?.some(r=>r.cssLinear)?C({version:1,width:t.width,height:t.height,paints:t.fillPaints}):null}var Ct=Object.freeze(["border-top-left-radius","border-top-right-radius","border-bottom-right-radius","border-bottom-left-radius"]);function St(t){return t.cornerRadii??Array(4).fill(t.cornerRadius??0)}function S(t){let r=St(t),[e,o,s,i]=r,n=Math.min(1,...[[t.width,e+o],[t.width,i+s],[t.height,e+i],[t.height,o+s]].filter(([,a])=>a>0).map(([a,l])=>Math.max(0,a)/l));return r.map(a=>a*n)}var K=t=>t&&typeof t=="object"&&!Array.isArray(t),q=(t,r)=>Object.keys(t).every(e=>r.includes(e)),k=(t,r,e)=>typeof t=="number"&&Number.isFinite(t)&&t>=r&&t<=e;function N(t){if(!K(t)||!q(t,["basis","layers"])||t.basis!=="css-box"||!Array.isArray(t.layers)||t.layers.length<1||t.layers.length>8)throw Error("shadowStack 只支持 css-box 几何蒙版与 1–8 个有序阴影；native-paint 原始效果暂保留在来源中");return{basis:"css-box",layers:Array.from(t.layers,r=>{if(!K(r)||!q(r,["kind","color","opacity","x","y","blur","spread","visible"])||!["inner","outer"].includes(r.kind)||typeof r.color!="string"||!/^#[\da-f]{6}$/iu.test(r.color)||!k(r.opacity,0,1)||!k(r.x,-500,500)||!k(r.y,-500,500)||!k(r.blur,0,200)||r.spread!==0||typeof r.visible!="boolean")throw Error("阴影层需要 inner/outer、六位 RGB、0–1 透明度、±500px 偏移、0–200px 模糊、spread:0 与 visible 布尔值");return{kind:r.kind,color:r.color.toLowerCase(),opacity:r.opacity,x:r.x,y:r.y,blur:r.blur,spread:0,visible:r.visible}})}}function x(t){if(t.shadowStack===void 0)return;if(N(t.shadowStack),!["frame","rectangle","component"].includes(t.type)||t.shadow!==void 0)throw Error("shadowStack 只适用于 Frame/Rectangle/Component，且不能与旧 shadow 同时设置");let r=Y(t);if(r.some(e=>e>0)&&t.strokeAlign!=="inside")throw Error("CSS 阴影几何蒙版只支持 inside 边框；center/outside 描边暂不能作为 CSS 边缘");if(r.some(e=>e>0)&&S(t).some(e=>e>0))throw Error("带边框圆角的 CSS 阴影蒙版接合暂不能无损保留；请使用方角或移除边框，未近似内边缘曲线")}var Q=(t,r)=>(t.shadowStack?.layers??[]).filter(e=>e.visible&&e.opacity>0&&(!r||e.kind===r));var Y=t=>W(t).map(r=>t.strokeSides!==void 0||t.strokeAlign!==void 0||t.stroke!=="transparent"?r.width:0);var O=t=>Object.assign(Error(t),{code:"NATIVE_CSS_SHADOW_MASK"});function tt(t){if(!t.shadowStack)return;x(t);let r=Q(t,"inner");if(r.length&&(Y(t).some(e=>e>0)||t.fill==="transparent"||t.fillPaints?.some(e=>e.type!=="SOLID"||e.opacity!==1)))throw O("CSS 内阴影的透明/无填充或边框几何蒙版不能无损映射 Figma INNER_SHADOW；请保留 Panel/CSS 版本");if(new Set(r.map(e=>e.color)).size>1)throw O("多色 CSS 内阴影的原生可视顺序尚未验证；保留 Panel/CSS 完整层序");if(Q(t,"outer").length)throw O("CSS 外阴影几何蒙版暂不能无损映射 Figma painted-alpha DROP_SHADOW");return t.shadowStack.layers.map(e=>({type:e.kind==="inner"?"INNER_SHADOW":"DROP_SHADOW",color:{r:parseInt(e.color.slice(1,3),16)/255,g:parseInt(e.color.slice(3,5),16)/255,b:parseInt(e.color.slice(5,7),16)/255,a:e.opacity},offset:{x:e.x,y:e.y},radius:e.blur,spread:0,visible:e.visible,blendMode:"NORMAL"}))}var Ht=Object.freeze(["gridRows","gridColumnSizes","gridRowSizes","gridItemsPositioning","gridAutoTracks"]),jt=Object.freeze(["gridRowAnchorIndex","gridColumnAnchorIndex","gridChildHorizontalAlign","gridChildVerticalAlign"]);var rt=["top","right","bottom","left"],kt=["frame","component","rectangle","text"],et=t=>Number.isFinite(t)&&t>=0&&t<=100,z=t=>t&&typeof t=="object"&&!Array.isArray(t);function I(t,r){if(!z(t)||!Object.keys(t).some(e=>e!=="sourceOnly")||Object.keys(t).some(e=>!["strokeAlign","strokeWeight","individualStrokeWeights","strokesIncludedInLayout","strokesIncludedInLayoutDefault","sourceOnly"].includes(e)))throw Error("空描边样式包含未知字段或缺少来源样式");if(t.strokeAlign!==void 0&&!["INSIDE","CENTER","OUTSIDE"].includes(t.strokeAlign))throw Error("空描边对齐无效");if(t.strokeWeight!==void 0&&!et(t.strokeWeight))throw Error("空描边宽度必须为 0–100");if(t.individualStrokeWeights!==void 0&&(!z(t.individualStrokeWeights)||Object.keys(t.individualStrokeWeights).length!==4||!rt.every(e=>et(t.individualStrokeWeights[e]))))throw Error("空描边侧宽必须为完整的上右下左 0–100 数值");if(t.strokesIncludedInLayout!==void 0&&typeof t.strokesIncludedInLayout!="boolean")throw Error("空描边布局选择必须为布尔值");if(t.strokesIncludedInLayoutDefault!==void 0&&(t.strokesIncludedInLayoutDefault!==!1||t.strokesIncludedInLayout!==void 0))throw Error("空描边 REST 默认只支持独立保存的 false");if(t.sourceOnly!==void 0&&t.sourceOnly!==!0)throw Error("空描边 sourceOnly 只能为 true");if(t.individualStrokeWeights&&t.strokeWeight!==void 0&&rt.some(e=>t.individualStrokeWeights[e]!==t.strokeWeight)&&t.sourceOnly!==!0)throw Error("混合侧宽与标量宽度不一致，必须保留为仅来源样式");if(r&&(!kt.includes(r.type)||r.stroke!=="transparent"||r.strokeWidth!==0||r.strokeSides!==void 0||r.strokeAlign!==void 0||r.strokeLayoutExcluded!==void 0||t.individualStrokeWeights!==void 0&&r.type==="text"||(t.strokesIncludedInLayout!==void 0||t.strokesIncludedInLayoutDefault!==void 0)&&!["frame","component"].includes(r.type)))throw Error("空描边样式只适用于无描边绘制的 Frame/Component/Rectangle/Text");return Object.fromEntries(Object.entries(t).map(([e,o])=>[e,z(o)?{...o}:o]))}function P(t){let r=I(t.nativeStrokeInactive,t);if(r.sourceOnly)throw Error("此空描边包含尚不能原生重建的特殊样式；请保留来源绑定");let e=t.layoutReverse||t.layoutWrap==="wrap-reverse"||t.layout==="vertical"&&t.layoutWrap==="wrap";if((r.strokesIncludedInLayout!==void 0||r.strokesIncludedInLayoutDefault!==void 0)&&(e||!["horizontal","vertical","grid"].includes(t.layout)))throw Error("自由布局中的描边布局选择尚不能安全重建；请保留来源绑定，不猜测原生布局状态");return r}var Yt=Object.freeze(["top","right","bottom","left"]),it=t=>typeof t=="number"&&Number.isFinite(t),D=t=>typeof t=="string"&&/^#[a-f\d]{6}$/iu.test(t),xt=["frame","rectangle","component"],It=t=>["frame","component"].includes(t?.type)&&["horizontal","vertical"].includes(t.layout)&&t.strokeAlign==="inside";function G(t){if(!Array.isArray(t)||t.length!==4)throw new Error("strokeSides 必须为上右下左四项");return Array.from(t,r=>{if(!r||typeof r!="object"||Array.isArray(r)||Object.keys(r).some(e=>!["width","color","opacity"].includes(e))||!it(r.width)||r.width<0||r.width>100||!D(r.color)||!it(r.opacity)||r.opacity<0||r.opacity>1)throw new Error("边框只支持 0–100px、六位 RGB 与 0–1 透明度的有界实线侧边");return{width:r.width,color:r.color.toLowerCase(),opacity:r.opacity}})}function W(t){return t.strokeSides??Array.from({length:4},()=>({width:t.strokeWidth??0,color:D(t.stroke)?t.stroke:"#000000",opacity:D(t.stroke)?1:0}))}var Et=t=>t.every(r=>r.width===t[0].width&&(!r.width||r.opacity===t[0].opacity&&(!r.opacity||r.color===t[0].color)));function T(t){if(t.nativeStrokeInactive!==void 0&&I(t.nativeStrokeInactive,t),t.strokeLayoutExcluded!==void 0&&(t.strokeLayoutExcluded!==!0||!It(t)))throw new Error("strokeLayoutExcluded 只能为 true，且只适用于水平/垂直 Auto Layout Frame/Component 的 inside 描边");if(t.strokeAlign!==void 0&&!["inside","center","outside"].includes(t.strokeAlign))throw new Error("strokeAlign 只支持 inside/center/outside");let r=t.strokeSides===void 0?null:G(t.strokeSides);if((t.strokeSides!==void 0||t.strokeAlign!==void 0)&&!xt.includes(t.type))throw new Error("独立边框/对齐暂只适用于矩形与 Frame 表面");if(r&&!Et(r)&&S(t).some(e=>e>0))throw new Error("不同侧边的圆角接合暂不能无损保留；请使用方角或统一边框");if(r?.some((e,o)=>e.width>0&&r[(o+1)%4].width>0&&e.opacity!==r[(o+1)%4].opacity))throw new Error("相接侧边的不同透明度暂不能保留；请使用相同透明度或不相接的侧边")}var ot=t=>t.strokeSides!==void 0||t.strokeAlign!==void 0;function nt(t){T(t);let r=W(t),e=r.filter(s=>s.width>0),o=e[0]??{color:"#000000",opacity:0};if(e.some(s=>(s.opacity||o.opacity)&&(s.color!==o.color||s.opacity!==o.opacity)))throw new Error("Figma 原生侧边只支持同一颜色/透明度；多色边框请保留 v3 源文档，不能无损导出");return{align:(t.strokeAlign??"center").toUpperCase(),weights:r.map(s=>s.width),paint:{type:"SOLID",color:Object.fromEntries(["r","g","b"].map((s,i)=>[s,parseInt(o.color.slice(1+i*2,3+i*2),16)/255])),opacity:o.opacity}}}var f=(t="")=>{let r=new Error(`原生 fill 图片需要可验证的 PNG/JPEG/GIF 字节尺寸${t?`：${t}`:""}`);throw r.code="NATIVE_IMAGE_FILL",r};function At(t){if(!(t instanceof Uint8Array)||t.length<10||t.length>8*1024*1024)return f();let r=new DataView(t.buffer,t.byteOffset,t.byteLength),e=(i,n=!1)=>r.getUint16(i,n),o=(i,n)=>String.fromCharCode(...t.subarray(i,i+n)),s=(i,n)=>!Number.isInteger(i)||!Number.isInteger(n)||i<1||n<1||i>32768||n>32768||i*n>16777216?f():{width:i,height:n};if(o(0,8)===`PNG\r

`){if(t.length<45||r.getUint32(8)!==13||o(12,4)!=="IHDR"||!{0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]}[t[25]]?.includes(t[24])||t[26]!==0||t[27]!==0||![0,1].includes(t[28]))return f();let n=8,a=!1;for(let l=0;l<4096&&n+12<=t.length;l++){let c=r.getUint32(n),d=o(n+4,4);if(c>t.length-n-12||!/^[A-Za-z]{4}$/u.test(d)||d==="IHDR"&&n!==8)return f();if(d==="eXIf")return f("EXIF 方向对原生解码尺寸的影响尚未证明");if(d==="IDAT"&&c>0&&(a=!0),d==="IEND")return c!==0||n+12!==t.length||!a?f():s(r.getUint32(16),r.getUint32(20));n+=c+12}return f()}if(["GIF87a","GIF89a"].includes(o(0,6))){if(t.length<14||t[12]!==0)return f("GIF 像素宽高比元数据尚未证明");let i=13+(t[10]&128?3*2**((t[10]&7)+1):0),n=!1,a=()=>{for(let l=0;l<t.length&&i<t.length;l++){let c=t[i++];if(!c)return;if(i+c>t.length)return f();i+=c}return f()};for(let l=0;l<4096&&i<t.length;l++){let c=t[i++];if(c===59)return n&&i===t.length?s(e(6,!0),e(8,!0)):f();if(c===33){if(i>=t.length)return f();i++,a()}else if(c===44){if(i+10>t.length)return f();let d=t[i+8];if(!e(i+4,!0)||!e(i+6,!0)||e(i,!0)+e(i+4,!0)>e(6,!0)||e(i+2,!0)+e(i+6,!0)>e(8,!0)||(i+=9+(d&128?3*2**((d&7)+1):0),i>=t.length||t[i]<2||t[i]>8))return f();i++,a(),n=!0}else return f()}return f()}if(t[0]===255&&t[1]===216&&t.at(-2)===255&&t.at(-1)===217){let i=2,n;for(let a=0;a<4096&&i+3<t.length;a++){if(t[i++]!==255)return f();for(;t[i]===255;)i++;let l=t[i++];if(i+2>t.length||[0,216,217].includes(l))return f();let c=e(i);if(c<2||c>t.length-i)return f();if(l===225)return f("JPEG APP1/EXIF 方向对原生解码尺寸的影响尚未证明");if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(l)){if(c<11||![1,3,4].includes(t[i+7])||c!==8+3*t[i+7]||n)return f();n=s(e(i+5),e(i+3))}if(l===218)return n&&i+c<t.length-2?n:f();i+=c}}return f()}function st(t,r){if(t.type!=="image"||t.objectFit!=="fill")return;let e=At(r);if(!Number.isFinite(t.width)||!Number.isFinite(t.height)||t.width<=0||t.height<=0||t.width*e.height!==t.height*e.width){let o=new Error("object-fit:fill 的图像与内容框宽高比不同；原生 FILL 会裁剪，已拒绝而未改为 cover");throw o.code="NATIVE_IMAGE_FILL",o}}return ht($t);})();
/* END GENERATED PAINT RUNTIME */
/* BEGIN GENERATED TEXT RUNTIME */
"use strict";var CodeShellFigmaText=(()=>{var ke=Object.defineProperty;var Kt=Object.getOwnPropertyDescriptor;var qt=Object.getOwnPropertyNames;var Zt=Object.prototype.hasOwnProperty;var Qt=(e,t)=>{for(var n in t)ke(e,n,{get:t[n],enumerable:!0})},en=(e,t,n,r)=>{if(t&&typeof t=="object"||typeof t=="function")for(let s of qt(t))!Zt.call(e,s)&&s!==n&&ke(e,s,{get:()=>t[s],enumerable:!(r=Kt(t,s))||r.enumerable});return e};var tn=e=>en(ke({},"__esModule",{value:!0}),e);var Hn={};Qt(Hn,{applyCreatedNativeTextRanges:()=>Tt,assertNativeTextRangeBoundary:()=>ht,createNativeTextExportCapture:()=>Yt,finalizeCreatedNativeTextRanges:()=>kt,nativeTextContent:()=>Ue,nativeTextLineHeight:()=>K,nativeTextPlan:()=>pt,nativeTextRangeCreationPlan:()=>_e,validTextLineHeight:()=>J,validateTextRanges:()=>k});function J(e){return Number.isFinite(e.lineHeight)?e.lineHeightUnit===void 0?e.lineHeight>=.7&&e.lineHeight<=3:e.lineHeightUnit==="pixels"&&e.lineHeight>=4.2&&e.lineHeight<=720:!1}function K(e){if(!J(e))throw Error("文字行高或单位无效。");return e.lineHeightUnit==="pixels"?{unit:"PIXELS",value:e.lineHeight}:{unit:"PERCENT",value:e.lineHeight*100}}var Te=["fill","textDecoration","textDecorationThickness","textUnderlineOffset","textDecorationSkipInk","href"],at=e=>e!==null&&typeof e=="object"&&[Object.prototype,null].includes(Object.getPrototypeOf(e)),O=(e,t="TEXT_RANGES_INVALID")=>{let n=new Error(e);throw n.code=t,n},ye=(e,t)=>Object.hasOwn(e,t),Ee=(e,t)=>at(e)&&Object.keys(e).every(n=>t.includes(n));function st(e){let t=JSON.stringify(e),n=0;for(let r=0;r<t.length;r++){let s=t.charCodeAt(r);n+=s<128?1:s<2048?2:Ge(s)&&Ne(t.charCodeAt(r+1))?(r++,4):3}return n}function Me(e,t=new Set,n=0){if(e===null||typeof e!="object")return e;(n>64||t.has(e)||!Array.isArray(e)&&!at(e))&&O("文字编辑仅接受有界无环纯数据"),t.add(e);let r=Array.isArray(e)?e.map(s=>Me(s,t,n+1)):Object.fromEntries(Object.entries(e).map(([s,i])=>[s,Me(i,t,n+1)]));return t.delete(e),r}var Ge=e=>e>=55296&&e<=56319,Ne=e=>e>=56320&&e<=57343;function ne(e){if(typeof e!="string"||e.length>4e3)return!1;for(let t=0;t<e.length;t++){let n=e.charCodeAt(t);if(Ge(n)){if(!Ne(e.charCodeAt(++t)))return!1}else if(Ne(n))return!1}return!0}function ot(e,t){return Number.isInteger(t)&&t>=0&&t<=e.length&&!(t>0&&t<e.length&&Ge(e.charCodeAt(t-1))&&Ne(e.charCodeAt(t)))}function re(e){return ne(e)||O("范围文字必须是最多4000个 UTF16 单元的完整 Unicode 字符串"),JSON.stringify([e])}var ct=e=>typeof e.textSource=="string"?e.textSource:e.text,nn=(e,t)=>JSON.stringify(e)===JSON.stringify(t),Ve=e=>Object.fromEntries(Te.filter(t=>ye(e,t)).map(t=>[t,Me(e[t])]));function rn(e,t,n){if(Ee(e,["unit","value"])||O("文字装饰长度包含未知字段"),e.unit==="auto")return ye(e,"value")&&O("auto 装饰长度不能包含数值"),{unit:"auto"};let r=e.unit==="em"?10:e.unit==="px"?100:NaN,s=e.value,i=e.unit==="em"?s*t:s;return(!Number.isFinite(r)||typeof s!="number"||!Number.isFinite(s)||Math.abs(s)>r||n&&s<=0||!Number.isFinite(i)||Math.abs(i)>100)&&O("文字装饰长度超出有限 px/em 范围"),{unit:e.unit,value:s}}function fe(e){if(typeof e!="string"||!e||e.length>2048||/[\u0000-\u0020\u007f]/u.test(e[0])||/[\u0000-\u0020\u007f]/u.test(e.at(-1))||/[\u0000-\u001f\u007f]/u.test(e)||!ne(e))return!1;if(e.startsWith("#")||/^(?:mailto|tel):[^\s\\]+$/iu.test(e))return!0;let t=/^https?:\/\/([^/?#]+)(?:[/?#][^\\]*)?$/iu.exec(e);if(!t||/\s|\\/u.test(e))return!1;let n=/^(\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([0-9]+))?$/iu.exec(t[1]);return!!(n&&!n[1].includes("..")&&(!n[2]||Number(n[2])<=65535))}function sn(e,t){Ee(e,Te)||O("文字范围样式包含未知字段");let n={};for(let r of Te){if(!ye(e,r))continue;let s=e[r];r==="fill"?((typeof s!="string"||!/^#[0-9a-f]{6}$/iu.test(s))&&O("文字范围填色必须是不透明六位十六进制颜色"),n.fill=s.toLowerCase()):r==="textDecoration"?(["none","underline","line-through"].includes(s)||O("文字范围装饰无效"),n[r]=s):r==="textDecorationThickness"||r==="textUnderlineOffset"?n[r]=rn(s,t,r==="textDecorationThickness"):r==="textDecorationSkipInk"?(["auto","none"].includes(s)||O("文字范围 skip-ink 无效"),n[r]=s):(fe(s)||O("文字范围链接目标无效"),n.href=s)}return["textDecorationThickness","textUnderlineOffset","textDecorationSkipInk"].some(r=>ye(n,r))&&n.textDecoration!=="underline"&&O("范围下划线参数需要同一范围显式 underline"),n}function on(e){let t=[];for(let n of e){let r=Ve(n);if(!Object.keys(r).length)continue;let s=t.at(-1);s?.end===n.start&&nn(Ve(s),r)?s.end=n.end:t.push({start:n.start,end:n.end,...r})}return t}function lt(e){if(e?.textRanges===void 0)return;e.type!=="text"&&O("textRanges 仅用于文字图层");let t=ct(e),n=e.textRanges;(!ne(t)||!ne(e.text))&&O("范围文字来源或显示内容无效"),(!Ee(n,["version","sourceSignature","ranges"])||n.version!==1||typeof n.sourceSignature!="string"||n.sourceSignature.length>24004||!Array.isArray(n.ranges)||n.ranges.length>64||st(n)>32768)&&O("textRanges 版本、字段或预算无效"),n.sourceSignature!==re(t)&&O("textRanges 与当前完整文字来源签名不一致","TEXT_RANGES_STALE"),e.textOverflow!==void 0&&O("范围文字暂不支持截断","TEXT_RANGES_UNSUPPORTED_TRUNCATION"),e.fillPaints!==void 0&&n.ranges.length&&O("范围文字暂不支持基础 paint stack；请先显式选择纯色","TEXT_RANGES_UNSUPPORTED_BASE_PAINT");let r=0,s=Array.from(n.ranges,(o,a)=>((!Ee(o,["start","end",...Te])||!ot(t,o.start)||!ot(t,o.end)||o.start>=o.end||a>0&&o.start<r)&&O("文字范围必须排序、不重叠并位于 UTF16 字符边界"),r=o.end,{start:o.start,end:o.end,...sn(Ve(o),e.fontSize)})),i={version:1,sourceSignature:n.sourceSignature,ranges:on(s)};return st(i)>32768&&O("textRanges 超出字节预算"),i.ranges.length?i:void 0}function ft(e){let t=ct(e),n=e.text;(!ne(t)||!ne(n))&&O("范围文字来源或显示内容无效");let r=[],s=0,i=0;for(;i<n.length;){let o=String.fromCodePoint(n.codePointAt(i));if(t.startsWith(o,s)){let a=r.at(-1);a?.kind==="source"&&a.sourceEnd===s&&a.displayEnd===i?(a.sourceEnd+=o.length,a.displayEnd+=o.length):r.push({kind:"source",sourceStart:s,sourceEnd:s+o.length,displayStart:i,displayEnd:i+o.length}),s+=o.length}else o===`
`&&e.textFlow==="wrap"?r.push({kind:"soft-break",sourceOffset:s,displayStart:i,displayEnd:i+1}):O("范围显示文字必须保留每个来源字符；仅允许添加软换行","TEXT_RANGES_DISPLAY_MISMATCH");i+=o.length}return s!==t.length&&O("范围显示文字丢失来源字符","TEXT_RANGES_DISPLAY_MISMATCH"),{sourceText:t,displayText:n,sourceSignature:re(t),segments:r}}function k(e){let t=lt(e);return e?.textRanges!==void 0&&ft(e),t}function xe(e){return lt(e),ft(e)}function ut(e){return!!(e&&typeof e=="object"&&!Array.isArray(e)&&Object.keys(e).every(t=>["version","signature","sourceSignature","lineWidths","lineInkBounds","height","fontAvailable"].includes(t))&&e.version===1&&typeof e.signature=="string"&&e.signature.length<=8500&&(e.sourceSignature===void 0||typeof e.sourceSignature=="string"&&e.sourceSignature.length<=8500)&&Array.isArray(e.lineWidths)&&e.lineWidths.length>=1&&e.lineWidths.length<=4001&&e.lineWidths.every(t=>Number.isFinite(t)&&t>=0&&t<=1e6)&&Array.isArray(e.lineInkBounds)&&e.lineInkBounds.length===e.lineWidths.length&&e.lineInkBounds.every(t=>t&&typeof t=="object"&&!Array.isArray(t)&&Object.keys(t).length===4&&["x","y","width","height"].every(n=>Number.isFinite(t[n])&&Math.abs(t[n])<=1e6)&&t.width>=0&&t.height>=0)&&Number.isFinite(e.height)&&e.height>=0&&e.height<=1e6&&typeof e.fontAvailable=="boolean")}var gt=e=>{try{let t=JSON.parse(e);return Array.isArray(t)&&(t.length===8||t.length===9&&t[8]==="pixels")&&typeof t[0]=="string"?t[0]:void 0}catch{return}};function an(e,t){let n=0;for(let r of e)if(t.startsWith(r,n))n+=r.length;else if(r!==`
`)return!1;return n===t.length}function Ue(e,t){if(e.textRanges!==void 0)return k(e),xe(e).sourceText;let n=e.text??"",r=e.textSource;if(typeof r!="string"||n===r)return n;if(ut(e.textMetrics)){let s=gt(e.textMetrics.signature),i=gt(e.textMetrics.sourceSignature);if(n===s)return r;if(s!==void 0&&(i===void 0||r===i))return n}return t&&n===t.text&&r!==t.textSource||e.textFlow==="wrap"&&an(n,r)||e.textOverflow==="ellipsis"&&n.endsWith("…")&&r.startsWith(n.slice(0,-1).trimEnd())?r:n}function pt(e,t){return{characters:Ue(e,t),autoResize:e.layoutSizingHorizontal==="hug"?"WIDTH_AND_HEIGHT":e.layoutSizingVertical==="hug"?"HEIGHT":"NONE",truncation:e.textOverflow==="ellipsis"?"ENDING":"DISABLED",maxLines:e.textOverflow==="ellipsis"?1:null}}var rr=129,Ae=["textDecorationThickness","textUnderlineOffset","textDecorationSkipInk"],ue=(e,t)=>Object.hasOwn(e,t),dt=new WeakSet,C=(e,t)=>{let n=new Error(t);throw n.code=e,dt.add(n),n},Se="Native range planning requires a valid complete content-bound Text source.",ln=new Set(["TEXT_RANGES_INVALID","TEXT_RANGES_STALE","TEXT_RANGES_DISPLAY_MISMATCH","TEXT_RANGES_UNSUPPORTED_TRUNCATION","TEXT_RANGES_UNSUPPORTED_BASE_PAINT"]),fn=["type","text","textSource","textFlow","textRanges","fill","fillPaints","textDecoration",...Ae,"textOverflow","fontSize"];function un(e){let t=()=>C("TEXT_RANGES_NATIVE_INVALID_SOURCE",Se),n=f=>f!==null&&typeof f=="object"&&!Array.isArray(f)&&[Object.prototype,null].includes(Object.getPrototypeOf(f));n(e)||C("TEXT_RANGES_NATIVE_INVALID_NODE","Native range planning requires a canonical Text node.");let r=0,s=0,i=f=>{for(let h of JSON.stringify(f)){let d=h.codePointAt(0);s+=d<128?1:d<2048?2:d<65536?3:4}s>96*1024&&t()},o=(f,h=new Set,d=0)=>{if((++r>2048||d>8)&&t(),f===null||typeof f=="boolean"||typeof f=="number"&&Number.isFinite(f))return i(f),f;if(typeof f=="string")return f.length>32768&&t(),i(f),f;let N=Array.isArray(f);(!N&&!n(f)||h.has(f))&&t();let l=Object.getOwnPropertyDescriptors(f),T=Reflect.ownKeys(l),m=N?l.length?.value:void 0;(T.some(y=>typeof y!="string")||N&&(!Number.isInteger(m)||m>64))&&t();let S=N?T.filter(y=>y!=="length"):T;(S.length>16&&!N||N&&(S.length!==m||S.some((y,x)=>y!==String(x))))&&t(),h.add(f);let g=N?[]:{};for(let y of S){let x=l[y];(!ue(x,"value")||!x.enumerable)&&t(),i(y),Object.defineProperty(g,y,{value:o(x.value,h,d+1),enumerable:!0,writable:!0,configurable:!0})}return h.delete(f),g},a=Object.getOwnPropertyDescriptors(e),c={};for(let f of fn){if(!ue(a,f))continue;let h=a[f];(!ue(h,"value")||!h.enumerable)&&t(),Ae.includes(f)&&C("TEXT_RANGES_NATIVE_UNSUPPORTED_DECORATION","Native range planning currently supports no text decoration or CSS underline geometry."),f==="fillPaints"&&h.value!==void 0&&C("TEXT_RANGES_NATIVE_UNSUPPORTED_PAINT","Native text range planning supports one opaque hex base fill only."),h.value!==void 0&&(c[f]=o(h.value))}return c}function gn(e){try{return{ranges:k(e)?.ranges??[],characters:xe(e).sourceText}}catch(t){let n;try{n=t&&typeof t=="object"?Object.getOwnPropertyDescriptor(t,"code")?.value:void 0}catch{}C(ln.has(n)?n:"TEXT_RANGES_NATIVE_INVALID_SOURCE",Se)}}function pn(e){let t=()=>C("TEXT_RANGES_NATIVE_UNSUPPORTED_LINK","Native range links support conservative absolute HTTP(S) URLs and bare ASCII mailto addresses only.");if(fe(e)||t(),/^https?:\/\//iu.test(e)){let s=/^https?:\/\/([^/?#]+)/iu.exec(e)[1].replace(/:[0-9]+$/u,""),i=s.split(".");return(s.length>253||i.some(o=>!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(o)))&&t(),/^(?:[0-9]+|0x[0-9a-f]*)$/iu.test(i.at(-1))&&!(i.length===4&&i.every(o=>/^(?:0|[1-9][0-9]{0,2})$/u.test(o)&&Number(o)<=255))&&t(),{type:"URL",value:e}}let n=/^mailto:([a-z0-9_+.-]{1,64})@([a-z0-9.-]{1,253})$/iu.exec(e);return(!n||n[1].startsWith(".")||n[1].endsWith(".")||n[1].includes("..")||n[2].split(".").length<2||n[2].split(".").some(r=>!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(r)))&&t(),{type:"URL",value:e}}function dn(e){(!e||typeof e!="object"||Array.isArray(e)||e.type!=="text")&&C("TEXT_RANGES_NATIVE_INVALID_NODE","Native range planning requires a canonical Text node."),e.textSource!==void 0&&typeof e.textSource!="string"&&C("TEXT_RANGES_NATIVE_INVALID_SOURCE",Se),(typeof e.fill!="string"||!/^#[0-9a-f]{6}$/iu.test(e.fill)||e.fillPaints!==void 0)&&C("TEXT_RANGES_NATIVE_UNSUPPORTED_PAINT","Native text range planning supports one opaque hex base fill only."),(e.textDecoration!==void 0&&e.textDecoration!=="none"||Ae.some(o=>ue(e,o)))&&C("TEXT_RANGES_NATIVE_UNSUPPORTED_DECORATION","Native range planning currently supports no text decoration or CSS underline geometry."),e.textOverflow!==void 0&&C("TEXT_RANGES_UNSUPPORTED_TRUNCATION","Native range planning does not support truncated text.");let{characters:t,ranges:n}=gn(e),r=e.fill.toLowerCase(),s=[],i=0;for(let o of n)(o.textDecoration!==void 0&&o.textDecoration!=="none"||Ae.some(a=>ue(o,a)))&&C("TEXT_RANGES_NATIVE_UNSUPPORTED_DECORATION","Native range planning currently supports no text decoration or CSS underline geometry."),i<o.start&&s.push({start:i,end:o.start,fill:r,hyperlink:null}),s.push({start:o.start,end:o.end,fill:o.fill??r,hyperlink:o.href===void 0?null:pn(o.href)}),i=o.end;return i<t.length&&s.push({start:i,end:t.length,fill:r,hyperlink:null}),{characters:t,runs:s}}function q(e){try{return dn(un(e))}catch(t){if(t!==null&&typeof t=="object"&&dt.has(t))throw t;C("TEXT_RANGES_NATIVE_INVALID_SOURCE",Se)}}function ht(e){if(e?.textRanges===void 0)return;let t=(typeof e.name=="string"?e.name:typeof e.id=="string"?e.id:"Text").slice(0,120),n=new Error(t+"：范围文字的此项原生互转尚未完成验证；已阻止互转，未丢弃范围样式。");throw n.code="TEXT_RANGES_NATIVE_UNSUPPORTED",n}function _e(e){if(e?.textRanges!==void 0)try{return q(e)}catch(t){let n={TEXT_RANGES_NATIVE_UNSUPPORTED_LINK:"范围文字的原生链接目前只支持完整 HTTP(S) 地址和简单 mailto 地址",TEXT_RANGES_NATIVE_UNSUPPORTED_DECORATION:"范围文字的原生装饰仍待验证；请先移除下划线和删除线",TEXT_RANGES_NATIVE_UNSUPPORTED_PAINT:"范围文字的原生填充目前只支持不透明纯色"},r=typeof t?.code=="string"?t.code:"TEXT_RANGES_NATIVE_INVALID_SOURCE",s=new Error(n[r]??"范围文字的完整来源或区间无效，已阻止创建副本");throw s.code=r,s}}function Tt(e,t){let n=_e(t);if(!n)return;let r=["setRangeHyperlink","setRangeFills","setRangeTextDecoration"];if(e?.type!=="TEXT"||e.characters!==n.characters||r.some(a=>typeof e[a]!="function")){let a=new Error("范围文字的原生写入能力或完整来源不匹配，已阻止创建副本");throw a.code="TEXT_RANGES_NATIVE_WRITE_UNAVAILABLE",a}let[s,i,o]=r.map(a=>e[a]);for(let a of n.runs){s.call(e,a.start,a.end,a.hyperlink);let c=[1,3,5].map(f=>parseInt(a.fill.slice(f,f+2),16)/255);i.call(e,a.start,a.end,[{type:"SOLID",color:{r:c[0],g:c[1],b:c[2]}}]),o.call(e,a.start,a.end,"NONE")}return n}var hn=Object.freeze(["textDecoration","textDecorationStyle","textDecorationOffset","textDecorationThickness","textDecorationColor","textDecorationSkipInk","hyperlink"]),me=(e,t)=>Object.prototype.hasOwnProperty.call(e,t),ge=e=>{try{let t=e&&typeof e=="object"?Object.getOwnPropertyDescriptor(e,"message"):void 0;return t&&me(t,"value")&&typeof t.value=="string"?t.value.slice(0,240):"Native getter failed"}catch{return"Native getter failed"}},$=e=>{throw new Error(e)},Et=new WeakSet,yt=e=>e!==null&&typeof e=="object"&&Et.has(e),pe=e=>{let t=new Error(e);throw Et.add(t),t};function je(e){let t=0;for(let n of e){let r=n.codePointAt(0);t+=r<128?1:r<2048?2:r<65536?3:4}return t}function Nt(e,t,{fields:n,scalarFields:r=[]}={}){let s=[],i=(l,T)=>({status:"unsupported",diagnostics:[...s,{code:l,message:T}]});if(!e||e.type!=="TEXT")return i("NATIVE_TEXT_CAPTURE_TYPE","Native source must be TEXT");if(typeof t!="symbol")return i("NATIVE_TEXT_CAPTURE_MIXED","Native mixed identity is unavailable");if(!Array.isArray(n)||!n.length||n.length>64||!Array.isArray(r)||r.length>64||[...n,...r].some(l=>typeof l!="string"||!/^[a-zA-Z][a-zA-Z0-9]*$/u.test(l))||new Set(n).size!==n.length||new Set(r).size!==r.length)return i("NATIVE_TEXT_CAPTURE_FIELDS","Native field catalog is invalid");let o;try{o=e.characters}catch(l){return i("NATIVE_TEXT_CAPTURE_CHARACTERS",ge(l))}if(typeof o!="string"||o.length>4e3)return i("NATIVE_TEXT_CAPTURE_BUDGET","Native text exceeds the complete 4000 UTF16 source budget");let a=0,c=0,f=l=>{(c+=l)>262144&&pe("Complete native observations exceed 256 KiB")},h=(l,T=new Set,m=0)=>{if((++a>4e4||m>12)&&pe("Native observation exceeds its data budget"),l===null||typeof l=="boolean")return f(l===null||l?4:5),l;if(typeof l=="number")return Number.isFinite(l)||$("Nonfinite native number"),f(String(l).length),l;if(typeof l=="string")return l.length>262144&&pe("Native string exceeds its data budget"),f(je(JSON.stringify(l))),l;(typeof l!="object"||l===t)&&$("Unsupported native host value"),T.has(l)&&$("Cyclic native observation");let S=Array.isArray(l),g=Object.getPrototypeOf(l);!S&&g!==Object.prototype&&g!==null&&$("Unsupported native object prototype");let y=Object.getOwnPropertyDescriptors(l),x=Reflect.ownKeys(y);x.some(u=>typeof u!="string")&&$("Native symbol key is not JSON data"),S&&(!Number.isInteger(l.length)||l.length>1024)&&pe("Native array exceeds its data budget");let _=S?x.filter(u=>u!=="length"):x;_.length>512&&pe("Native object exceeds its data budget"),S&&_.length!==l.length&&$("Native object is sparse"),S&&_.some((u,p)=>u!==String(p))&&$("Native array has extra properties"),T.add(l),f(2);let A=S?[]:{};for(let u of _){let p=y[u];(!me(p,"value")||!p.enumerable)&&$("Native observation has an accessor or hidden field"),f((S?0:je(JSON.stringify(u))+1)+1),Object.defineProperty(A,u,{value:h(p.value,T,m+1),enumerable:!0,configurable:!0,writable:!0})}return T.delete(l),A},d=l=>{try{let T=l();return T===t?{kind:"mixed"}:T===void 0?{kind:"missing"}:{kind:"value",value:h(T)}}catch(T){if(yt(T))throw T;return{kind:"error",message:ge(T)}}},N=()=>{let l={};for(let u of new Set([...n,...r]))l[u]=d(()=>e[u]);let T;try{T=e.getStyledTextSegments([...n])}catch(u){return i("NATIVE_TEXT_CAPTURE_SEGMENTS",ge(u))}if(!Array.isArray(T)||T.length>256)return i("NATIVE_TEXT_CAPTURE_BUDGET","Native segments exceed their complete source budget");let m=Object.getOwnPropertyDescriptors(T),S=Reflect.ownKeys(m);if(S.some(u=>typeof u!="string"||u!=="length"&&!/^(0|[1-9][0-9]*)$/u.test(u))||S.length!==T.length+1)return i("NATIVE_TEXT_CAPTURE_SEGMENTS","Native segment array is not dense owned data");let g=[],y=[],x=0;for(let u=0;u<T.length;u++){let p=m[String(u)];if(!p||!me(p,"value")||!p.enumerable)return i("NATIVE_TEXT_CAPTURE_SEGMENTS","Native segment entry is not owned data");let I=p.value;if(!I||typeof I!="object"||Array.isArray(I)||![Object.prototype,null].includes(Object.getPrototypeOf(I)))return i("NATIVE_TEXT_CAPTURE_SEGMENTS","Native segment is not a plain record");let b=Object.getOwnPropertyDescriptors(I);if(Reflect.ownKeys(b).some(j=>typeof j!="string"||!me(b[j],"value")||!b[j].enumerable))return i("NATIVE_TEXT_CAPTURE_SEGMENTS","Native segment contains accessors or hidden data");let w=b.start?.value,X=b.end?.value,tt=b.characters?.value;if(!Number.isInteger(w)||!Number.isInteger(X)||w!==x||X<=w||X>o.length||tt!==o.slice(w,X)||w>0&&/[\uD800-\uDBFF]/u.test(o[w-1])&&/[\uDC00-\uDFFF]/u.test(o[w])||X<o.length&&/[\uD800-\uDBFF]/u.test(o[X-1])&&/[\uDC00-\uDFFF]/u.test(o[X]))return i("NATIVE_TEXT_CAPTURE_SEGMENTS","Native segments do not cover exact UTF16 source boundaries");let nt={},rt={};for(let j of n)nt[j]=d(()=>b[j]?.value);for(let j of hn){let Jt=`getRange${j[0].toUpperCase()}${j.slice(1)}`;rt[j]=d(()=>{let it=e[Jt];return typeof it=="function"?it.call(e,w,X):void 0})}g.push({start:w,end:X,characters:tt,values:nt}),y.push({start:w,end:X,values:rt}),x=X}if(x!==o.length)return i("NATIVE_TEXT_CAPTURE_SEGMENTS","Native segments leave an uncaptured source suffix");let _;try{_=e.characters}catch(u){return i("NATIVE_TEXT_CAPTURE_CHARACTERS",ge(u))}if(_!==o)return i("NATIVE_TEXT_CAPTURE_RACE","Native characters changed during source capture");let A={characters:o,scalars:l,segments:g,rangeChecks:y};return je(JSON.stringify(A))>262144?i("NATIVE_TEXT_CAPTURE_BUDGET","Complete native source exceeds 256 KiB"):{status:"captured",observations:A,diagnostics:s}};try{return N()}catch(l){return i(yt(l)?"NATIVE_TEXT_CAPTURE_BUDGET":"NATIVE_TEXT_CAPTURE_DATA",ge(l))}}var ee=256*1024,Tn=256,yn=256,z=Object.freeze(["fontName","fontSize","fontWeight","fontStyle","lineHeight","letterSpacing","fills","textDecoration","textDecorationStyle","textDecorationOffset","textDecorationThickness","textDecorationColor","textDecorationSkipInk","hyperlink","textCase","openTypeFeatures","textStyleId","fillStyleId","listOptions","listSpacing","indentation","paragraphIndent","paragraphSpacing","textStyleOverrides","boundVariables","textWrapStyle"]),se=Object.freeze(["hasMissingFont","textTruncation","maxLines","leadingTrim","hangingPunctuation","hangingList","textAlignHorizontal","textAlignVertical","textAutoResize","layoutSizingHorizontal","layoutSizingVertical"]),xt=["id","type","characters","style","characterStyleOverrides","styleOverrideTable","fills","lineTypes","lineIndentations","textTruncation","maxLines","textAutoResize","layoutSizingHorizontal","layoutSizingVertical","hasMissingFont","leadingTrim","hangingPunctuation","hangingList"],v=(e,t)=>Object.hasOwn(e,t),Z=(e,t,n)=>v(e,t)?e[t]:n,D=e=>e!==null&&typeof e=="object"&&[Object.prototype,null].includes(Object.getPrototypeOf(e)),Q=(e,t,n={})=>({code:e,message:t,...n}),E=(e,t="NATIVE_TEXT_RANGES_INVALID")=>{let n=new Error(e);throw n.code=t,n},M=(e,t)=>D(e)&&Object.keys(e).every(n=>t.includes(n)),B=(e,t)=>ie(e)===ie(t);function At(e){let t=0;for(let n=0;n<e.length;n++){let r=e.charCodeAt(n);t+=r<128?1:r<2048?2:r>=55296&&r<=56319&&e.charCodeAt(n+1)>=56320&&e.charCodeAt(n+1)<=57343?(n++,4):3}return t}function oe(e,t={size:0,seen:new Set},n=0){n>12&&E("Native text source exceeds depth12","NATIVE_TEXT_RANGES_BUDGET");let r=a=>{(t.size+=a)>ee&&E("Native text source exceeds256KiB","NATIVE_TEXT_RANGES_BUDGET")};if(e===null||typeof e=="boolean")return r(e===null||e?4:5),e;if(typeof e=="string")return r(At(JSON.stringify(e))),e;if(typeof e=="number"&&Number.isFinite(e))return r(String(e).length),e;(!Array.isArray(e)&&!D(e)||t.seen.has(e))&&E("Native text source must be acyclic plain JSON"),t.seen.add(e),r(2),Array.isArray(e)&&e.length*2+1>ee&&E("Native array exceeds minimum JSON byte budget","NATIVE_TEXT_RANGES_BUDGET");let s=Object.getOwnPropertyDescriptors(e),i=[];Reflect.ownKeys(e).some(a=>typeof a!="string")&&E("Native text source contains symbol keys"),Array.isArray(e)&&e.length>ee&&E("Native array exceeds budget","NATIVE_TEXT_RANGES_BUDGET");let o=Array.isArray(e)?Array.from({length:e.length},(a,c)=>String(c)):Object.keys(s);if(Array.isArray(e)){let a=new Set(o);Object.keys(s).some(c=>c!=="length"&&!a.has(c))&&E("Native text source array is not JSON")}for(let a of o){let c=s[a];(!c||!v(c,"value")||!c.enumerable)&&E("Native text source contains holes or accessors"),r((Array.isArray(e)?0:At(JSON.stringify(a))+1)+(i.length?1:0)),i.push([a,oe(c.value,t,n+1)])}return t.seen.delete(e),Array.isArray(e)?i.map(a=>a[1]):Object.fromEntries(i)}function ie(e){return e===null||typeof e!="object"?JSON.stringify(e):Array.isArray(e)?`[${e.map(ie).join(",")}]`:`{${Object.keys(e).sort().map(t=>`${JSON.stringify(t)}:${ie(e[t])}`).join(",")}}`}function _t(e){D(e)||E("Native source must be plain JSON"),["type","id","characters"].some(n=>{let r=Object.getOwnPropertyDescriptor(e,n);return r&&!v(r,"value")})&&E("REST source contains accessors"),(e.type!=="TEXT"||typeof e.id!="string"||!e.id||e.id.length>160)&&E("Native source is not an identified TEXT");let t=Object.getOwnPropertyDescriptors(e);return xt.some(n=>v(t,n)&&!v(t[n],"value"))&&E("REST source contains accessors"),re(e.characters),ie(oe(Object.fromEntries(xt.filter(n=>v(e,n)).map(n=>[n,e[n]]))))}function En(e){D(e)||E("Native observation must have an explicit kind"),!(e.kind==="value"&&M(e,["kind","value"])&&v(e,"value"))&&(["mixed","missing"].includes(e.kind)&&M(e,["kind"])||e.kind==="error"&&M(e,["kind","message"])&&typeof e.message=="string"&&e.message.length<=2e3||E("Malformed native observation"))}function He(e,t=!1){M(e,t?[...z,...se]:z)||E("Unknown native observation field");for(let n of Object.values(e))En(n)}var Ie=(e,t)=>Number.isInteger(t)&&t>=0&&t<=e.length&&!(t>0&&t<e.length&&/[\ud800-\udbff]/u.test(e[t-1])&&/[\udc00-\udfff]/u.test(e[t]));function mt(e){(!M(e,["version","nodeId","characters","restSignature","scalars","segments","rangeChecks"])||e.version!==1||typeof e.nodeId!="string"||typeof e.restSignature!="string")&&E("Malformed native text source version"),re(e.characters),He(e.scalars,!0),(!Array.isArray(e.segments)||e.segments.length>Tn||!Array.isArray(e.rangeChecks)||e.rangeChecks.length>yn)&&E("Native text source exceeds segment/check budget","NATIVE_TEXT_RANGES_BUDGET");let t=0;for(let n of e.segments)(!M(n,["start","end","characters","values"])||!Ie(e.characters,n.start)||!Ie(e.characters,n.end)||n.start!==t||n.end<=n.start||n.characters!==e.characters.slice(n.start,n.end))&&E("Native segments do not cover exact authored UTF16 text"),He(n.values),t=n.end;t!==e.characters.length&&E("Native segments omit authored text");for(let n of e.rangeChecks)(!M(n,["start","end","values"])||!Ie(e.characters,n.start)||!Ie(e.characters,n.end)||n.start>=n.end)&&E("Invalid native getter range"),He(n.values)}var G=(e,t)=>e[t]?.kind==="value"?e[t].value:void 0;function St(e){return Array.isArray(e)?e.map(t=>({type:t.type,visible:Z(t,"visible",!0),opacity:Z(t,"opacity",1),blendMode:Z(t,"blendMode","NORMAL"),boundVariables:v(t,"boundVariables")?t.boundVariables:{},color:t.color&&{r:t.color.r,g:t.color.g,b:t.color.b,a:Z(t.color,"a",1)}})):e}function U(e,t=!1){if(e===null)return null;if(M(e,["type",t?"url":"value"])&&e.type==="URL"&&typeof e[t?"url":"value"]=="string")return e[t?"url":"value"]}function Nn(e,t){let n=e.characterStyleOverrides??[],r=e.styleOverrideTable??{},s=Array.from(t.characters).length;e.style!==void 0&&!D(e.style)&&E("Malformed REST text style"),(!Array.isArray(n)||n.length>s||!D(r)||n.some(a=>!Number.isInteger(a)||a<0||a!==0&&!D(r[a])))&&E("Malformed REST character styles");let i=()=>E("REST and live native style differ; source may have changed during capture","NATIVE_TEXT_RANGES_CAPTURE_RACE");for(let a of se){let c=t.scalars[a];c?.kind==="value"&&(v(e,a)&&!B(e[a],c.value)||v(e.style??{},a)&&!B(e.style[a],c.value))&&i()}let o=0;for(let a of t.segments){let c=a.values;for(let f=a.start;f<a.end;f+=t.characters.codePointAt(f)>65535?2:1){let h=n[o++]??0,d={...e.style??{},...h===0?{}:r[h]};for(let S of["fontSize","fontWeight","textDecoration","textCase"])v(d,S)&&c[S]?.kind==="value"&&!B(d[S],G(c,S))&&i();let N=G(c,"fontName");N&&(v(d,"fontFamily")&&d.fontFamily!==N.family||v(d,"fontStyle")&&d.fontStyle!==N.style)&&i();let l=d.fills??e.fills;l!==void 0&&c.fills?.kind==="value"&&!B(St(l),St(G(c,"fills")))&&i(),v(d,"hyperlink")&&c.hyperlink?.kind==="value"&&U(d.hyperlink,!0)!==void 0&&U(G(c,"hyperlink"))!==void 0&&U(d.hyperlink,!0)!==U(G(c,"hyperlink"))&&i();let T=G(c,"lineHeight");d.lineHeightUnit==="PIXELS"&&T&&(T.unit!=="PIXELS"||d.lineHeightPx!==T.value)&&i(),["FONT_SIZE_%","PERCENT"].includes(d.lineHeightUnit)&&T&&(T.unit!=="PERCENT"||d.lineHeightPercentFontSize!==T.value&&!(typeof T.value=="number"&&typeof d.lineHeightPercentFontSize=="number"&&d.lineHeightPercentFontSize===Math.fround(T.value)))&&i();let m=G(c,"letterSpacing");if(v(d,"letterSpacing")&&m&&["PIXELS","PERCENT"].includes(m.unit)){let S=m.unit==="PIXELS"?m.value:m.value*G(c,"fontSize")/100;d.letterSpacing!==S&&i()}}}}function xn(e){let t=[];for(let[n,r]of Object.entries(e.scalars)){if(["error","missing"].includes(r.kind)&&t.push(Q("NATIVE_TEXT_RANGES_SCALAR_OBSERVATION","Native scalar observation remains raw",{field:n,kind:r.kind})),n==="hyperlink"&&r.kind==="value"&&U(r.value)!==void 0){let s=e.segments.map(i=>i.values.hyperlink);if(s.length&&s.every(i=>i?.kind==="value"&&U(i.value)!==void 0)){let i=[...new Set(s.map(a=>U(a.value)).filter(a=>a!==null))],o=i.length===0?null:i.length===1?i[0]:void 0;(o===void 0||U(r.value)!==o)&&E("Native scalar hyperlink conflicts with complete styled segments","NATIVE_TEXT_RANGES_CAPTURE_RACE")}}n==="hyperlink"&&r.kind==="value"&&U(r.value)===void 0&&t.push(Q("NATIVE_TEXT_RANGES_HYPERLINK_UNKNOWN","Native scalar hyperlink is not interpreted as no-link",{field:n,value:r.value}))}for(let[n,r]of Object.entries(e.scalars)){if(r.kind!=="value"||!z.includes(n)||n==="hyperlink")continue;let s=e.segments.map(i=>i.values[n]);s.length&&s.every(i=>i?.kind==="value")&&s.every(i=>B(i.value,s[0].value))&&!B(r.value,s[0].value)&&E("Native scalar conflicts with uniform styled segments","NATIVE_TEXT_RANGES_CAPTURE_RACE")}for(let[n,r]of e.rangeChecks.entries())for(let[s,i]of Object.entries(r.values)){if(i.kind!=="value"){t.push(Q("NATIVE_TEXT_RANGES_GETTER_OBSERVATION","Native getter observation remains raw",{field:s,index:n,kind:i.kind}));continue}if(s==="hyperlink"&&U(i.value)===void 0){t.push(Q("NATIVE_TEXT_RANGES_HYPERLINK_UNKNOWN","Native hyperlink getter value is not interpreted as no-link",{field:s,index:n,value:i.value}));continue}let a=e.segments.filter(c=>c.start<r.end&&c.end>r.start).map(c=>c.values[s]);a.length&&a.every(c=>c?.kind==="value")&&a.every(c=>B(c.value,a[0].value))&&!B(i.value,a[0].value)&&E("Valid native range getter conflicts with styled segments","NATIVE_TEXT_RANGES_CAPTURE_RACE")}return t}var Be=e=>({status:e.code==="NATIVE_TEXT_RANGES_STALE"?"stale":"invalid",diagnostics:[Q(e.code??"NATIVE_TEXT_RANGES_INVALID",e.message)]});function H(e,t,n){D(e)||E("Native codec input must be plain data");let r=Object.getOwnPropertyDescriptor(e,t);return r?(v(r,"value")||E("Native codec input contains accessors"),r.value):n}function It(e){try{let t=H(e,"rest"),n=H(e,"characters"),r=H(e,"scalars"),s=H(e,"segments"),i=H(e,"rangeChecks",[]),o=_t(t),a=oe({version:1,nodeId:t.id,characters:n,restSignature:o,scalars:r,segments:s,rangeChecks:i});return ae(t,a)}catch(t){return Be(t)}}function ae(e,t){try{if(t===void 0&&(t=H(e,"codeshellNativeTextRanges")),t===void 0)return{status:"absent",diagnostics:[]};let n=oe(t);mt(n);let r=_t(e);return(n.nodeId!==e.id||n.characters!==e.characters||n.restSignature!==r)&&E("Native text evidence is stale for this REST node","NATIVE_TEXT_RANGES_STALE"),Nn(e,n),{status:"bound",source:n,diagnostics:xn(n)}}catch(n){return Be(n)}}function W(e){let t=oe(e);mt(t);let{restSignature:n,...r}=t;return ie(r)}function P(e,t){return e[t]?.kind!=="value"&&E(`Native ${t} is missing/mixed/unknown`,"NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS"),e[t].value}function An(e){(!Array.isArray(e)||e.length!==1)&&E("Native range requires one opaque normal SOLID paint","NATIVE_TEXT_RANGES_UNSUPPORTED_PAINT");let t=e[0],n=t?.color;return(!M(t,["type","visible","opacity","blendMode","color","boundVariables"])||t.type!=="SOLID"||v(t,"visible")&&t.visible!==!0||Z(t,"opacity",1)!==1||Z(t,"blendMode","NORMAL")!=="NORMAL"||!M(n,["r","g","b","a"])||Z(n,"a",1)!==1||v(t,"boundVariables")&&(!D(t.boundVariables)||Object.keys(t.boundVariables).length))&&E("Native range paint is not supported","NATIVE_TEXT_RANGES_UNSUPPORTED_PAINT"),`#${[n.r,n.g,n.b].map(s=>{for(let i=0;i<=255;i++)if(s===i/255||s===Math.fround(i/255))return i;E("Native color cannot be represented exactly as sRGB8; raw channels were retained","NATIVE_TEXT_RANGES_COLOR_QUANTIZATION")}).map(s=>s.toString(16).padStart(2,"0")).join("")}`}var Rt=["fontName","fontSize","lineHeight","letterSpacing"];function Sn(e,t){if(!D(e)||!Number.isFinite(e.value)||!J(t))return!1;let n=K(t);return e.unit===n.unit&&(e.value===n.value||n.unit==="PERCENT"&&e.value===Math.fround(n.value/100)*100)}function _n(e){for(let r of Rt)P(e,r);for(let[r,s]of[["textCase","ORIGINAL"],["listSpacing",0],["indentation",0],["paragraphIndent",0],["paragraphSpacing",0]])P(e,r)!==s&&E(`Native ${r} changes paragraph metrics`,"NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");let t=P(e,"listOptions");(!D(t)||t.type!=="NONE"||Object.keys(t).some(r=>r!=="type"))&&E("Native lists are not supported","NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");for(let r of["openTypeFeatures","boundVariables"]){let s=P(e,r);(!D(s)||Object.keys(s).length)&&E("Native features/variables require a separate model","NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS")}let n=P(e,"textStyleOverrides");(!Array.isArray(n)||n.some(r=>!M(r,["type"])||!["HYPERLINK","TEXT_DECORATION"].includes(r.type)))&&E("Native semantic font overrides require a separate model","NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS"),P(e,"textWrapStyle")!=="AUTO"&&E("Native text-wrap style is unsupported","NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS")}function Re(e){let t,n,r;try{t=H(e,"rest"),n=H(e,"source"),r=oe(H(e,"canonicalNode"))}catch(a){return{...Be(a),status:"unsupported",pixelsVerified:!1}}let s=ae(t,n),i=[...s.diagnostics],o=a=>({status:"unsupported",diagnostics:[...i,Q(a.code??"NATIVE_TEXT_RANGES_INVALID",a.message)],pixelsVerified:!1});if(s.status!=="bound")return{status:"unsupported",diagnostics:i,pixelsVerified:!1};try{let a=s.source;(r?.type!=="text"||(r.textSource??r.text)!==a.characters)&&E("Canonical text does not preserve native authored source","NATIVE_TEXT_RANGES_SOURCE_MISMATCH");for(let N of a.segments)for(let l of["textDecorationStyle","textDecorationOffset","textDecorationThickness","textDecorationColor","textDecorationSkipInk"])N.values[l]?.kind==="value"&&N.values[l].value!==null&&E("Native underline geometry has no proven CSS basis; whole range admission refused","NATIVE_TEXT_RANGES_NATIVE_DECORATION_BASIS");let c=a.scalars;for(let[N,l]of[["hasMissingFont",!1],["leadingTrim","NONE"],["hangingPunctuation",!1],["hangingList",!1],["textAlignVertical","TOP"],["textTruncation","DISABLED"],["maxLines",null]])P(c,N)!==l&&E(`Native ${N} applicability is unsupported`,"NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");({LEFT:"left",CENTER:"center",RIGHT:"right"})[P(c,"textAlignHorizontal")]!==(r.textAlign??"left")&&E("Canonical text alignment differs from native","NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");let f=a.segments[0]?.values,h=[];for(let N of a.segments){let l=N.values;_n(l);for(let p of Rt)B(G(l,p),G(f,p))||E("Native metric variants cannot be split into paint ranges","NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");let T=P(l,"fontName"),m=P(l,"lineHeight"),S=P(l,"letterSpacing");(!D(T)||T.family!==r.fontFamily||G(l,"fontSize")!==r.fontSize||P(l,"fontWeight")!==r.fontWeight||P(l,"fontStyle")!==(r.fontStyle==="italic"?"ITALIC":"REGULAR")||!Sn(m,r)||!D(S)||!(S.value===0&&r.letterSpacing===0||S.unit==="PIXELS"&&S.value===r.letterSpacing))&&E("Canonical font metrics differ from native","NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS"),(!M(T,["family","style","variationSettings"])||!["Regular","Bold","Italic","Bold Italic"].includes(T.style)||v(T,"variationSettings")&&(!D(T.variationSettings)||Object.entries(T.variationSettings).some(([p,I])=>p==="wght"?I!==r.fontWeight:p==="slnt"?I!==0:!0)))&&E("Native font axis/style is outside canonical uniform metrics","NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");let g=An(P(l,"fills")),y=P(l,"textDecoration");["NONE","UNDERLINE","STRIKETHROUGH"].includes(y)||E("Native decoration is unsupported","NATIVE_TEXT_RANGES_UNSUPPORTED_DECORATION");for(let p of["textDecorationStyle","textDecorationOffset","textDecorationThickness","textDecorationColor","textDecorationSkipInk"])P(l,p)!==null&&E("Native underline geometry has no proven CSS basis; whole range admission refused","NATIVE_TEXT_RANGES_NATIVE_DECORATION_BASIS");let x=P(l,"hyperlink"),_=U(x);(_===void 0||typeof _=="string"&&(_.startsWith("#")||!fe(_)))&&E("Native hyperlink target is unsupported; raw value retained","NATIVE_TEXT_RANGES_UNSUPPORTED_HYPERLINK");let A={start:N.start,end:N.end},u={NONE:"none",UNDERLINE:"underline",STRIKETHROUGH:"line-through"}[y];g!==r.fill?.toLowerCase()&&(A.fill=g),u!==(r.textDecoration??"none")&&(A.textDecoration=u),_!==null&&(A.href=_),Object.keys(A).length>2&&h.push(A)}let d=k({...r,textRanges:{version:1,sourceSignature:re(a.characters),ranges:h}});return i.push(Q("NATIVE_TEXT_RANGES_PIXELS_UNVERIFIED","Native paint/link/decoration intent recovered; cross-renderer pixels are not verified")),{status:d?"admitted-intent":"uniform",...d?{textRanges:d}:{},diagnostics:i,pixelsVerified:!1}}catch(a){return o(a)}}var mn=64*1024,In=1e5,Ot=new WeakSet,F=(e,t)=>{let n=new Error(t);throw n.code=e,Ot.add(n),n},L=()=>F("NATIVE_TEXT_RANGE_HINT_INVALID","Native author hints require bounded owned plain data."),Oe=(e,t)=>Object.hasOwn(e,t),$e=e=>e!==null&&typeof e=="object"&&!Array.isArray(e)&&[Object.prototype,null].includes(Object.getPrototypeOf(e)),Rn=["id","type","characters","style","characterStyleOverrides","styleOverrideTable","fills","lineTypes","lineIndentations","textTruncation","maxLines","textAutoResize","layoutSizingHorizontal","layoutSizingVertical","hasMissingFont","leadingTrim","hangingPunctuation","hangingList"],ze=["type","text","textSource","textFlow","textRanges","fill","fillPaints","textDecoration","textDecorationThickness","textUnderlineOffset","textDecorationSkipInk","textOverflow","fontFamily","fontSize","fontWeight","fontStyle","lineHeight","lineHeightUnit","letterSpacing","textAlign"];function be(e){let t=0;for(let n of e){let r=n.codePointAt(0);t+=r<128?1:r<2048?2:r<65536?3:4}return t}function we(e,t={seen:new Set,bytes:0,count:0},n=0){let r=h=>{(t.bytes+=be(h))>524288&&L()};if((++t.count>1e5||n>16)&&L(),e===null||typeof e=="boolean"||typeof e=="number"&&Number.isFinite(e))return r(String(e)),e;if(typeof e=="string")return e.length>512*1024&&L(),r(JSON.stringify(e)),e;let s=Array.isArray(e);(!s&&!$e(e)||t.seen.has(e))&&L();let i=Object.getOwnPropertyDescriptors(e),o=Reflect.ownKeys(i),a=s?i.length?.value:void 0;(o.some(h=>typeof h!="string")||s&&(!Number.isInteger(a)||a>4096))&&L();let c=s?o.filter(h=>h!=="length"):o;(c.length>4096||s&&(c.length!==a||c.some((h,d)=>h!==String(d))))&&L(),t.seen.add(e),r("[]");let f=s?[]:{};for(let h of c){let d=i[h];(!Oe(d,"value")||!d.enumerable)&&L(),r(JSON.stringify(h)+":,"),Object.defineProperty(f,h,{value:we(d.value,t,n+1),enumerable:!0,writable:!0,configurable:!0})}return t.seen.delete(e),f}function Fe(e,t){$e(e)||L();let n=Object.getOwnPropertyDescriptors(e);return Reflect.ownKeys(n).some(r=>typeof r!="string"||!t.includes(r)||!Oe(n[r],"value")||!n[r].enumerable)&&L(),Object.fromEntries(Object.keys(n).map(r=>[r,n[r].value]))}function ve(e,t,n=!1){$e(e)||L();let r=Object.getOwnPropertyDescriptors(e),s={};for(let i of t){if(!Oe(r,i))continue;let o=r[i];(!Oe(o,"value")||!o.enumerable)&&L(),!(o.value===void 0&&n)&&(s[i]=we(o.value))}return s}function vt(e,t,n){[t,n].every(i=>typeof i=="string"&&i.length<=1e5&&/^[a-z0-9_.-]+$/iu.test(i))||L();let r=typeof e=="string"?e:JSON.stringify(e),s=be(r);return(s>mn||s+be(t)+be(n)>In)&&F("NATIVE_TEXT_RANGE_HINT_BUDGET","The complete native author hint or plugin-data entry exceeds its byte budget."),r}function bt(e){let t=[];for(let n of e.runs){let r=t.at(-1);r&&r.end===n.start&&r.fill===n.fill&&JSON.stringify(r.hyperlink)===JSON.stringify(n.hyperlink)?r.end=n.end:t.push({...n,hyperlink:n.hyperlink&&{...n.hyperlink}})}return JSON.stringify({characters:e.characters,runs:t})}function wt(e,t,n){let r=ve(e,Rn),s=we(t),i=ae(r,s);i.status!=="bound"&&F("NATIVE_TEXT_RANGE_HINT_SOURCE","Author hints require a complete independently bound current native source.");let o=ve(n,ze,!0),a=Re({rest:r,source:i.source,canonicalNode:o});["uniform","admitted-intent"].includes(a.status)||F("NATIVE_TEXT_RANGE_HINT_EFFECTIVE","Current native text cannot independently prove the supported effective paint/link plan."),delete o.textRanges,a.textRanges&&(o.textRanges=a.textRanges);let c=q(o);return{rest:r,source:i.source,plan:c,snapshot:W(i.source)}}function Pt(e,t){bt(q(e))!==bt(t)&&F("NATIVE_TEXT_RANGE_HINT_EFFECTIVE","The hinted author state would change current native characters, colors, or links.")}function Dt(e){try{return e()}catch(t){if(t!==null&&typeof t=="object"&&Ot.has(t))throw t;F("NATIVE_TEXT_RANGE_HINT_INVALID","Native author hint validation failed without restoring any author state.")}}function Xt(e){return Dt(()=>{let t=Fe(e,["rest","source","authorNode","pluginId","key"]),n=ve(t.authorNode,ze,!0),r=k(n);r||F("NATIVE_TEXT_RANGE_HINT_NO_INTENT","Only a nonempty explicit canonical range payload needs an author hint.");let s=wt(t.rest,t.source,n);Pt(n,s.plan);let i={version:1,nodeId:s.rest.id,fill:n.fill.toLowerCase(),textRanges:r,snapshot:s.snapshot};return vt(i,t.pluginId,t.key),i})}function Ct(e){return Dt(()=>{let t=Fe(e,["rest","source","canonicalNode","hint","pluginId","key"]),n=typeof t.hint=="string"?t.hint:we(t.hint);vt(n,t.pluginId,t.key);let r=Fe(typeof n=="string"?JSON.parse(n):n,["version","nodeId","fill","textRanges","snapshot"]);(Object.keys(r).length!==5||r.version!==1||typeof r.nodeId!="string"||typeof r.fill!="string"||typeof r.snapshot!="string")&&L();let s=ve(t.canonicalNode,ze,!0),i=wt(t.rest,t.source,s);(r.nodeId!==i.rest.id||r.snapshot!==i.snapshot)&&F("NATIVE_TEXT_RANGE_HINT_STALE","The author hint does not match this complete current native text snapshot.");let o={...s,fill:r.fill,textRanges:r.textRanges},a=k(o);return a||F("NATIVE_TEXT_RANGE_HINT_NO_INTENT","An author hint cannot restore an empty or partial range payload."),Pt(o,i.plan),{fill:r.fill.toLowerCase(),textRanges:a}})}var Lt="codeshellTextRangeIntent",bn=16*1024*1024,ce=(e,t)=>{let n=new Error(t);throw n.code=e,n};function On(e){let t=0;for(let n of e){let r=n.codePointAt(0);t+=r<128?1:r<2048?2:r<65536?3:4}return t}function de(e,t,n){let r=Nt(e,n,{fields:z,scalarFields:se});return r.status!=="captured"?r:It({rest:t,...r.observations})}async function kt(e,{mixed:t,pluginId:n,assertOwned:r}){(!Array.isArray(e)||e.length>1e4||typeof r!="function")&&ce("TEXT_RANGES_NATIVE_FINALIZE_INPUT","范围文字的最终校验上下文无效，已阻止创建副本");let s=[],i=0;for(let{target:o,source:a}of e){r(o),(o?.type!=="TEXT"||typeof o.exportAsync!="function"||typeof o.setPluginData!="function")&&ce("TEXT_RANGES_NATIVE_FINALIZE_UNAVAILABLE","范围文字的最终读取或意图保存能力不可用，已阻止创建副本");let c=await o.exportAsync({format:"JSON_REST_V1"});r(o);let f=c?.document??c?.nodes?.[o.id]?.document;(f?.id!==o.id||f?.type!=="TEXT")&&ce("TEXT_RANGES_NATIVE_FINALIZE_IDENTITY","范围文字的最终来源身份不匹配，已阻止创建副本");let h=de(o,f,t);h.status!=="bound"&&ce("TEXT_RANGES_NATIVE_FINALIZE_SOURCE","无法完整校验新建范围文字的最终原生状态，已阻止创建副本");let d=Xt({rest:f,source:h.source,authorNode:a,pluginId:n,key:Lt}),N=JSON.stringify(d);(i+=On(N))>bn&&ce("TEXT_RANGES_NATIVE_FINALIZE_BUDGET","范围文字的完整意图快照合计超过 16 MiB，已阻止创建副本"),s.push({target:o,rest:f,text:N,snapshot:W(h.source)})}for(let o of s){r(o.target);let a=de(o.target,o.rest,t);(a.status!=="bound"||W(a.source)!==o.snapshot)&&ce("TEXT_RANGES_NATIVE_FINALIZE_RACE","范围文字在最终读取期间发生变化，已阻止创建副本")}for(let o of s)o.target.setPluginData(Lt,o.text);return{texts:s.length,bytes:i}}var De="codeshellTextRangeIntent",vn="nativeTextRanges",wn=Object.freeze(["codeshellNativeTextRanges","codeshellNativeTextRangeHint","codeshellTextRangeIntent",vn]),Pn=new Set(["serif","sans-serif","monospace","cursive","fantasy","system-ui","ui-serif","ui-sans-serif","ui-monospace","ui-rounded","emoji","math","fangsong"]),Dn=["textDecoration","textDecorationStyle","textDecorationOffset","textDecorationThickness","textDecorationColor","textDecorationSkipInk","hyperlink"],Mt=(e,t)=>Object.hasOwn(e,t),Y=e=>e!==null&&typeof e=="object"&&!Array.isArray(e)&&[Object.prototype,null].includes(Object.getPrototypeOf(e)),We=(e,t)=>Y(e)&&Object.keys(e).length===t.length&&t.every(n=>Mt(e,n)),Ye=(e,t)=>JSON.stringify(e)===JSON.stringify(t),V=(e,t)=>{if(e[t]?.kind!=="value")throw Error("Native "+t+" is not a complete supported value");return e[t].value},Xn=e=>{let t=0;for(let n of e){let r=n.codePointAt(0);t+=r<128?1:r<2048?2:r<65536?3:4}return t};function Je(e,t,n={bytes:0,steps:0,seen:new Set},r=0,s={steps:1e5,depth:20,keys:8192}){let i=N=>{if((n.bytes+=Xn(N))>t)throw Error("Owned native data exceeds its complete byte budget")};if(++n.steps>s.steps||r>s.depth)throw Error("Owned native data exceeds its structural budget");if(e===null||typeof e=="boolean"||typeof e=="number"&&Number.isFinite(e)||typeof e=="string")return i(JSON.stringify(e)),e;let o=Array.isArray(e);if(!o&&!Y(e)||n.seen.has(e))throw Error("Native import requires acyclic owned JSON");let a=Object.getOwnPropertyDescriptors(e),c=Reflect.ownKeys(a),f=o?a.length?.value:void 0,h=o?c.filter(N=>N!=="length"):c;if(c.some(N=>typeof N!="string")||h.length>s.keys||o&&(!Number.isInteger(f)||h.length!==f||h.some((N,l)=>N!==String(l))))throw Error("Native import requires dense bounded JSON");n.seen.add(e),i(o?"[":"{");let d=o?[]:{};for(let[N,l]of h.entries()){let T=a[l];if(!Object.hasOwn(T,"value")||!T.enumerable)throw Error("Native import refuses accessors and hidden fields");i((N?",":"")+(o?"":JSON.stringify(l)+":")),Object.defineProperty(d,l,{value:Je(T.value,t,n,r+1,s),enumerable:!0,configurable:!0,writable:!0})}return i(o?"]":"}"),n.seen.delete(e),d}function Pe(e,t){if(!Y(e))throw Error("Native import arguments must be an owned record");let n=Object.getOwnPropertyDescriptor(e,t);if(n){if(!Object.hasOwn(n,"value")||!n.enumerable)throw Error("Native import argument accessor refused");return n.value}}function Xe(e){return Y(e)&&We(e.scalars,[...z,...se])&&Array.isArray(e.segments)&&Array.isArray(e.rangeChecks)&&e.segments.every(t=>We(t.values,z))&&e.rangeChecks.length===e.segments.length&&e.rangeChecks.every((t,n)=>t.start===e.segments[n].start&&t.end===e.segments[n].end&&We(t.values,Dn))}function Ke(e){return wn.some(t=>Mt(e,t))}function Cn(e,t){return e.type!=="TEXT"||e.isMask===!0||e.children!==void 0&&(!Array.isArray(e.children)||e.children.length)||![void 0,"NORMAL","PASS_THROUGH"].includes(e.blendMode)||!Array.isArray(e.fills)||e.fills.filter(n=>n.visible!==!1).length>1||e.fills.some(n=>n.visible!==!1&&n.type!=="SOLID")||e.strokes!==void 0&&(!Array.isArray(e.strokes)||e.strokes.some(n=>n.visible!==!1))||e.effects!==void 0&&(!Array.isArray(e.effects)||e.effects.some(n=>n.visible!==!1))?!1:t.scalars.fills.kind==="mixed"&&t.scalars.fontName.kind==="value"&&t.scalars.fontSize.kind==="value"}function Vt(e){let t=[],n=r=>({status:"unsupported",diagnostics:[...t,{code:"NATIVE_TEXT_IMPORT_UNSUPPORTED",message:r}],pixelsVerified:!1});try{let r=Pe(e,"rest"),s=Pe(e,"source"),i=s===void 0?null:Je({rest:r,source:s},ee);if(i&&({rest:r,source:s}=i),!Y(r)||s===void 0||Ke(r))return n("A fresh explicit supplemental source without raw collisions is required");if(r.children!==void 0&&(!Array.isArray(r.children)||r.children.length))return n("A native Text must be a leaf");let o=ae(r,s);if(t.push(...o.diagnostics),o.status!=="bound"||!Xe(o.source))return n("The native source is stale, invalid or incomplete");let a=o.source,c=a.segments,f=c[0]?.values;if(!f)return n("A nonempty complete metric segment is required");let h=["fontName","fontSize","fontWeight","fontStyle","lineHeight","letterSpacing"];for(let b of h){let w=V(f,b);if(!c.every(X=>Ye(V(X.values,b),w)))return n("Native metric variants cannot become paint/link ranges");if(b!=="fontStyle"&&!Ye(V(a.scalars,b),w))return n("Scalar and complete segment metrics disagree");if(b==="fontStyle"&&a.scalars[b].kind==="value"&&!Ye(V(a.scalars,b),w))return n("Scalar and complete segment fontStyle disagree")}let d=V(f,"fontName"),N=V(f,"fontSize"),l=V(f,"fontWeight"),T=V(f,"fontStyle"),m=V(f,"lineHeight"),S=V(f,"letterSpacing");if(!Y(d)||typeof d.family!="string"||!d.family.length||d.family!==d.family.trim()||d.family.length>120||/[\u0000-\u001f\u007f,"'\\]/u.test(d.family)||Pn.has(d.family.toLowerCase())||!Number.isFinite(N)||N<6||N>240||![100,200,300,400,500,600,700,800,900].includes(l)||!["REGULAR","ITALIC"].includes(T)||!["Regular","Bold","Italic","Bold Italic"].includes(d.style)||(["Italic","Bold Italic"].includes(d.style)?"ITALIC":"REGULAR")!==T||d.variationSettings?.wght!==l&&(["Bold","Bold Italic"].includes(d.style)?700:400)!==l)return n("Native font metrics are outside the canonical uniform subset");let g={text:a.characters,textSource:a.characters,fontFamily:d.family,fontSize:N,fontWeight:l,fontStyle:T==="ITALIC"?"italic":"normal",fill:"#000000",textDecoration:"none"};if(!Y(m)||!Number.isFinite(m.value))return n("Native line height is not explicit");if(m.unit==="PIXELS")Object.assign(g,{lineHeight:m.value,lineHeightUnit:"pixels"});else if(m.unit==="PERCENT")g.lineHeight=m.value/100;else return n("Native automatic or unknown line-height units require a separate model");if(!J(g)||K(g).unit!==m.unit||K(g).value!==m.value)return n("Native line height has no exact in-envelope canonical unit conversion");if(!Y(S)||!Number.isFinite(S.value)||!(S.unit==="PIXELS"||S.unit==="PERCENT"&&S.value===0)||S.value<-20||S.value>100)return n("Native letter spacing is unsupported");g.letterSpacing=S.value;let y={LEFT:"left",CENTER:"center",RIGHT:"right"}[V(a.scalars,"textAlignHorizontal")];if(!y)return n("Native horizontal alignment is unsupported");g.textAlign=y;let x=V(a.scalars,"textAutoResize");if(!["NONE","HEIGHT","WIDTH_AND_HEIGHT"].includes(x))return n("Native text resize mode is unsupported");a.characters.length&&x!=="WIDTH_AND_HEIGHT"&&(g.textFlow="wrap");let _={type:"text",...g},A=Re({rest:r,source:a,canonicalNode:_});if(t.push(...A.diagnostics),!["uniform","admitted-intent"].includes(A.status))return n("The complete native paint/link/decoration context is unsupported");A.textRanges&&(g.textRanges=A.textRanges);let u=!1;try{q({type:"text",...g}),u=!0}catch{}let p,I;try{p=Pe(e,"hint"),I=Pe(e,"pluginId"),p!==void 0&&(p=Je(p,64*1024))}catch{t.push({code:"NATIVE_TEXT_IMPORT_HINT_INVALID",message:"Author hint data was refused; independently admitted native intent retained"}),p=void 0}if(p!==void 0)if(typeof I!="string"||!I)t.push({code:"NATIVE_TEXT_IMPORT_HINT_UNAVAILABLE",message:"Actual pluginId is unavailable; native intent retained"});else try{Object.assign(g,Ct({rest:r,source:a,canonicalNode:{type:"text",...g},hint:p,pluginId:I,key:De}))}catch(b){t.push({code:b.code??"NATIVE_TEXT_IMPORT_HINT_INVALID",message:"Author hint was refused; independently admitted native intent retained"})}return{status:A.status,patch:g,paintLinkOnly:u,ownMixedPreview:u&&Cn(r,a),diagnostics:t,pixelsVerified:!1}}catch(r){return n(r.message)}}var Ln=e=>e&&typeof e=="object"&&!Array.isArray(e),Gt=e=>typeof e=="number"&&Number.isFinite(e),qe=(e,t)=>{if(!Ln(e)||Object.keys(e).some(n=>!t.includes(n)))throw new Error("CSS 渐变几何包含未知字段")};function Ut(e,t){qe(e,["direction","positions","sourceOnly"]);let n=e.direction;qe(n,["angle","corner"]);let r;if(Object.keys(n).length!==1)throw new Error("CSS 渐变方向必须唯一");if(n.angle!==void 0){if(!Gt(n.angle)||n.angle<0||n.angle>=360)throw new Error("CSS 渐变角度必须为 0–360（不含 360）");r={angle:n.angle}}else{if(!Array.isArray(n.corner)||n.corner.length!==2||!Array.from(n.corner).every(i=>i===-1||i===1))throw new Error("CSS 渐变角方向必须为两个 ±1");r={corner:[...n.corner]}}if(e.sourceOnly!==void 0&&e.sourceOnly!==!0)throw new Error("CSS 渐变 sourceOnly 只能为 true");if(!Array.isArray(e.positions)||e.positions.length<2||e.positions.length>16||!e.sourceOnly&&e.positions.length!==t.length)throw new Error("CSS 渐变位置必须为 2–16 项且与可编辑色标对应");let s=Array.from(e.positions,(i,o)=>{if(i===null)return null;if(i==="previous"){if(!o||e.positions[o-1]==="previous"||!e.sourceOnly&&(t[o].opacity!==0||t[o-1].opacity!==0))throw new Error("CSS 透明色标重复位置无效");return"previous"}if(qe(i,["unit","value"]),!["px","percent"].includes(i.unit)||!Gt(i.value)||Math.abs(i.value)>2e4)throw new Error("CSS 色标只支持有界 px/percent 坐标");return{unit:i.unit,value:i.value}});if(s.filter(i=>i!=="previous").length<2)throw new Error("CSS 渐变至少需要两个原始色标");return{direction:r,positions:s,...e.sourceOnly?{sourceOnly:!0}:{}}}function jt(e,t){if(!e.sourceOnly)for(let n=1;n<t.length;n++){let r=t[n-1],s=t[n],i=e.positions[n-1],o=e.positions[n];if(!(o==="previous"||i&&o&&typeof i=="object"&&typeof o=="object"&&i.unit===o.unit&&i.value>=o.value)&&r.opacity!==s.opacity&&r.color!==s.color)throw new Error("不同颜色且透明度变化的 CSS 预乘插值无法由当前原生渐变无损表示")}}var kn=e=>e!==null&&typeof e=="object"&&!Array.isArray(e),Ht=e=>typeof e=="string"&&/^#[a-f\d]{6}$/iu.test(e),le=e=>typeof e=="number"&&Number.isFinite(e),Ce=e=>Math.max(0,Math.min(1,e));var Bt=e=>`#${[e.r,e.g,e.b].map(t=>Math.round(Ce(t)*255).toString(16).padStart(2,"0")).join("")}`;function Ze(e,t){if(!kn(e)||Object.keys(e).some(n=>!t.includes(n)))throw new Error("绘制包含未知字段")}function Qe(e){if(!le(e)||e<0||e>1)throw new Error("绘制透明度必须在 0–1 之间");return e}function Mn(e){let[t,n,r]=e;return[[n.x-t.x,2*(r.x-t.x),2*t.x-r.x],[n.y-t.y,2*(r.y-t.y),2*t.y-r.y]]}function Ft(e){let[[t,n,r],[s,i,o]]=Mn(e),a=t*i-n*s;if(Math.abs(a)<1e-8)throw new Error("线性渐变坐标不可逆");return[[i/a,-n/a,(n*o-i*r)/a],[-s/a,t/a,(s*r-t*o)/a]]}function Vn(e){if(!Array.isArray(e)||!e.length||e.length>8)throw new Error("填充绘制必须为 1–8 层");return e.map(t=>{Ze(t,t?.type==="SOLID"?["type","color","opacity"]:["type","opacity","handles","stops","cssLinear"]);let n=Qe(t.opacity);if(t.type==="SOLID"){if(!Ht(t.color))throw new Error("纯色绘制必须是六位十六进制颜色");return{type:"SOLID",color:t.color.toLowerCase(),opacity:n}}if(t.type!=="GRADIENT_LINEAR"||!Array.isArray(t.handles)||t.handles.length!==3||!Array.isArray(t.stops)||t.stops.length<2||t.stops.length>16)throw new Error("仅支持有界纯色/线性渐变；渐变必须有三个控制点与 2–16 个色标");let r=t.handles.map(o=>{if(Ze(o,["x","y"]),![o.x,o.y].every(a=>le(a)&&Math.abs(a)<=100))throw new Error("渐变控制点超出范围");return{x:o.x,y:o.y}});Ft(r);let s=t.stops.map(o=>{if(Ze(o,["position","color","opacity"]),!Ht(o.color))throw new Error("渐变色标颜色无效");return{position:Qe(o.position),color:o.color.toLowerCase(),opacity:Qe(o.opacity)}});if(s.some((o,a)=>a&&o.position<s[a-1].position))throw new Error("渐变色标必须按位置排序");let i=t.cssLinear===void 0?void 0:Ut(t.cssLinear,s);return i&&jt(i,s),{type:"GRADIENT_LINEAR",opacity:n,handles:r,stops:s,...i?{cssLinear:i}:{}}})}function Gn(e){if(!Array.isArray(e)||e.length!==2||!e.every(f=>Array.isArray(f)&&f.length===3&&f.every(le)))throw new Error("渐变矩阵无效");let[[t,n,r],[s,i,o]]=e,a=t*i-n*s;if(Math.abs(a)<1e-8)throw new Error("渐变矩阵不可逆");let c=(f,h)=>({x:(i*(f-r)-n*(h-o))/a,y:(-s*(f-r)+t*(h-o))/a});return[c(0,.5),c(1,.5),c(0,1)]}function $t(e,t=()=>{}){if(!Array.isArray(e))return null;let n=e.filter(r=>r?.visible!==!1);if(!n.length||n.length>8||n.some(r=>!["SOLID","GRADIENT_LINEAR"].includes(r?.type)))return null;try{let r=n.map(s=>{if(s.blendMode&&s.blendMode!=="NORMAL")throw new Error("非 NORMAL 混合绘制需本地预览资源");let i=le(s.opacity)?Ce(s.opacity):1;if(s.type==="SOLID")return{type:"SOLID",color:Bt(s.color),opacity:i*(le(s.color?.a)?Ce(s.color.a):1)};let o=s.gradientStops?.map(c=>({position:c.position,color:Bt(c.color),opacity:le(c.color?.a)?Ce(c.color.a):1})),a=s.gradientHandlePositions??Gn(s.gradientTransform);try{Ft(a)}catch{if(!o?.length)throw new Error("缺少渐变色标");t("退化线性渐变没有可逆控制点；按零长度渐变的末色标保留，不猜测方向。");let c=o.at(-1);return{type:"SOLID",color:c.color,opacity:i*c.opacity}}return{type:"GRADIENT_LINEAR",opacity:i,handles:a,stops:o}});return Vn(r)}catch(r){return t(`绘制无法无损转换：${r.message}`),null}}var et=16*1024*1024,Le=e=>e!==null&&typeof e=="object"&&!Array.isArray(e)&&[Object.prototype,null].includes(Object.getPrototypeOf(e)),R=(e,t)=>{let n=Error(t);throw n.code=e,n},te=e=>{let t=0;for(let n of e){let r=n.codePointAt(0);t+=r<128?1:r<2048?2:r<65536?3:4}return t};function he(e,t=new Set,n=0){if(e===null||typeof e=="boolean"||typeof e=="string"||typeof e=="number"&&Number.isFinite(e))return JSON.stringify(e);(n>40||typeof e!="object"||t.has(e)||!Array.isArray(e)&&!Le(e))&&R("NATIVE_TEXT_EXPORT_DATA","Source export requires complete owned JSON");let r=Object.getOwnPropertyDescriptors(e),s=Array.isArray(e),i=Reflect.ownKeys(r).filter(a=>!s||a!=="length");(i.some(a=>typeof a!="string"||!Object.hasOwn(r[a],"value")||!r[a].enumerable)||s&&(i.length!==e.length||i.some((a,c)=>a!==String(c))))&&R("NATIVE_TEXT_EXPORT_DATA","Source export cannot interpret hidden/accessor/sparse data"),t.add(e);let o=s?"["+i.map(a=>he(r[a].value,t,n+1)).join(",")+"]":"{"+i.sort().map(a=>JSON.stringify(a)+":"+he(r[a].value,t,n+1)).join(",")+"}";return t.delete(e),te(o)>et&&R("NATIVE_TEXT_EXPORT_BUDGET","Complete export exceeds16MiB"),o}function Un(e,t){let n=r=>r===t?{mixed:!0}:r??null;return he({type:e.type,isMask:e.isMask===!0,blendMode:e.blendMode??null,fills:n(e.fills),strokes:n(e.strokes),effects:n(e.effects),mixedFontName:e.fontName===t,mixedFontSize:e.fontSize===t,childMasks:Array.isArray(e.children)?e.children.map(r=>[r.id,r.isMask===!0]):[]})}var zt=e=>Array.isArray(e)&&e.every(t=>Le(t)&&t.visible===!1),jn=new Set(["FRAME","GROUP","COMPONENT","COMPONENT_SET","INSTANCE","SECTION"]);function Wt(e,t,n){if(Vt({rest:e,source:t}).ownMixedPreview)for(let[r,s]of n.entries()){let i=JSON.parse(s.context);if(i.childMasks.some(([,h])=>h)&&R("NATIVE_TEXT_EXPORT_PREVIEW_CONTEXT","Actual native ancestor has a known mask child; editable range preview bypass was refused"),r&&["PAGE","DOCUMENT"].includes(i.type))continue;let o=!i.isMask&&["NORMAL","PASS_THROUGH"].includes(i.blendMode)&&zt(i.strokes)&&zt(i.effects)&&i.childMasks.every(([,h])=>!h),a=r===0&&i.type==="TEXT"&&Le(i.fills)&&i.fills.mixed===!0&&Object.keys(i.fills).length===1&&!i.mixedFontName&&!i.mixedFontSize,c=Array.isArray(i.fills)?i.fills.filter(h=>h.visible!==!1):null,f=r>0&&jn.has(i.type)&&c&&(c.length===0||!!$t(c));(!o||!(a||f))&&R("NATIVE_TEXT_EXPORT_PREVIEW_CONTEXT","Actual native Text or ancestor has an independent preview cause; editable range preview bypass was refused")}}function Yt({roots:e,mixed:t,pluginId:n}={}){(!Array.isArray(e)||e.length>1e4||new Set(e).size!==e.length||typeof t!="symbol")&&R("NATIVE_TEXT_EXPORT_CONTEXT","Export capture requires exact current native roots and mixed identity");let r=new Map,s=[],i=new Set(e),o=new Map,a=new Map,c=0,f=0,h=0,d=(g,y)=>{if(!g)return{values:[],indices:new Map};if(!y.has(g)){let x=Array.isArray(g.children)?[...g.children]:[],_=new Map;for(let[A,u]of x.entries())_.has(u)&&R("NATIVE_TEXT_EXPORT_TOPOLOGY","Native children contain aliased objects"),_.set(u,A);y.set(g,{values:x,indices:_})}return y.get(g)},N=(g,y,x)=>{if(!y.has(g)){let _=g.parent,u=d(_,x).indices.get(g)??-1;_&&u<0&&R("NATIVE_TEXT_EXPORT_TOPOLOGY","Native source left its original parent");let p=Un(g,t);(h+=te(p))>et&&R("NATIVE_TEXT_EXPORT_BUDGET","Complete native preview contexts exceed16MiB"),y.set(g,{current:g,parent:_,id:g.id,index:u,children:d(g,x).values,context:p})}return y.get(g)},l=(g,y=o,x=a)=>{let _=[],A=new Set,u=!1;for(let p=g;p;p=p.parent)(A.has(p)||_.length>35||p.removed===!0)&&R("NATIVE_TEXT_EXPORT_TOPOLOGY","Native source identity or ancestry is unavailable"),A.add(p),i.has(p)&&(u=!0),_.push(N(p,y,x));return u||R("NATIVE_TEXT_EXPORT_TOPOLOGY","Native Text is outside the exported roots"),_},T=(g,y)=>g.length===y.length&&g.every((x,_)=>{let A=y[_];return x.current===A.current&&x.parent===A.parent&&x.id===A.id&&x.index===A.index&&x.context===A.context&&x.children.length===A.children.length&&x.children.every((u,p)=>u===A.children[p])}),m=(g,y,x=0)=>{if((!Le(g)||!y||y.id!==g.id||x>34||++f>5e4)&&R("NATIVE_TEXT_EXPORT_IDENTITY","Official REST and exact native source ownership disagree"),g.type!==(y.type==="PAGE"?"CANVAS":y.type)&&R("NATIVE_TEXT_EXPORT_IDENTITY","Official REST and native source types disagree"),Ke(g)&&R("NATIVE_TEXT_EXPORT_COLLISION","Official REST contains a reserved supplemental lookalike; raw data was not overwritten"),g.children!==void 0&&!Array.isArray(g.children)&&R("NATIVE_TEXT_EXPORT_DATA","Official REST children must remain an array"),y.type==="TEXT"){(g.type!=="TEXT"||g.children?.length)&&R("NATIVE_TEXT_EXPORT_IDENTITY","Text source must remain a native leaf");let u=he(g),p=r.get(g.id);if(p){(p.target!==y||p.fingerprint!==u||!T(p.lineage,l(y)))&&R("NATIVE_TEXT_EXPORT_OVERLAP","Repeated Text source ownership or complete raw data disagree");return}let I=de(y,g,t),b=I.status==="bound"&&Xe(I.source);b?(te(JSON.stringify({rest:g,source:I.source}))>ee&&R("NATIVE_TEXT_EXPORT_NODE_BUDGET","The complete Text proof exceeds256KiB"),c+=te(JSON.stringify(I.source)),c>et&&R("NATIVE_TEXT_EXPORT_BUDGET","Complete native sources exceed16MiB")):s.push(g.id+": complete native range source unavailable; existing fallback retained");let w=l(y);b&&Wt(g,I.source,w),r.set(g.id,{rest:g,target:y,fingerprint:u,lineage:w,bound:b,source:b?I.source:void 0,snapshot:b?W(I.source):null});return}let _=Array.isArray(y.children)?y.children:[],A=new Map;for(let u of _)A.has(u.id)&&R("NATIVE_TEXT_EXPORT_OVERLAP","Native children contain repeated identity"),A.set(u.id,u);((g.children??[]).length!==_.length||(g.children??[]).some((u,p)=>u?.id!==_[p]?.id))&&R("NATIVE_TEXT_EXPORT_IDENTITY","Official and native child topology disagree");for(let u of g.children??[]){let p=A.get(u?.id);p||R("NATIVE_TEXT_EXPORT_IDENTITY","Official descendant has no exact native owner"),m(u,p,x+1)}};return{add:m,finalize:()=>{let g=new Map,y=typeof n=="string"&&/^[a-z0-9_.-]+$/iu.test(n)?n:void 0;for(let u of r.values())if(u.bound&&y&&typeof u.target.getPluginData=="function"){let p;try{p=u.target.getPluginData(De)}catch{s.push(u.target.id+": optional author hint unavailable; independent native source retained");continue}typeof p!="string"&&R("NATIVE_TEXT_EXPORT_HINT","Native plugin data did not return a string"),p&&(te(p)+te(y)+te(De)>1e5&&R("NATIVE_TEXT_EXPORT_HINT_BUDGET","The complete native plugin-data entry exceeds100000bytes"),g.set(u.target.id,p))}let x={},_=new Map,A=new Map;h=0;for(let u of r.values()){(!T(u.lineage,l(u.target,_,A))||he(u.rest)!==u.fingerprint)&&R("NATIVE_TEXT_EXPORT_RACE","Native source identity/topology/preview cause changed during awaited export");let p=de(u.target,u.rest,t),I=p.status==="bound"&&Xe(p.source);(I!==u.bound||I&&W(p.source)!==u.snapshot)&&R("NATIVE_TEXT_EXPORT_RACE","Complete observed native Text changed during awaited export"),I&&Wt(u.rest,p.source,l(u.target,_,A)),I&&Object.defineProperty(x,u.target.id,{enumerable:!0,configurable:!0,writable:!0,value:{source:p.source,...g.has(u.target.id)?{hint:g.get(u.target.id)}:{}}})}return{supplement:Object.keys(x).length?{version:1,...y?{pluginId:y}:{},nodes:x}:void 0,warnings:s,observedTextNodes:r.size}}}}return tn(Hn);})();
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
        range(node.fontSize, 6, 240, "fontSize");
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
        if (node.type === "text") await loadFont(node);
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
    const validateNode = (node, id, copying) => {
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
    return {
      value,
      indexes,
      targets,
      currentRaw,
      geometryBefore,
      strokeLayoutPlans,
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
    // All awaited REST/image/PNG/SVG work has ended. No native read or
    // mutation follows the collector's final synchronous observed-field pass.
    const exportName = page.name, exportFileKey = figma.fileKey;
    const capturedText = nativeTextCapture.finalize();
    const value = {
      format: "codeshell.figma.source",
      version: 1,
      name: `${exportName}${scope === "selection" ? " Selection" : ""}`,
      ...(exportFileKey ? { fileKey: exportFileKey } : {}),
      nodes,
      assets,
      previews,
      ...(capturedText.supplement ? { nativeTextRanges: capturedText.supplement } : {}),
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
