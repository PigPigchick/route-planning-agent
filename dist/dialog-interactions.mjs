export function attachDialogBackdropClose(dialog){
 let startedOutside=false;
 const outside=event=>{
  const bounds=dialog.getBoundingClientRect();
  return event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom;
 };
 const clear=()=>{startedOutside=false};
 dialog.addEventListener('pointerdown',event=>{
  startedOutside=dialog.open&&event.button===0&&event.isPrimary!==false&&event.target===dialog&&outside(event);
 });
 dialog.addEventListener('click',event=>{
  const dismiss=startedOutside&&dialog.open&&event.button===0&&event.detail>0&&event.target===dialog&&outside(event);
  clear();
  if(dismiss)dialog.close();
 });
 // Opening a native context menu must not leave an old backdrop gesture armed.
 for(const name of ['contextmenu','pointercancel','close'])dialog.addEventListener(name,clear);
}
