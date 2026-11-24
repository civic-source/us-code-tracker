"""Deterministic streaming archive transport for retained eCFR artifacts."""
import argparse
import gzip
import hashlib
import io
import json
import os
import re
import tarfile

CHUNK = 1024 * 1024
MAX_MANIFEST = 1024 * 1024
MAX_UNPACKED = 16 * 1024 ** 3


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON key')
        result[key] = value
    return result


def inventory(manifest):
    blobs = {}
    for blob in manifest['blobs']:
        sha = blob['sha256']
        size = blob['byteLength']
        if not re.fullmatch(r'[a-f0-9]{64}', sha) or type(size) is not int or size < 0:
            raise ValueError('Invalid blob identity')
        if sha in blobs:
            raise ValueError('Duplicate blob identity')
        blobs[sha] = size
    expected = [source['blob'] for source in manifest['snapshot']['sources']]
    expected += [manifest['snapshot']['index']] + manifest['products']
    if {blob['sha256'] for blob in expected} != set(blobs):
        raise ValueError('Archive blob inventory mismatch')
    if any(blobs[blob['sha256']] != blob['byteLength'] for blob in expected):
        raise ValueError('Conflicting archive blob sizes')
    if sum(blobs.values()) > MAX_UNPACKED:
        raise ValueError('Archive exceeds unpacked size limit')
    return blobs


def member(name, size):
    info = tarfile.TarInfo(name)
    info.size = size
    info.mode = 0o600
    info.mtime = 0
    info.uid = info.gid = 0
    info.uname = info.gname = ''
    return info


def export_archive(args):
    with open(args.manifest, 'rb') as source:
        raw = source.read(MAX_MANIFEST + 1)
    if len(raw) > MAX_MANIFEST:
        raise ValueError('Oversized archive manifest')
    manifest = json.loads(raw, object_pairs_hook=unique_object)
    blobs = inventory(manifest)
    with open(args.output, 'xb') as output:
        with gzip.GzipFile(fileobj=output, mode='wb', filename='', mtime=0) as zipped:
            with tarfile.open(fileobj=zipped, mode='w|', format=tarfile.USTAR_FORMAT) as tar:
                tar.addfile(member('archive.json', len(raw)), io.BytesIO(raw))
                for sha, size in sorted(blobs.items()):
                    path = os.path.join(args.root, 'objects', sha)
                    if os.path.getsize(path) != size or not os.path.isfile(path) or os.path.islink(path):
                        raise ValueError('Invalid source artifact')
                    with open(path, 'rb') as source:
                        tar.addfile(member('objects/' + sha, size), source)
        output.flush()
        os.fsync(output.fileno())


def consume(source, size, destination=None):
    digest = hashlib.sha256()
    remaining = size
    while remaining:
        data = source.read(min(CHUNK, remaining))
        if not data:
            raise ValueError('Truncated archive artifact')
        remaining -= len(data)
        digest.update(data)
        if destination is not None:
            destination.write(data)
    return digest.hexdigest()


class BoundedReader:
    def __init__(self, source):
        self.source = source
        self.count = 0
        self.limit = MAX_MANIFEST + 1024 * 1024

    def read(self, size=-1):
        amount = min(size if size >= 0 else CHUNK, self.limit - self.count + 1)
        data = self.source.read(amount)
        self.count += len(data)
        if self.count > self.limit:
            raise ValueError('Archive decompression exceeds declared bound')
        return data


def inspect_archive(args):
    manifest = None
    blobs = {}
    seen = set()
    with gzip.open(args.archive, 'rb') as zipped:
        bounded = BoundedReader(zipped)
        with tarfile.open(fileobj=bounded, mode='r|', ignore_zeros=True) as tar:
            for entry in tar:
                if not entry.isfile() or entry.issparse() or entry.pax_headers or entry.name in seen:
                    raise ValueError('Linked, special or duplicate archive member')
                seen.add(entry.name)
                source = tar.extractfile(entry)
                if source is None:
                    raise ValueError('Unreadable archive member')
                if manifest is None:
                    if entry.name != 'archive.json' or entry.size > MAX_MANIFEST:
                        raise ValueError('Archive manifest must be the first bounded member')
                    raw = source.read(MAX_MANIFEST + 1)
                    manifest = json.loads(raw, object_pairs_hook=unique_object)
                    blobs = inventory(manifest)
                    bounded.limit = sum(blobs.values()) + MAX_MANIFEST + len(blobs) * 1024 + 1024 * 1024
                else:
                    sha = entry.name.removeprefix('objects/')
                    if entry.name != 'objects/' + sha or sha not in blobs or entry.size != blobs[sha]:
                        raise ValueError('Unexpected archive member or size')
                    check_artifact(args, source, sha, entry.size)
        while bounded.read(CHUNK):
            pass
    if manifest is None or seen != {'archive.json'} | {'objects/' + sha for sha in blobs}:
        raise ValueError('Incomplete archive')
    print(json.dumps(manifest, separators=(',', ':'), sort_keys=True))


def check_artifact(args, source, sha, size):
    if args.destination:
        path = os.path.join(args.destination, sha)
        with open(path, 'xb') as output:
            actual = consume(source, size, output)
            output.flush()
            os.fsync(output.fileno())
    else:
        actual = consume(source, size)
    if actual != sha:
        raise ValueError('Archive artifact hash mismatch')


def main():
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest='action', required=True)
    export = commands.add_parser('export')
    for flag in ('root', 'manifest', 'output'):
        export.add_argument('--' + flag, required=True)
    inspect = commands.add_parser('inspect')
    inspect.add_argument('--archive', required=True)
    inspect.add_argument('--destination')
    args = parser.parse_args()
    if args.action == 'export':
        export_archive(args)
    else:
        inspect_archive(args)


if __name__ == '__main__':
    main()
