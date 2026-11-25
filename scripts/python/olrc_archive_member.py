"""Read an exact pinned OLRC ZIP member, including streaming data-descriptor entries."""
import argparse,hashlib,io,sys,zipfile,re
from pathlib import Path

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--archive',type=Path,required=True);p.add_argument('--archive-sha256',required=True)
    p.add_argument('--archive-bytes',type=int,required=True);p.add_argument('--member-sha256',required=True)
    p.add_argument('--member-bytes',type=int,required=True);p.add_argument('--member-name',default='usc18.xml');a=p.parse_args()
    try:
        if not 0<a.archive_bytes<=128*1024*1024 or not 0<a.member_bytes<=128*1024*1024:raise ValueError('Invalid source byte bounds')
        if not re.fullmatch(r'usc[0-9]+[A-Za-z]?\.xml',a.member_name):raise ValueError('Invalid source member name')
        with a.archive.open('rb') as stream:raw=stream.read(a.archive_bytes+1)
        if len(raw)!=a.archive_bytes or hashlib.sha256(raw).hexdigest()!=a.archive_sha256:raise ValueError('Archive byte pin mismatch')
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            if archive.namelist()!=[a.member_name]:raise ValueError('Unexpected or duplicate archive members')
            info=archive.getinfo(a.member_name)
            if info.orig_filename!=a.member_name:raise ValueError('Ambiguous archive member name')
            if info.file_size!=a.member_bytes or info.flag_bits&1:raise ValueError('Invalid member size or encryption')
            with archive.open(info) as stream:member=stream.read(a.member_bytes+1)
        if len(member)!=a.member_bytes or hashlib.sha256(member).hexdigest()!=a.member_sha256:raise ValueError('Member byte pin mismatch')
        sys.stdout.buffer.write(member)
    except (OSError,ValueError,zipfile.BadZipFile,RuntimeError) as error:p.exit(1,str(error)+'\n')
if __name__=='__main__':main()
