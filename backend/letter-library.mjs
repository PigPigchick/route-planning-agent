// Remove contact details before historical outgoing letters are sent for embedding.
// Originals and extracted text remain available only in the local database.
export function historicalIndexText(text){
 let contactBlock=false;
 return String(text||'').replace(/\u0000/g,'').split(/\r?\n/).filter(line=>{
  if(/联系人|收件人|地址[:：]|复函.*[寄送]|回函.*[寄送]|联系电话|联系手机|邮编|传真|电子邮[箱件]|电子邮箱|E-?mail|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/i.test(line)){contactBlock=true;return false;}
  if(/(?:\+?86[- ]?)?1[3-9]\d{9}|0\d{2,3}[-— ]?\d{7,8}/.test(line))return false;
  if(contactBlock){if(/^\s*附件/.test(line)||line.length>80)contactBlock=false;else return false;}
  return true;
 }).join('\n').replace(/https?:\/\/\S+/g,'【历史链接省略】').trim();
}
export function archiveLabel(direction){return {outgoing:'发函模板参考',incoming:'复函参考',support:'支撑材料'}[direction]||'参考资料';}
