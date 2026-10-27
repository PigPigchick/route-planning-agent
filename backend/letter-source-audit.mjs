// Deterministic suggestions from local reference text; never infer a recipient.
const blank=v=>v===undefined||v===null||String(v).trim()==='';
export function extractSourceFacts(text,{type}={}){
 const fields=[],crossings=[],coordinates=[],coordinateSystemEvidence=(text.match(/CGCS\s*2000\s*坐标系/i)||[])[0]||'';
 if(type==='water'){
  const re=/([A-Z]{1,8}\d+(?:\+\d+)?)\s*[-—～~至]\s*([A-Z]{1,8}\d+(?:\+\d+)?)\s*段线路跨越([^。；\n]{1,40})[。；\n]/g;
  for(const m of text.matchAll(re))crossings.push({facilityName:m[3].trim(),spanStart:m[1],spanEnd:m[2],...(/CGCS\s*2000/i.test(text)?{coordinateSystem:'CGCS2000'}:{}),source:m[0].trim()});
  const cr=/\b([A-Z]{1,8}\d+(?:\+\d+)?)\s*[\r\n]+\s*(\d{5,8}\.\d+)\s*[，,]\s*(\d{5,8}\.\d+)/g;
  for(const m of text.matchAll(cr))coordinates.push({tower:m[1],x:m[2],y:m[3],source:m[0]});
 }
 const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
 for(let i=lines.length-1;i>0;i--)if(/^\d{4}年\s*\d{1,2}月\s*\d{1,2}日\s*$/.test(lines[i])){
  const previous=lines[i-1];if(previous.length<150&&/(?:公司|研究院|供电局|设计院)$/.test(previous)&&!/[：:]/.test(previous))fields.push({field:'project.issuer',value:previous,source:previous+'\n'+lines[i]});break;
 }
 return {fields,crossings,coordinates,coordinateSystemEvidence};
}
export function fillMissingFromSource(input,agreementId,extraction){
 const copy=structuredClone(input),a=copy.agreements.find(a=>a.id===agreementId),applied=[],conflicts=[];
 if(!a)throw new Error('协议事项不存在');a.facts??={};
 function fill(target,key,value,path,source){if(blank(target[key])){target[key]=value;applied.push({field:path,value,source});}else if(String(target[key])!==String(value))conflicts.push({field:path,current:target[key],candidate:value,source});}
 for(const item of extraction.fields)if(item.field==='project.issuer')fill(copy.project,'issuer',item.value,item.field,item.source);
 if(extraction.crossings.length===1&&a.crossings===undefined){for(const [k,v] of Object.entries(extraction.crossings[0]))if(k!=='source')fill(a.facts,k,v,'facts.'+k,k==='coordinateSystem'?(extraction.coordinateSystemEvidence||extraction.crossings[0].source):extraction.crossings[0].source);}
 else if(extraction.crossings.length>1&&a.crossings===undefined){a.crossings=extraction.crossings.map(({source,...row})=>row);applied.push({field:'crossings',value:a.crossings,source:extraction.crossings.map(r=>r.source).join('\n')});}
 return {input:copy,applied,conflicts,coordinates:extraction.coordinates};
}
export function attachmentKindFromName(name){return /航带/.test(name)?'航带图':/平断面/.test(name)?'平断面图':/高程/.test(name)&&/杆塔|坐标/.test(name)?'杆塔坐标高程表':/坐标/.test(name)?'坐标表':/路径|走向|地形图/.test(name)?'路径图':'其他';}
function stem(value){return value.normalize('NFKC').split('/').at(-1).replace(/\.[a-z\d]{1,5}$/i,'').replace(/^附件\s*[:：]\s*/,'').replace(/^(?:附件\s*)?(?:\d{1,2}|[一二三四五六七八九十]+)[.、:：)）]\s*/,'').replace(/[（(][^()（）]*(?:式|份|张|比例尺)[^()（）]*[)）]/g,'').replace(/\s/g,'');}
export function matchSourceAttachment(name,files,{scopePrefix}={}){
 if(!scopePrefix)throw new Error('附件匹配必须限定资料范围');
 const key=stem(name);if(!key||key.includes('原件待匹配'))return {status:'unresolved',candidates:[],reason:'没有可用于精确匹配的原始附件名称'};
 const matches=files.filter(f=>f.path.startsWith(scopePrefix)&&!/(?:复函|回复|反馈)/.test(f.path.split('/').at(-1))&&stem(f.path)===key);
 const hashes=new Set(matches.map(f=>f.sha256||f.path));
 return hashes.size===1?{status:'matched',file:matches[0],candidates:matches,reason:'限定资料范围内名称精确对应；同名重复件内容一致'}:matches.length?{status:'ambiguous',candidates:matches,reason:'同名文件内容不同，需核对版本'}:{status:'unresolved',candidates:[],reason:'本次资料包未定位到名称精确对应的原件；不能据此认定未提供'};
}
