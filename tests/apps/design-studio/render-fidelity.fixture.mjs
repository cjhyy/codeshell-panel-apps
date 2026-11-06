export const fidelityNode = (id,type,x,y,width,height,extra={}) => ({ id,type,name:id,x,y,width,height,
  fill:"#111111",stroke:"transparent",strokeWidth:0,opacity:1,rotation:0,cornerRadius:0,visible:true,locked:false,
  ...(["frame","component","group"].includes(type)?{layout:"none",gap:0,padding:0,alignItems:"start",justifyContent:"start",children:[]}:{}),...extra });
// Missing local/resource fonts may still produce useful fallback diagnostics,
// but cannot certify the requested font. Only selected-page cases are required.
export function fidelityFontOmissions(fonts, pages) {
  return fonts.filter(font=>!font.available).flatMap(font=>{
    const cases=pages.flatMap(page=>page.nodes.filter(node=>node.type==="text"&&String(node.fontFamily).split(",").some(family=>family.trim().replace(/^["']|["']$/g,"").toLowerCase()===font.family.toLowerCase())).map(node=>({page:page.id,id:node.id})));
    return cases.length?[{family:font.family,cases,status:"fallback-only; requested font not certified"}]:[];
  });
}
const text=(id,x,y,width,height,value,extra={})=>fidelityNode(id,"text",x,y,width,height,{text:value,fontFamily:"Arial",fontSize:20,fontWeight:400,lineHeight:1.6,textAlign:"left",...extra});
export function renderFidelityFixture({ textRangeSourceSignature } = {}) {
  const lineHeights=[1,1.2,1.6,2,1.6];
  const samples=[{label:"latin",value:"HELLO HMI",family:"Arial"},{label:"cjk",value:"中文渲染保真",family:'"PingFang SC", sans-serif'},{label:"mixed",value:"中文 Hello 123",family:'system-ui, sans-serif'}];
  const lines=lineHeights.flatMap((lineHeight,row)=>samples.map((sample,column)=>text(`${sample.label}-lh-${row}`,20+column*212,18+row*80,188,56,sample.value,{fontFamily:sample.family,lineHeight,...(row===4?{lineHeightUnit:"pixels",lineHeight:30}:{})})));
  const variations=[
    text("inter-bytes",20,20,270,44,"Inter HMI 123",{fontFamily:"Fidelity Inter",fontRef:"fidelity-inter",fontWeight:600,lineHeight:1.6}),
    text("fallback",340,20,290,44,"中文 fallback HMI",{fontFamily:'"Absent Fidelity Font", Arial, sans-serif'}),
    text("center-spacing",20,85,280,52,"HMI AV W",{fontWeight:700,letterSpacing:1.25,textAlign:"center",lineHeight:2}),
    text("right-spacing",340,85,280,52,"HMI AV W",{fontWeight:500,letterSpacing:.75,textAlign:"right",lineHeight:1.2}),
    text("ranges-plain",20,150,280,68,"RED BLUE HMI",{fontFamily:"Fidelity Inter",fontRef:"fidelity-inter",textSource:"RED BLUE HMI",...(textRangeSourceSignature ? {textRanges:{version:1,sourceSignature:textRangeSourceSignature("RED BLUE HMI"),ranges:[{start:0,end:3,fill:"#cc2233"},{start:4,end:8,fill:"#2244aa"}]}}:{})}),
    text("finite-offset",340,150,280,64,"Imported HMI",{layoutBaselineOffset:5.25,lineHeight:1.6}),
    text("stroke-text",20,235,280,70,"HMI TEST",{fontSize:34,fill:"#ffffff",stroke:"#111111",strokeWidth:1.5}),
    text("opacity-text",340,235,280,60,"HMI OPACITY",{opacity:.6,fontWeight:700}),
    text("multi-line",20,325,290,90,"First HMI\nSecond HMI\nThird HMI",{lineHeight:1.2}),
    text("finite-offset-negative",340,325,280,66,"Legacy HMI",{layoutBaselineOffset:-3,lineHeight:2}),
    text("finite-offset-native",340,403,280,28,"Native HMI",{fontFamily:"Fidelity Inter",fontRef:"fidelity-inter",fontSize:16,fontWeight:600,layoutBaselineOffset:3.5,lineHeight:1.2}),
  ];
  const shapes=[
    fidelityNode("legacy-parent","frame",20,20,280,70,{fill:"#ffffff",stroke:"#111111",strokeWidth:4,layout:"horizontal",padding:12,gap:12,alignItems:"center",children:[text("button-label",32,42,112,32,"BUTTON HMI",{fontSize:16}),fidelityNode("button-edge","rectangle",156,40,20,24,{fill:"#2266cc"})]}),
    fidelityNode("selector","frame",340,20,280,70,{fill:"#ffffff",stroke:"#111111",strokeWidth:2,cornerRadius:8,layout:"horizontal",padding:12,gap:12,alignItems:"center",children:[text("selector-label",352,42,150,32,"Select 中文",{fontSize:16}),fidelityNode("selector-edge","rectangle",514,43,12,18,{fill:"#2266cc"})]}),
    fidelityNode("legacy-stroke","rectangle",20,130,130,74,{fill:"#ffffff",stroke:"#111111",strokeWidth:3}),
    fidelityNode("inside-stroke","rectangle",185,130,130,74,{fill:"#ffffff",stroke:"#111111",strokeWidth:3,strokeAlign:"inside"}),
    fidelityNode("center-stroke","rectangle",350,130,120,74,{fill:"#ffffff",stroke:"#111111",strokeWidth:3,strokeAlign:"center"}),
    fidelityNode("outside-stroke","rectangle",505,130,115,74,{fill:"#ffffff",stroke:"#111111",strokeWidth:3,strokeAlign:"outside"}),
    fidelityNode("radius","rectangle",20,250,120,75,{fill:"#eeeeee",stroke:"#111111",strokeWidth:4,cornerRadius:14}),
    fidelityNode("rotation","rectangle",185,250,110,60,{fill:"#2266cc",rotation:15}),
    fidelityNode("clip","frame",350,250,120,75,{fill:"#eeeeee",clipContent:true,cornerRadius:12,children:[fidelityNode("clipped-child","rectangle",330,272,155,30,{fill:"#2266cc"})]}),
    fidelityNode("shadow","rectangle",505,250,115,70,{fill:"#eeeeee",stroke:"#111111",strokeWidth:2,shadow:{color:"#000000",opacity:.25,x:4,y:6,blur:8}}),
    fidelityNode("shadow-stack","rectangle",20,355,200,60,{fill:"#eeeeee",shadowStack:{basis:"css-box",layers:[{kind:"outer",color:"#000000",opacity:.25,x:3,y:4,blur:4,spread:0,visible:true},{kind:"inner",color:"#000000",opacity:.2,x:2,y:2,blur:3,spread:0,visible:true}]}}),
    fidelityNode("opacity","rectangle",350,355,120,60,{fill:"#2266cc",opacity:.5}),
  ];
  return {format:"codeshell.design",version:3,name:"Render fidelity B0 matrix",canvas:{width:640,height:440,background:"#ffffff"},tokens:{colors:[]},resources:[],activePageId:"lines",pages:[{id:"lines",name:"Line boxes",children:lines},{id:"variants",name:"Text variants",children:variations},{id:"geometry",name:"Stroke and geometry",children:shapes}]};
}
