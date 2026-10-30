import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attachDialogBackdropClose} from './dist/dialog-interactions.mjs';

function fixture(){
 const listeners=new Map();
 const dialog={open:true,closes:0,getBoundingClientRect:()=>({left:100,top:100,right:600,bottom:500}),
  addEventListener(name,fn){listeners.set(name,fn)},close(){this.open=false;this.closes++;listeners.get('close')?.()}};
 attachDialogBackdropClose(dialog);
 const event=(name,{x=50,y=50,button=0,target=dialog,detail=1,...rest}={})=>listeners.get(name)?.({clientX:x,clientY:y,button,target,detail,...rest});
 return {dialog,event};
}
test('弹窗内右键、空白边缘和文字选择产生的外层点击均不会关闭',()=>{
 const f=fixture();
 f.event('pointerdown',{x:200,y:150,button:2});f.event('contextmenu',{x:200,y:150,button:2});f.event('click',{x:200,y:150,button:2});
 f.event('pointerdown',{x:101,y:101});f.event('click',{x:101,y:101});
 f.event('pointerdown',{x:200,y:200,target:{nodeName:'DD'}});f.event('click',{x:50,y:50});
 assert.equal(f.dialog.closes,0);assert.equal(f.dialog.open,true);
});
test('仅左键在背景按下并在背景点击才关闭，向内拖动不关闭',()=>{
 const f=fixture();f.event('pointerdown');f.event('click',{x:200,y:200});assert.equal(f.dialog.open,true);
 f.event('pointerdown');f.event('click');assert.equal(f.dialog.open,false);assert.equal(f.dialog.closes,1);
});
test('背景右键、键盘点击、取消手势及右键菜单之后的遗留点击不关闭',()=>{
 for(const kind of ['right','keyboard','cancel','contextmenu','secondary']){
  const f=fixture();
  f.event('pointerdown',kind==='right'?{button:2}:kind==='secondary'?{isPrimary:false}:{});
  if(kind==='cancel')f.event('pointercancel');if(kind==='contextmenu')f.event('contextmenu');
  f.event('click',kind==='right'?{button:2}:kind==='keyboard'?{detail:0}:{});
  assert.equal(f.dialog.open,true,kind);
 }
});
test('显式关闭再打开后，不沿用上次框外按下状态',()=>{
 const f=fixture();f.event('pointerdown');f.dialog.close();f.dialog.open=true;f.event('click');assert.equal(f.dialog.open,true);
});
