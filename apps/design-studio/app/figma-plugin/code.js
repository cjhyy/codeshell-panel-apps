/* BEGIN GENERATED SPACING RUNTIME */
"use strict";var CodeShellFigmaSpacing=(()=>{var u=Object.defineProperty;var w=Object.getOwnPropertyDescriptor;var m=Object.getOwnPropertyNames;var g=Object.prototype.hasOwnProperty;var v=(t,r)=>{for(var i in r)u(t,i,{get:r[i],enumerable:!0})},y=(t,r,i,a)=>{if(r&&typeof r=="object"||typeof r=="function")for(let o of m(r))!g.call(t,o)&&o!==i&&u(t,o,{get:()=>r[o],enumerable:!(a=w(r,o))||a.enumerable});return t};var h=t=>y(u({},"__esModule",{value:!0}),t);var G={};v(G,{mainAxisGap:()=>n,nativeMainGap:()=>s,validateLayoutSpacing:()=>l,validateNativeLayoutSpacing:()=>c});var n=t=>t?.[t.layout==="vertical"?"rowGap":"columnGap"]??t?.gap??0;function l(t){for(let i of["gap","rowGap","columnGap"])if(t[i]!==void 0&&(!Number.isFinite(t[i])||t[i]<-2e3||t[i]>2e3))throw new Error(`${i} 必须为 -2000–2000 的有限间距`);if(!["gap","rowGap","columnGap"].some(i=>t[i]<0))return;let r=t.layout==="horizontal";if(!["horizontal","vertical"].includes(t.layout))throw new Error("负间距只支持水平或垂直主轴；Grid 和自由布局不能使用负间距");if(t.layoutWrap&&t.layoutWrap!=="none")throw new Error("负间距换行尚不能可靠映射到原生与 CSS 布局");if(t.layoutReverse)throw new Error("负间距反向布局尚不支持");if(t[r?"rowGap":"columnGap"]<0)throw new Error("交叉轴间距不能为负数");if(t[r?"layoutSizingHorizontal":"layoutSizingVertical"]==="hug")throw new Error("负间距主轴的 Hug 尺寸尚未验证；请使用固定或 Fill 尺寸")}function s(t,r=t.children??[]){let i=n(t);if(!Array.isArray(r)||r.length>1e4)throw new Error("原生间距子项必须为有界数组");let a=r.filter(e=>e.visible!==!1&&e.layoutPositioning!=="absolute");if(i>=0||a.length<2)return{requested:i,effective:i,minimum:null};let o=t.layout==="vertical"?"height":"width",f=a.map(e=>e[o]);if(f.some(e=>!Number.isFinite(e)||e<=0))throw new Error("原生负间距需要可核对的可见 AUTO 子项主轴尺寸");let p=Math.min(...f);return{requested:i,effective:Math.max(i,-p),minimum:p}}function c(t,r=t.children??[]){l(t);let i=s(t,r);if(n(t)<0&&(t.rotation||r.some(a=>a.visible!==!1&&a.layoutPositioning!=="absolute"&&a.rotation)))throw Object.assign(new Error("旋转子项的原生负间距主轴尺寸尚未验证"),{code:"NATIVE_NEGATIVE_SPACING"});if(i.effective-i.requested>1e-4)throw Object.assign(new Error(`原生负间距 ${i.requested}px 会被最小可见 AUTO 子项 ${i.minimum}px 限制为 ${i.effective}px；请调整间距或使用已验证的流关系`),{code:"NATIVE_NEGATIVE_SPACING"});return i}return h(G);})();
/* END GENERATED SPACING RUNTIME */
/* BEGIN GENERATED GRID RUNTIME */
"use strict";var CodeShellFigmaGrid=(()=>{var A=Object.defineProperty;var v=Object.getOwnPropertyDescriptor;var T=Object.getOwnPropertyNames;var k=Object.prototype.hasOwnProperty;var N=(i,t)=>{for(var r in t)A(i,r,{get:t[r],enumerable:!0})},P=(i,t,r,n)=>{if(t&&typeof t=="object"||typeof t=="function")for(let l of T(t))!k.call(i,l)&&l!==r&&A(i,l,{get:()=>t[l],enumerable:!(n=v(t,l))||n.enumerable});return i};var L=i=>P(A({},"__esModule",{value:!0}),i);var X={};N(X,{configureNativeGrid:()=>H,finishNativeGrid:()=>C,nativeGridPlan:()=>x,positionNativeGridChild:()=>G,validateGridFields:()=>I});function z(i){return Number.isFinite(i.lineHeight)?i.lineHeightUnit===void 0?i.lineHeight>=.7&&i.lineHeight<=3:i.lineHeightUnit==="pixels"&&i.lineHeight>=4.2&&i.lineHeight<=720:!1}var M=i=>i.lineHeightUnit==="pixels"?i.lineHeight:(i.fontSize??16)*(i.lineHeight??1.2),E=i=>M(i)/(i.fontSize??16);var b=Object.freeze(["gridRows","gridColumnSizes","gridRowSizes","gridItemsPositioning","gridAutoTracks"]),D=Object.freeze(["gridRowAnchorIndex","gridColumnAnchorIndex","gridChildHorizontalAlign","gridChildVerticalAlign"]),c=(i,t,r)=>Number.isInteger(i)&&i>=t&&i<=r;function _(i){if(!Array.isArray(i)||!i.length||i.length>24)throw new Error("Grid tracks 必须为 1–24 项");return i.map(t=>{if(!t||typeof t!="object"||Array.isArray(t)||Object.keys(t).some(n=>!["type","value"].includes(n))||!["fixed","flex","hug"].includes(t.type))throw new Error("Grid track 类型无效");if(t.type==="hug"){if(t.value!==void 0)throw new Error("HUG track 不接受 value");return{type:"hug"}}let r=t.value??(t.type==="flex"?1:void 0);if(!Number.isFinite(r)||r<0||t.type==="flex"&&r===0||r>2e4)throw new Error("Grid track value 超出范围");return{type:t.type,value:r}})}function I(i,t=!1){for(let r of["gridRows","gridColumns","gridColumnSpan","gridRowSpan"])if(i[r]!==void 0&&!c(i[r],1,24))throw new Error(`${r} 必须为 1–24`);for(let r of["gridRowAnchorIndex","gridColumnAnchorIndex"])if(i[r]!==void 0&&!c(i[r],0,9999))throw new Error(`${r} 必须为 0–9999`);if(i.gridRowAnchorIndex===void 0!=(i.gridColumnAnchorIndex===void 0))throw new Error("Grid manual anchors 必须同时包含行和列");for(let r of["gridChildHorizontalAlign","gridChildVerticalAlign"])if(i[r]!==void 0&&!["auto","start","center","end"].includes(i[r]))throw new Error(`${r} 无效`);if(!t&&b.some(r=>i[r]!==void 0))throw new Error("Grid container 字段只适用于容器");if(i.gridItemsPositioning!==void 0&&!["manual","row-auto-flow"].includes(i.gridItemsPositioning))throw new Error("gridItemsPositioning 无效");if(i.gridAutoTracks!==void 0&&!["none","rows"].includes(i.gridAutoTracks))throw new Error("gridAutoTracks 无效");for(let[r,n]of[["gridColumnSizes",i.gridColumns],["gridRowSizes",i.gridRows]])if(i[r]!==void 0){let l=_(i[r]);if(n===void 0||l.length!==n)throw new Error(`${r} 数量与 grid count 不一致`)}if(t&&i.layout==="grid"&&i.gridItemsPositioning==="manual"&&Array.isArray(i.children)){let r=R(i.children,i.gridColumns??1,i);if(i.gridAutoTracks!=="rows"&&i.gridRows!==void 0&&r.rowCount>i.gridRows)throw new Error("Grid manual anchors/spans 超出 gridRows")}}function R(i,t,r={}){if(!c(t,1,24))throw new Error("Grid columns 必须为 1–24");let n=new Set,l=[],f=0,d=(o,a,g,u)=>{if(a+u>t)return!1;for(let w=o;w<o+g;w++)for(let e=a;e<a+u;e++)if(n.has(w*t+e))return!1;return!0};for(let o of i){if(!o||typeof o!="object")throw new Error("Grid 子项无效");for(let h of["gridColumnSpan","gridRowSpan"])if(o[h]!==void 0&&!c(o[h],1,24))throw new Error(`${h} 必须为 1–24`);for(let h of["gridRowAnchorIndex","gridColumnAnchorIndex"])if(o[h]!==void 0&&!c(o[h],0,9999))throw new Error(`${h} 必须为 0–9999`);if(o.visible===!1||o.layoutPositioning==="absolute")continue;let a=Math.min(t,Math.max(1,o.gridColumnSpan??1)),g=Math.max(1,o.gridRowSpan??1),u=r.gridItemsPositioning==="manual"&&Number.isInteger(o.gridRowAnchorIndex)&&Number.isInteger(o.gridColumnAnchorIndex),w=r.gridItemsPositioning==="row-auto-flow"?f:0,e=u?o.gridRowAnchorIndex:Math.floor(w/t),p=u?o.gridColumnAnchorIndex:w%t;if(u&&!d(e,p,g,a))throw new Error(`${o.name??o.id}: Grid placement 重叠或超出列范围`);for(;!u&&!d(e,p,g,a);)w++,e=Math.floor(w/t),p=w%t;for(let h=e;h<e+g;h++)for(let m=p;m<p+a;m++)n.add(h*t+m);f=e*t+p+a,l.push({child:o,row:e,column:p,rowSpan:g,columnSpan:a})}return{placements:l,rowCount:Math.max(0,...l.map(o=>o.row+o.rowSpan))}}function F(i,t,r=t?.children,n){let l=s=>["minWidth","maxWidth","minHeight","maxHeight"].every(y=>s[y]===void 0),f=s=>!(s.strokeWidth>0)&&(s.strokeSides===void 0||Array.isArray(s.strokeSides)&&s.strokeSides.every(y=>y&&y.width===0))&&!s.strokeLayoutExcluded,d=s=>(s.paddingTop??s.padding??0)+(s.paddingBottom??s.padding??0),o=s=>["Top","Right","Bottom","Left"].every(y=>{let S=s[`padding${y}`]??s.padding??0;return Number.isFinite(S)&&S>=0&&S<=2e3}),a=i?.layoutSizingHorizontal==="fill"&&n?.layout==="vertical"&&n.layoutSizingHorizontal==="fixed"&&Number.isFinite(n.width)&&n.width>=1&&n.width<=2e4&&l(n)&&!n.rotation&&!n.layoutReverse&&(!n.layoutWrap||n.layoutWrap==="none")&&i.layoutPositioning!=="absolute"&&!i.layoutMarginBefore&&l(i),g=i?.strokeAlign==="inside"&&!i.strokeLayoutExcluded&&Array.isArray(i.strokeSides)&&i.strokeSides.length===4&&Array.from(i.strokeSides).every((s,y)=>s&&s.width===(y===2?1:0))&&["Top","Right","Left"].every(s=>(i[`padding${s}`]??i.padding??0)===0)&&(i.paddingBottom??i.padding??0)===1,u=i?.strokeAlign==="center"&&!i.strokeLayoutExcluded&&Array.isArray(i.strokeSides)&&i.strokeSides.length===4&&Array.from(i.strokeSides).every((s,y)=>s&&s.width===(y===2?1:0))&&["Top","Right","Bottom","Left"].every(s=>(i[`padding${s}`]??i.padding??0)===0);if(!i||!t||i.layout!=="grid"||i.layoutSizingHorizontal!=="fixed"&&!a||i.layoutSizingVertical!=="hug"||i.gridRows!==1||i.gridRowSizes?.length!==1||i.gridRowSizes[0].type!=="hug"||i.gridColumnSizes?.some(s=>!["fixed","flex"].includes(s.type))||i.rotation||i.layoutReverse||i.layoutWrap&&i.layoutWrap!=="none"||i.justifyContent&&i.justifyContent!=="start"||i.alignContent&&i.alignContent!=="start"||i.alignItems&&i.alignItems!=="start"||d(i)!==0&&!g||!l(i)||!f(i)&&!g&&!u||t.type!=="frame"||t.layout!=="vertical"||t.layoutSizingHorizontal!=="fill"||t.layoutSizingVertical!=="fill"||(t.gridRowSpan??1)!==1||t.visible===!1||t.layoutPositioning==="absolute"||t.rotation||t.layoutReverse||t.layoutWrap&&t.layoutWrap!=="none"||t.layoutMarginBefore||t.justifyContent&&t.justifyContent!=="start"||t.alignItems&&t.alignItems!=="start"||(t.gap??0)!==0||(t.rowGap??0)!==0||!o(t)||!l(t)||!f(t))return null;let w=typeof r=="function"?r():r;if(!Array.isArray(w)||w.length!==1)return null;let e=w[0],p=e?.type==="rectangle"&&e.layoutSizingVertical==="fixed"&&["fixed","fill"].includes(e.layoutSizingHorizontal),h=e?.type==="text"&&e.layoutSizingVertical==="hug"&&e.layoutSizingHorizontal==="fill"&&e.textFlow==="wrap"&&e.textOverflow===void 0&&typeof e.textSource=="string"&&e.textSource.length<=4e3&&/[^\t\n\f\r ]/u.test(e.textSource)&&Number.isFinite(e.fontSize)&&e.fontSize>=6&&e.fontSize<=240&&z(e)&&E(e)>=.7&&E(e)<=3&&(e.letterSpacing??0)===0&&(e.textAlign??"left")==="left"&&(e.textDecoration??"none")==="none";if(!e||!p&&!h||u&&!h||p&&d(t)!==0||e.children!==void 0||e.visible===!1||e.layoutPositioning==="absolute"||e.rotation||e.layoutMarginBefore||!Number.isFinite(e.height)||e.height<1||e.height>2e4||!l(e)||!f(e))return null;let m=e.height+d(t);return m<=2e4?m:null}function $(i,t){return i.gridAutoTracks==="rows"?Math.max(1,t):Math.max(1,i.gridRows??t,t)}function U(i,t){return i.gridRowSizes?Array.from({length:t},(r,n)=>i.gridRowSizes[n]??{type:"hug"}):void 0}function x(i,t){I(i,!0);let r=i.gridColumns??1,n=R(i.children??[],r,i),l=$(i,n.rowCount);if(l>24)throw new Error("原生 Grid 互换最多保留 24 行；请拆分网格");if(n.rowCount>l)throw new Error("Grid children 超出 gridRows；请增加行数");if(i.gridAutoTracks==="rows"&&i.gridItemsPositioning==="manual"){let o=new Set;for(let a of n.placements)for(let g=a.row;g<a.row+a.rowSpan;g++)o.add(g);if(o.size&&o.size!==l)throw new Error("自动 Grid 行中的空白手动行不能保留；请移除空行或关闭自动行")}let f=i.gridColumnSizes??Array.from({length:r},()=>({type:"flex",value:1})),d=U(i,l)??Array.from({length:l},()=>({type:"hug"}));for(let[o,a]of[["Horizontal",f],["Vertical",d]]){for(let g of n.placements){let u=g.child,w=u.layoutAlignSelf==="stretch"||(!u.layoutAlignSelf||u.layoutAlignSelf==="auto")&&i.alignItems==="stretch",e=o==="Horizontal"?g.column:g.row,p=o==="Horizontal"?g.columnSpan:g.rowSpan;if((u[`layoutSizing${o}`]==="fill"||w)&&a.slice(e,e+p).some(h=>h.type==="hug")&&!(o==="Vertical"&&F(i,u,u.children,t)!==null))throw new Error(`Grid ${o}: FILL 子项与 HUG track 的内在尺寸循环尚不能保留；请改为固定 track 或 HUG/固定子项`)}if(i[`layoutSizing${o}`]==="hug"&&a.some(g=>g.type==="flex"))throw new Error(`Grid ${o}: HUG 容器不能包含 FLEX track；请改为 FIXED/HUG track 或固定容器尺寸`)}if(i.layoutReverse||i.layoutWrap&&i.layoutWrap!=="none"||i.justifyContent!=="start"||i.alignContent&&i.alignContent!=="start")throw new Error("Grid 反向/换行/track 分布不能对应 Figma；请使用 start 分布");return{columns:r,rows:l,columnSizes:f,rowSizes:d,...n}}function H(i,t,r){let n=x(t,r);for(let l of["gridColumnCount","gridRowCount","gridRowSizes","gridColumnSizes","gridAutoTracks","gridItemsPositioning"])if(!(l in i))throw new Error(`${t.name}: 当前 Figma 不支持原生 GRID API (${l})，请更新 Figma 后重试`);i.layoutMode="GRID",i.layoutSizingHorizontal="FIXED",i.layoutSizingVertical="FIXED",i.gridAutoTracks="NONE",i.gridItemsPositioning="MANUAL",i.gridColumnCount=n.columns,i.gridRowCount=n.rows,i.gridColumnGap=t.columnGap??t.gap,i.gridRowGap=t.rowGap??t.gap;for(let l of["Top","Right","Bottom","Left"])i[`padding${l}`]=t[`padding${l}`]??t.padding;for(let[l,f]of[["gridColumnSizes",n.columnSizes],["gridRowSizes",n.rowSizes]]){let d=i[l];if(d.length!==f.length)throw new Error(`${t.name}: Figma Grid track 数量不匹配`);f.forEach((o,a)=>{d[a].type=o.type.toUpperCase(),o.type!=="hug"&&(d[a].value=o.value??1)})}return n}function G(i,t,r,n){if(i.layoutPositioning=t.layoutPositioning==="absolute"?"ABSOLUTE":"AUTO",t.layoutPositioning==="absolute")return;let l=t.visible===!1,f=l?{row:n.rows,column:0,rowSpan:t.gridRowSpan??1,columnSpan:Math.min(n.columns,t.gridColumnSpan??1)}:n.placements.find(d=>d.child===t);if(typeof i.setGridChildPosition!="function")throw new Error("当前 Figma 不支持 Grid 子项位置；请更新后重试");l&&(i.parent.gridRowCount=Math.max(i.parent.gridRowCount,f.row+f.rowSpan),i.visible=!0),i.setGridChildPosition(f.row,f.column),i.gridColumnSpan=f.columnSpan,i.gridRowSpan=f.rowSpan,l&&(i.visible=!1);for(let d of["Horizontal","Vertical"]){let o=`gridChild${d}Align`,a=t[o]??(t.layoutAlignSelf&&t.layoutAlignSelf!=="auto"?t.layoutAlignSelf:r.alignItems);i[o]={start:"MIN",center:"CENTER",end:"MAX",stretch:"MIN",auto:"AUTO"}[a]??"MIN"}}function C(i,t,r){i.gridRowCount=x(t,r).rows,i.gridItemsPositioning=t.gridItemsPositioning==="row-auto-flow"?"ROW_AUTO_FLOW":"MANUAL",i.gridAutoTracks=t.gridAutoTracks==="rows"?"ROWS":"NONE"}return L(X);})();
/* END GENERATED GRID RUNTIME */
/* BEGIN GENERATED PAINT RUNTIME */
"use strict";var CodeShellFigmaPaint=(()=>{var S=Object.defineProperty;var Z=Object.getOwnPropertyDescriptor;var K=Object.getOwnPropertyNames;var q=Object.prototype.hasOwnProperty;var Q=(t,r)=>{for(var e in r)S(t,e,{get:r[e],enumerable:!0})},Y=(t,r,e,i)=>{if(r&&typeof r=="object"||typeof r=="function")for(let o of K(r))!q.call(t,o)&&o!==e&&S(t,o,{get:()=>r[o],enumerable:!(i=Z(r,o))||i.enumerable});return t};var tt=t=>Y(S({},"__esModule",{value:!0}),t);var ht={};Q(ht,{cssLinearNeedsNativeWarning:()=>E,cssLinearSourceSnapshot:()=>F,designPaintsToFigma:()=>j,figmaFillPaints:()=>H,hasDesignStroke:()=>X,nativeDesignStroke:()=>J,nativeInactiveStrokePlan:()=>R,normalizeCssLinearSource:()=>b,normalizeDesignPaints:()=>m,normalizeStrokeSides:()=>O,validateDesignStroke:()=>M});var rt=t=>t&&typeof t=="object"&&!Array.isArray(t),I=t=>typeof t=="number"&&Number.isFinite(t),x=(t,r)=>{if(!rt(t)||Object.keys(t).some(e=>!r.includes(e)))throw new Error("CSS 渐变几何包含未知字段")};function z(t,r){x(t,["direction","positions","sourceOnly"]);let e=t.direction;x(e,["angle","corner"]);let i;if(Object.keys(e).length!==1)throw new Error("CSS 渐变方向必须唯一");if(e.angle!==void 0){if(!I(e.angle)||e.angle<0||e.angle>=360)throw new Error("CSS 渐变角度必须为 0–360（不含 360）");i={angle:e.angle}}else{if(!Array.isArray(e.corner)||e.corner.length!==2||!Array.from(e.corner).every(n=>n===-1||n===1))throw new Error("CSS 渐变角方向必须为两个 ±1");i={corner:[...e.corner]}}if(t.sourceOnly!==void 0&&t.sourceOnly!==!0)throw new Error("CSS 渐变 sourceOnly 只能为 true");if(!Array.isArray(t.positions)||t.positions.length<2||t.positions.length>16||!t.sourceOnly&&t.positions.length!==r.length)throw new Error("CSS 渐变位置必须为 2–16 项且与可编辑色标对应");let o=Array.from(t.positions,(n,s)=>{if(n===null)return null;if(n==="previous"){if(!s||t.positions[s-1]==="previous"||!t.sourceOnly&&(r[s].opacity!==0||r[s-1].opacity!==0))throw new Error("CSS 透明色标重复位置无效");return"previous"}if(x(n,["unit","value"]),!["px","percent"].includes(n.unit)||!I(n.value)||Math.abs(n.value)>2e4)throw new Error("CSS 色标只支持有界 px/percent 坐标");return{unit:n.unit,value:n.value}});if(o.filter(n=>n!=="previous").length<2)throw new Error("CSS 渐变至少需要两个原始色标");return{direction:i,positions:o,...t.sourceOnly?{sourceOnly:!0}:{}}}function et(t,r,e){if(t.corner){let n=Math.hypot(r,e);return{x:t.corner[0]*e/n,y:t.corner[1]*r/n}}let i=t.angle*Math.PI/180,o=n=>Math.abs(n)<1e-12?0:Math.abs(Math.abs(n)-1)<1e-12?Math.sign(n):n;return{x:o(Math.sin(i)),y:o(-Math.cos(i))}}function T(t,r,e){var W,N;let i=t.cssLinear;if(!i||i.sourceOnly||!(r>0&&e>0)||![r,e].every(I))return t;let o=et(i.direction,r,e),n=Math.abs(r*o.x)+Math.abs(e*o.y),s=i.positions.flatMap((l,u)=>l==="previous"?[]:[{index:u,value:l===null?null:l.value/(l.unit==="percent"?100:n)}]);(W=s[0]).value??(W.value=0),(N=s.at(-1)).value??(N.value=1);let a=-1/0;for(let l of s)l.value!==null&&(l.value=Math.max(a,l.value),a=l.value);for(let l=0;l<s.length-1;l++){let u=l+1;for(;s[u].value===null;)u++;for(let g=l+1;g<u;g++)s[g].value=s[l].value+(s[u].value-s[l].value)*(g-l)/(u-l);l=u-1}let c=[];for(let l of s)c[l.index]=l.value;i.positions.forEach((l,u)=>{l==="previous"&&(c[u]=c[u-1])});let f=Math.min(0,c[0]),h=Math.max(1,c.at(-1)),k=(l,u=0)=>({x:.5+((l-.5)*n*o.x-u*n*o.y)/r,y:.5+((l-.5)*n*o.y+u*n*o.x)/e});return{...t,handles:[k(f),k(h),k(f,(h-f)/2)],stops:t.stops.map((l,u)=>({...l,position:(c[u]-f)/(h-f)}))}}function E(t){let r=t.cssLinear;return!!(r&&(r.sourceOnly||r.direction.angle!==void 0&&Math.abs(r.direction.angle%90)>1e-9||r.positions.some(e=>e&&e.unit==="px"&&e.value!==0)))}function D(t,r){if(!t.sourceOnly)for(let e=1;e<r.length;e++){let i=r[e-1],o=r[e],n=t.positions[e-1],s=t.positions[e];if(!(s==="previous"||n&&s&&typeof n=="object"&&typeof s=="object"&&n.unit===s.unit&&n.value>=s.value)&&i.opacity!==o.opacity&&i.color!==o.color)throw new Error("不同颜色且透明度变化的 CSS 预乘插值无法由当前原生渐变无损表示")}}var it=t=>t!==null&&typeof t=="object"&&!Array.isArray(t),L=t=>typeof t=="string"&&/^#[a-f\d]{6}$/iu.test(t),d=t=>typeof t=="number"&&Number.isFinite(t),p=t=>Math.max(0,Math.min(1,t));var P=t=>`#${[t.r,t.g,t.b].map(r=>Math.round(p(r)*255).toString(16).padStart(2,"0")).join("")}`,G=t=>[1,3,5].map(r=>parseInt(t.slice(r,r+2),16)/255);function y(t,r){if(!it(t)||Object.keys(t).some(e=>!r.includes(e)))throw new Error("绘制包含未知字段")}function A(t){if(!d(t)||t<0||t>1)throw new Error("绘制透明度必须在 0–1 之间");return t}function ot(t){let[r,e,i]=t;return[[e.x-r.x,2*(i.x-r.x),2*r.x-i.x],[e.y-r.y,2*(i.y-r.y),2*r.y-i.y]]}function v(t){let[[r,e,i],[o,n,s]]=ot(t),a=r*n-e*o;if(Math.abs(a)<1e-8)throw new Error("线性渐变坐标不可逆");return[[n/a,-e/a,(e*s-n*i)/a],[-o/a,r/a,(o*i-r*s)/a]]}function m(t){if(!Array.isArray(t)||!t.length||t.length>8)throw new Error("填充绘制必须为 1–8 层");return t.map(r=>{y(r,r?.type==="SOLID"?["type","color","opacity"]:["type","opacity","handles","stops","cssLinear"]);let e=A(r.opacity);if(r.type==="SOLID"){if(!L(r.color))throw new Error("纯色绘制必须是六位十六进制颜色");return{type:"SOLID",color:r.color.toLowerCase(),opacity:e}}if(r.type!=="GRADIENT_LINEAR"||!Array.isArray(r.handles)||r.handles.length!==3||!Array.isArray(r.stops)||r.stops.length<2||r.stops.length>16)throw new Error("仅支持有界纯色/线性渐变；渐变必须有三个控制点与 2–16 个色标");let i=r.handles.map(s=>{if(y(s,["x","y"]),![s.x,s.y].every(a=>d(a)&&Math.abs(a)<=100))throw new Error("渐变控制点超出范围");return{x:s.x,y:s.y}});v(i);let o=r.stops.map(s=>{if(y(s,["position","color","opacity"]),!L(s.color))throw new Error("渐变色标颜色无效");return{position:A(s.position),color:s.color.toLowerCase(),opacity:A(s.opacity)}});if(o.some((s,a)=>a&&s.position<o[a-1].position))throw new Error("渐变色标必须按位置排序");let n=r.cssLinear===void 0?void 0:z(r.cssLinear,o);return n&&D(n,o),{type:"GRADIENT_LINEAR",opacity:e,handles:i,stops:o,...n?{cssLinear:n}:{}}})}function nt(t){if(!Array.isArray(t)||t.length!==2||!t.every(f=>Array.isArray(f)&&f.length===3&&f.every(d)))throw new Error("渐变矩阵无效");let[[r,e,i],[o,n,s]]=t,a=r*n-e*o;if(Math.abs(a)<1e-8)throw new Error("渐变矩阵不可逆");let c=(f,h)=>({x:(n*(f-i)-e*(h-s))/a,y:(-o*(f-i)+r*(h-s))/a});return[c(0,.5),c(1,.5),c(0,1)]}function H(t,r=()=>{}){if(!Array.isArray(t))return null;let e=t.filter(i=>i?.visible!==!1);if(!e.length||e.length>8||e.some(i=>!["SOLID","GRADIENT_LINEAR"].includes(i?.type)))return null;try{let i=e.map(o=>{if(o.blendMode&&o.blendMode!=="NORMAL")throw new Error("非 NORMAL 混合绘制需本地预览资源");let n=d(o.opacity)?p(o.opacity):1;if(o.type==="SOLID")return{type:"SOLID",color:P(o.color),opacity:n*(d(o.color?.a)?p(o.color.a):1)};let s=o.gradientStops?.map(c=>({position:c.position,color:P(c.color),opacity:d(c.color?.a)?p(c.color.a):1})),a=o.gradientHandlePositions??nt(o.gradientTransform);try{v(a)}catch{if(!s?.length)throw new Error("缺少渐变色标");r("退化线性渐变没有可逆控制点；按零长度渐变的末色标保留，不猜测方向。");let c=s.at(-1);return{type:"SOLID",color:c.color,opacity:n*c.opacity}}return{type:"GRADIENT_LINEAR",opacity:n,handles:a,stops:s}});return m(i)}catch(i){return r(`绘制无法无损转换：${i.message}`),null}}function st(t){let r=t.fillPaints??(L(t.fill)?[{type:"SOLID",color:t.fill,opacity:1}]:[]);return r.some(e=>e.cssLinear&&!e.cssLinear.sourceOnly)?r.map(e=>e.cssLinear?T(e,t.width,t.height):e):r}function j(t){let r=st(t);if(r.some(e=>e.cssLinear&&!e.cssLinear.sourceOnly&&e.handles.some(i=>Math.abs(i.x)>100||Math.abs(i.y)>100)))throw new Error("当前 CSS 渐变尺寸/像素色标产生超出 ±100 的原生控制点；请调整尺寸或色标后再导出。原始 CSS 意图仍可在 Design Studio 中编辑。");return r.map(e=>e.type==="SOLID"?{type:"SOLID",color:Object.fromEntries(["r","g","b"].map((i,o)=>[i,G(e.color)[o]])),opacity:e.opacity}:{type:"GRADIENT_LINEAR",opacity:e.opacity,gradientTransform:v(e.handles),gradientStops:e.stops.map(i=>({position:i.position,color:{...Object.fromEntries(["r","g","b"].map((o,n)=>[o,G(i.color)[n]])),a:i.opacity}}))})}function b(t){if(y(t,["version","width","height","paints"]),t.version!==1||![t.width,t.height].every(i=>d(i)&&i>=1&&i<=2e4))throw new Error("CSS 渐变来源尺寸无效");let r=m(t.paints);if(!r.some(i=>i.cssLinear))throw new Error("CSS 渐变来源缺少几何意图");let e={version:1,width:t.width,height:t.height,paints:r};if(JSON.stringify(e).length>32768)throw new Error("CSS 渐变来源超过 32 KiB");return e}function F(t){return t.fillPaints?.some(r=>r.cssLinear)?b({version:1,width:t.width,height:t.height,paints:t.fillPaints}):null}var kt=Object.freeze(["border-top-left-radius","border-top-right-radius","border-bottom-right-radius","border-bottom-left-radius"]);function at(t){return t.cornerRadii??Array(4).fill(t.cornerRadius??0)}function _(t){let r=at(t),[e,i,o,n]=r,s=Math.min(1,...[[t.width,e+i],[t.width,n+o],[t.height,e+n],[t.height,i+o]].filter(([,a])=>a>0).map(([a,c])=>Math.max(0,a)/c));return r.map(a=>a*s)}var Lt=Object.freeze(["gridRows","gridColumnSizes","gridRowSizes","gridItemsPositioning","gridAutoTracks"]),vt=Object.freeze(["gridRowAnchorIndex","gridColumnAnchorIndex","gridChildHorizontalAlign","gridChildVerticalAlign"]);var U=["top","right","bottom","left"],lt=["frame","component","rectangle","text"],B=t=>Number.isFinite(t)&&t>=0&&t<=100,$=t=>t&&typeof t=="object"&&!Array.isArray(t);function w(t,r){if(!$(t)||!Object.keys(t).some(e=>e!=="sourceOnly")||Object.keys(t).some(e=>!["strokeAlign","strokeWeight","individualStrokeWeights","strokesIncludedInLayout","strokesIncludedInLayoutDefault","sourceOnly"].includes(e)))throw Error("空描边样式包含未知字段或缺少来源样式");if(t.strokeAlign!==void 0&&!["INSIDE","CENTER","OUTSIDE"].includes(t.strokeAlign))throw Error("空描边对齐无效");if(t.strokeWeight!==void 0&&!B(t.strokeWeight))throw Error("空描边宽度必须为 0–100");if(t.individualStrokeWeights!==void 0&&(!$(t.individualStrokeWeights)||Object.keys(t.individualStrokeWeights).length!==4||!U.every(e=>B(t.individualStrokeWeights[e]))))throw Error("空描边侧宽必须为完整的上右下左 0–100 数值");if(t.strokesIncludedInLayout!==void 0&&typeof t.strokesIncludedInLayout!="boolean")throw Error("空描边布局选择必须为布尔值");if(t.strokesIncludedInLayoutDefault!==void 0&&(t.strokesIncludedInLayoutDefault!==!1||t.strokesIncludedInLayout!==void 0))throw Error("空描边 REST 默认只支持独立保存的 false");if(t.sourceOnly!==void 0&&t.sourceOnly!==!0)throw Error("空描边 sourceOnly 只能为 true");if(t.individualStrokeWeights&&t.strokeWeight!==void 0&&U.some(e=>t.individualStrokeWeights[e]!==t.strokeWeight)&&t.sourceOnly!==!0)throw Error("混合侧宽与标量宽度不一致，必须保留为仅来源样式");if(r&&(!lt.includes(r.type)||r.stroke!=="transparent"||r.strokeWidth!==0||r.strokeSides!==void 0||r.strokeAlign!==void 0||r.strokeLayoutExcluded!==void 0||t.individualStrokeWeights!==void 0&&r.type==="text"||(t.strokesIncludedInLayout!==void 0||t.strokesIncludedInLayoutDefault!==void 0)&&!["frame","component"].includes(r.type)))throw Error("空描边样式只适用于无描边绘制的 Frame/Component/Rectangle/Text");return Object.fromEntries(Object.entries(t).map(([e,i])=>[e,$(i)?{...i}:i]))}function R(t){let r=w(t.nativeStrokeInactive,t);if(r.sourceOnly)throw Error("此空描边包含尚不能原生重建的特殊样式；请保留来源绑定");let e=t.layoutReverse||t.layoutWrap==="wrap-reverse"||t.layout==="vertical"&&t.layoutWrap==="wrap";if((r.strokesIncludedInLayout!==void 0||r.strokesIncludedInLayoutDefault!==void 0)&&(e||!["horizontal","vertical","grid"].includes(t.layout)))throw Error("自由布局中的描边布局选择尚不能安全重建；请保留来源绑定，不猜测原生布局状态");return r}var Dt=Object.freeze(["top","right","bottom","left"]),V=t=>typeof t=="number"&&Number.isFinite(t),C=t=>typeof t=="string"&&/^#[a-f\d]{6}$/iu.test(t),ct=["frame","rectangle","component"],ut=t=>["frame","component"].includes(t?.type)&&["horizontal","vertical"].includes(t.layout)&&t.strokeAlign==="inside";function O(t){if(!Array.isArray(t)||t.length!==4)throw new Error("strokeSides 必须为上右下左四项");return Array.from(t,r=>{if(!r||typeof r!="object"||Array.isArray(r)||Object.keys(r).some(e=>!["width","color","opacity"].includes(e))||!V(r.width)||r.width<0||r.width>100||!C(r.color)||!V(r.opacity)||r.opacity<0||r.opacity>1)throw new Error("边框只支持 0–100px、六位 RGB 与 0–1 透明度的有界实线侧边");return{width:r.width,color:r.color.toLowerCase(),opacity:r.opacity}})}function ft(t){return t.strokeSides??Array.from({length:4},()=>({width:t.strokeWidth??0,color:C(t.stroke)?t.stroke:"#000000",opacity:C(t.stroke)?1:0}))}var dt=t=>t.every(r=>r.width===t[0].width&&(!r.width||r.opacity===t[0].opacity&&(!r.opacity||r.color===t[0].color)));function M(t){if(t.nativeStrokeInactive!==void 0&&w(t.nativeStrokeInactive,t),t.strokeLayoutExcluded!==void 0&&(t.strokeLayoutExcluded!==!0||!ut(t)))throw new Error("strokeLayoutExcluded 只能为 true，且只适用于水平/垂直 Auto Layout Frame/Component 的 inside 描边");if(t.strokeAlign!==void 0&&!["inside","center","outside"].includes(t.strokeAlign))throw new Error("strokeAlign 只支持 inside/center/outside");let r=t.strokeSides===void 0?null:O(t.strokeSides);if((t.strokeSides!==void 0||t.strokeAlign!==void 0)&&!ct.includes(t.type))throw new Error("独立边框/对齐暂只适用于矩形与 Frame 表面");if(r&&!dt(r)&&_(t).some(e=>e>0))throw new Error("不同侧边的圆角接合暂不能无损保留；请使用方角或统一边框");if(r?.some((e,i)=>e.width>0&&r[(i+1)%4].width>0&&e.opacity!==r[(i+1)%4].opacity))throw new Error("相接侧边的不同透明度暂不能保留；请使用相同透明度或不相接的侧边")}var X=t=>t.strokeSides!==void 0||t.strokeAlign!==void 0;function J(t){M(t);let r=ft(t),e=r.filter(o=>o.width>0),i=e[0]??{color:"#000000",opacity:0};if(e.some(o=>(o.opacity||i.opacity)&&(o.color!==i.color||o.opacity!==i.opacity)))throw new Error("Figma 原生侧边只支持同一颜色/透明度；多色边框请保留 v3 源文档，不能无损导出");return{align:(t.strokeAlign??"center").toUpperCase(),weights:r.map(o=>o.width),paint:{type:"SOLID",color:Object.fromEntries(["r","g","b"].map((o,n)=>[o,parseInt(i.color.slice(1+n*2,3+n*2),16)/255])),opacity:i.opacity}}}return tt(ht);})();
/* END GENERATED PAINT RUNTIME */
/* BEGIN GENERATED TEXT RUNTIME */
"use strict";var CodeShellFigmaText=(()=>{var s=Object.defineProperty;var u=Object.getOwnPropertyDescriptor;var x=Object.getOwnPropertyNames;var p=Object.prototype.hasOwnProperty;var y=(t,e)=>{for(var i in e)s(t,i,{get:e[i],enumerable:!0})},w=(t,e,i,n)=>{if(e&&typeof e=="object"||typeof e=="function")for(let r of x(e))!p.call(t,r)&&r!==i&&s(t,r,{get:()=>e[r],enumerable:!(n=u(e,r))||n.enumerable});return t};var m=t=>w(s({},"__esModule",{value:!0}),t);var d={};y(d,{nativeTextContent:()=>o,nativeTextLineHeight:()=>f,nativeTextPlan:()=>c,validTextLineHeight:()=>a});function a(t){return Number.isFinite(t.lineHeight)?t.lineHeightUnit===void 0?t.lineHeight>=.7&&t.lineHeight<=3:t.lineHeightUnit==="pixels"&&t.lineHeight>=4.2&&t.lineHeight<=720:!1}function f(t){if(!a(t))throw Error("文字行高或单位无效。");return t.lineHeightUnit==="pixels"?{unit:"PIXELS",value:t.lineHeight}:{unit:"PERCENT",value:t.lineHeight*100}}function h(t){return!!(t&&typeof t=="object"&&!Array.isArray(t)&&Object.keys(t).every(e=>["version","signature","sourceSignature","lineWidths","lineInkBounds","height","fontAvailable"].includes(e))&&t.version===1&&typeof t.signature=="string"&&t.signature.length<=8500&&(t.sourceSignature===void 0||typeof t.sourceSignature=="string"&&t.sourceSignature.length<=8500)&&Array.isArray(t.lineWidths)&&t.lineWidths.length>=1&&t.lineWidths.length<=4001&&t.lineWidths.every(e=>Number.isFinite(e)&&e>=0&&e<=1e6)&&Array.isArray(t.lineInkBounds)&&t.lineInkBounds.length===t.lineWidths.length&&t.lineInkBounds.every(e=>e&&typeof e=="object"&&!Array.isArray(e)&&Object.keys(e).length===4&&["x","y","width","height"].every(i=>Number.isFinite(e[i])&&Math.abs(e[i])<=1e6)&&e.width>=0&&e.height>=0)&&Number.isFinite(t.height)&&t.height>=0&&t.height<=1e6&&typeof t.fontAvailable=="boolean")}var g=t=>{try{let e=JSON.parse(t);return Array.isArray(e)&&(e.length===8||e.length===9&&e[8]==="pixels")&&typeof e[0]=="string"?e[0]:void 0}catch{return}};function S(t,e){let i=0;for(let n of t)if(e.startsWith(n,i))i+=n.length;else if(n!==`
`)return!1;return i===e.length}function o(t,e){let i=t.text??"",n=t.textSource;if(typeof n!="string"||i===n)return i;if(h(t.textMetrics)){let r=g(t.textMetrics.signature),l=g(t.textMetrics.sourceSignature);if(i===r)return n;if(r!==void 0&&(l===void 0||n===l))return i}return e&&i===e.text&&n!==e.textSource||t.textFlow==="wrap"&&S(i,n)||t.textOverflow==="ellipsis"&&i.endsWith("…")&&n.startsWith(i.slice(0,-1).trimEnd())?n:i}function c(t,e){return{characters:o(t,e),autoResize:t.layoutSizingHorizontal==="hug"?"WIDTH_AND_HEIGHT":t.layoutSizingVertical==="hug"?"HEIGHT":"NONE",truncation:t.textOverflow==="ellipsis"?"ENDING":"DISABLED",maxLines:t.textOverflow==="ellipsis"?1:null}}return m(d);})();
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
        if ((node.textFlow || node.textOverflow) && !node.textSource?.trim())
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
        if (node.layout === "grid") CodeShellFigmaGrid.nativeGridPlan(node, parentSource);
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
    const count = validateTransfer(value, undefined, { copying: hooks.factoryOnly !== true }); // Complete validation before the first document mutation.
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
        const plan = CodeShellFigmaGrid.configureNativeGrid(node, source, parentSource);
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
      setNodeStroke(node,source);
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
          const plan = applyLayout(node, source, parentSource);
          for (const child of source.children) {
            const created = await createNode(child, node, source);
            CodeShellFigmaGrid.positionNativeGridChild(created, child, source, plan);
          }
          CodeShellFigmaGrid.finishNativeGrid(node, source, parentSource);
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
