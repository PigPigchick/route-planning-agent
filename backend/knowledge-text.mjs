import {createHash} from 'node:crypto';
export const textHash=text=>createHash('sha256').update(text).digest('hex');
export function splitKnowledge(text,{size=1100,overlap=150}={}){
 const normalized=String(text||'').replace(/\u0000/g,'').replace(/\r\n?/g,'\n').replace(/[ \t]+/g,' ').trim();
 if(normalized.length<10)throw new Error('资料中没有足够的可读文字；扫描PDF请先完成OCR');
 if(normalized.length>80000)throw new Error('单份资料文字超过8万字，请按章节拆分后入库');
 const chunks=[];let start=0;
 while(start<normalized.length){let end=Math.min(start+size,normalized.length);if(end<normalized.length){const boundary=Math.max(normalized.lastIndexOf('\n',end),normalized.lastIndexOf('。',end));if(boundary>start+size/2)end=boundary+1;}
  chunks.push(normalized.slice(start,end));if(end===normalized.length)break;start=Math.max(start+1,end-overlap);
 }
 return chunks;
}
export function vectorLiteral(vector,dimensions){
 if(!Array.isArray(vector)||vector.length!==dimensions||vector.some(n=>typeof n!=='number'||!Number.isFinite(n))||!vector.some(n=>n!==0))throw new Error('向量模型返回的维度或数值无效');
 return '['+vector.join(',')+']';
}
export function knowledgeQuery(letter){return [letter.typeLabel,letter.templateRef?.name,letter.tokens?.requestItems].filter(Boolean).join('\n').slice(0,3000);}

// Keep these patterns portable between JavaScript and PostgreSQL ARE. Read the whole
// archived letter before retrieval: an innocuous fragment can belong to a comparison letter.
const planNumber='[一二三四五六七八九十甲乙丙丁0-9A-DＡ-Ｄ０-９]';
const labelStart=String.raw`(?:^|[\s、，,。；;：:（）()《》【】“”"/]|采用|选用|使用|选择|选定|推荐|确定|以|为|按|及|和|与|由)`;
const labelEnd=String.raw`(?=$|[\s、，,。；;：:（）()《》【】“”"/]|路径|线路|线位|走向|的|与|和|及|为|较|需|均|由|在|经|自|起|止|长)`;
export const comparisonReferencePattern=[
 '推荐(?:的)?(?:线路|路径|线位)?方案',
 '优化(?:设计|路径|线路|调整|后的?){0,2}方案',
 '(?:备选|候选|择优|优选|最优|不同|各个|各备选)(?:的)?(?:路径|线路|线位)?方案',
 '(?:若干|多个?|[两二三四五六七八九十2-9２-９][个套种]?)(?:可选|备选|候选|路径|线路|线位|走廊|的){0,4}方案',
 '(?:多(?:方案|路由|路径)|方案|路径|线位|线路)(?:比选|比较|对比|优选|择优)',
 '(?:比选|比较|对比)(?:各|若干|多个)?(?:路径|线路|线位)?方案',
 '方案\\s*'+planNumber+'+'+labelEnd,
 '第[一二三四五六七八九十0-9０-９]+(?:个|套|号)?\\s*方案',
 labelStart+'(?:[中东西南北](?:线|侧)?|'+planNumber+'+号?)\\s*方案'+labelEnd,
 '(?:再次|重新|二次|第二次)(?:征询|征求|征求意见)',
 '优化调整',
 '(?:线路|线位|路径|走廊)(?:方案)?调整(?:前|后)',
 '调整(?:前|后)(?:的)?(?:线路|线位|路径|走廊|方案)',
].join('|');
// Some older samples only identify the revised stage in their parent directory.
export const comparisonSourcePattern=String.raw`调整[前后](?:[/\\／"\s]|$)`;
