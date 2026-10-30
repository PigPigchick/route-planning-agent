"""Render reviewed letter objects. Receives trusted backend file paths on stdin."""
import sys,json,pathlib,zipfile,csv,io,re
from xlsx_ledger import workbook_bytes
from word_layout import make_doc
from materials_word import make_materials_doc

data=json.load(sys.stdin)
out=pathlib.Path(data['output']);out.parent.mkdir(parents=True,exist_ok=True)
def safe(s):return re.sub(r'[\\/:*?"<>|\x00-\x1f]','_',str(s))[:90]

letters=data['letters']
if data['format']=='materials-docx':make_materials_doc(data['checklist'],out)
elif data['format']=='xlsx':out.write_bytes(workbook_bytes(letters))
elif data['format']=='docx':make_doc(letters[0],out)
else:
 manifest=[];buf=io.StringIO(newline='');writer=csv.writer(buf);writer.writerow(['序号','协议单位','行政区/区段','类型','原协议完成情况','回函关键内容','函件状态','待补资料','发出与反馈状态','发出日期','回复日期','闭环处理','登记人员'])
 def cell(s):
  s=str(s);return "'"+s if s[:1] in '=+@-\t\r' else s
 with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
  for i,l in enumerate(letters,1):
   folder=f"{i:02d}_{safe(l['unit'])}";tmp=out.parent/(out.stem+'_'+folder+'.docx');make_doc(l,tmp);z.write(tmp,folder+'/'+('模拟测试_' if l.get('simulation') else '已复核_' if l['status']=='confirmed' else '草稿_')+safe(l['unit'])+'.docx');tmp.unlink()
   writer.writerow(list(map(cell,[i,l['unit'],l['scope'],l['typeLabel'],l.get('sourceStatus',''),(l.get('correspondence') or {}).get('replySummary',l.get('replySummary','')),l['status'],'；'.join(x['label'] for x in l['missingFields']),(l.get('correspondence') or {}).get('state','未发出'),(l.get('correspondence') or {}).get('sentAt',''),(l.get('correspondence') or {}).get('replyAt',''),(l.get('correspondence') or {}).get('closureNote',''),(l.get('correspondence') or {}).get('updatedBy','')])))
   for j,a in enumerate(l['attachments'],1):
    asset=data['assets'].get(a.get('assetId'))
    if a['available'] and asset and pathlib.Path(asset['path']).is_file():z.write(asset['path'],folder+'/附件/'+str(j)+'_'+safe(asset['name']))
    else:manifest.append(folder+'：'+a['name']+'（未找到已关联原件，请核对文件与关联关系）')
  z.writestr('协议征询台账.xlsx',workbook_bytes(letters))
  z.writestr('检索参考记录.json',json.dumps([{'letterId':l['id'],'unit':l['unit'],'retrieval':l.get('retrieval')} for l in letters if l.get('retrieval')],ensure_ascii=False,indent=2))
  z.writestr('发出与反馈变更记录.json',json.dumps([{'letterId':l['id'],'unit':l['unit'],'record':l.get('correspondence'),'history':l.get('correspondenceHistory',[])} for l in letters],ensure_ascii=False,indent=2))
  if data.get('simulation'):z.writestr('模拟流程记录.json',json.dumps(data['simulation'],ensure_ascii=False,indent=2))
  z.writestr('人工复核记录.json',json.dumps([{"id":l['id'],"unit":l['unit'],"revision":l['revision'],"confirmations":l['confirmations']} for l in letters],ensure_ascii=False,indent=2));z.writestr('协议征询台账.csv','\ufeff'+buf.getvalue());z.writestr('附件核对清单.txt','\n'.join(manifest) or '所有所列附件均已打包。')
  z.writestr('使用说明.txt',('模拟测试成果：资料由模型补齐，附件均为文字占位文件，未进行人工复核，不是真实工程资料，不可正式发文。\n' if data.get('simulation') else '')+'本包由协议清单和人工输入生成。草稿文件不可作为正式发文；已复核仅表示在系统记录了人工核对。模型不推断空间参数、审批结论或代替发文程序。')
print(json.dumps({'ok':True}))
