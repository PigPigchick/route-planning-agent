"""Portable XLSX export: text is stored as inline strings, never as formulas."""
import io,zipfile
from xml.sax.saxutils import escape

HEADERS=['序号','工程名称','工程编号','路径编号','路径版本','协议编号','函件编号','收函单位','行政区/区段','协议类型','征询轮次','模板版本','函件修订','起草/复核状态','发出/反馈状态','发出日期','发出时修订','回复日期','回复意见','闭环处理','业务文号','备注','登记人员','登记时间','待补资料','资料性质']
LABELS={'draft':'草稿待复核','confirmed':'已人工复核','incomplete':'资料待补充','blocked':'资料阻断','needs_rewrite':'正文待重写','failed':'生成失败','pending':'待生成','generating':'生成中','checking':'检查中','simulated':'模拟确认'}
def rows(letters):
 result=[]
 for i,l in enumerate(letters,1):
  p=l['issuer'];c=l.get('correspondence') or {};result.append([i,p.get('name',''),p.get('id',''),l.get('routeId',''),p.get('version',''),'、'.join(l['agreementIds']),l['id'],l['unit'],l['scope'],l['typeLabel'],{'first':'首次','repeat':'再次','revised':'路径调整后'}.get(l['round'],l['round']),l['template'],l['revision'],LABELS.get(l['status'],l['status']),c.get('state','未发出'),c.get('sentAt',''),c.get('sentRevision') or '',c.get('replyAt',''),c.get('replySummary',l.get('replySummary','')),c.get('closureNote',''),c.get('referenceNumber',''),c.get('notes',''),c.get('updatedBy',''),c.get('updatedAt',''),'；'.join(m['label'] for m in l['missingFields']),'模拟测试，未经人工复核' if l.get('simulation') else '工程资料，按记录状态核对'])
 return result
def column(i):
 s=''
 while i:i,r=divmod(i-1,26);s=chr(65+r)+s
 return s
def xml_text(s):
 return escape(''.join(c for c in str(s) if c in '\t\n\r' or ord(c)>=32))
def workbook_bytes(letters):
 data=[HEADERS,*rows(letters)];last=f'{column(len(HEADERS))}{len(data)}';body=[]
 for rn,row in enumerate(data,1):
  cells=[]
  for cn,v in enumerate(row,1):
   style=1 if rn==1 else 2 if rn%2==0 else 0;ref=f'{column(cn)}{rn}'
   if isinstance(v,(int,float)):cells.append(f'<c r="{ref}" s="{style}" t="n"><v>{v}</v></c>')
   else:cells.append(f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{xml_text(v)}</t></is></c>')
  body.append(f'<row r="{rn}" ht="{34 if rn==1 else 62}" customHeight="1">'+''.join(cells)+'</row>')
 widths=[8,32,24,18,14,24,22,30,32,24,16,30,12,20,20,16,14,16,56,48,22,40,18,28,48,32]
 cols=''.join(f'<col min="{i}" max="{i}" width="{w}" customWidth="1"/>' for i,w in enumerate(widths,1))
 sheet=f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:{last}"/><sheetViews><sheetView workbookViewId="0"><pane xSplit="4" ySplit="1" topLeftCell="E2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="22"/><cols>{cols}</cols><sheetData>{''.join(body)}</sheetData><autoFilter ref="A1:{last}"/><pageSetup orientation="landscape" paperSize="9"/></worksheet>'''
 styles='''<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Microsoft YaHei"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF286451"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F6F3"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'''
 files={'[Content_Types].xml':'''<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>''',
 '_rels/.rels':'''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>''',
 'xl/workbook.xml':'''<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="征询台账" sheetId="1" r:id="rId1"/></sheets></workbook>''',
 'xl/_rels/workbook.xml.rels':'''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>''',
 'xl/styles.xml':styles,'xl/worksheets/sheet1.xml':sheet}
 out=io.BytesIO()
 with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
  for name,content in files.items():z.writestr(name,content)
 return out.getvalue()
