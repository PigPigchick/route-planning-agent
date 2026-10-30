"""Read bounded XLSX cell values with the standard library. Never evaluate formulas."""
import sys, json, io, zipfile, re, datetime
import xml.etree.ElementTree as ET
from pathlib import PurePosixPath

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'

def read_xlsx(data):
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        infos = z.infolist()
        if len(infos) > 1000 or sum(x.file_size for x in infos) > 30 * 1024 * 1024:
            raise ValueError('Excel内容过大，请拆分后导入')
        def xml(name):
            content = z.read(name)
            if b'<!DOCTYPE' in content or b'<!ENTITY' in content:
                raise ValueError('不支持此Excel结构')
            return ET.fromstring(content)
        book = xml('xl/workbook.xml')
        rels = {x.attrib['Id']: x.attrib['Target'] for x in xml('xl/_rels/workbook.xml.rels')}
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            shared = [''.join(x.itertext()) for x in xml('xl/sharedStrings.xml').findall('s:si', NS)]
        dates = set()
        if 'xl/styles.xml' in z.namelist():
            styles = xml('xl/styles.xml')
            custom = {int(x.attrib['numFmtId']): x.attrib.get('formatCode', '') for x in styles.findall('s:numFmts/s:numFmt', NS)}
            for i, x in enumerate(styles.findall('s:cellXfs/s:xf', NS)):
                fmt = int(x.attrib.get('numFmtId', 0))
                code = re.sub(r'"[^"]*"|\[[^\]]*\]', '', custom.get(fmt, '')).lower()
                if fmt in range(14, 23) or fmt in range(45, 48) or ('y' in code and 'd' in code):
                    dates.add(i)
        props = book.find('s:workbookPr', NS)
        epoch = datetime.datetime(1904, 1, 1) if props is not None and props.attrib.get('date1904') in ('1', 'true') else datetime.datetime(1899, 12, 30)
        result = []
        for sheet in book.findall('s:sheets/s:sheet', NS):
            if len(result) >= 12:
                raise ValueError('最多支持12个工作表')
            target = rels[sheet.attrib[REL]]
            name = str(PurePosixPath('xl') / target) if not target.startswith('/') else target.lstrip('/')
            if '..' in PurePosixPath(name).parts:
                raise ValueError('Excel工作表路径无效')
            tree = xml(name)
            rows = []
            for row in tree.findall('s:sheetData/s:row', NS):
                if int(row.attrib.get('r', '1')) > 1002:
                    raise ValueError('单个工作表最多1000行数据')
                values = []
                for cell in row.findall('s:c', NS):
                    address = cell.attrib.get('r', '')
                    letters = re.match(r'[A-Z]+', address)
                    if not letters:
                        raise ValueError('Excel单元格地址无效')
                    col = 0
                    for ch in letters.group(): col = col * 26 + ord(ch) - 64
                    if col > 50: raise ValueError('最多支持50列，请删除多余的已用列')
                    if cell.find('s:f', NS) is not None:
                        raise ValueError('输入表含公式，请在Excel中复制并粘贴为数值后导入')
                    typ = cell.attrib.get('t', '')
                    value = cell.findtext('s:v', default='', namespaces=NS)
                    if typ == 'inlineStr': value = ''.join(cell.find('s:is', NS).itertext())
                    elif typ == 's': value = shared[int(value)] if value else ''
                    elif typ == 'b': value = '是' if value == '1' else '否'
                    elif typ == 'e': raise ValueError('输入表含Excel错误值，请先修正')
                    elif value and int(cell.attrib.get('s', 0)) in dates:
                        value = (epoch + datetime.timedelta(days=float(value))).date().isoformat()
                    if len(value) > 12000: raise ValueError('单元格文字不能超过12000字')
                    while len(values) < col: values.append('')
                    values[col-1] = value
                if any(str(v).strip() for v in values): rows.append(values)
            result.append({'name': sheet.attrib['name'], 'rows': rows})
        return {'sheets': result}

if __name__ == '__main__':
    try:
        data = sys.stdin.buffer.read(6 * 1024 * 1024 + 1)
        if len(data) > 6 * 1024 * 1024: raise ValueError('Excel文件不能超过6MB')
        print(json.dumps(read_xlsx(data), ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'error': str(e)}, ensure_ascii=False))
        sys.exit(1)
