import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {execFile, spawn} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import pg from 'pg';
import {openRepository} from './backend/database.mjs';
import {knowledgeStore} from './backend/knowledge.mjs';
import {historicalIndexText} from './backend/letter-library.mjs';
import {loadLocalEnv} from './backend/model.mjs';
import {resolveExportPython} from './backend/python-runtime.mjs';
import {SAMPLE} from './dist/engine.mjs';
import {createLettersInput} from './dist/letters-core.mjs';
import {letterContext, workbookProjects, workbookToLetters} from './dist/letter-table.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const reports = process.argv.slice(2);
if (reports.length > 1) throw new Error('用法：node letters-holdout-integration.mjs [报告路径.json]');
const corpusDir = path.resolve(process.env.TX_HOLDOUT_CORPUS_DIR || path.join(root, '.local-data', 'letter-library-2026-10-31'));
const targets = JSON.parse(await fs.readFile(path.join(corpusDir, 'holdout-targets.json'), 'utf8'));
assert.ok(Array.isArray(targets) && targets.length === 2 &&
  targets.every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) &&
  new Set(targets).size === 2, 'holdout-targets.json 须列出两份不同历史原函的完整 SHA-256，第一份用于 P04 正文对照');
const all = JSON.parse(await fs.readFile(path.join(corpusDir, 'extracted.json'), 'utf8'));
const corpus = all.filter(row => row.direction === 'outgoing' && !row.error);
assert.ok(corpus.length >= 3, '缺少可用的本机历史发函样本');
await loadLocalEnv(root);
const dbUrl = new URL(process.env.TX_DATABASE_URL || '');
assert.ok(['localhost','127.0.0.1','[::1]'].includes(dbUrl.hostname), '盲测只使用本机 PostgreSQL');
const dbName = 'tx_holdout_' + randomUUID().replaceAll('-', '');
const adminUrl = new URL(dbUrl);
adminUrl.pathname = '/postgres';
dbUrl.pathname = '/' + dbName;
const admin = new pg.Client({connectionString: adminUrl.href});
let dbCreated = false, dir, repository, app;

