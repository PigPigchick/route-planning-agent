import {embedMany} from 'ai';
import {createOpenAICompatible} from '@ai-sdk/openai-compatible';
import {splitKnowledge,textHash,vectorLiteral,knowledgeQuery} from './knowledge-text.mjs';
import {LETTER_TEMPLATES} from '../dist/letters-core.mjs';

const defaults={enabled:false,model:'text-embedding-v4',dimensions:1024,topK:4,minScore:0.3};
export async function knowledgeStore(repository,modelStore){
 const pool=repository.pool;
 let config=pool?(await pool.query("SELECT payload FROM tx_resources WHERE id='rag-settings'")).rows[0]?.payload||defaults:defaults;
 const ready=()=>{if(!pool)throw new Error('知识检索需要连接 PostgreSQL＋pgvector，请先配置数据库');};
 const settings=()=>({...defaults,...config,baseUrl:modelStore.get().baseUrl,keyConfigured:!!modelStore.get().apiKey,database:!!pool});
 const signature=(modelConfig=modelStore.get(),ragConfig=config)=>modelConfig.baseUrl+'|'+ragConfig.model;
 async function embeddings(texts,{modelConfig=modelStore.get(),ragConfig=config}={}){
  const c=modelConfig;if(!c.apiKey)throw new Error('请先在大模型配置中填写 API Key');
  const provider=createOpenAICompatible({name:'studio-embedding',baseURL:c.baseUrl,apiKey:c.apiKey});
  const result=[];
  for(let i=0;i<texts.length;i+=10){
   try{const r=await embedMany({model:provider.embeddingModel(ragConfig.model),values:texts.slice(i,i+10),dimensions:ragConfig.dimensions,maxRetries:1,maxParallelCalls:1,abortSignal:AbortSignal.timeout(90000)});for(const v of r.embeddings)vectorLiteral(v,ragConfig.dimensions);result.push(...r.embeddings);}
   catch{throw new Error('向量化调用失败，请检查大模型服务是否支持 '+ragConfig.model+' 及所选维度；本次操作未完成');}
  }
  if(result.length!==texts.length)throw new Error('向量返回数量与资料片段不一致');return result;
 }
 const publicDocument=row=>({...row,metadata:{...row.metadata,path:undefined},created_at:row.created_at instanceof Date?row.created_at.toISOString():row.created_at});
 return {
  settings,
  snapshot(modelConfig=modelStore.get()){return {modelConfig:{...modelConfig},ragConfig:{...defaults,...config}};},
  async configure(body){
   ready();const next={...defaults,...config};
   if(body.enabled!==undefined){if(typeof body.enabled!=='boolean')throw new Error('启用状态无效');next.enabled=body.enabled;}
   if(body.model!==undefined){if(typeof body.model!=='string'||!body.model.trim()||body.model.length>160)throw new Error('向量模型名称无效');next.model=body.model.trim();}
   if(body.dimensions!==undefined){if(![64,128,256,512,768,1024,1536,2048].includes(body.dimensions))throw new Error('向量维度无效');next.dimensions=body.dimensions;}
   if(body.topK!==undefined){if(!Number.isInteger(body.topK)||body.topK<1||body.topK>8)throw new Error('检索数量须为1至8');next.topK=body.topK;}
   await pool.query("INSERT INTO tx_resources(id,payload) VALUES('rag-settings',$1) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload",[JSON.stringify(next)]);config=next;return settings();
  },
  async test(){ready();const v=(await embeddings(['输电工程协议征询函资料检索连通性测试']))[0];return {ok:true,model:config.model,dimensions:v.length};},
  async list(){ready();const rows=(await pool.query('SELECT d.*,count(c.id)::int AS chunks FROM tx_documents d LEFT JOIN tx_chunks c ON c.document_id=d.id GROUP BY d.id ORDER BY d.created_at DESC')).rows;return rows.map(publicDocument);},
  async detail(id){ready();const row=(await pool.query('SELECT d.*,t.content,t.index_text FROM tx_documents d LEFT JOIN tx_document_text t ON t.document_id=d.id WHERE d.id=$1',[id])).rows[0];if(!row)throw new Error('资料不存在');return publicDocument(row);},
  async original(id){ready();const row=(await pool.query('SELECT name,content FROM tx_document_files WHERE document_id=$1',[id])).rows[0];if(!row)throw new Error('该资料未保存原文件');return row;},
  // Local archival is deliberately independent from external embedding calls.
  async archive({title,type='general',direction,text='',indexText='',original,metadata={}}){
   ready();if(!['outgoing','incoming','support'].includes(direction)||!LETTER_TEMPLATES.some(t=>t.id===type))throw new Error('函件类别无效');
   if(typeof title!=='string'||!title.trim()||title.length>200||typeof text!=='string'||text.length>80000||typeof indexText!=='string'||indexText.length>80000)throw new Error('函件名称或正文超出限制');
   if(!original||typeof original.name!=='string'||!Buffer.isBuffer(original.content)||!original.content.length||original.content.length>20*1024*1024)throw new Error('函件原文件无效');
   const hash=textHash(original.content),contentHash=textHash(JSON.stringify({archive:1,hash,type,direction}));
   const old=(await pool.query("SELECT d.id,t.index_text FROM tx_documents d LEFT JOIN tx_document_text t ON t.document_id=d.id WHERE d.content_hash=$1 OR (d.metadata->>'fileHash'=$2 AND d.metadata->>'archived'='true')",[contentHash,hash])).rows[0];
   if(old){const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT id FROM tx_documents WHERE id=$1 FOR UPDATE',[old.id]);
    if(old.index_text!==indexText){await c.query('DELETE FROM tx_chunks WHERE document_id=$1',[old.id]);await c.query("UPDATE tx_documents SET enabled=false,metadata=metadata-'indexFingerprint' WHERE id=$1",[old.id]);}
    await c.query('UPDATE tx_documents SET title=$2,consultation_type=$3,content_hash=$4,metadata=metadata||$5::jsonb,kind=$6 WHERE id=$1',[old.id,title.trim(),type,contentHash,JSON.stringify({...metadata,direction,archived:true,originalName:original.name,fileHash:hash}),direction==='outgoing'?'history':'reference']);
    await c.query('INSERT INTO tx_document_text(document_id,content,index_text) VALUES($1,$2,$3) ON CONFLICT(document_id) DO UPDATE SET content=EXCLUDED.content,index_text=EXCLUDED.index_text',[old.id,text,indexText]);await c.query('COMMIT');
   }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}return {id:old.id,reused:true};}
   const id='DOC-'+crypto.randomUUID(),c=await pool.connect();
   try{await c.query('BEGIN');await c.query('INSERT INTO tx_documents(id,title,kind,consultation_type,enabled,content_hash,metadata) VALUES($1,$2,$3,$4,false,$5,$6)',[id,title.trim(),direction==='outgoing'?'history':'reference',type,contentHash,JSON.stringify({...metadata,direction,archived:true,originalName:original.name,fileHash:hash})]);
    await c.query('INSERT INTO tx_document_text(document_id,content,index_text) VALUES($1,$2,$3)',[id,text,indexText]);
    await c.query('INSERT INTO tx_document_files(document_id,name,content) VALUES($1,$2,$3)',[id,original.name,original.content]);await c.query('COMMIT');
   }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}return {id,reused:false};
  },
  async indexDocument(id){
   ready();const row=await this.detail(id);
   if(!row.metadata.archived||row.metadata.direction!=='outgoing')throw new Error('仅发函模板参考可建立起草索引；复函与支撑材料仅归档');
   if(row.metadata.extractionError)throw new Error('正文识别未完成，请先核对原件：'+row.metadata.extractionError);
   const snapshot=this.snapshot(),chunks=splitKnowledge(row.index_text||''),fingerprint=textHash(JSON.stringify({text:row.index_text,model:signature(snapshot.modelConfig,snapshot.ragConfig),dimensions:snapshot.ragConfig.dimensions}));
   if(row.metadata.indexFingerprint===fingerprint&&row.enabled)return {id,chunks:(await pool.query('SELECT count(*)::int AS n FROM tx_chunks WHERE document_id=$1',[id])).rows[0].n,reused:true};
   const vectors=await embeddings(chunks,snapshot),c=await pool.connect();
   try{await c.query('BEGIN');await c.query('SELECT id FROM tx_documents WHERE id=$1 FOR UPDATE',[id]);await c.query('DELETE FROM tx_chunks WHERE document_id=$1',[id]);
    for(let i=0;i<chunks.length;i++)await c.query('INSERT INTO tx_chunks(id,document_id,ordinal,content,embedding,embedding_model,dimensions) VALUES($1,$2,$3,$4,$5::vector,$6,$7)',[id+'-'+i,id,i,chunks[i],vectorLiteral(vectors[i],snapshot.ragConfig.dimensions),signature(snapshot.modelConfig,snapshot.ragConfig),snapshot.ragConfig.dimensions]);
    await c.query("UPDATE tx_documents SET enabled=true,metadata=metadata||$2::jsonb WHERE id=$1",[id,JSON.stringify({indexFingerprint:fingerprint,indexedAt:new Date().toISOString(),indexModel:snapshot.ragConfig.model})]);await c.query('COMMIT');
   }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}return {id,chunks:chunks.length,reused:false};
  },
  async ingest({title,kind='reference',type='all',projectId='',projectVersion='',text,metadata={}}){
   ready();if(typeof title!=='string'||!title.trim()||title.length>200)throw new Error('请填写资料名称');
   if(!['template','history','rule','reference'].includes(kind)||!['all',...LETTER_TEMPLATES.map(t=>t.id)].includes(type))throw new Error('资料类别或协议类型无效');
   if(typeof projectId!=='string'||typeof projectVersion!=='string'||projectId.length>200||projectVersion.length>200||projectId&&!projectVersion)throw new Error('工程专用资料须指定工程编号和版本');
   const snapshot=this.snapshot(),chunks=splitKnowledge(text),hash=textHash(JSON.stringify({text,title,kind,type,projectId,projectVersion,model:signature(snapshot.modelConfig,snapshot.ragConfig),dimensions:snapshot.ragConfig.dimensions}));
   const old=(await pool.query('SELECT id FROM tx_documents WHERE content_hash=$1',[hash])).rows[0];if(old){await pool.query('UPDATE tx_documents SET enabled=true WHERE id=$1',[old.id]);return {id:old.id,chunks:chunks.length,reused:true};}
   const vectors=await embeddings(chunks,snapshot),id='DOC-'+crypto.randomUUID(),c=await pool.connect();
   try{await c.query('BEGIN');await c.query('INSERT INTO tx_documents(id,title,kind,consultation_type,project_id,project_version,content_hash,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,title.trim(),kind,type,projectId,projectVersion,hash,JSON.stringify(metadata)]);
    await c.query('INSERT INTO tx_document_text(document_id,content,index_text) VALUES($1,$2,$2)',[id,text]);
    for(let i=0;i<chunks.length;i++)await c.query('INSERT INTO tx_chunks(id,document_id,ordinal,content,embedding,embedding_model,dimensions) VALUES($1,$2,$3,$4,$5::vector,$6,$7)',[id+'-'+i,id,i,chunks[i],vectorLiteral(vectors[i],snapshot.ragConfig.dimensions),signature(snapshot.modelConfig,snapshot.ragConfig),snapshot.ragConfig.dimensions]);await c.query('COMMIT');
   }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
   return {id,chunks:chunks.length,reused:false};
  },
  async setEnabled(id,enabled){ready();if(typeof id!=='string'||typeof enabled!=='boolean')throw new Error('资料状态无效');if(enabled){const d=await this.detail(id);if(d.metadata.archived&&!(await pool.query('SELECT 1 FROM tx_chunks WHERE document_id=$1 LIMIT 1',[id])).rowCount)throw new Error('该资料仅归档，尚未建立向量索引');}const r=await pool.query('UPDATE tx_documents SET enabled=$2 WHERE id=$1 RETURNING id',[id,enabled]);if(!r.rowCount)throw new Error('资料不存在');return {ok:true};},
  async invalidateTemplates(templates){
   if(!pool)return;
   const valid=new Set(templates.filter(t=>t.enabled).map(t=>t.id+'|'+t.version));
   const invalid=(await pool.query("SELECT id,metadata FROM tx_documents WHERE kind='template' AND metadata ? 'templateId'")).rows.filter(d=>!valid.has(d.metadata.templateId+'|'+d.metadata.templateVersion)).map(d=>d.id);
   if(invalid.length)await pool.query('UPDATE tx_documents SET enabled=false WHERE id=ANY($1::text[])',[invalid]);
  },
  async syncTemplates(templates){
   ready();const ids=[];let chunks=0;
   for(const t of templates.filter(t=>t.enabled)){
    const result=await this.ingest({title:t.name+' v'+t.version,kind:'template',type:t.type,text:[t.name,t.purpose,'正文段落结构：',...(t.bodyBlocks||[]),'必填要点：',...t.required.map(x=>x[1]),'附件要求：',...t.attachments].join('\n'),metadata:{templateId:t.id,templateVersion:t.version,source:t.source}});ids.push(result.id);chunks+=result.chunks;
   }
   await pool.query("UPDATE tx_documents SET enabled=false WHERE kind='template' AND metadata ? 'templateId' AND NOT(id=ANY($1::text[]))",[ids]);return {documents:ids.length,chunks};
  },
  async search({query,type='all',projectId='',projectVersion='',templateId='',templateVersion='',forDraft=false},snapshot=this.snapshot()){
   ready();if(typeof query!=='string'||!query.trim()||query.length>4000)throw new Error('请输入4000字以内的检索内容');
   const {ragConfig}=snapshot,params=[signature(snapshot.modelConfig,ragConfig),ragConfig.dimensions,type,projectId,projectVersion,templateId,templateVersion];
   const filter="d.enabled AND c.embedding_model=$1 AND c.dimensions=$2 AND (d.consultation_type='all' OR $3='all' OR d.consultation_type=$3) AND (d.project_id='' OR (d.project_id=$4 AND d.project_version=$5)) AND (d.kind<>'template' OR $6='' OR (d.metadata->>'templateId'=$6 AND d.metadata->>'templateVersion'=$7))"+(forDraft?" AND COALESCE(d.metadata->>'direction','outgoing')='outgoing'":"");
   if(!(await pool.query('SELECT 1 FROM tx_chunks c JOIN tx_documents d ON d.id=c.document_id WHERE '+filter+' LIMIT 1',params)).rowCount)return {status:'empty',sources:[]};
   const vector=vectorLiteral((await embeddings([query],snapshot))[0],ragConfig.dimensions);
   const rows=(await pool.query('SELECT c.id,c.content,d.id AS document_id,d.title,d.kind,d.metadata,1-(c.embedding <=> $8::vector) AS score FROM tx_chunks c JOIN tx_documents d ON d.id=c.document_id WHERE '+filter+' ORDER BY c.embedding <=> $8::vector LIMIT $9',[...params,vector,ragConfig.topK])).rows;
   const sources=rows.filter(row=>row.score>=ragConfig.minScore).map(row=>({...row,metadata:{...row.metadata,path:undefined},score:Number(row.score.toFixed(4))}));
   return {status:sources.length?'used':'no_match',model:ragConfig.model,dimensions:ragConfig.dimensions,sources};
  },
  async forLetter(letter,input,snapshot=this.snapshot()){if(!snapshot.ragConfig.enabled)return {status:'disabled',sources:[]};return this.search({query:knowledgeQuery(letter),type:letter.type,projectId:input.project.id,projectVersion:input.project.version,templateId:letter.templateRef.id,templateVersion:letter.templateRef.version,forDraft:true},snapshot);}
 };
}
