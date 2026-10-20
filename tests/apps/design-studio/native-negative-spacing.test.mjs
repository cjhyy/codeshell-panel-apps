import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { importFigmaJson, prepareFigmaImport, createFigmaTransfer } from '../../../apps/design-studio/app/figma-bridge.mjs';
import { createFigmaBinding, createFigmaPatch } from '../../../apps/design-studio/app/figma-binding.mjs';
import { normalizeDesignDocument, serializeDesignDocument } from '../../../apps/design-studio/app/document.mjs';
import { applyAllAutoLayouts } from '../../../apps/design-studio/app/layout.mjs';
import { nativeMainGap, validateNativeLayoutSpacing } from '../../../apps/design-studio/app/layout-spacing.mjs';
const fixture=JSON.parse(await readFile(new URL('../../fixtures/design-studio-negative-margins/actual-native-spacing.json',import.meta.url)));
const receipt=JSON.parse(await readFile(new URL('../../fixtures/design-studio-negative-margins/actual-native-spacing-receipt.json',import.meta.url)));
const reopen=document=>normalizeDesignDocument(JSON.parse(serializeDesignDocument(document)));
const sourceId=(imported,id)=>imported.mapping.find(entry=>entry.sourceId===id)?.designId;
const nodeFor=(imported,document,id)=>document.nodes.find(node=>node.id===sourceId(imported,id));
function assertSnapshot(imported,document,item,snapshot){
  const rawNodes=new Map(snapshot.nodes.map(node=>[node.id,node]));
  const absolute=(id,axis)=>{const node=rawNodes.get(id);return node[axis]+(rawNodes.has(node.parentId)?absolute(node.parentId,axis):0);};
  for(const raw of snapshot.nodes){
    const node=nodeFor(imported,document,raw.id);assert(node,raw.id);
    for(const[key,value]of Object.entries({x:absolute(raw.id,'x'),y:absolute(raw.id,'y'),width:raw.width,height:raw.height}))
      assert(Math.abs(node[key]-value)<0.0001,`${item.name}/${snapshot.stage}/${raw.name}.${key}: ${node[key]} != ${value}`);
  }
}

test('actual native shared-gap snapshots retain AUTO reflow through resize and reopen',()=>{
  const before=JSON.stringify(fixture),imported=importFigmaJson(fixture),document=imported.document;
  assert(imported.warnings.some(warning=>warning.code==='native-negative-gap-effective'));
  applyAllAutoLayouts(document.nodes);
  for(const item of receipt.cases)assertSnapshot(imported,document,item,item.snapshots[2]);
  for(const item of receipt.cases){const control=nodeFor(imported,document,item.controlId);control[item.direction==='HORIZONTAL'?'width':'height']=item.snapshots[1].parentMainExtent;}
  applyAllAutoLayouts(document.nodes);
  for(const item of receipt.cases)assertSnapshot(imported,document,item,item.snapshots[1]);
  const saved=reopen(document);applyAllAutoLayouts(saved.nodes);
  for(const item of receipt.cases)assertSnapshot(imported,saved,item,item.snapshots[1]);
  assert.equal(JSON.stringify(fixture),before,'raw requested itemSpacing is immutable');
  assert(saved.nodes.filter(node=>node.gap<0).every(node=>node.layout!=='none'));
});

test('native export rejects an incompatible CSS signed gap without altering authored layout',()=>{
  const imported=importFigmaJson(fixture),document=imported.document,item=receipt.cases.find(item=>item.index===5);
  const parent=nodeFor(imported,document,item.parentId);assert.equal(parent.gap,-1);
  parent.gap=-16;const before=JSON.stringify(document);
  assert.throws(()=>createFigmaTransfer(document),/最小可见 AUTO 子项/u);
  assert.equal(JSON.stringify(document),before);
  const plan={layout:'horizontal',gap:-16,children:[{width:1,height:20},{width:599,height:20},{width:2,height:20}]};
  assert.deepEqual(nativeMainGap(plan),{requested:-16,effective:-1,minimum:1});
  assert.throws(()=>validateNativeLayoutSpacing(plan));
  assert.doesNotThrow(()=>validateNativeLayoutSpacing({...plan,gap:-1}));
  assert.doesNotThrow(()=>validateNativeLayoutSpacing({...plan,children:[{width:100,height:20},...plan.children.map(child=>({...child,visible:false}))]}));
});

