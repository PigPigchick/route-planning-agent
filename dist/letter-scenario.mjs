// 单方案函件只披露本次征询路径。纯方案标签可以转换，比较事实交由经办人核对。
const directionLabel=/(?<![其当之文图档明表书函案施行作程])(?:东|西|南|北|中)(?:线|走廊)?(?:路径)?方案/g;
const recommendation=/推荐(?:的)?(?:(?:线路)?路径方案|线路方案|方案|(?:线路)?路径|线路)/g;
const decisionWording=[
 /(?:多种|多套|多条|多个|几种|两种|两套|两个|三种|三套|三个|若干|[二三四五\d]+个)(?:线路|路径)?方案|多方案/,
 /(?:备选|候选|可选|替代|比选|比较|优化(?:调整|设计|后)?|优选|最优|原|旧|调整前|调整后)(?:的)?(?:线路|路线|路径|线位)?方案/,
 /方案[一二三四五六七八九十甲乙丙丁A-Da-d\d]+(?=$|[、，,。；;：:（）()《》【】“”/\\_.-]|采用|选用|为|与|和|及|相较|优于|较|比|需要|需|拟|将|均|由|在|经|自|起|止|走向|长|路径|线路|线位|的)|[一二三四五六七八九十甲乙丙丁A-Da-d\d]+号方案/,
 /各(?:个|条|类)?(?:路径|线路)?方案|(?:两条|三条|多条|若干条)(?:备选|候选|可选|不同)(?:线路|路径)/,
 /(?:同时|分别|一并)(?:提供|报送|征询|提交).{0,18}方案|(?:方案|路径)(?:之间|比选|比较|优劣|择优)|先后采用.{0,25}方案/
];
const comparisonContext=/相比|对比|比较|比选|排序|优于|劣于|不及|优先于|更优|择优|优缺点|二选一|任选|候选|备选|替代|供选择|供选|另(?:一|有|拟|设|备)|其余|其他(?:线路|路径)?方案|方案(?:不同|差异)|(?:而|比).{0,16}(?:更长|更短|更低|更高)/;

const comparable=value=>String(value??'').normalize('NFKC').replace(/[\s\u200B-\u200D\uFEFF]/g,'');

export function findAlternativeWording(value){
 const text=comparable(value);
 return decisionWording.map(pattern=>text.match(pattern)?.[0]).find(Boolean)||text.match(directionLabel)?.[0]||text.match(recommendation)?.[0]||'';
}

export function allowsRouteAlternatives(item){
 return item.round==='revised'&&item.allowAlternatives===true&&Boolean(String(item.previousLetter??'').trim()&&String(item.changeSummary??'').trim());
}

export function conflictsWithSingleRoute(values){
 const labels=new Set(values.flatMap(value=>(comparable(value).match(directionLabel)||[]).map(label=>label[0])));
 return labels.size>1;
}

export function singleRouteWording(value){
 const text=String(value??'');
 const comparisonText=comparable(text);
 if(decisionWording.some(pattern=>pattern.test(comparisonText))||comparisonContext.test(comparisonText)||conflictsWithSingleRoute([text]))return text;
 return text
  .replace(/(?:本次采用|本工程采用|本工程选用|本次选用)\s*(?:东|西|南|北|中)(?:线|走廊)?(?:路径)?方案\s*[（(]\s*推荐(?:路径)?方案\s*[）)]\s*[，,]/g,'本次征询范围内，')
  .replace(/((?:东|西|南|北|中)(?:线|走廊)?(?:路径)?方案)\s*[（(]\s*推荐(?:路径)?方案\s*[）)]/g,'$1')
  .replace(/(?:推荐方案|推荐线路|推荐路径方案)\s*(?:线路)?路径长度/g,'本次征询路径长度')
  .replace(/(?:推荐方案|推荐线路|推荐路径方案)\s*(新建路径)/g,'本次征询$1')
  .replace(recommendation,'本次征询路径')
  .replace(directionLabel,'本次征询路径');
}

export function letterAlternativeWording(letter,body=letter.bodyBlocks){
 if(letter.round==='revised'&&letter.allowAlternatives===true)return '';
 const {issuer={},attachments=[],tables=[]}=letter;
 const fields=[letter.title,letter.unit,(body||[]).join('\n'),...attachments.map(a=>a.name),
  ...tables.flatMap(t=>[t.title,...t.headers,...t.rows.flat()]),
  issuer.issuer,issuer.documentNumber,issuer.contactName,issuer.replyAddress];
 return fields.map(findAlternativeWording).find(Boolean)||'';
}
