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
"use strict";var CodeShellFigmaText=(()=>{var Ie=Object.defineProperty;var It=Object.getOwnPropertyDescriptor;var Rt=Object.getOwnPropertyNames;var bt=Object.prototype.hasOwnProperty;var Ot=(e,t)=>{for(var n in t)Ie(e,n,{get:t[n],enumerable:!0})},vt=(e,t,n,i)=>{if(t&&typeof t=="object"||typeof t=="function")for(let r of Rt(t))!bt.call(e,r)&&r!==n&&Ie(e,r,{get:()=>t[r],enumerable:!(i=It(t,r))||i.enumerable});return e};var wt=e=>vt(Ie({},"__esModule",{value:!0}),e);var gn={};Ot(gn,{applyCreatedNativeTextRanges:()=>nt,assertNativeTextRangeBoundary:()=>tt,createNativeTextExportCapture:()=>St,finalizeCreatedNativeTextRanges:()=>yt,nativeTextContent:()=>ve,nativeTextLineHeight:()=>se,nativeTextPlan:()=>Qe,nativeTextRangeCreationPlan:()=>xe,validTextLineHeight:()=>K,validateTextRanges:()=>V});function K(e){return Number.isFinite(e.lineHeight)?e.lineHeightUnit===void 0?e.lineHeight>=.7&&e.lineHeight<=3:e.lineHeightUnit==="pixels"&&e.lineHeight>=4.2&&e.lineHeight<=720:!1}function se(e){if(!K(e))throw Error("文字行高或单位无效。");return e.lineHeightUnit==="pixels"?{unit:"PIXELS",value:e.lineHeight}:{unit:"PERCENT",value:e.lineHeight*100}}var ge=["fill","textDecoration","textDecorationThickness","textUnderlineOffset","textDecorationSkipInk","href"],$e=e=>e!==null&&typeof e=="object"&&[Object.prototype,null].includes(Object.getPrototypeOf(e)),I=(e,t="TEXT_RANGES_INVALID")=>{let n=new Error(e);throw n.code=t,n},Te=(e,t)=>Object.hasOwn(e,t),pe=(e,t)=>$e(e)&&Object.keys(e).every(n=>t.includes(n));function ze(e){let t=JSON.stringify(e),n=0;for(let i=0;i<t.length;i++){let r=t.charCodeAt(i);n+=r<128?1:r<2048?2:Oe(r)&&he(t.charCodeAt(i+1))?(i++,4):3}return n}function Re(e,t=new Set,n=0){if(e===null||typeof e!="object")return e;(n>64||t.has(e)||!Array.isArray(e)&&!$e(e))&&I("文字编辑仅接受有界无环纯数据"),t.add(e);let i=Array.isArray(e)?e.map(r=>Re(r,t,n+1)):Object.fromEntries(Object.entries(e).map(([r,s])=>[r,Re(s,t,n+1)]));return t.delete(e),i}var Oe=e=>e>=55296&&e<=56319,he=e=>e>=56320&&e<=57343;function q(e){if(typeof e!="string"||e.length>4e3)return!1;for(let t=0;t<e.length;t++){let n=e.charCodeAt(t);if(Oe(n)){if(!he(e.charCodeAt(++t)))return!1}else if(he(n))return!1}return!0}function We(e,t){return Number.isInteger(t)&&t>=0&&t<=e.length&&!(t>0&&t<e.length&&Oe(e.charCodeAt(t-1))&&he(e.charCodeAt(t)))}function Z(e){return q(e)||I("范围文字必须是最多4000个 UTF16 单元的完整 Unicode 字符串"),JSON.stringify([e])}var Ye=e=>typeof e.textSource=="string"?e.textSource:e.text,Pt=(e,t)=>JSON.stringify(e)===JSON.stringify(t),be=e=>Object.fromEntries(ge.filter(t=>Te(e,t)).map(t=>[t,Re(e[t])]));function Xt(e,t,n){if(pe(e,["unit","value"])||I("文字装饰长度包含未知字段"),e.unit==="auto")return Te(e,"value")&&I("auto 装饰长度不能包含数值"),{unit:"auto"};let i=e.unit==="em"?10:e.unit==="px"?100:NaN,r=e.value,s=e.unit==="em"?r*t:r;return(!Number.isFinite(i)||typeof r!="number"||!Number.isFinite(r)||Math.abs(r)>i||n&&r<=0||!Number.isFinite(s)||Math.abs(s)>100)&&I("文字装饰长度超出有限 px/em 范围"),{unit:e.unit,value:r}}function oe(e){if(typeof e!="string"||!e||e.length>2048||/[\u0000-\u0020\u007f]/u.test(e[0])||/[\u0000-\u0020\u007f]/u.test(e.at(-1))||/[\u0000-\u001f\u007f]/u.test(e)||!q(e))return!1;if(e.startsWith("#")||/^(?:mailto|tel):[^\s\\]+$/iu.test(e))return!0;let t=/^https?:\/\/([^/?#]+)(?:[/?#][^\\]*)?$/iu.exec(e);if(!t||/\s|\\/u.test(e))return!1;let n=/^(\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([0-9]+))?$/iu.exec(t[1]);return!!(n&&!n[1].includes("..")&&(!n[2]||Number(n[2])<=65535))}function Dt(e,t){pe(e,ge)||I("文字范围样式包含未知字段");let n={};for(let i of ge){if(!Te(e,i))continue;let r=e[i];i==="fill"?((typeof r!="string"||!/^#[0-9a-f]{6}$/iu.test(r))&&I("文字范围填色必须是不透明六位十六进制颜色"),n.fill=r.toLowerCase()):i==="textDecoration"?(["none","underline","line-through"].includes(r)||I("文字范围装饰无效"),n[i]=r):i==="textDecorationThickness"||i==="textUnderlineOffset"?n[i]=Xt(r,t,i==="textDecorationThickness"):i==="textDecorationSkipInk"?(["auto","none"].includes(r)||I("文字范围 skip-ink 无效"),n[i]=r):(oe(r)||I("文字范围链接目标无效"),n.href=r)}return["textDecorationThickness","textUnderlineOffset","textDecorationSkipInk"].some(i=>Te(n,i))&&n.textDecoration!=="underline"&&I("范围下划线参数需要同一范围显式 underline"),n}function kt(e){let t=[];for(let n of e){let i=be(n);if(!Object.keys(i).length)continue;let r=t.at(-1);r?.end===n.start&&Pt(be(r),i)?r.end=n.end:t.push({start:n.start,end:n.end,...i})}return t}function Je(e){if(e?.textRanges===void 0)return;e.type!=="text"&&I("textRanges 仅用于文字图层");let t=Ye(e),n=e.textRanges;(!q(t)||!q(e.text))&&I("范围文字来源或显示内容无效"),(!pe(n,["version","sourceSignature","ranges"])||n.version!==1||typeof n.sourceSignature!="string"||n.sourceSignature.length>24004||!Array.isArray(n.ranges)||n.ranges.length>64||ze(n)>32768)&&I("textRanges 版本、字段或预算无效"),n.sourceSignature!==Z(t)&&I("textRanges 与当前完整文字来源签名不一致","TEXT_RANGES_STALE"),e.textOverflow!==void 0&&I("范围文字暂不支持截断","TEXT_RANGES_UNSUPPORTED_TRUNCATION"),e.fillPaints!==void 0&&n.ranges.length&&I("范围文字暂不支持基础 paint stack；请先显式选择纯色","TEXT_RANGES_UNSUPPORTED_BASE_PAINT");let i=0,r=Array.from(n.ranges,(a,o)=>((!pe(a,["start","end",...ge])||!We(t,a.start)||!We(t,a.end)||a.start>=a.end||o>0&&a.start<i)&&I("文字范围必须排序、不重叠并位于 UTF16 字符边界"),i=a.end,{start:a.start,end:a.end,...Dt(be(a),e.fontSize)})),s={version:1,sourceSignature:n.sourceSignature,ranges:kt(r)};return ze(s)>32768&&I("textRanges 超出字节预算"),s.ranges.length?s:void 0}function Ke(e){let t=Ye(e),n=e.text;(!q(t)||!q(n))&&I("范围文字来源或显示内容无效");let i=[],r=0,s=0;for(;s<n.length;){let a=String.fromCodePoint(n.codePointAt(s));if(t.startsWith(a,r)){let o=i.at(-1);o?.kind==="source"&&o.sourceEnd===r&&o.displayEnd===s?(o.sourceEnd+=a.length,o.displayEnd+=a.length):i.push({kind:"source",sourceStart:r,sourceEnd:r+a.length,displayStart:s,displayEnd:s+a.length}),r+=a.length}else a===`
`&&e.textFlow==="wrap"?i.push({kind:"soft-break",sourceOffset:r,displayStart:s,displayEnd:s+1}):I("范围显示文字必须保留每个来源字符；仅允许添加软换行","TEXT_RANGES_DISPLAY_MISMATCH");s+=a.length}return r!==t.length&&I("范围显示文字丢失来源字符","TEXT_RANGES_DISPLAY_MISMATCH"),{sourceText:t,displayText:n,sourceSignature:Z(t),segments:i}}function V(e){let t=Je(e);return e?.textRanges!==void 0&&Ke(e),t}function Ee(e){return Je(e),Ke(e)}function qe(e){return!!(e&&typeof e=="object"&&!Array.isArray(e)&&Object.keys(e).every(t=>["version","signature","sourceSignature","lineWidths","lineInkBounds","height","fontAvailable"].includes(t))&&e.version===1&&typeof e.signature=="string"&&e.signature.length<=8500&&(e.sourceSignature===void 0||typeof e.sourceSignature=="string"&&e.sourceSignature.length<=8500)&&Array.isArray(e.lineWidths)&&e.lineWidths.length>=1&&e.lineWidths.length<=4001&&e.lineWidths.every(t=>Number.isFinite(t)&&t>=0&&t<=1e6)&&Array.isArray(e.lineInkBounds)&&e.lineInkBounds.length===e.lineWidths.length&&e.lineInkBounds.every(t=>t&&typeof t=="object"&&!Array.isArray(t)&&Object.keys(t).length===4&&["x","y","width","height"].every(n=>Number.isFinite(t[n])&&Math.abs(t[n])<=1e6)&&t.width>=0&&t.height>=0)&&Number.isFinite(e.height)&&e.height>=0&&e.height<=1e6&&typeof e.fontAvailable=="boolean")}var Ze=e=>{try{let t=JSON.parse(e);return Array.isArray(t)&&(t.length===8||t.length===9&&t[8]==="pixels")&&typeof t[0]=="string"?t[0]:void 0}catch{return}};function Ct(e,t){let n=0;for(let i of e)if(t.startsWith(i,n))n+=i.length;else if(i!==`
`)return!1;return n===t.length}function ve(e,t){if(e.textRanges!==void 0)return V(e),Ee(e).sourceText;let n=e.text??"",i=e.textSource;if(typeof i!="string"||n===i)return n;if(qe(e.textMetrics)){let r=Ze(e.textMetrics.signature),s=Ze(e.textMetrics.sourceSignature);if(n===r)return i;if(r!==void 0&&(s===void 0||i===s))return n}return t&&n===t.text&&i!==t.textSource||e.textFlow==="wrap"&&Ct(n,i)||e.textOverflow==="ellipsis"&&n.endsWith("…")&&i.startsWith(n.slice(0,-1).trimEnd())?i:n}function Qe(e,t){return{characters:ve(e,t),autoResize:e.layoutSizingHorizontal==="hug"?"WIDTH_AND_HEIGHT":e.layoutSizingVertical==="hug"?"HEIGHT":"NONE",truncation:e.textOverflow==="ellipsis"?"ENDING":"DISABLED",maxLines:e.textOverflow==="ellipsis"?1:null}}var On=129,ye=["textDecorationThickness","textUnderlineOffset","textDecorationSkipInk"],ae=(e,t)=>Object.hasOwn(e,t),et=new WeakSet,P=(e,t)=>{let n=new Error(t);throw n.code=e,et.add(n),n},Ne="Native range planning requires a valid complete content-bound Text source.",Mt=new Set(["TEXT_RANGES_INVALID","TEXT_RANGES_STALE","TEXT_RANGES_DISPLAY_MISMATCH","TEXT_RANGES_UNSUPPORTED_TRUNCATION","TEXT_RANGES_UNSUPPORTED_BASE_PAINT"]),Gt=["type","text","textSource","textFlow","textRanges","fill","fillPaints","textDecoration",...ye,"textOverflow","fontSize"];function Ut(e){let t=()=>P("TEXT_RANGES_NATIVE_INVALID_SOURCE",Ne),n=d=>d!==null&&typeof d=="object"&&!Array.isArray(d)&&[Object.prototype,null].includes(Object.getPrototypeOf(d));n(e)||P("TEXT_RANGES_NATIVE_INVALID_NODE","Native range planning requires a canonical Text node.");let i=0,r=0,s=d=>{for(let y of JSON.stringify(d)){let E=y.codePointAt(0);r+=E<128?1:E<2048?2:E<65536?3:4}r>96*1024&&t()},a=(d,y=new Set,E=0)=>{if((++i>2048||E>8)&&t(),d===null||typeof d=="boolean"||typeof d=="number"&&Number.isFinite(d))return s(d),d;if(typeof d=="string")return d.length>32768&&t(),s(d),d;let A=Array.isArray(d);(!A&&!n(d)||y.has(d))&&t();let c=Object.getOwnPropertyDescriptors(d),h=Reflect.ownKeys(c),R=A?c.length?.value:void 0;(h.some(T=>typeof T!="string")||A&&(!Number.isInteger(R)||R>64))&&t();let S=A?h.filter(T=>T!=="length"):h;(S.length>16&&!A||A&&(S.length!==R||S.some((T,N)=>T!==String(N))))&&t(),y.add(d);let u=A?[]:{};for(let T of S){let N=c[T];(!ae(N,"value")||!N.enumerable)&&t(),s(T),Object.defineProperty(u,T,{value:a(N.value,y,E+1),enumerable:!0,writable:!0,configurable:!0})}return y.delete(d),u},o=Object.getOwnPropertyDescriptors(e),f={};for(let d of Gt){if(!ae(o,d))continue;let y=o[d];(!ae(y,"value")||!y.enumerable)&&t(),ye.includes(d)&&P("TEXT_RANGES_NATIVE_UNSUPPORTED_DECORATION","Native range planning currently supports no text decoration or CSS underline geometry."),d==="fillPaints"&&y.value!==void 0&&P("TEXT_RANGES_NATIVE_UNSUPPORTED_PAINT","Native text range planning supports one opaque hex base fill only."),y.value!==void 0&&(f[d]=a(y.value))}return f}function Lt(e){try{return{ranges:V(e)?.ranges??[],characters:Ee(e).sourceText}}catch(t){let n;try{n=t&&typeof t=="object"?Object.getOwnPropertyDescriptor(t,"code")?.value:void 0}catch{}P(Mt.has(n)?n:"TEXT_RANGES_NATIVE_INVALID_SOURCE",Ne)}}function Ht(e){let t=()=>P("TEXT_RANGES_NATIVE_UNSUPPORTED_LINK","Native range links support conservative absolute HTTP(S) URLs and bare ASCII mailto addresses only.");if(oe(e)||t(),/^https?:\/\//iu.test(e)){let r=/^https?:\/\/([^/?#]+)/iu.exec(e)[1].replace(/:[0-9]+$/u,""),s=r.split(".");return(r.length>253||s.some(a=>!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(a)))&&t(),/^(?:[0-9]+|0x[0-9a-f]*)$/iu.test(s.at(-1))&&!(s.length===4&&s.every(a=>/^(?:0|[1-9][0-9]{0,2})$/u.test(a)&&Number(a)<=255))&&t(),{type:"URL",value:e}}let n=/^mailto:([a-z0-9_+.-]{1,64})@([a-z0-9.-]{1,253})$/iu.exec(e);return(!n||n[1].startsWith(".")||n[1].endsWith(".")||n[1].includes("..")||n[2].split(".").length<2||n[2].split(".").some(i=>!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(i)))&&t(),{type:"URL",value:e}}function jt(e){(!e||typeof e!="object"||Array.isArray(e)||e.type!=="text")&&P("TEXT_RANGES_NATIVE_INVALID_NODE","Native range planning requires a canonical Text node."),e.textSource!==void 0&&typeof e.textSource!="string"&&P("TEXT_RANGES_NATIVE_INVALID_SOURCE",Ne),(typeof e.fill!="string"||!/^#[0-9a-f]{6}$/iu.test(e.fill)||e.fillPaints!==void 0)&&P("TEXT_RANGES_NATIVE_UNSUPPORTED_PAINT","Native text range planning supports one opaque hex base fill only."),(e.textDecoration!==void 0&&e.textDecoration!=="none"||ye.some(a=>ae(e,a)))&&P("TEXT_RANGES_NATIVE_UNSUPPORTED_DECORATION","Native range planning currently supports no text decoration or CSS underline geometry."),e.textOverflow!==void 0&&P("TEXT_RANGES_UNSUPPORTED_TRUNCATION","Native range planning does not support truncated text.");let{characters:t,ranges:n}=Lt(e),i=e.fill.toLowerCase(),r=[],s=0;for(let a of n)(a.textDecoration!==void 0&&a.textDecoration!=="none"||ye.some(o=>ae(a,o)))&&P("TEXT_RANGES_NATIVE_UNSUPPORTED_DECORATION","Native range planning currently supports no text decoration or CSS underline geometry."),s<a.start&&r.push({start:s,end:a.start,fill:i,hyperlink:null}),r.push({start:a.start,end:a.end,fill:a.fill??i,hyperlink:a.href===void 0?null:Ht(a.href)}),s=a.end;return s<t.length&&r.push({start:s,end:t.length,fill:i,hyperlink:null}),{characters:t,runs:r}}function Q(e){try{return jt(Ut(e))}catch(t){if(t!==null&&typeof t=="object"&&et.has(t))throw t;P("TEXT_RANGES_NATIVE_INVALID_SOURCE",Ne)}}function tt(e){if(e?.textRanges===void 0)return;let t=(typeof e.name=="string"?e.name:typeof e.id=="string"?e.id:"Text").slice(0,120),n=new Error(t+"：范围文字的此项原生互转尚未完成验证；已阻止互转，未丢弃范围样式。");throw n.code="TEXT_RANGES_NATIVE_UNSUPPORTED",n}function xe(e){if(e?.textRanges!==void 0)try{return Q(e)}catch(t){let n={TEXT_RANGES_NATIVE_UNSUPPORTED_LINK:"范围文字的原生链接目前只支持完整 HTTP(S) 地址和简单 mailto 地址",TEXT_RANGES_NATIVE_UNSUPPORTED_DECORATION:"范围文字的原生装饰仍待验证；请先移除下划线和删除线",TEXT_RANGES_NATIVE_UNSUPPORTED_PAINT:"范围文字的原生填充目前只支持不透明纯色"},i=typeof t?.code=="string"?t.code:"TEXT_RANGES_NATIVE_INVALID_SOURCE",r=new Error(n[i]??"范围文字的完整来源或区间无效，已阻止创建副本");throw r.code=i,r}}function nt(e,t){let n=xe(t);if(!n)return;let i=["setRangeHyperlink","setRangeFills","setRangeTextDecoration"];if(e?.type!=="TEXT"||e.characters!==n.characters||i.some(o=>typeof e[o]!="function")){let o=new Error("范围文字的原生写入能力或完整来源不匹配，已阻止创建副本");throw o.code="TEXT_RANGES_NATIVE_WRITE_UNAVAILABLE",o}let[r,s,a]=i.map(o=>e[o]);for(let o of n.runs){r.call(e,o.start,o.end,o.hyperlink);let f=[1,3,5].map(d=>parseInt(o.fill.slice(d,d+2),16)/255);s.call(e,o.start,o.end,[{type:"SOLID",color:{r:f[0],g:f[1],b:f[2]}}]),a.call(e,o.start,o.end,"NONE")}return n}var Bt=Object.freeze(["textDecoration","textDecorationStyle","textDecorationOffset","textDecorationThickness","textDecorationColor","textDecorationSkipInk","hyperlink"]),_e=(e,t)=>Object.prototype.hasOwnProperty.call(e,t),ce=e=>{try{let t=e&&typeof e=="object"?Object.getOwnPropertyDescriptor(e,"message"):void 0;return t&&_e(t,"value")&&typeof t.value=="string"?t.value.slice(0,240):"Native getter failed"}catch{return"Native getter failed"}},B=e=>{throw new Error(e)},rt=new WeakSet,it=e=>e!==null&&typeof e=="object"&&rt.has(e),le=e=>{let t=new Error(e);throw rt.add(t),t};function we(e){let t=0;for(let n of e){let i=n.codePointAt(0);t+=i<128?1:i<2048?2:i<65536?3:4}return t}function st(e,t,{fields:n,scalarFields:i=[]}={}){let r=[],s=(c,h)=>({status:"unsupported",diagnostics:[...r,{code:c,message:h}]});if(!e||e.type!=="TEXT")return s("NATIVE_TEXT_CAPTURE_TYPE","Native source must be TEXT");if(typeof t!="symbol")return s("NATIVE_TEXT_CAPTURE_MIXED","Native mixed identity is unavailable");if(!Array.isArray(n)||!n.length||n.length>64||!Array.isArray(i)||i.length>64||[...n,...i].some(c=>typeof c!="string"||!/^[a-zA-Z][a-zA-Z0-9]*$/u.test(c))||new Set(n).size!==n.length||new Set(i).size!==i.length)return s("NATIVE_TEXT_CAPTURE_FIELDS","Native field catalog is invalid");let a;try{a=e.characters}catch(c){return s("NATIVE_TEXT_CAPTURE_CHARACTERS",ce(c))}if(typeof a!="string"||a.length>4e3)return s("NATIVE_TEXT_CAPTURE_BUDGET","Native text exceeds the complete 4000 UTF16 source budget");let o=0,f=0,d=c=>{(f+=c)>262144&&le("Complete native observations exceed 256 KiB")},y=(c,h=new Set,R=0)=>{if((++o>4e4||R>12)&&le("Native observation exceeds its data budget"),c===null||typeof c=="boolean")return d(c===null||c?4:5),c;if(typeof c=="number")return Number.isFinite(c)||B("Nonfinite native number"),d(String(c).length),c;if(typeof c=="string")return c.length>262144&&le("Native string exceeds its data budget"),d(we(JSON.stringify(c))),c;(typeof c!="object"||c===t)&&B("Unsupported native host value"),h.has(c)&&B("Cyclic native observation");let S=Array.isArray(c),u=Object.getPrototypeOf(c);!S&&u!==Object.prototype&&u!==null&&B("Unsupported native object prototype");let T=Object.getOwnPropertyDescriptors(c),N=Reflect.ownKeys(T);N.some(l=>typeof l!="string")&&B("Native symbol key is not JSON data"),S&&(!Number.isInteger(c.length)||c.length>1024)&&le("Native array exceeds its data budget");let x=S?N.filter(l=>l!=="length"):N;x.length>512&&le("Native object exceeds its data budget"),S&&x.length!==c.length&&B("Native object is sparse"),S&&x.some((l,g)=>l!==String(g))&&B("Native array has extra properties"),h.add(c),d(2);let _=S?[]:{};for(let l of x){let g=T[l];(!_e(g,"value")||!g.enumerable)&&B("Native observation has an accessor or hidden field"),d((S?0:we(JSON.stringify(l))+1)+1),Object.defineProperty(_,l,{value:y(g.value,h,R+1),enumerable:!0,configurable:!0,writable:!0})}return h.delete(c),_},E=c=>{try{let h=c();return h===t?{kind:"mixed"}:h===void 0?{kind:"missing"}:{kind:"value",value:y(h)}}catch(h){if(it(h))throw h;return{kind:"error",message:ce(h)}}},A=()=>{let c={};for(let l of new Set([...n,...i]))c[l]=E(()=>e[l]);let h;try{h=e.getStyledTextSegments([...n])}catch(l){return s("NATIVE_TEXT_CAPTURE_SEGMENTS",ce(l))}if(!Array.isArray(h)||h.length>256)return s("NATIVE_TEXT_CAPTURE_BUDGET","Native segments exceed their complete source budget");let R=Object.getOwnPropertyDescriptors(h),S=Reflect.ownKeys(R);if(S.some(l=>typeof l!="string"||l!=="length"&&!/^(0|[1-9][0-9]*)$/u.test(l))||S.length!==h.length+1)return s("NATIVE_TEXT_CAPTURE_SEGMENTS","Native segment array is not dense owned data");let u=[],T=[],N=0;for(let l=0;l<h.length;l++){let g=R[String(l)];if(!g||!_e(g,"value")||!g.enumerable)return s("NATIVE_TEXT_CAPTURE_SEGMENTS","Native segment entry is not owned data");let b=g.value;if(!b||typeof b!="object"||Array.isArray(b)||![Object.prototype,null].includes(Object.getPrototypeOf(b)))return s("NATIVE_TEXT_CAPTURE_SEGMENTS","Native segment is not a plain record");let X=Object.getOwnPropertyDescriptors(b);if(Reflect.ownKeys(X).some(L=>typeof L!="string"||!_e(X[L],"value")||!X[L].enumerable))return s("NATIVE_TEXT_CAPTURE_SEGMENTS","Native segment contains accessors or hidden data");let U=X.start?.value,C=X.end?.value,He=X.characters?.value;if(!Number.isInteger(U)||!Number.isInteger(C)||U!==N||C<=U||C>a.length||He!==a.slice(U,C)||U>0&&/[\uD800-\uDBFF]/u.test(a[U-1])&&/[\uDC00-\uDFFF]/u.test(a[U])||C<a.length&&/[\uD800-\uDBFF]/u.test(a[C-1])&&/[\uDC00-\uDFFF]/u.test(a[C]))return s("NATIVE_TEXT_CAPTURE_SEGMENTS","Native segments do not cover exact UTF16 source boundaries");let je={},Be={};for(let L of n)je[L]=E(()=>X[L]?.value);for(let L of Bt){let mt=`getRange${L[0].toUpperCase()}${L.slice(1)}`;Be[L]=E(()=>{let Fe=e[mt];return typeof Fe=="function"?Fe.call(e,U,C):void 0})}u.push({start:U,end:C,characters:He,values:je}),T.push({start:U,end:C,values:Be}),N=C}if(N!==a.length)return s("NATIVE_TEXT_CAPTURE_SEGMENTS","Native segments leave an uncaptured source suffix");let x;try{x=e.characters}catch(l){return s("NATIVE_TEXT_CAPTURE_CHARACTERS",ce(l))}if(x!==a)return s("NATIVE_TEXT_CAPTURE_RACE","Native characters changed during source capture");let _={characters:a,scalars:c,segments:u,rangeChecks:T};return we(JSON.stringify(_))>262144?s("NATIVE_TEXT_CAPTURE_BUDGET","Complete native source exceeds 256 KiB"):{status:"captured",observations:_,diagnostics:r}};try{return A()}catch(c){return s(it(c)?"NATIVE_TEXT_CAPTURE_BUDGET":"NATIVE_TEXT_CAPTURE_DATA",ce(c))}}var ee=256*1024,Ft=256,zt=256,F=Object.freeze(["fontName","fontSize","fontWeight","fontStyle","lineHeight","letterSpacing","fills","textDecoration","textDecorationStyle","textDecorationOffset","textDecorationThickness","textDecorationColor","textDecorationSkipInk","hyperlink","textCase","openTypeFeatures","textStyleId","fillStyleId","listOptions","listSpacing","indentation","paragraphIndent","paragraphSpacing","textStyleOverrides","boundVariables","textWrapStyle"]),ne=Object.freeze(["hasMissingFont","textTruncation","maxLines","leadingTrim","hangingPunctuation","hangingList","textAlignHorizontal","textAlignVertical","textAutoResize","layoutSizingHorizontal","layoutSizingVertical"]),ot=["id","type","characters","style","characterStyleOverrides","styleOverrideTable","fills","lineTypes","lineIndentations","textTruncation","maxLines","textAutoResize","layoutSizingHorizontal","layoutSizingVertical","hasMissingFont","leadingTrim","hangingPunctuation","hangingList"],O=(e,t)=>Object.hasOwn(e,t),W=(e,t,n)=>O(e,t)?e[t]:n,w=e=>e!==null&&typeof e=="object"&&[Object.prototype,null].includes(Object.getPrototypeOf(e)),$=(e,t,n={})=>({code:e,message:t,...n}),p=(e,t="NATIVE_TEXT_RANGES_INVALID")=>{let n=new Error(e);throw n.code=t,n},D=(e,t)=>w(e)&&Object.keys(e).every(n=>t.includes(n)),j=(e,t)=>te(e)===te(t);function at(e){let t=0;for(let n=0;n<e.length;n++){let i=e.charCodeAt(n);t+=i<128?1:i<2048?2:i>=55296&&i<=56319&&e.charCodeAt(n+1)>=56320&&e.charCodeAt(n+1)<=57343?(n++,4):3}return t}function ie(e,t={size:0,seen:new Set},n=0){n>12&&p("Native text source exceeds depth12","NATIVE_TEXT_RANGES_BUDGET");let i=o=>{(t.size+=o)>ee&&p("Native text source exceeds256KiB","NATIVE_TEXT_RANGES_BUDGET")};if(e===null||typeof e=="boolean")return i(e===null||e?4:5),e;if(typeof e=="string")return i(at(JSON.stringify(e))),e;if(typeof e=="number"&&Number.isFinite(e))return i(String(e).length),e;(!Array.isArray(e)&&!w(e)||t.seen.has(e))&&p("Native text source must be acyclic plain JSON"),t.seen.add(e),i(2),Array.isArray(e)&&e.length*2+1>ee&&p("Native array exceeds minimum JSON byte budget","NATIVE_TEXT_RANGES_BUDGET");let r=Object.getOwnPropertyDescriptors(e),s=[];Reflect.ownKeys(e).some(o=>typeof o!="string")&&p("Native text source contains symbol keys"),Array.isArray(e)&&e.length>ee&&p("Native array exceeds budget","NATIVE_TEXT_RANGES_BUDGET");let a=Array.isArray(e)?Array.from({length:e.length},(o,f)=>String(f)):Object.keys(r);if(Array.isArray(e)){let o=new Set(a);Object.keys(r).some(f=>f!=="length"&&!o.has(f))&&p("Native text source array is not JSON")}for(let o of a){let f=r[o];(!f||!O(f,"value")||!f.enumerable)&&p("Native text source contains holes or accessors"),i((Array.isArray(e)?0:at(JSON.stringify(o))+1)+(s.length?1:0)),s.push([o,ie(f.value,t,n+1)])}return t.seen.delete(e),Array.isArray(e)?s.map(o=>o[1]):Object.fromEntries(s)}function te(e){return e===null||typeof e!="object"?JSON.stringify(e):Array.isArray(e)?`[${e.map(te).join(",")}]`:`{${Object.keys(e).sort().map(t=>`${JSON.stringify(t)}:${te(e[t])}`).join(",")}}`}function lt(e){w(e)||p("Native source must be plain JSON"),["type","id","characters"].some(n=>{let i=Object.getOwnPropertyDescriptor(e,n);return i&&!O(i,"value")})&&p("REST source contains accessors"),(e.type!=="TEXT"||typeof e.id!="string"||!e.id||e.id.length>160)&&p("Native source is not an identified TEXT");let t=Object.getOwnPropertyDescriptors(e);return ot.some(n=>O(t,n)&&!O(t[n],"value"))&&p("REST source contains accessors"),Z(e.characters),te(ie(Object.fromEntries(ot.filter(n=>O(e,n)).map(n=>[n,e[n]]))))}function Wt(e){w(e)||p("Native observation must have an explicit kind"),!(e.kind==="value"&&D(e,["kind","value"])&&O(e,"value"))&&(["mixed","missing"].includes(e.kind)&&D(e,["kind"])||e.kind==="error"&&D(e,["kind","message"])&&typeof e.message=="string"&&e.message.length<=2e3||p("Malformed native observation"))}function Pe(e,t=!1){D(e,t?[...F,...ne]:F)||p("Unknown native observation field");for(let n of Object.values(e))Wt(n)}var Ae=(e,t)=>Number.isInteger(t)&&t>=0&&t<=e.length&&!(t>0&&t<e.length&&/[\ud800-\udbff]/u.test(e[t-1])&&/[\udc00-\udfff]/u.test(e[t]));function ft(e){(!D(e,["version","nodeId","characters","restSignature","scalars","segments","rangeChecks"])||e.version!==1||typeof e.nodeId!="string"||typeof e.restSignature!="string")&&p("Malformed native text source version"),Z(e.characters),Pe(e.scalars,!0),(!Array.isArray(e.segments)||e.segments.length>Ft||!Array.isArray(e.rangeChecks)||e.rangeChecks.length>zt)&&p("Native text source exceeds segment/check budget","NATIVE_TEXT_RANGES_BUDGET");let t=0;for(let n of e.segments)(!D(n,["start","end","characters","values"])||!Ae(e.characters,n.start)||!Ae(e.characters,n.end)||n.start!==t||n.end<=n.start||n.characters!==e.characters.slice(n.start,n.end))&&p("Native segments do not cover exact authored UTF16 text"),Pe(n.values),t=n.end;t!==e.characters.length&&p("Native segments omit authored text");for(let n of e.rangeChecks)(!D(n,["start","end","values"])||!Ae(e.characters,n.start)||!Ae(e.characters,n.end)||n.start>=n.end)&&p("Invalid native getter range"),Pe(n.values)}var M=(e,t)=>e[t]?.kind==="value"?e[t].value:void 0;function ct(e){return Array.isArray(e)?e.map(t=>({type:t.type,visible:W(t,"visible",!0),opacity:W(t,"opacity",1),blendMode:W(t,"blendMode","NORMAL"),boundVariables:O(t,"boundVariables")?t.boundVariables:{},color:t.color&&{r:t.color.r,g:t.color.g,b:t.color.b,a:W(t.color,"a",1)}})):e}function G(e,t=!1){if(e===null)return null;if(D(e,["type",t?"url":"value"])&&e.type==="URL"&&typeof e[t?"url":"value"]=="string")return e[t?"url":"value"]}function $t(e,t){let n=e.characterStyleOverrides??[],i=e.styleOverrideTable??{},r=Array.from(t.characters).length;e.style!==void 0&&!w(e.style)&&p("Malformed REST text style"),(!Array.isArray(n)||n.length>r||!w(i)||n.some(o=>!Number.isInteger(o)||o<0||o!==0&&!w(i[o])))&&p("Malformed REST character styles");let s=()=>p("REST and live native style differ; source may have changed during capture","NATIVE_TEXT_RANGES_CAPTURE_RACE");for(let o of ne){let f=t.scalars[o];f?.kind==="value"&&(O(e,o)&&!j(e[o],f.value)||O(e.style??{},o)&&!j(e.style[o],f.value))&&s()}let a=0;for(let o of t.segments){let f=o.values;for(let d=o.start;d<o.end;d+=t.characters.codePointAt(d)>65535?2:1){let y=n[a++]??0,E={...e.style??{},...y===0?{}:i[y]};for(let S of["fontSize","fontWeight","textDecoration","textCase"])O(E,S)&&f[S]?.kind==="value"&&!j(E[S],M(f,S))&&s();let A=M(f,"fontName");A&&(O(E,"fontFamily")&&E.fontFamily!==A.family||O(E,"fontStyle")&&E.fontStyle!==A.style)&&s();let c=E.fills??e.fills;c!==void 0&&f.fills?.kind==="value"&&!j(ct(c),ct(M(f,"fills")))&&s(),O(E,"hyperlink")&&f.hyperlink?.kind==="value"&&G(E.hyperlink,!0)!==void 0&&G(M(f,"hyperlink"))!==void 0&&G(E.hyperlink,!0)!==G(M(f,"hyperlink"))&&s();let h=M(f,"lineHeight");E.lineHeightUnit==="PIXELS"&&h&&(h.unit!=="PIXELS"||E.lineHeightPx!==h.value)&&s(),["FONT_SIZE_%","PERCENT"].includes(E.lineHeightUnit)&&h&&(h.unit!=="PERCENT"||E.lineHeightPercentFontSize!==h.value&&!(typeof h.value=="number"&&typeof E.lineHeightPercentFontSize=="number"&&E.lineHeightPercentFontSize===Math.fround(h.value)))&&s();let R=M(f,"letterSpacing");if(O(E,"letterSpacing")&&R&&["PIXELS","PERCENT"].includes(R.unit)){let S=R.unit==="PIXELS"?R.value:R.value*M(f,"fontSize")/100;E.letterSpacing!==S&&s()}}}}function Yt(e){let t=[];for(let[n,i]of Object.entries(e.scalars)){if(["error","missing"].includes(i.kind)&&t.push($("NATIVE_TEXT_RANGES_SCALAR_OBSERVATION","Native scalar observation remains raw",{field:n,kind:i.kind})),n==="hyperlink"&&i.kind==="value"&&G(i.value)!==void 0){let r=e.segments.map(s=>s.values.hyperlink);if(r.length&&r.every(s=>s?.kind==="value"&&G(s.value)!==void 0)){let s=[...new Set(r.map(o=>G(o.value)).filter(o=>o!==null))],a=s.length===0?null:s.length===1?s[0]:void 0;(a===void 0||G(i.value)!==a)&&p("Native scalar hyperlink conflicts with complete styled segments","NATIVE_TEXT_RANGES_CAPTURE_RACE")}}n==="hyperlink"&&i.kind==="value"&&G(i.value)===void 0&&t.push($("NATIVE_TEXT_RANGES_HYPERLINK_UNKNOWN","Native scalar hyperlink is not interpreted as no-link",{field:n,value:i.value}))}for(let[n,i]of Object.entries(e.scalars)){if(i.kind!=="value"||!F.includes(n)||n==="hyperlink")continue;let r=e.segments.map(s=>s.values[n]);r.length&&r.every(s=>s?.kind==="value")&&r.every(s=>j(s.value,r[0].value))&&!j(i.value,r[0].value)&&p("Native scalar conflicts with uniform styled segments","NATIVE_TEXT_RANGES_CAPTURE_RACE")}for(let[n,i]of e.rangeChecks.entries())for(let[r,s]of Object.entries(i.values)){if(s.kind!=="value"){t.push($("NATIVE_TEXT_RANGES_GETTER_OBSERVATION","Native getter observation remains raw",{field:r,index:n,kind:s.kind}));continue}if(r==="hyperlink"&&G(s.value)===void 0){t.push($("NATIVE_TEXT_RANGES_HYPERLINK_UNKNOWN","Native hyperlink getter value is not interpreted as no-link",{field:r,index:n,value:s.value}));continue}let o=e.segments.filter(f=>f.start<i.end&&f.end>i.start).map(f=>f.values[r]);o.length&&o.every(f=>f?.kind==="value")&&o.every(f=>j(f.value,o[0].value))&&!j(s.value,o[0].value)&&p("Valid native range getter conflicts with styled segments","NATIVE_TEXT_RANGES_CAPTURE_RACE")}return t}var Xe=e=>({status:e.code==="NATIVE_TEXT_RANGES_STALE"?"stale":"invalid",diagnostics:[$(e.code??"NATIVE_TEXT_RANGES_INVALID",e.message)]});function H(e,t,n){w(e)||p("Native codec input must be plain data");let i=Object.getOwnPropertyDescriptor(e,t);return i?(O(i,"value")||p("Native codec input contains accessors"),i.value):n}function ut(e){try{let t=H(e,"rest"),n=H(e,"characters"),i=H(e,"scalars"),r=H(e,"segments"),s=H(e,"rangeChecks",[]),a=lt(t),o=ie({version:1,nodeId:t.id,characters:n,restSignature:a,scalars:i,segments:r,rangeChecks:s});return fe(t,o)}catch(t){return Xe(t)}}function fe(e,t){try{if(t===void 0&&(t=H(e,"codeshellNativeTextRanges")),t===void 0)return{status:"absent",diagnostics:[]};let n=ie(t);ft(n);let i=lt(e);return(n.nodeId!==e.id||n.characters!==e.characters||n.restSignature!==i)&&p("Native text evidence is stale for this REST node","NATIVE_TEXT_RANGES_STALE"),$t(e,n),{status:"bound",source:n,diagnostics:Yt(n)}}catch(n){return Xe(n)}}function z(e){let t=ie(e);ft(t);let{restSignature:n,...i}=t;return te(i)}function v(e,t){return e[t]?.kind!=="value"&&p(`Native ${t} is missing/mixed/unknown`,"NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS"),e[t].value}function Jt(e){(!Array.isArray(e)||e.length!==1)&&p("Native range requires one opaque normal SOLID paint","NATIVE_TEXT_RANGES_UNSUPPORTED_PAINT");let t=e[0],n=t?.color;return(!D(t,["type","visible","opacity","blendMode","color","boundVariables"])||t.type!=="SOLID"||O(t,"visible")&&t.visible!==!0||W(t,"opacity",1)!==1||W(t,"blendMode","NORMAL")!=="NORMAL"||!D(n,["r","g","b","a"])||W(n,"a",1)!==1||O(t,"boundVariables")&&(!w(t.boundVariables)||Object.keys(t.boundVariables).length))&&p("Native range paint is not supported","NATIVE_TEXT_RANGES_UNSUPPORTED_PAINT"),`#${[n.r,n.g,n.b].map(r=>{for(let s=0;s<=255;s++)if(r===s/255||r===Math.fround(s/255))return s;p("Native color cannot be represented exactly as sRGB8; raw channels were retained","NATIVE_TEXT_RANGES_COLOR_QUANTIZATION")}).map(r=>r.toString(16).padStart(2,"0")).join("")}`}var dt=["fontName","fontSize","lineHeight","letterSpacing"];function Kt(e,t){if(!w(e)||!Number.isFinite(e.value)||!K(t))return!1;let n=se(t);return e.unit===n.unit&&(e.value===n.value||n.unit==="PERCENT"&&e.value===Math.fround(n.value/100)*100)}function qt(e){for(let i of dt)v(e,i);for(let[i,r]of[["textCase","ORIGINAL"],["listSpacing",0],["indentation",0],["paragraphIndent",0],["paragraphSpacing",0]])v(e,i)!==r&&p(`Native ${i} changes paragraph metrics`,"NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");let t=v(e,"listOptions");(!w(t)||t.type!=="NONE"||Object.keys(t).some(i=>i!=="type"))&&p("Native lists are not supported","NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");for(let i of["openTypeFeatures","boundVariables"]){let r=v(e,i);(!w(r)||Object.keys(r).length)&&p("Native features/variables require a separate model","NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS")}let n=v(e,"textStyleOverrides");(!Array.isArray(n)||n.some(i=>!D(i,["type"])||!["HYPERLINK","TEXT_DECORATION"].includes(i.type)))&&p("Native semantic font overrides require a separate model","NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS"),v(e,"textWrapStyle")!=="AUTO"&&p("Native text-wrap style is unsupported","NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS")}function De(e){let t,n,i;try{t=H(e,"rest"),n=H(e,"source"),i=ie(H(e,"canonicalNode"))}catch(o){return{...Xe(o),status:"unsupported",pixelsVerified:!1}}let r=fe(t,n),s=[...r.diagnostics],a=o=>({status:"unsupported",diagnostics:[...s,$(o.code??"NATIVE_TEXT_RANGES_INVALID",o.message)],pixelsVerified:!1});if(r.status!=="bound")return{status:"unsupported",diagnostics:s,pixelsVerified:!1};try{let o=r.source;(i?.type!=="text"||(i.textSource??i.text)!==o.characters)&&p("Canonical text does not preserve native authored source","NATIVE_TEXT_RANGES_SOURCE_MISMATCH");for(let A of o.segments)for(let c of["textDecorationStyle","textDecorationOffset","textDecorationThickness","textDecorationColor","textDecorationSkipInk"])A.values[c]?.kind==="value"&&A.values[c].value!==null&&p("Native underline geometry has no proven CSS basis; whole range admission refused","NATIVE_TEXT_RANGES_NATIVE_DECORATION_BASIS");let f=o.scalars;for(let[A,c]of[["hasMissingFont",!1],["leadingTrim","NONE"],["hangingPunctuation",!1],["hangingList",!1],["textAlignVertical","TOP"],["textTruncation","DISABLED"],["maxLines",null]])v(f,A)!==c&&p(`Native ${A} applicability is unsupported`,"NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");({LEFT:"left",CENTER:"center",RIGHT:"right"})[v(f,"textAlignHorizontal")]!==(i.textAlign??"left")&&p("Canonical text alignment differs from native","NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");let d=o.segments[0]?.values,y=[];for(let A of o.segments){let c=A.values;qt(c);for(let g of dt)j(M(c,g),M(d,g))||p("Native metric variants cannot be split into paint ranges","NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");let h=v(c,"fontName"),R=v(c,"lineHeight"),S=v(c,"letterSpacing");(!w(h)||h.family!==i.fontFamily||M(c,"fontSize")!==i.fontSize||v(c,"fontWeight")!==i.fontWeight||v(c,"fontStyle")!==(i.fontStyle==="italic"?"ITALIC":"REGULAR")||!Kt(R,i)||!w(S)||!(S.value===0&&i.letterSpacing===0||S.unit==="PIXELS"&&S.value===i.letterSpacing))&&p("Canonical font metrics differ from native","NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS"),(!D(h,["family","style","variationSettings"])||!["Regular","Bold","Italic","Bold Italic"].includes(h.style)||O(h,"variationSettings")&&(!w(h.variationSettings)||Object.entries(h.variationSettings).some(([g,b])=>g==="wght"?b!==i.fontWeight:g==="slnt"?b!==0:!0)))&&p("Native font axis/style is outside canonical uniform metrics","NATIVE_TEXT_RANGES_UNSUPPORTED_METRICS");let u=Jt(v(c,"fills")),T=v(c,"textDecoration");["NONE","UNDERLINE","STRIKETHROUGH"].includes(T)||p("Native decoration is unsupported","NATIVE_TEXT_RANGES_UNSUPPORTED_DECORATION");for(let g of["textDecorationStyle","textDecorationOffset","textDecorationThickness","textDecorationColor","textDecorationSkipInk"])v(c,g)!==null&&p("Native underline geometry has no proven CSS basis; whole range admission refused","NATIVE_TEXT_RANGES_NATIVE_DECORATION_BASIS");let N=v(c,"hyperlink"),x=G(N);(x===void 0||typeof x=="string"&&(x.startsWith("#")||!oe(x)))&&p("Native hyperlink target is unsupported; raw value retained","NATIVE_TEXT_RANGES_UNSUPPORTED_HYPERLINK");let _={start:A.start,end:A.end},l={NONE:"none",UNDERLINE:"underline",STRIKETHROUGH:"line-through"}[T];u!==i.fill?.toLowerCase()&&(_.fill=u),l!==(i.textDecoration??"none")&&(_.textDecoration=l),x!==null&&(_.href=x),Object.keys(_).length>2&&y.push(_)}let E=V({...i,textRanges:{version:1,sourceSignature:Z(o.characters),ranges:y}});return s.push($("NATIVE_TEXT_RANGES_PIXELS_UNVERIFIED","Native paint/link/decoration intent recovered; cross-renderer pixels are not verified")),{status:E?"admitted-intent":"uniform",...E?{textRanges:E}:{},diagnostics:s,pixelsVerified:!1}}catch(o){return a(o)}}var Zt=64*1024,Qt=1e5,Tt=new WeakSet,Y=(e,t)=>{let n=new Error(t);throw n.code=e,Tt.add(n),n},k=()=>Y("NATIVE_TEXT_RANGE_HINT_INVALID","Native author hints require bounded owned plain data."),me=(e,t)=>Object.hasOwn(e,t),Ce=e=>e!==null&&typeof e=="object"&&!Array.isArray(e)&&[Object.prototype,null].includes(Object.getPrototypeOf(e)),en=["id","type","characters","style","characterStyleOverrides","styleOverrideTable","fills","lineTypes","lineIndentations","textTruncation","maxLines","textAutoResize","layoutSizingHorizontal","layoutSizingVertical","hasMissingFont","leadingTrim","hangingPunctuation","hangingList"],pt=["type","text","textSource","textFlow","textRanges","fill","fillPaints","textDecoration","textDecorationThickness","textUnderlineOffset","textDecorationSkipInk","textOverflow","fontFamily","fontSize","fontWeight","fontStyle","lineHeight","lineHeightUnit","letterSpacing","textAlign"];function Se(e){let t=0;for(let n of e){let i=n.codePointAt(0);t+=i<128?1:i<2048?2:i<65536?3:4}return t}function Ve(e,t={seen:new Set,bytes:0,count:0},n=0){let i=y=>{(t.bytes+=Se(y))>524288&&k()};if((++t.count>1e5||n>16)&&k(),e===null||typeof e=="boolean"||typeof e=="number"&&Number.isFinite(e))return i(String(e)),e;if(typeof e=="string")return e.length>512*1024&&k(),i(JSON.stringify(e)),e;let r=Array.isArray(e);(!r&&!Ce(e)||t.seen.has(e))&&k();let s=Object.getOwnPropertyDescriptors(e),a=Reflect.ownKeys(s),o=r?s.length?.value:void 0;(a.some(y=>typeof y!="string")||r&&(!Number.isInteger(o)||o>4096))&&k();let f=r?a.filter(y=>y!=="length"):a;(f.length>4096||r&&(f.length!==o||f.some((y,E)=>y!==String(E))))&&k(),t.seen.add(e),i("[]");let d=r?[]:{};for(let y of f){let E=s[y];(!me(E,"value")||!E.enumerable)&&k(),i(JSON.stringify(y)+":,"),Object.defineProperty(d,y,{value:Ve(E.value,t,n+1),enumerable:!0,writable:!0,configurable:!0})}return t.seen.delete(e),d}function tn(e,t){Ce(e)||k();let n=Object.getOwnPropertyDescriptors(e);return Reflect.ownKeys(n).some(i=>typeof i!="string"||!t.includes(i)||!me(n[i],"value")||!n[i].enumerable)&&k(),Object.fromEntries(Object.keys(n).map(i=>[i,n[i].value]))}function ke(e,t,n=!1){Ce(e)||k();let i=Object.getOwnPropertyDescriptors(e),r={};for(let s of t){if(!me(i,s))continue;let a=i[s];(!me(a,"value")||!a.enumerable)&&k(),!(a.value===void 0&&n)&&(r[s]=Ve(a.value))}return r}function nn(e,t,n){[t,n].every(s=>typeof s=="string"&&s.length<=1e5&&/^[a-z0-9_.-]+$/iu.test(s))||k();let i=typeof e=="string"?e:JSON.stringify(e),r=Se(i);return(r>Zt||r+Se(t)+Se(n)>Qt)&&Y("NATIVE_TEXT_RANGE_HINT_BUDGET","The complete native author hint or plugin-data entry exceeds its byte budget."),i}function gt(e){let t=[];for(let n of e.runs){let i=t.at(-1);i&&i.end===n.start&&i.fill===n.fill&&JSON.stringify(i.hyperlink)===JSON.stringify(n.hyperlink)?i.end=n.end:t.push({...n,hyperlink:n.hyperlink&&{...n.hyperlink}})}return JSON.stringify({characters:e.characters,runs:t})}function rn(e,t,n){let i=ke(e,en),r=Ve(t),s=fe(i,r);s.status!=="bound"&&Y("NATIVE_TEXT_RANGE_HINT_SOURCE","Author hints require a complete independently bound current native source.");let a=ke(n,pt,!0),o=De({rest:i,source:s.source,canonicalNode:a});["uniform","admitted-intent"].includes(o.status)||Y("NATIVE_TEXT_RANGE_HINT_EFFECTIVE","Current native text cannot independently prove the supported effective paint/link plan."),delete a.textRanges,o.textRanges&&(a.textRanges=o.textRanges);let f=Q(a);return{rest:i,source:s.source,plan:f,snapshot:z(s.source)}}function sn(e,t){gt(Q(e))!==gt(t)&&Y("NATIVE_TEXT_RANGE_HINT_EFFECTIVE","The hinted author state would change current native characters, colors, or links.")}function on(e){try{return e()}catch(t){if(t!==null&&typeof t=="object"&&Tt.has(t))throw t;Y("NATIVE_TEXT_RANGE_HINT_INVALID","Native author hint validation failed without restoring any author state.")}}function ht(e){return on(()=>{let t=tn(e,["rest","source","authorNode","pluginId","key"]),n=ke(t.authorNode,pt,!0),i=V(n);i||Y("NATIVE_TEXT_RANGE_HINT_NO_INTENT","Only a nonempty explicit canonical range payload needs an author hint.");let r=rn(t.rest,t.source,n);sn(n,r.plan);let s={version:1,nodeId:r.rest.id,fill:n.fill.toLowerCase(),textRanges:i,snapshot:r.snapshot};return nn(s,t.pluginId,t.key),s})}var Et="codeshellTextRangeIntent",an=16*1024*1024,re=(e,t)=>{let n=new Error(t);throw n.code=e,n};function cn(e){let t=0;for(let n of e){let i=n.codePointAt(0);t+=i<128?1:i<2048?2:i<65536?3:4}return t}function ue(e,t,n){let i=st(e,n,{fields:F,scalarFields:ne});return i.status!=="captured"?i:ut({rest:t,...i.observations})}async function yt(e,{mixed:t,pluginId:n,assertOwned:i}){(!Array.isArray(e)||e.length>1e4||typeof i!="function")&&re("TEXT_RANGES_NATIVE_FINALIZE_INPUT","范围文字的最终校验上下文无效，已阻止创建副本");let r=[],s=0;for(let{target:a,source:o}of e){i(a),(a?.type!=="TEXT"||typeof a.exportAsync!="function"||typeof a.setPluginData!="function")&&re("TEXT_RANGES_NATIVE_FINALIZE_UNAVAILABLE","范围文字的最终读取或意图保存能力不可用，已阻止创建副本");let f=await a.exportAsync({format:"JSON_REST_V1"});i(a);let d=f?.document??f?.nodes?.[a.id]?.document;(d?.id!==a.id||d?.type!=="TEXT")&&re("TEXT_RANGES_NATIVE_FINALIZE_IDENTITY","范围文字的最终来源身份不匹配，已阻止创建副本");let y=ue(a,d,t);y.status!=="bound"&&re("TEXT_RANGES_NATIVE_FINALIZE_SOURCE","无法完整校验新建范围文字的最终原生状态，已阻止创建副本");let E=ht({rest:d,source:y.source,authorNode:o,pluginId:n,key:Et}),A=JSON.stringify(E);(s+=cn(A))>an&&re("TEXT_RANGES_NATIVE_FINALIZE_BUDGET","范围文字的完整意图快照合计超过 16 MiB，已阻止创建副本"),r.push({target:a,rest:d,text:A,snapshot:z(y.source)})}for(let a of r){i(a.target);let o=ue(a.target,a.rest,t);(o.status!=="bound"||z(o.source)!==a.snapshot)&&re("TEXT_RANGES_NATIVE_FINALIZE_RACE","范围文字在最终读取期间发生变化，已阻止创建副本")}for(let a of r)a.target.setPluginData(Et,a.text);return{texts:r.length,bytes:s}}var Ge="codeshellTextRangeIntent",ln="nativeTextRanges",fn=Object.freeze(["codeshellNativeTextRanges","codeshellNativeTextRangeHint","codeshellTextRangeIntent",ln]);var un=["textDecoration","textDecorationStyle","textDecorationOffset","textDecorationThickness","textDecorationColor","textDecorationSkipInk","hyperlink"],Nt=(e,t)=>Object.hasOwn(e,t),xt=e=>e!==null&&typeof e=="object"&&!Array.isArray(e)&&[Object.prototype,null].includes(Object.getPrototypeOf(e)),Me=(e,t)=>xt(e)&&Object.keys(e).length===t.length&&t.every(n=>Nt(e,n));function Ue(e){return xt(e)&&Me(e.scalars,[...F,...ne])&&Array.isArray(e.segments)&&Array.isArray(e.rangeChecks)&&e.segments.every(t=>Me(t.values,F))&&e.rangeChecks.length===e.segments.length&&e.rangeChecks.every((t,n)=>t.start===e.segments[n].start&&t.end===e.segments[n].end&&Me(t.values,un))}function _t(e){return fn.some(t=>Nt(e,t))}var Le=16*1024*1024,At=e=>e!==null&&typeof e=="object"&&!Array.isArray(e)&&[Object.prototype,null].includes(Object.getPrototypeOf(e)),m=(e,t)=>{let n=Error(t);throw n.code=e,n},J=e=>{let t=0;for(let n of e){let i=n.codePointAt(0);t+=i<128?1:i<2048?2:i<65536?3:4}return t};function de(e,t=new Set,n=0){if(e===null||typeof e=="boolean"||typeof e=="string"||typeof e=="number"&&Number.isFinite(e))return JSON.stringify(e);(n>40||typeof e!="object"||t.has(e)||!Array.isArray(e)&&!At(e))&&m("NATIVE_TEXT_EXPORT_DATA","Source export requires complete owned JSON");let i=Object.getOwnPropertyDescriptors(e),r=Array.isArray(e),s=Reflect.ownKeys(i).filter(o=>!r||o!=="length");(s.some(o=>typeof o!="string"||!Object.hasOwn(i[o],"value")||!i[o].enumerable)||r&&(s.length!==e.length||s.some((o,f)=>o!==String(f))))&&m("NATIVE_TEXT_EXPORT_DATA","Source export cannot interpret hidden/accessor/sparse data"),t.add(e);let a=r?"["+s.map(o=>de(i[o].value,t,n+1)).join(",")+"]":"{"+s.sort().map(o=>JSON.stringify(o)+":"+de(i[o].value,t,n+1)).join(",")+"}";return t.delete(e),J(a)>Le&&m("NATIVE_TEXT_EXPORT_BUDGET","Complete export exceeds16MiB"),a}function dn(e,t){let n=i=>i===t?{mixed:!0}:i??null;return de({type:e.type,isMask:e.isMask===!0,blendMode:e.blendMode??null,fills:n(e.fills),strokes:n(e.strokes),effects:n(e.effects),mixedFontName:e.fontName===t,mixedFontSize:e.fontSize===t,childMasks:Array.isArray(e.children)?e.children.map(i=>[i.id,i.isMask===!0]):[]})}function St({roots:e,mixed:t,pluginId:n}={}){(!Array.isArray(e)||e.length>1e4||new Set(e).size!==e.length||typeof t!="symbol")&&m("NATIVE_TEXT_EXPORT_CONTEXT","Export capture requires exact current native roots and mixed identity");let i=new Map,r=[],s=new Set(e),a=new Map,o=new Map,f=0,d=0,y=0,E=(u,T)=>{if(!u)return{values:[],indices:new Map};if(!T.has(u)){let N=Array.isArray(u.children)?[...u.children]:[],x=new Map;for(let[_,l]of N.entries())x.has(l)&&m("NATIVE_TEXT_EXPORT_TOPOLOGY","Native children contain aliased objects"),x.set(l,_);T.set(u,{values:N,indices:x})}return T.get(u)},A=(u,T,N)=>{if(!T.has(u)){let x=u.parent,l=E(x,N).indices.get(u)??-1;x&&l<0&&m("NATIVE_TEXT_EXPORT_TOPOLOGY","Native source left its original parent");let g=dn(u,t);(y+=J(g))>Le&&m("NATIVE_TEXT_EXPORT_BUDGET","Complete native preview contexts exceed16MiB"),T.set(u,{current:u,parent:x,id:u.id,index:l,children:E(u,N).values,context:g})}return T.get(u)},c=(u,T=a,N=o)=>{let x=[],_=new Set,l=!1;for(let g=u;g;g=g.parent)(_.has(g)||x.length>35||g.removed===!0)&&m("NATIVE_TEXT_EXPORT_TOPOLOGY","Native source identity or ancestry is unavailable"),_.add(g),s.has(g)&&(l=!0),x.push(A(g,T,N));return l||m("NATIVE_TEXT_EXPORT_TOPOLOGY","Native Text is outside the exported roots"),x},h=(u,T)=>u.length===T.length&&u.every((N,x)=>{let _=T[x];return N.current===_.current&&N.parent===_.parent&&N.id===_.id&&N.index===_.index&&N.context===_.context&&N.children.length===_.children.length&&N.children.every((l,g)=>l===_.children[g])}),R=(u,T,N=0)=>{if((!At(u)||!T||T.id!==u.id||N>34||++d>5e4)&&m("NATIVE_TEXT_EXPORT_IDENTITY","Official REST and exact native source ownership disagree"),u.type!==(T.type==="PAGE"?"CANVAS":T.type)&&m("NATIVE_TEXT_EXPORT_IDENTITY","Official REST and native source types disagree"),_t(u)&&m("NATIVE_TEXT_EXPORT_COLLISION","Official REST contains a reserved supplemental lookalike; raw data was not overwritten"),u.children!==void 0&&!Array.isArray(u.children)&&m("NATIVE_TEXT_EXPORT_DATA","Official REST children must remain an array"),T.type==="TEXT"){(u.type!=="TEXT"||u.children?.length)&&m("NATIVE_TEXT_EXPORT_IDENTITY","Text source must remain a native leaf");let l=de(u),g=i.get(u.id);if(g){(g.target!==T||g.fingerprint!==l||!h(g.lineage,c(T)))&&m("NATIVE_TEXT_EXPORT_OVERLAP","Repeated Text source ownership or complete raw data disagree");return}let b=ue(T,u,t),X=b.status==="bound"&&Ue(b.source);X?(J(JSON.stringify({rest:u,source:b.source}))>ee&&m("NATIVE_TEXT_EXPORT_NODE_BUDGET","The complete Text proof exceeds256KiB"),f+=J(JSON.stringify(b.source)),f>Le&&m("NATIVE_TEXT_EXPORT_BUDGET","Complete native sources exceed16MiB")):r.push(u.id+": complete native range source unavailable; existing fallback retained"),i.set(u.id,{rest:u,target:T,fingerprint:l,lineage:c(T),bound:X,source:X?b.source:void 0,snapshot:X?z(b.source):null});return}let x=Array.isArray(T.children)?T.children:[],_=new Map;for(let l of x)_.has(l.id)&&m("NATIVE_TEXT_EXPORT_OVERLAP","Native children contain repeated identity"),_.set(l.id,l);((u.children??[]).length!==x.length||(u.children??[]).some((l,g)=>l?.id!==x[g]?.id))&&m("NATIVE_TEXT_EXPORT_IDENTITY","Official and native child topology disagree");for(let l of u.children??[]){let g=_.get(l?.id);g||m("NATIVE_TEXT_EXPORT_IDENTITY","Official descendant has no exact native owner"),R(l,g,N+1)}};return{add:R,finalize:()=>{let u=new Map,T=typeof n=="string"&&/^[a-z0-9_.-]+$/iu.test(n)?n:void 0;for(let l of i.values())if(l.bound&&T&&typeof l.target.getPluginData=="function"){let g;try{g=l.target.getPluginData(Ge)}catch{r.push(l.target.id+": optional author hint unavailable; independent native source retained");continue}typeof g!="string"&&m("NATIVE_TEXT_EXPORT_HINT","Native plugin data did not return a string"),g&&(J(g)+J(T)+J(Ge)>1e5&&m("NATIVE_TEXT_EXPORT_HINT_BUDGET","The complete native plugin-data entry exceeds100000bytes"),u.set(l.target.id,g))}let N={},x=new Map,_=new Map;y=0;for(let l of i.values()){(!h(l.lineage,c(l.target,x,_))||de(l.rest)!==l.fingerprint)&&m("NATIVE_TEXT_EXPORT_RACE","Native source identity/topology/preview cause changed during awaited export");let g=ue(l.target,l.rest,t),b=g.status==="bound"&&Ue(g.source);(b!==l.bound||b&&z(g.source)!==l.snapshot)&&m("NATIVE_TEXT_EXPORT_RACE","Complete observed native Text changed during awaited export"),b&&Object.defineProperty(N,l.target.id,{enumerable:!0,configurable:!0,writable:!0,value:{source:g.source,...u.has(l.target.id)?{hint:u.get(l.target.id)}:{}}})}return{supplement:Object.keys(N).length?{version:1,...T?{pluginId:T}:{},nodes:N}:void 0,warnings:r,observedTextNodes:i.size}}}}return wt(gn);})();
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