test('source binding keeps requested negative gap for no-op/style and guards threshold edits',async()=>{
  const imported=await prepareFigmaImport(fixture),binding=createFigmaBinding(imported),current=reopen(imported.document);
  applyAllAutoLayouts(current.nodes);
  assert.deepEqual(createFigmaPatch(binding,current).operations,[]);
  const item=receipt.cases.find(item=>item.index===5),parent=nodeFor(imported,current,item.parentId),middle=nodeFor(imported,current,item.middleId);
  middle.fill='#123456';
  let patch=createFigmaPatch(binding,current);assert.equal(patch.operations.length,1);assert.deepEqual(patch.operations[0].changed,['fill']);
  const nested=Object.values(binding.source.nodes)[0].document.children[0].children.find(node=>node.id===item.parentId);
  assert.equal(nested.itemSpacing,-16);
  parent.gap=-0.5;applyAllAutoLayouts(current.nodes);patch=createFigmaPatch(binding,current);
  const update=patch.operations.find(operation=>operation.sourceId===item.parentId);
  assert(update.changed.includes('gap'));assert.equal(update.before.itemSpacing,-16);assert.equal(update.after.gap,-0.5);
  const changed=reopen(imported.document),changedParent=nodeFor(imported,changed,item.parentId);
  const children=changed.nodes.filter(node=>node.parentId===changedParent.id);children[0].width=children[2].width=2;
  applyAllAutoLayouts(changed.nodes);
  assert.throws(()=>createFigmaPatch(binding,changed),/不能静默覆盖原始请求/u);
  changedParent.gap=0;applyAllAutoLayouts(changed.nodes);assert.doesNotThrow(()=>createFigmaPatch(binding,changed));
});

test('null clipped paint bounds retain native AUTO participation while hidden/absolute/freeform suppression stays explicit',()=>{
  for(const mode of ['HORIZONTAL','VERTICAL','GRID']){
    const shape=(id,properties={})=>({id,type:'RECTANGLE',name:id,absoluteBoundingBox:{x:-40,y:-40,width:1,height:1},absoluteRenderBounds:null,fills:[],...properties});
    const source={document:{id:'0:1',type:'CANVAS',name:'Clipped flow',children:[{id:'1:1',type:'FRAME',name:'Clip',clipsContent:true,
      absoluteBoundingBox:{x:0,y:0,width:100,height:100},children:[{id:'1:2',type:'FRAME',name:'Flow',layoutMode:mode,
        absoluteBoundingBox:{x:-40,y:-40,width:80,height:80},layoutSizingHorizontal:'FIXED',layoutSizingVertical:'FIXED',
        ...(mode==='GRID'?{gridColumnCount:2,gridRowCount:1,gridColumnSizes:[{type:'FIXED',value:40},{type:'FIXED',value:40}],gridRowSizes:[{type:'FIXED',value:80}],gridItemsPositioning:'MANUAL',gridAutoTracks:'NONE'}:{}),
        children:[shape('1:3',{layoutPositioning:'AUTO',gridRowAnchorIndex:0,gridColumnAnchorIndex:0}),shape('1:4',{visible:false,layoutPositioning:'AUTO',gridRowAnchorIndex:0,gridColumnAnchorIndex:1}),shape('1:5',{layoutPositioning:'ABSOLUTE'})]},
      {id:'1:6',type:'FRAME',name:'Freeform',absoluteBoundingBox:{x:-40,y:-40,width:80,height:80},children:[shape('1:7')]}]}]}};
    const imported=importFigmaJson(source),node=id=>nodeFor(imported,imported.document,id);
    assert.notEqual(node('1:2').layout,'none',mode);
    assert.equal(node('1:3').visible,true,`${mode} AUTO remains in flow`);
    assert.equal(node('1:4').visible,false,`${mode} explicit hidden stays hidden`);
    assert.equal(node('1:5').visible,false,`${mode} absolute paint suppression remains`);
    assert.equal(node('1:7').visible,false,`${mode} freeform paint suppression remains`);
  }
});
