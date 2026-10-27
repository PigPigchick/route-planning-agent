const present=v=>v!==undefined&&v!==null&&String(v).trim()!=='';
export const SPECIAL_LETTER_TEMPLATES=[
 {id:'grounding',name:'接地极址与接地极线路征询',version:'1.0',source:'接地极址及接地极线路发函样例',required:[],attachments:['路径图'],purpose:'征询接地极址及配套接地极线路方案，不代替选址或审批结论'},
 {id:'railway',name:'铁路协调征询',version:'1.0',source:'铁路协调发函样例',required:[['facilityName','铁路或相关设施名称']],attachments:['路径图','坐标表'],purpose:'征询线路与现状或规划铁路平行、交叉等关系的协调意见'},
 {id:'seismic',name:'地震监测协调征询',version:'1.0',source:'地震监测协调发函样例',required:[],attachments:['路径图','坐标表'],purpose:'征询线路与地震监测设施的协调意见，监测设施名称和范围须按实际资料填写'},
 {id:'military',name:'军事设施协调征询',version:'1.0',source:'军事设施协调发函样例',required:[],attachments:['路径图','坐标表'],purpose:'征询线路路径与相关军事设施的协调意见，不推断设施位置或审批结果'}
];
export const CROSSING_FIELDS={
 highway:[['facilityName','公路名称'],['spanStart','起点杆塔'],['spanEnd','终点杆塔'],['angleDeg','交叉角 °'],['spanLengthM','档距 m'],['horizontalDistanceM','塔路最小水平距离 m'],['clearanceM','导线至路面最小距离 m'],['chainage','跨越点里程']],
 water:[['facilityName','河流或航道名称'],['spanStart','起点杆塔'],['spanEnd','终点杆塔'],['coordinateSystem','坐标基准']]
};
const rowNumbers=new Set(['angleDeg','spanLengthM','horizontalDistanceM','clearanceM']);
export function crossingRows(a){
 if(!CROSSING_FIELDS[a.type])return [];
 const rows=a.crossings===undefined?[a.facts||{}]:a.crossings;
 return rows.map(row=>Object.fromEntries(CROSSING_FIELDS[a.type].map(([k])=>[k,row[k]??(['facilityName','coordinateSystem'].includes(k)?a.facts?.[k]:'')??''])));
}
export function validateCrossingRows(a){
 if(a.crossings===undefined)return;
 const fields=CROSSING_FIELDS[a.type];
 if(!fields||!Array.isArray(a.crossings)||!a.crossings.length||a.crossings.length>50)throw new Error('跨越明细仅适用于公路/河道，每份协议须为1至50行');
 const allowed=new Set(fields.map(([k])=>k));
 for(const [i,row] of a.crossings.entries()){
  if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('第'+(i+1)+'行跨越明细格式无效');
  for(const [k,v] of Object.entries(row)){
   if(!allowed.has(k))throw new Error('跨越明细存在未支持字段：'+k);
   if(!present(v))continue;
   if(rowNumbers.has(k)){
    if(typeof v!=='number'||!Number.isFinite(v)||v<0||k==='angleDeg'&&v>180)throw new Error('第'+(i+1)+'行跨越明细的'+k+'数值无效');
   }else if(typeof v!=='string'||v.length>500)throw new Error('跨越明细的'+k+'须为不超过500字的文字');
  }
 }
}
export function crossingTables(a){
 const rows=crossingRows(a),value=v=>present(v)?String(v):'待补';
 if(a.type==='highway')return [{title:'公路跨越技术参数表',headers:['序号','公路','跨越档','交叉角','档距 m','塔路距离 m','导线至路面 m','里程'],rows:rows.map((f,i)=>[String(i+1),value(f.facilityName),value(f.spanStart)+'～'+value(f.spanEnd),present(f.angleDeg)?f.angleDeg+'°':'待补',value(f.spanLengthM),value(f.horizontalDistanceM),value(f.clearanceM),value(f.chainage)])}];
 if(a.type==='water')return [{title:'河道与航道跨越明细表',headers:['序号','河流或航道','起点杆塔','终点杆塔','坐标基准'],rows:rows.map((f,i)=>[String(i+1),value(f.facilityName),value(f.spanStart),value(f.spanEnd),value(f.coordinateSystem)])}];
 return [];
}
export function normalizeAttachmentName(value){
 let text=String(value??'').trim();
 for(let i=0;i<3;i++){const next=text.replace(/^(?:附件\s*)?(?:\d{1,2}|[一二三四五六七八九十]+)\s*[.．、:：）)]\s*/,'');if(next===text||!next.trim())break;text=next.trim();}
 return text;
}
export function requestParagraph(value){
 const text=String(value??'').trim();if(!text)return '';
 // Complete source sentences remain intact; noun lists get one program-owned frame.
 if(/[。！？!?]/.test(text)||/^(?:现|请|恳请|望|为|本次)/.test(text))return text;
 return '现就以下事项征询贵单位意见：'+text.replace(/[；;，,]+$/,'')+'。请研究后函复。';
}
export function buildLetterTitle(a,projectName){
 const action=a.round==='repeat'?'再次征询':a.round==='revised'?'重新征询':'征询';
 if(a.subject?.trim())return '关于'+action+projectName+a.subject.trim()+'意见的函';
 if(a.type==='mineral')return '关于'+(a.round==='repeat'?'再次申请核查':a.round==='revised'?'重新申请核查':'申请核查')+projectName+'线路有无压覆矿产资源的函';
 let subject='路径方案';
 if(a.type==='grounding')subject='接地极址及接地极线路方案';
 if(a.type==='railway')subject='线路路径与'+(a.facts?.facilityName||'铁路设施')+'协调事项';
 if(a.type==='seismic')subject='线路路径与地震监测设施协调事项';
 if(a.type==='military')subject='线路路径与军事设施协调事项';
 if(CROSSING_FIELDS[a.type]){const names=[...new Set(crossingRows(a).map(r=>r.facilityName).filter(Boolean))];subject='跨越'+(names.length>2?(a.type==='water'?'河道及航道':'公路'):names.join('、')||(a.type==='water'?'河道':'公路'))+'路径方案';}
 return '关于'+action+projectName+subject+'意见的函';
}
export function assembleTemplateBody(blocks,tokens){
 return blocks.map(block=>{
  // v1 templates wrapped requestItems, which is now a complete protected paragraph.
  if(block.includes('{{requestItems}}'))return tokens.requestItems;
  return block.replace(/\{\{(\w+)\}\}/g,(_,k)=>tokens[k]||'');
 }).filter(block=>block.trim());
}
