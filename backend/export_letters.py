"""Render reviewed letter objects. Receives trusted backend file paths on stdin."""
import sys,json,pathlib,zipfile,csv,io,re
from xlsx_ledger import workbook_bytes
from docx import Document
from docx.shared import Pt,Cm,RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

data=json.load(sys.stdin)
out=pathlib.Path(data['output']);out.parent.mkdir(parents=True,exist_ok=True)
def safe(s):return re.sub(r'[\\/:*?"<>|\x00-\x1f]','_',str(s))[:90]
def make_doc(letter,target):
 d=Document();sec=d.sections[0];sec.page_width=Cm(21);sec.page_height=Cm(29.7);sec.left_margin=Cm(2.5);sec.right_margin=Cm(2.5);sec.top_margin=Cm(2.5);sec.bottom_margin=Cm(2.4)
 for node in list(d.styles.element.iter(qn('w:pBdr'))):node.getparent().remove(node)
 for name in ['Heading 1','Heading 2']:
  d.styles[name].font.color.rgb=RGBColor(0,0,0)
 style=d.styles['Normal'];style.font.name='Songti SC';style.font.size=Pt(12);style.element.rPr.rFonts.set(qn('w:eastAsia'),'Songti SC');style.paragraph_format.line_spacing=1.5
 if letter.get('simulation'):
  p=d.add_paragraph('模拟测试成果 · 非真实工程资料 · 未经人工复核');p.runs[0].bold=True
  d.add_paragraph('本函仅验证软件流程。参数和文字附件为测试数据，模板适用性按测试假设处理，不可正式发文。')
 elif letter['status']!='confirmed':
  p=d.add_paragraph('草稿 · 待人工复核');p.runs[0].bold=True
 title=letter['title'];name=letter['issuer']['name']
 title=title.replace(name,name+'\n',1) if len(title)>28 else title
 p=d.add_paragraph(style='Title');p.alignment=1;p.paragraph_format.line_spacing=1.25;p.paragraph_format.space_after=Pt(18);r=p.add_run(title);r.bold=True;r.font.size=Pt(17);r.font.color.rgb=RGBColor(0,0,0);r.font.name='Songti SC';r._element.rPr.rFonts.set(qn('w:eastAsia'),'Songti SC')
 if letter['issuer'].get('documentNumber'):d.add_paragraph(letter['issuer']['documentNumber'])
 d.add_paragraph(letter['unit']+'：')
 for text in letter['bodyBlocks']:
  p=d.add_paragraph(text);p.paragraph_format.first_line_indent=Cm(.85)
 for t in letter['tables']:
  d.add_paragraph(t['title']);table=d.add_table(rows=1,cols=len(t['headers']));table.style='Table Grid'
  for c,text in zip(table.rows[0].cells,t['headers']):c.text=str(text)
  for row in t['rows']:
   for c,text in zip(table.add_row().cells,row):c.text=str(text)
 d.add_paragraph('附件：')
 for a in letter['attachments']:d.add_paragraph(f"{a['number']}. {a['name']}"+('' if a['available'] else '（实际文件待补充）'))
 for text in [letter['issuer'].get('issuer') or '发函单位待填写',letter['issuer'].get('issueDate') or '日期待填写']:
  p=d.add_paragraph(text);p.alignment=2
 d.add_paragraph('联系人：'+(letter['issuer'].get('contactName') or '待填写')+'    电话：'+(letter['issuer'].get('contactPhone') or '待填写'))
 d.add_paragraph('复函地址：'+(letter['issuer'].get('replyAddress') or '待填写'))
 if letter['status'] not in ['confirmed','simulated']:
  d.add_paragraph('待补资料与复核事项',style='Heading 2')
  for item in letter['missingFields']:d.add_paragraph(item['label'],style='List Bullet')
  for w in letter['warnings']:d.add_paragraph(w)
 d.save(target)

letters=data['letters']
if data['format']=='xlsx':out.write_bytes(workbook_bytes(letters))
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
    else:manifest.append(folder+'：'+a['name']+'（实际文件未提供）')
  z.writestr('协议征询台账.xlsx',workbook_bytes(letters))
  z.writestr('发出与反馈变更记录.json',json.dumps([{'letterId':l['id'],'unit':l['unit'],'record':l.get('correspondence'),'history':l.get('correspondenceHistory',[])} for l in letters],ensure_ascii=False,indent=2))
  if data.get('simulation'):z.writestr('模拟流程记录.json',json.dumps(data['simulation'],ensure_ascii=False,indent=2))
  z.writestr('人工复核记录.json',json.dumps([{"id":l['id'],"unit":l['unit'],"revision":l['revision'],"confirmations":l['confirmations']} for l in letters],ensure_ascii=False,indent=2));z.writestr('协议征询台账.csv','\ufeff'+buf.getvalue());z.writestr('附件核对清单.txt','\n'.join(manifest) or '所有所列附件均已打包。')
  z.writestr('使用说明.txt',('模拟测试成果：资料由模型补齐，附件均为文字占位文件，未进行人工复核，不是真实工程资料，不可正式发文。\n' if data.get('simulation') else '')+'本包由协议清单和人工输入生成。草稿文件不可作为正式发文；已复核仅表示在系统记录了人工核对。模型不推断空间参数、审批结论或代替发文程序。')
print(json.dumps({'ok':True}))