function grams(text, n) {
  const chars = [...text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')];
  return Array.from({length: Math.max(0, chars.length - n + 1)}, (_, i) => chars.slice(i, i + n).join(''));
}

// A deterministic local lexical baseline. The same function embeds every title
// and every indexed chunk without case-specific lookup or pretrained weights.
function lexicalVector(text) {
  const vector = Array(1024).fill(0);
  for (const gram of new Set([...grams(text, 2), ...grams(text, 3)])) {
    const hash = createHash('sha256').update(gram).digest();
    vector[hash.readUInt16LE(0) % 1024] += (hash[2] % 2 ? 1 : -1);
  }
  if (!vector.some(Boolean)) vector[0] = 1;
  return vector;
}

function jaccard(a, b) {
  const left = new Set(grams(a, 3));
  const right = new Set(grams(b, 3));
  const common = [...left].filter(g => right.has(g)).length;
  const union = left.size + right.size - common;
  return union ? Number((common / union).toFixed(4)) : 0;
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function close(server) {
  if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

const modelRequests = [];
let injectRisk = false;
const models = http.createServer(async (request, response) => {
  try {
    let raw = '';
    for await (const part of request) raw += part;
    const body = JSON.parse(raw);
    let output;
    if (request.url === '/embedding/v1/embeddings') {
      assert.equal(body.model, 'local-lexical-baseline');
      assert.ok(!request.headers.authorization);
      const input = Array.isArray(body.input) ? body.input : [body.input];
      output = {object:'list', model:body.model, data:input.map((text,index)=>({object:'embedding',index,embedding:lexicalVector(text)}))};
    } else if (request.url === '/chat/v1/chat/completions') {
      assert.equal(body.model, 'local-draft-stub');
      assert.equal(request.headers.authorization, 'Bearer holdout-mock-only');
      const prompt = JSON.parse(body.messages[1].content);
      const addRisk = injectRisk;
      injectRisk = false;
      modelRequests.push({addRisk, prompt});
      output = {model:body.model, choices:[{finish_reason:'stop',message:{content:JSON.stringify({
        bodyBlocks:[...prompt.paragraphOrder.map(key=>'{{'+key+'}}'),addRisk?'建议优先采用中方案。':'以上事项请研究并书面函复。'],
        factsUsed:prompt.paragraphOrder
      })}}]};
    } else throw new Error('模拟服务路径不符');
    response.writeHead(200, {'Content-Type':'application/json'});
    response.end(JSON.stringify(output));
  } catch {
    response.writeHead(400, {'Content-Type':'application/json'});
    response.end(JSON.stringify({error:{message:'本机模拟模型请求不符合协议'}}));
  }
});

let origin;
async function api(endpoint, body, expected=200) {
  const response = await fetch(origin+endpoint, {
    method: body ? 'POST' : 'GET',
    headers: body ? {'Content-Type':'application/json'} : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json();
  assert.equal(response.status, expected, `${endpoint}: ${data.error?.message || response.status}`);
  return data;
}

const search = query => api('/api/v1/knowledge',{action:'search',query,type:'all',forDraft:true});
const queryTitle = name => name.replace(/\.[^.]+$/u, '');
const targetRecords = new Map();

async function evaluateHoldout(knowledge, prefix) {
  const target = corpus.find(row => row.sha256.startsWith(prefix));
  assert.ok(target, '历史盲测样本缺失：'+prefix);
  const originalText = historicalIndexText(target.text);
  const title = queryTitle(target.name);
  const duplicate = await knowledge.ingest({title:title+'（同文副本）',kind:'history',type:target.type,text:originalText,metadata:{direction:'outgoing'}});
  const group = corpus.filter(row => row.sha256 === target.sha256 || jaccard(historicalIndexText(row.text),originalText) >= 0.90);
  const excluded = [...group.map(row=>targetRecords.get(row.sha256)), duplicate.id];
  const ids = new Set(excluded);
  const types = new Map([...corpus.map(row=>[targetRecords.get(row.sha256),row.type]), [duplicate.id,target.type]]);
  const before = await search(title);
  const connection = await repository.pool.connect();
  try {
    await connection.query('BEGIN');
    for (const table of ['tx_document_files','tx_document_text','tx_chunks']) {
      await connection.query(`DELETE FROM ${table} WHERE document_id=ANY($1::text[])`,[excluded]);
    }
    const removed=await connection.query('DELETE FROM tx_documents WHERE id=ANY($1::text[])',[excluded]);
    assert.equal(removed.rowCount, excluded.length);
    await connection.query('COMMIT');
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
  }
  const after = await search(title);
  assert.ok(after.sources.every(source => !ids.has(source.document_id)), '目标文件或重复文件出现在反查结果');
  const scores = result => result.sources.map(source=>({
    title:source.title, vectorCosine:source.score,
    targetBodyTrigramJaccard:jaccard(originalText,source.content),
    sameConsultationType:types.get(source.document_id)===target.type,
    heldOut:ids.has(source.document_id)
  }));
  return {queryTitle:title, removedOriginals:group.length, removedExactTestCopies:1, removedIds:excluded,
    baselineTargetRecovered:before.sources.some(source=>ids.has(source.document_id)), beforeStatus:before.status, afterStatus:after.status,
    before:scores(before), after:scores(after), targetBody:originalText};
}

async function draftFromExcel(parsed) {
  for (const item of parsed.pendingAssets) {
    const asset = await api('/api/v1/assets',{name:item.name,base64:Buffer.from(item.content).toString('base64')},201);
    parsed.input.agreements.find(a=>a.id===item.agreementId).attachments[item.attachmentIndex].assetId=asset.id;
  }
  parsed.input.templateConfirmed = true;
  const context = await api('/api/v1/context',letterContext(parsed.input),201);
  const routeId = parsed.input.route.id;
  let task = await api('/api/v1/tasks',{
    contextId:context.contextId,agentType:'letters',routeIds:[routeId],
    options:{mode:'llm',lettersInput:parsed.input,agreementIds:parsed.selectedIds}
  },201);
  for (let i=0; task.status==='running' && i<100; i++) {
    await new Promise(resolve=>setTimeout(resolve,50));
    task=await api('/api/v1/tasks/'+task.id,{action:'status'});
  }
  assert.equal(task.status,'awaiting_confirmation');
  const [letter]=task.result.letters;
  assert.equal(letter?.status,'draft',letter?.error||JSON.stringify(letter?.missingFields));
  return {task, letter};
}

async function verifyWordExport(task, letter) {
  const exported = await api('/api/v1/tasks/'+task.id,{action:'export',format:'docx',letterId:letter.id});
  assert.match(exported.name,/^草稿_.*\.docx$/);
  const response = await fetch(origin+exported.url,{signal:AbortSignal.timeout(15000)});
  assert.ok(response.ok);
  assert.match(response.headers.get('content-type'),/wordprocessingml/);
  const file = path.join(dir,'holdout-draft.docx');
  await fs.writeFile(file,Buffer.from(await response.arrayBuffer()));
  const python = await resolveExportPython(root);
  const {stdout} = await promisify(execFile)(python,['-c',[
    'import sys, zipfile, xml.etree.ElementTree as xml',
    'root = xml.fromstring(zipfile.ZipFile(sys.argv[1]).read("word/document.xml"))',
    'for node in root.iter():',
    '    if node.tag.endswith("}p"):',
    '        print("".join(text.text or "" for text in node.iter() if text.tag.endswith("}t")))'
  ].join('\n'),file]);
  assert.ok(letter.bodyBlocks.every(block=>stdout.includes(block)));
  assert.doesNotMatch(stdout,/中方案|推荐方案|优化方案|备选方案/);
  return stdout;
}

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}"`);
  dbCreated = true;
  dir = await fs.mkdtemp(path.join(tmpdir(),'letters-holdout-'));
  const port = await listen(models), reservation = http.createServer();
  const appPort = await listen(reservation);
  await close(reservation);
  origin = 'http://127.0.0.1:'+appPort;
  const env={
    EMBEDDING_BASE_URL:`http://127.0.0.1:${port}/embedding/v1`,
    EMBEDDING_MODEL:'local-lexical-baseline', EMBEDDING_API_KEY:'',
    LLM_BASE_URL:`http://127.0.0.1:${port}/chat/v1`, LLM_MODEL:'local-draft-stub',
    LLM_API_KEY:'holdout-mock-only', LLM_STREAM:'false', LLM_THINKING_MODE:'off'
  };
  Object.assign(process.env,env);
  repository=await openRepository(dir,dbUrl.href);
  const knowledge=await knowledgeStore(repository,{get:()=>({baseUrl:env.LLM_BASE_URL,model:env.LLM_MODEL,apiKey:env.LLM_API_KEY})});
  await knowledge.configure({enabled:true,topK:4});

  for (const row of corpus) {
    const bytes = await fs.readFile(path.join(corpusDir,'originals',path.basename(row.path)));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256);
    const document = await knowledge.archive({
      title:queryTitle(row.name),type:row.type,direction:row.direction,
      text:row.text,indexText:historicalIndexText(row.text),original:{name:row.name,content:bytes}
    });
    targetRecords.set(row.sha256,document.id);
    await knowledge.indexDocument(document.id);
  }
  app=spawn(process.execPath,[path.join(root,'server.mjs')],{
    cwd:root,env:{...process.env,...env,PORT:String(appPort),TX_DATA_DIR:dir,TX_DATABASE_URL:dbUrl.href,TX_USE_DATABASE:'true'},
    stdio:['ignore','pipe','pipe']
  });
  app.stderr.resume();
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('隔离测试应用启动超时')),10000);
    const ready=()=>{clearTimeout(timeout);resolve();};
    const fail=()=>{clearTimeout(timeout);reject(new Error('隔离测试应用启动失败'));};
    app.stdout.once('data',ready);app.once('error',fail);app.once('exit',fail);
  });
  assert.equal((await api('/api/v1/knowledge')).settings.baseUrl,env.EMBEDDING_BASE_URL);
  const workbookName='征询函输入测试样例_四工程.xlsx';
  const workbook=await api('/api/v1/letter-input/parse',{
    name:workbookName,base64:(await fs.readFile(path.join(root,'dist','assets',workbookName))).toString('base64')
  });
  const parsed=Object.fromEntries(workbookProjects(workbook).map(project=>[project.code,workbookToLetters(workbook,createLettersInput(SAMPLE,SAMPLE.routes[0]),project.code)]));
  assert.deepEqual(Object.values(parsed).map(p=>p.input.agreements.length),[67,35,19,42]);

  const results=[];
  for(const hash of targets) results.push(await evaluateHoldout(knowledge,hash));
  assert.ok(results.some(result=>result.baselineTargetRecovered),'两个历史对照组均未召回目标或同文副本，当前基线不足以做剔除对照');
  const heldOutIds=new Set(results.flatMap(result=>result.removedIds));
  const available=await api('/api/v1/knowledge');
  assert.ok(available.documents.every(d=>!heldOutIds.has(d.id)));

  // Both references are synthetic so they can be used with any local corpus.
  const topic='关于征询测试设施配套线路接入事项的函';
  const multi=await knowledge.ingest({title:topic+'（合规反例）',kind:'history',type:'general',text:topic+'。此次为再次调整，共有三个路径方案，现比较方案一和方案二并请在备选方案中选择。',metadata:{direction:'outgoing'}});
  const single=await knowledge.ingest({title:topic+'（单路径对照）',kind:'history',type:'general',text:topic+'。现就本次拟建线路接入方案征询意见，请书面函复。',metadata:{direction:'outgoing'}});
  const first=await search(topic);
  assert.ok(first.sources.some(source=>source.document_id===single.id));
  assert.ok(first.sources.every(source=>source.document_id!==multi.id), '首次场景召回了多方案反例');
  const adjusted=await api('/api/v1/knowledge',{action:'search',query:topic,type:'all',forDraft:true,allowAlternatives:true,round:'revised'});
  assert.ok(adjusted.sources.some(source=>source.document_id===multi.id), '明确许可的路径调整场景未召回多方案反例');
  const again=await api('/api/v1/knowledge',{action:'search',query:topic,type:'all',forDraft:true,allowAlternatives:true,round:'repeat'});
  assert.ok(again.sources.every(source=>source.document_id!==multi.id), '普通再次征询不得以许可标志绕过情景校验');

  const previous=parsed.P01.input.route.summary;
  assert.match(previous,/中方案|推荐方案/);
  injectRisk=true;
  const {task:p01Task,letter:p01}=await draftFromExcel(parsed.P01);
  assert.doesNotMatch(p01.text,/中方案|推荐方案|优化方案|备选方案/);
  assert.match(p01.text,/94\.5\s*km/);
  assert.ok(p01.generation.attempts.some(attempt=>attempt.passed===false),'第一次模拟违规输出未被程序拒绝');
  assert.equal(modelRequests.filter(r=>r.addRisk).length,1);
  assert.ok(p01.retrieval.sources.every(source=>!heldOutIds.has(source.document_id)&&source.document_id!==multi.id));
  const edit=await api('/api/v1/tasks/'+p01Task.id,{
    action:'edit',letterId:p01.id,expectedRevision:p01.revision,
    bodyBlocks:[...p01.bodyBlocks,'优先采用中方案。']
  },400);
  assert.match(edit.error.message,/方案标识/);
  assert.equal((await api('/api/v1/tasks/'+p01Task.id,{action:'status'})).result.letters[0].revision,p01.revision);
  const {task:p04Task,letter:p04}=await draftFromExcel(parsed.P04);
  assert.doesNotMatch(p04.text,/中方案|推荐方案|优化方案|备选方案/);
  assert.ok(p04.retrieval.sources.every(source=>!heldOutIds.has(source.document_id)&&source.document_id!==multi.id));
  await verifyWordExport(p04Task,p04);
  const p04Body=p04.bodyBlocks.join('\n');
  const report={
    at:new Date().toISOString(),database:'独立临时 PostgreSQL＋pgvector',
    inputWorkbook:workbookName, historicalOutgoingArchives:corpus.length,
    embedding:'本机字符二元/三元组哈希模拟向量', draft:'本机固定占位符响应桩',
    method:'仅以历史文件题名（不含扩展名）检索，剔除原函、合成同文副本和正文三元组 Jaccard 不低于 0.90 的近重复；各取最多四段且沿用检索最低分。',
    limits:'余弦分数来自本机词面基线；正文相似度为字符三元组 Jaccard。没有真实语义模型评分、业务标注的相关样本及阈值，分数不能作为生产检索精度或函件质量依据。',
    excel:Object.fromEntries(Object.entries(parsed).map(([key,value])=>[key,{agreements:value.input.agreements.length,selected:value.selectedIds}])),
    historicalHoldout:results.map(({targetBody,removedIds,...result})=>result),
    scenario:{syntheticObjects:true,firstExcludedMulti:true,ordinaryRepeatExcludedMulti:true,authorizedRevisedCanRecallMulti:true},
    drafting:{p01InputContainedRiskWords:true,p01FirstModelAttemptRejected:true,p01FinalDraftClean:true,
      p01UnsafeManualEditRejected:true,p04FinalDraftClean:true,p04WordExportVerified:true,
      p04HeldOutBodyTrigramJaccard:jaccard(p04Body,results[0].targetBody),modelRequestCount:modelRequests.length}
  };
  if (reports[0]) {
    const output = path.resolve(reports[0]);
    await fs.mkdir(path.dirname(output),{recursive:true});
    await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
  }
  console.log(JSON.stringify(report,null,2));
} finally {
  if(app?.pid && app.exitCode===null && app.signalCode===null){const stopped=once(app,'exit');app.kill();await stopped;}
  await close(models);
  if(repository)await repository.close();
  if(dbCreated)await admin.query(`DROP DATABASE "${dbName}" WITH (FORCE)`);
  await admin.end();
  if(dir)await fs.rm(dir,{recursive:true,force:true});
}
