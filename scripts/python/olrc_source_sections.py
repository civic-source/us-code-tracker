"""Extract bounded source metadata and CI fragments; publisher bytes remain separately pinned."""
import argparse,copy,hashlib,json,re,unicodedata,xml.etree.ElementTree as ET
from pathlib import Path

NS='http://xml.house.gov/schemas/uslm/1.0'
ET.register_namespace('',NS)
def local(element):return element.tag.rsplit('}',1)[-1]
def text(element):return ' '.join(unicodedata.normalize('NFC',''.join(element.itertext())).split())

def extract(path,expected_sha,requested):
    with path.open('rb') as stream:raw=stream.read(128*1024*1024+1)
    if len(raw)>128*1024*1024 or hashlib.sha256(raw).hexdigest()!=expected_sha:raise ValueError('Pinned full member identity mismatch')
    if re.search(rb'<!\s*(DOCTYPE|ENTITY)\b',raw,re.I):raise ValueError('DTD/entity prohibited')
    document=ET.fromstring(raw)
    if document.tag!='{'+NS+'}uscDoc':raise ValueError('Unknown source namespace')
    parents={child:parent for parent in document.iter() for child in parent}
    sections=[element for element in document.iter() if local(element)=='section']
    identities=[element.get('identifier') for element in sections if (element.get('identifier') or '').startswith('/us/usc/t18/s')]
    if len(identities)!=len(set(identities)):raise ValueError('Nonunique canonical provision identity')
    selected=[]
    for section in requested:
        matches=[element for element in sections if element.get('identifier')=='/us/usc/t18/s'+section]
        if len(matches)!=1:raise ValueError('Requested source section missing or nonunique')
        element=matches[0];ancestor=element
        while ancestor in parents and local(ancestor)!='chapter':ancestor=parents[ancestor]
        match=re.search(r'/ch([0-9]+[a-z]*)$',ancestor.get('identifier',''))
        chapter=match.group(1) if match else ''
        if not re.fullmatch(r'[0-9]+[a-z]*',chapter):raise ValueError('Unqualified chapter identity')
        heading=next((child for child in element if local(child)=='heading'),None)
        if heading is None:raise ValueError('Source heading unavailable')
        refs=[]
        for ref in element.iter():
            if local(ref)!='ref':continue
            parent=ref;in_note=False
            while parent is not element:
                parent=parents[parent]
                if local(parent) in ('note','notes','sourceCredit'):in_note=True
            if not in_note:refs.append({'literal':text(ref),'target':ref.get('href','')})
        fixture=ET.Element('{'+NS+'}uscDoc')
        meta=ET.SubElement(fixture,'{'+NS+'}meta');ET.SubElement(meta,'{'+NS+'}docNumber').text='18'
        title=ET.SubElement(ET.SubElement(fixture,'{'+NS+'}main'),'{'+NS+'}title',identifier='/us/usc/t18')
        ET.SubElement(title,'{'+NS+'}num').text='18'
        container=ET.SubElement(title,'{'+NS+'}chapter',identifier=ancestor.get('identifier'))
        ET.SubElement(container,'{'+NS+'}num').text=chapter
        child=copy.deepcopy(element);child.tail=None;container.append(child)
        fragment=ET.tostring(fixture,encoding='unicode')
        selected.append({'section':section,'chapter':chapter,'identifier':element.get('identifier'),'heading':text(heading),
                         'excerpt':text(element)[:4000],'references':refs,'fixtureXml':fragment,
                         'fixtureSha256':hashlib.sha256(fragment.encode()).hexdigest()})
    return {'canonicalProvisionCount':len(identities),'rawSectionNodeCount':len(sections),'sections':selected}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--xml',type=Path,required=True);parser.add_argument('--sha256',required=True)
    parser.add_argument('--section',action='append',required=True);args=parser.parse_args()
    try:print(json.dumps(extract(args.xml,args.sha256,args.section),ensure_ascii=False,sort_keys=True))
    except (OSError,ValueError,ET.ParseError) as error:parser.exit(1,str(error)+'\n')
if __name__=='__main__':main()
