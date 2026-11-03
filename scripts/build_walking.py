"""공개 OSM 파일에서 보행 가능한 연결만 골라 정적 지역 자료로 만든다."""
import argparse
import gzip
import hashlib
import json
import math
from collections import Counter
from pathlib import Path

CELL = .02
BOUNDS = {'south': 36.8, 'north': 38.4, 'west': 126.0, 'east': 128.1}
ALLOWED = {'footway', 'pedestrian', 'path', 'steps', 'living_street', 'residential', 'service',
           'unclassified', 'tertiary', 'tertiary_link', 'secondary', 'secondary_link', 'primary', 'primary_link', 'track'}
PERMITTED = {'yes', 'designated', 'permissive'}


def permitted(tags):
    foot = tags.get('foot')
    if tags.get('highway') not in ALLOWED and not (tags.get('highway') == 'cycleway' and foot in PERMITTED):
        return False
    if tags.get('motorroad') == 'yes' or tags.get('area') == 'yes' or tags.get('indoor') == 'yes':
        return False
    if tags.get('foot:conditional') or tags.get('access:conditional'):
        return False
    if foot and foot not in PERMITTED:
        return False
    if tags.get('access') not in (None, '', 'yes', 'permissive') and foot not in PERMITTED:
        return False
    return True


def blocked(tags):
    if tags.get('foot') in PERMITTED:
        return False
    return (tags.get('foot') in {'no', 'private'} or tags.get('access') in {'no', 'private'}
            or tags.get('barrier') in {'wall', 'fence', 'retaining_wall', 'block'})


def direction(tags):
    # 자동차 일방통행과 보행 일방통행은 별개다.
    value = tags.get('oneway:foot', 'no')
    return 1 if value in {'yes', '1', 'true'} else -1 if value == '-1' else 0 if value in {'no', '0', 'false'} else None


def inside(lat, lng):
    return BOUNDS['south'] <= lat <= BOUNDS['north'] and BOUNDS['west'] <= lng <= BOUNDS['east']


def build(source, output, source_url):
    import osmium
    tiles, rejected, closed = {}, Counter(), set()

    class Collector(osmium.SimpleHandler):
        def node(self, node):
            if inside(node.location.lat, node.location.lon) and blocked(node.tags):
                closed.add(node.id)

        def way(self, way):
            if not permitted(way.tags):
                return
            travel = direction(way.tags)
            if travel is None:
                rejected['보행 방향 미확인'] += 1
                return
            try:
                points = [(node.ref, round(node.lat * 1e7), round(node.lon * 1e7)) for node in way.nodes]
            except osmium.InvalidLocationError:
                rejected['좌표 누락'] += 1
                return
            for a, b in zip(points, points[1:]):
                if a[0] == b[0] or a[0] in closed or b[0] in closed:
                    continue
                if not (inside(a[1] / 1e7, a[2] / 1e7) and inside(b[1] / 1e7, b[2] / 1e7)):
                    continue
                ys = sorted([math.floor(a[1] / 1e7 / CELL), math.floor(b[1] / 1e7 / CELL)])
                xs = sorted([math.floor(a[2] / 1e7 / CELL), math.floor(b[2] / 1e7 / CELL)])
                if (ys[1] - ys[0] + 1) * (xs[1] - xs[0] + 1) > 16:
                    rejected['긴 직선 연결'] += 1
                    continue
                for y in range(ys[0], ys[1] + 1):
                    for x in range(xs[0], xs[1] + 1):
                        nodes, edges = tiles.setdefault(f'{y}-{x}', ({}, set()))
                        nodes[a[0]] = a
                        nodes[b[0]] = b
                        edges.add((a[0], b[0], travel))

    with osmium.io.Reader(str(source)) as reader:
        timestamp = reader.header().get('osmosis_replication_timestamp')
    Collector().apply_file(str(source), locations=True, idx='flex_mem')
    if not tiles:
        raise ValueError('보행망 자료를 확보하지 못했습니다.')
    output.mkdir(parents=True, exist_ok=True)
    manifest = {'version': 1, 'cell': CELL, 'bounds': BOUNDS, 'tiles': {}, 'source': {
        'name': 'OpenStreetMap contributors', 'url': 'https://www.openstreetmap.org/copyright',
        'download': source_url, 'timestamp': timestamp, 'license': 'ODbL-1.0',
        'licenseUrl': 'https://opendatacommons.org/licenses/odbl/1-0/'}}
    node_count = edge_count = size = 0
    for key, (nodes, edges) in sorted(tiles.items()):
        payload = json.dumps({'version': 1, 'nodes': sorted(nodes.values()), 'edges': sorted(edges)}, separators=(',', ':')).encode()
        asset = f'walk-{hashlib.sha256(payload).hexdigest()[:12]}.json.gz'
        packed = gzip.compress(payload, mtime=0)
        (output / asset).write_bytes(packed)
        manifest['tiles'][key] = asset
        node_count += len(nodes)
        edge_count += len(edges)
        size += len(packed)
    digest = hashlib.sha256()
    with source.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    audit = {'sourceSha256': digest.hexdigest(), 'sourceBytes': source.stat().st_size,
             'tileCount': len(tiles), 'tileNodes': node_count, 'tileEdges': edge_count, 'compressedBytes': size,
             'excluded': dict(rejected)}
    (output / 'index.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    (output / 'audit.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2) + '\n')
    (output / 'LICENSE.txt').write_text('© OpenStreetMap contributors\n이 파생 보행망 자료는 ODbL 1.0으로 배포합니다.\n'
        'https://www.openstreetmap.org/copyright\nhttps://opendatacommons.org/licenses/odbl/1-0/\n')
    print(json.dumps(audit, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--source-url', default='https://download.geofabrik.de/asia/south-korea-latest.osm.pbf')
    args = parser.parse_args()
    build(args.source, args.output, args.source_url)
