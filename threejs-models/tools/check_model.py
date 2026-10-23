#!/usr/bin/env python3
"""Проверка модели по ТЗ (MODEL_SPEC.md).

    python3 tools/check_model.py Cargo_Truck.zip
    python3 tools/check_model.py model.glb          # только .glb, без проверки архива

Код выхода 0 — ни одной ошибки и ни одного предупреждения (ТЗ требует сдавать именно так).
Пределы по умолчанию — класс «Большая техника»; меняются ключами --max-tris, --max-materials и т.д.
Для проверки версии сжатого .blend нужен модуль zstandard (он есть рядом с bpy).
"""
import argparse
import json
import math
import re
import struct
import sys
import zipfile
from pathlib import Path

import numpy as np

MB = 1024 * 1024
ALLOWED_EXTENSIONS = {'KHR_materials_emissive_strength', 'KHR_texture_transform'}
DEFAULT_NAME = re.compile(
    r'^(mesh|object|node|cube|cylinder|sphere|plane|geometry|untitled|scene|group|empty|default|primitive|material)'
    r'([ ._-]?\d+)?$', re.IGNORECASE)
GOOD_NAME = re.compile(r'^[A-Za-z][A-Za-z0-9_]*$')
COMPONENTS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
DTYPES = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}


class Report:
    def __init__(self):
        self.errors, self.warnings, self.facts = [], [], []

    def error(self, section, msg):
        self.errors.append(f'[п.{section}] {msg}')

    def warn(self, section, msg):
        self.warnings.append(f'[п.{section}] {msg}')

    def fact(self, msg):
        self.facts.append(msg)


def num(n):
    return f'{n:,}'.replace(',', ' ')


def short_list(items, limit=8):
    items = list(items)
    tail = f' … и ещё {len(items) - limit}' if len(items) > limit else ''
    return ', '.join(map(str, items[:limit])) + tail


# --- архив и .blend -------------------------------------------------------------------------------

def check_zip(path, rep, limits):
    """Архив называется как лодка или корабль в задании (можно по-русски, см. MODEL_SPEC.md),
    а два файла внутри — как латинский корень модели: <Root>.glb и <Root>.blend."""
    bad_chars = sorted(set(path.stem) & set('/\\:*?"<>|'))
    if bad_chars or path.stem != path.stem.strip():
        rep.error(9, f'имя архива {path.name!r}: недопустимые символы {bad_chars} или пробелы по краям')
    if path.stat().st_size > 200 * MB:
        rep.error(9, f'архив {path.stat().st_size / MB:.1f} МБ, предел 200 МБ')
    with zipfile.ZipFile(path) as z:
        infos = z.infolist()
        names = [i.filename for i in infos]
        if any(i.is_dir() or '/' in i.filename for i in infos):
            rep.error(9, f'в архиве есть папки: {short_list(names)} — оба файла должны лежать в корне')
        files = {i.filename for i in infos if not i.is_dir()}
        glbs = sorted(f for f in files if f.lower().endswith('.glb'))
        stem = Path(glbs[0]).stem if len(glbs) == 1 else path.stem
        want = {f'{stem}.glb', f'{stem}.blend'}
        if files != want:
            rep.error(9, f'в архиве должны быть ровно {sorted(want)}, а лежат: {short_list(sorted(files))}')
        if not GOOD_NAME.match(stem):
            rep.error(9, f'файлы внутри архива называются {stem!r} — нужно латинское имя корня модели')
        for i in infos:
            if i.flag_bits & 0x1:
                rep.error(9, f'{i.filename} зашифрован паролем')
            if i.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                rep.error(9, f'{i.filename} сжат нестандартным методом ({i.compress_type}), нужен обычный ZIP')
        glb = z.read(f'{stem}.glb') if f'{stem}.glb' in files else None
        blend = z.read(f'{stem}.blend') if f'{stem}.blend' in files else None
    rep.fact(f'архив: {path.name} → {stem}.glb + {stem}.blend')
    if blend is not None:
        check_blend(blend, rep, limits)
    return stem, glb


def check_blend(data, rep, limits):
    if len(data) > limits.max_blend_mb * MB:
        rep.error(9, f'.blend {len(data) / MB:.1f} МБ, предел {limits.max_blend_mb} МБ')
    head = data[:32]
    if head[:4] == b'\x28\xb5\x2f\xfd':  # zstd: Save с галочкой Compress
        head = None
        try:
            import zstandard
            head = zstandard.ZstdDecompressor().decompressobj().decompress(data[:65536])[:32]
        except ImportError:
            rep.warn(9, '.blend сжат zstd, а модуля zstandard нет — версию Blender не проверить '
                        '(запустите проверку тем же Python, где стоит bpy)')
            return
    if not head.startswith(b'BLENDER'):
        rep.error(9, '.blend не похож на файл Blender (нет заголовка BLENDER)')
        return
    if head[7:8].isdigit():  # новый заголовок Blender 5: BLENDER17-01v0502
        m = re.search(rb'v(\d{4})', head)
        version = int(m.group(1)) if m else 0
    else:  # старый: BLENDER-v405
        version = int(head[9:12]) if head[9:12].isdigit() else 0
    rep.fact(f'.blend: Blender {version // 100}.{version % 100}, {len(data) / MB:.1f} МБ')
    if version < 500:
        rep.error(9, f'.blend сохранён в Blender {version // 100}.{version % 100}, нужен Blender 5.x')


# --- разбор .glb ---------------------------------------------------------------------------------

def parse_glb(data, rep):
    if len(data) < 20 or data[:4] != b'glTF':
        rep.error(1, 'файл не glTF Binary (нет заголовка glTF)')
        return None, None
    version, length = struct.unpack_from('<II', data, 4)
    if version != 2:
        rep.error(1, f'версия glTF {version}, нужна 2.0')
    if length != len(data):
        rep.error(1, f'длина в заголовке {length} не совпадает с размером файла {len(data)}')
    gltf, binary, offset = None, b'', 12
    while offset + 8 <= len(data):
        chunk_len, chunk_type = struct.unpack_from('<II', data, offset)
        chunk = data[offset + 8: offset + 8 + chunk_len]
        if chunk_type == 0x4E4F534A:
            gltf = json.loads(chunk)
        elif chunk_type == 0x004E4942:
            binary = chunk
        offset += 8 + chunk_len
    if gltf is None:
        rep.error(1, 'в .glb нет JSON-части')
    return gltf, binary


def read_accessor(gltf, binary, index):
    acc = gltf['accessors'][index]
    count, comps = acc['count'], COMPONENTS[acc['type']]
    dtype = np.dtype(DTYPES[acc['componentType']])
    if 'bufferView' not in acc:
        return np.zeros((count, comps), dtype)
    view = gltf['bufferViews'][acc['bufferView']]
    start = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
    item = dtype.itemsize * comps
    stride = view.get('byteStride', item)
    if stride == item:
        arr = np.frombuffer(binary, dtype, count * comps, start).reshape(count, comps)
    else:
        rows = np.frombuffer(binary, np.uint8, stride * (count - 1) + item, start)
        arr = np.lib.stride_tricks.as_strided(rows, (count, item), (stride, 1)).copy().view(dtype).reshape(count, comps)
    if acc.get('normalized'):
        arr = arr.astype(np.float32) / np.iinfo(dtype).max
    return arr


def node_matrix(node):
    if 'matrix' in node:
        return np.array(node['matrix'], dtype=np.float64).reshape(4, 4).T
    t = np.array(node.get('translation', [0, 0, 0]), dtype=np.float64)
    x, y, z, w = node.get('rotation', [0, 0, 0, 1])
    s = np.array(node.get('scale', [1, 1, 1]), dtype=np.float64)
    r = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
    m = np.eye(4)
    m[:3, :3] = r * s
    m[:3, 3] = t
    return m


def image_size(blob, mime):
    if mime == 'image/png' and blob[:8] == b'\x89PNG\r\n\x1a\n':
        return struct.unpack('>II', blob[16:24])
    if mime == 'image/jpeg' and blob[:2] == b'\xff\xd8':
        i = 2
        while i + 9 < len(blob):
            if blob[i] != 0xFF:
                i += 1
                continue
            marker = blob[i + 1]
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                h, w = struct.unpack('>HH', blob[i + 5:i + 9])
                return w, h
            i += 2 + struct.unpack('>H', blob[i + 2:i + 4])[0]
    return None


def find_extras(obj, path='', found=None):
    found = [] if found is None else found
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == 'extras':
                found.append(path or '/')
            find_extras(v, f'{path}/{k}', found)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            find_extras(v, f'{path}[{i}]', found)
    return found


# --- проверки .glb -------------------------------------------------------------------------------

def check_glb(data, stem, rep, limits):
    size_mb = len(data) / MB
    if size_mb > limits.max_glb_mb:
        rep.error(3, f'.glb {size_mb:.1f} МБ, предел {limits.max_glb_mb} МБ')
    gltf, binary = parse_glb(data, rep)
    if gltf is None:
        return

    # п.1 — формат и расширения
    required = gltf.get('extensionsRequired', [])
    if required:
        rep.error(1, f'extensionsRequired должен быть пуст, а там: {required}')
    bad_ext = set(gltf.get('extensionsUsed', [])) - ALLOWED_EXTENSIONS
    if bad_ext:
        rep.error(1, f'недопустимые расширения glTF: {sorted(bad_ext)}')
    for i, buf in enumerate(gltf.get('buffers', [])):
        if 'uri' in buf:
            rep.error(1, f'буфер {i} ссылается на внешний файл {buf["uri"][:40]!r}, всё должно быть внутри .glb')

    # п.8 — лишнее
    if gltf.get('cameras'):
        rep.error(8, f'в файле есть камеры: {len(gltf["cameras"])}')
    if gltf.get('skins'):
        rep.warn(7, 'в файле есть скелет (skins) — он нужен только персонажам')
    extras = find_extras({k: v for k, v in gltf.items() if k != 'asset'})
    if extras:
        rep.error(8, f'есть пользовательские свойства extras: {short_list(extras, 5)} (экспорт без Custom Properties)')

    nodes = gltf.get('nodes', [])
    meshes = gltf.get('meshes', [])
    materials = gltf.get('materials', [])

    # п.5 — дерево узлов
    scene = gltf.get('scenes', [{}])[gltf.get('scene', 0)]
    roots = scene.get('nodes', [])
    if len(roots) != 1:
        rep.error(5, f'у сцены должен быть один корневой узел, а их {len(roots)}')
    elif nodes[roots[0]].get('name') != stem:
        rep.warn(5, f'корень называется {nodes[roots[0]].get("name")!r}, а файлы модели — {stem!r}')
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get('children', []):
            parent[c] = i

    world = {}

    def walk(i, m, depth):
        world[i] = m @ node_matrix(nodes[i])
        if depth > 8:
            rep.error(5, f'глубина дерева больше 8 у узла {nodes[i].get("name")!r}')
        for c in nodes[i].get('children', []):
            walk(c, world[i], depth + 1)

    for r in roots:
        walk(r, np.eye(4), 1)

    if len(nodes) > limits.max_nodes:
        rep.error(3, f'узлов {len(nodes)}, предел {limits.max_nodes} — склейте неподвижные детали одного материала')

    names = [n.get('name', '') for n in nodes]
    seen, dupes, defaults, bad_chars = set(), set(), [], []
    for name in names:
        if name and name in seen:
            dupes.add(name)
        seen.add(name)
        if not name or DEFAULT_NAME.match(name):
            defaults.append(name or '<без имени>')
        elif not GOOD_NAME.match(name):
            bad_chars.append(name)
    if defaults:
        rep.error(5, f'части без имён — ИИ не сможет их найти: {short_list(defaults)}')
    if bad_chars:
        rep.error(5, f'имена не латиницей или с пробелами/точками: {short_list(bad_chars)}')
    if dupes:
        rep.error(5, f'повторяющиеся имена узлов: {short_list(sorted(dupes))}')
    empty = [n.get('name') or f'узел {i}' for i, n in enumerate(nodes) if 'mesh' not in n and not n.get('children') and i in world]
    if empty:
        rep.error(5, f'пустые узлы без сетки и детей: {short_list(empty)}')
    orphans = [n.get('name') or f'узел {i}' for i, n in enumerate(nodes) if i not in world]
    if orphans:
        rep.warn(8, f'узлы вне сцены: {short_list(orphans)}')

    # п.2 — трансформации
    scaled, mirrored, rotated, matrix_nodes = [], [], [], []
    for i, n in enumerate(nodes):
        label = n.get('name') or f'узел {i}'
        if 'matrix' in n:
            matrix_nodes.append(label)
            m3 = node_matrix(n)[:3, :3]
            s = np.linalg.norm(m3, axis=0) * np.sign(np.linalg.det(m3))
            rot_ok = np.allclose(m3 / np.abs(s), np.eye(3), atol=1e-5)
        else:
            s = n.get('scale', [1, 1, 1])
            q = n.get('rotation', [0, 0, 0, 1])
            rot_ok = abs(abs(q[3]) - 1) <= 1e-5
        if any(v < 0 for v in s):
            mirrored.append(label)
        elif any(abs(v - 1) > 1e-5 for v in s):
            scaled.append(label)
        if not rot_ok:
            rotated.append(label)
    if mirrored:
        rep.error(2, f'отрицательный масштаб (зеркало): {short_list(mirrored)}')
    if scaled:
        rep.error(2, f'масштаб не 1: {short_list(scaled)}')
    if rotated:
        rep.error(2, f'поворот не применён: {short_list(rotated)}')
    if matrix_nodes:
        rep.warn(2, f'трансформация задана матрицей, а не TRS: {short_list(matrix_nodes)}')

    # п.4, 3 — сетки
    triangles, used_materials = 0, set()
    all_points = []
    mesh_tris = {}
    issues = {k: [] for k in ('mode', 'no_normal', 'extra_attr', 'pos_type', 'uv_range', 'degenerate',
                              'dupes', 'unused', 'winding', 'morph', 'no_index')}
    mesh_users = {}
    for i, n in enumerate(nodes):
        if 'mesh' in n:
            mesh_users.setdefault(n['mesh'], []).append(n.get('name') or f'узел {i}')
    for mi, mesh in enumerate(meshes):
        tris = 0
        users = mesh_users.get(mi, [])
        mname = (users[0] + (f' +{len(users) - 1}' if len(users) > 1 else '')) if users else (mesh.get('name') or f'сетка {mi}')
        for prim in mesh.get('primitives', []):
            attrs = prim.get('attributes', {})
            if prim.get('mode', 4) != 4:
                issues['mode'].append(mname)
                continue
            if 'material' in prim:
                used_materials.add(prim['material'])
            if prim.get('targets'):
                issues['morph'].append(mname)
            if 'NORMAL' not in attrs:
                issues['no_normal'].append(mname)
            extra = [a for a in attrs if a in ('TEXCOORD_1', 'COLOR_0', 'TANGENT') or a.startswith('_')]
            if extra:
                issues['extra_attr'].append(f'{mname} ({", ".join(extra)})')
            pacc = gltf['accessors'][attrs['POSITION']]
            if pacc['componentType'] != 5126 or pacc.get('normalized'):
                issues['pos_type'].append(mname)
            pos = read_accessor(gltf, binary, attrs['POSITION']).astype(np.float64)
            if 'indices' in prim:
                idx = read_accessor(gltf, binary, prim['indices']).reshape(-1).astype(np.int64)
            else:
                idx = np.arange(len(pos))
                issues['no_index'].append(mname)
            faces = idx.reshape(-1, 3)
            tris += len(faces)
            a, b, c = pos[faces[:, 0]], pos[faces[:, 1]], pos[faces[:, 2]]
            cross = np.cross(b - a, c - a)
            area = np.linalg.norm(cross, axis=1) / 2
            degenerate = (area < 1e-10) | (faces[:, 0] == faces[:, 1]) | (faces[:, 1] == faces[:, 2]) | (faces[:, 0] == faces[:, 2])
            if degenerate.any():
                issues['degenerate'].append(f'{mname} ({int(degenerate.sum())})')
            unused = len(pos) - len(np.unique(idx))
            if unused > 0:
                issues['unused'].append(f'{mname} ({unused})')
            # Дубли: совпадают положение (0,1 мм), нормаль и UV — такие вершины надо слить
            key = [np.round(pos / 1e-4)]
            if 'NORMAL' in attrs:
                nrm = read_accessor(gltf, binary, attrs['NORMAL']).astype(np.float64)
                key.append(np.round(nrm * 1000))
                # Обход против часовой со стороны нормали: геометрическая нормаль смотрит туда же, что вершинные
                vn = nrm[faces[:, 0]] + nrm[faces[:, 1]] + nrm[faces[:, 2]]
                ok = ~degenerate
                if ok.any():
                    flipped = (np.einsum('ij,ij->i', cross[ok], vn[ok]) < 0).mean()
                    if flipped > 0.01:
                        issues['winding'].append(f'{mname} ({flipped:.0%})')
            if 'TEXCOORD_0' in attrs:
                uv = read_accessor(gltf, binary, attrs['TEXCOORD_0']).astype(np.float64)
                key.append(np.round(uv * 1e4))
                if uv.min() < -1e-4 or uv.max() > 1 + 1e-4:
                    issues['uv_range'].append(f'{mname} ({uv.min():.2f}…{uv.max():.2f})')
            used = np.unique(idx)
            k = np.hstack(key)[used]
            dup = len(k) - len(np.unique(k, axis=0))
            if dup > 0:
                issues['dupes'].append(f'{mname} ({dup})')
        mesh_tris[mi] = tris

    for i, n in enumerate(nodes):
        if 'mesh' in n and i in world:
            triangles += mesh_tris[n['mesh']]
            for prim in meshes[n['mesh']].get('primitives', []):
                pos = read_accessor(gltf, binary, prim['attributes']['POSITION']).astype(np.float64)
                all_points.append(pos @ world[i][:3, :3].T + world[i][:3, 3])

    labels = {
        'mode': (4, 'error', 'в сетке не только треугольники (mode ≠ 4)'),
        'morph': (7, 'error', 'есть морфы (shape keys)'),
        'no_normal': (4, 'error', 'нет нормалей NORMAL'),
        'extra_attr': (4, 'warn', 'лишние атрибуты (в игре отбрасываются)'),
        'pos_type': (1, 'error', 'POSITION не float32 (квантование)'),
        'no_index': (4, 'warn', 'сетка без индексов — вершины не слиты'),
        'degenerate': (4, 'error', 'вырожденные треугольники'),
        'unused': (4, 'warn', 'висящие вершины без треугольников'),
        'dupes': (4, 'warn', 'не слитые совпадающие вершины (Merge by Distance 0,1 мм)'),
        'winding': (4, 'error', 'обход треугольников против нормалей (нормали внутрь?)'),
        'uv_range': (4, 'warn', 'UV за пределами 0…1'),
    }
    for key, items in issues.items():
        if items:
            section, level, text = labels[key]
            getattr(rep, 'error' if level == 'error' else 'warn')(section, f'{text}: {short_list(items, 6)}')

    if triangles > limits.max_tris:
        rep.error(3, f'треугольников {num(triangles)}, предел {num(limits.max_tris)}')

    # п.2 — габариты и начало координат
    if all_points:
        pts = np.vstack(all_points)
        lo, hi = pts.min(axis=0), pts.max(axis=0)
        size = hi - lo
        height = size[1]
        tol_y = max(0.03, 0.05 * height)
        rep.fact(f'габариты Д×Ш×В: {size[0]:.2f} × {size[2]:.2f} × {size[1]:.2f} м')
        if height > 1200:
            rep.error(2, f'высота {height:.0f} м — похоже, сантиметры вместо метров')
        elif height < 0.01:
            rep.error(2, f'высота {height * 1000:.1f} мм — похоже, модель в 100 раз меньше')
        elif height > limits.max_height:
            rep.warn(2, f'высота {height:.1f} м больше обычной для этого класса ({limits.max_height} м)')
        if abs(lo[1]) > tol_y:
            where = 'висит над полом' if lo[1] > 0 else 'утоплена в пол'
            rep.error(2, f'самая низкая точка на Y = {lo[1]:.3f} м — модель {where} (допуск ±{tol_y:.2f} м)')
        center = (lo + hi) / 2
        for axis, name in ((0, 'X'), (2, 'Z')):
            tol = max(0.03, 0.05 * size[axis])
            if abs(center[axis]) > tol:
                rep.warn(2, f'середина основания смещена по {name} на {center[axis]:.2f} м (допуск ±{tol:.2f} м)')
        if size[2] > size[0]:
            # Самолёт с размахом больше длины — норма, поэтому это не предупреждение, а подсказка
            rep.fact('модель шире, чем длиннее (так бывает у самолётов): убедитесь, что перёд смотрит в +X')

    # п.6 — материалы и текстуры
    if len(materials) > limits.max_materials:
        rep.error(3, f'материалов {len(materials)}, предел {limits.max_materials}')
    unused_mats = [m.get('name') for i, m in enumerate(materials) if i not in used_materials]
    if unused_mats:
        rep.warn(8, f'неиспользуемые материалы: {short_list(unused_mats)}')
    mat_names = [m.get('name', '') for m in materials]
    bad_mats = [n or '<без имени>' for n in mat_names if not n or DEFAULT_NAME.match(n) or not GOOD_NAME.match(n)]
    if bad_mats:
        rep.error(6, f'имена материалов не по смыслу или не латиницей: {short_list(bad_mats)}')
    dup_mats = sorted({n for n in mat_names if n and mat_names.count(n) > 1})
    if dup_mats:
        rep.error(6, f'повторяющиеся имена материалов: {short_list(dup_mats)}')
    for m in materials:
        ext = set(m.get('extensions', {})) - ALLOWED_EXTENSIONS
        if ext:
            rep.error(6, f'материал {m.get("name")!r}: недопустимые расширения {sorted(ext)}')
        if m.get('alphaMode') == 'BLEND':
            rep.warn(4, f'материал {m.get("name")!r}: alphaMode BLEND — для листов нужен MASK')
        if 'pbrMetallicRoughness' not in m and 'extensions' not in m:
            rep.warn(6, f'материал {m.get("name")!r} без pbrMetallicRoughness')

    for i, tex in enumerate(gltf.get('textures', [])):
        if tex.get('extensions'):
            rep.error(6, f'текстура {i}: расширения {sorted(tex["extensions"])} (KTX2/WebP нельзя)')
        if 'source' not in tex:
            rep.error(6, f'текстура {i} без картинки (source)')
    for i, img in enumerate(gltf.get('images', [])):
        label = img.get('name') or f'картинка {i}'
        if 'uri' in img:
            rep.error(1, f'{label}: внешний файл {img["uri"][:40]!r}')
            continue
        mime = img.get('mimeType')
        if mime not in ('image/png', 'image/jpeg'):
            rep.error(6, f'{label}: формат {mime}, нужен JPEG или PNG')
            continue
        view = gltf['bufferViews'][img['bufferView']]
        start = view.get('byteOffset', 0)
        dims = image_size(binary[start:start + view['byteLength']], mime)
        if not dims:
            rep.warn(6, f'{label}: не удалось прочитать размер картинки')
            continue
        w, h = dims
        if max(w, h) > limits.max_texture:
            rep.error(6, f'{label}: {w}×{h}, сторона больше {limits.max_texture} px')
        if w & (w - 1) or h & (h - 1):
            rep.warn(6, f'{label}: {w}×{h} — не степень двойки')

    # п.7 — анимации
    animated = {}
    for ai, anim in enumerate(gltf.get('animations', [])):
        aname = anim.get('name', '')
        if not aname or not GOOD_NAME.match(aname) or DEFAULT_NAME.match(aname):
            rep.error(7, f'анимация {ai} без понятного латинского имени: {aname!r}')
        open_loops, sparse = [], []
        for ch in anim.get('channels', []):
            target = ch.get('target', {})
            path = target.get('path')
            node = target.get('node')
            if path not in ('rotation', 'translation'):
                rep.error(7, f'{aname}: анимируется {path} у {nodes[node].get("name") if node is not None else "?"} '
                             '— можно только rotation и translation')
                continue
            animated.setdefault(node, set()).add(aname)
            sampler = anim['samplers'][ch['sampler']]
            out = read_accessor(gltf, binary, sampler['output']).astype(np.float64)
            if sampler.get('interpolation') == 'CUBICSPLINE':
                out = out[1::3]
            nname = nodes[node].get('name')
            if len(out) > 1:
                same = np.allclose(out[0], out[-1], atol=1e-4)
                if path == 'rotation' and not same:
                    same = np.allclose(out[0], -out[-1], atol=1e-4)  # q и −q — один и тот же поворот
                if not same:
                    open_loops.append(nname)
            if path == 'rotation' and len(out) > 1:
                dots = np.abs(np.einsum('ij,ij->i', out[:-1], out[1:])).clip(0, 1)
                if (2 * np.degrees(np.arccos(dots))).max() > 120:
                    sparse.append(nname)
        if open_loops:
            rep.warn(7, f'{aname}: не замкнута (последний ключ ≠ первому) у {short_list(sorted(set(open_loops)))} '
                        '— для повторяющейся анимации это рывок')
        if sparse:
            rep.error(7, f'{aname}: между соседними ключами поворота больше 120° у {short_list(sorted(set(sparse)))} '
                         '— нужно не меньше 5 ключей на оборот')
    nested = []
    for node in animated:
        p = parent.get(node)
        while p is not None:
            if p in animated:
                nested.append(f'{nodes[node].get("name")} внутри {nodes[p].get("name")}')
            p = parent.get(p)
    if nested:
        rep.error(5, f'подвижная часть вложена в другую подвижную: {short_list(nested, 5)}')

    rep.fact(f'треугольников: {num(triangles)}')
    rep.fact(f'узлов: {len(nodes)}, сеток: {len(meshes)}, материалов: {len(materials)} ({short_list(mat_names, 12)})')
    rep.fact(f'.glb: {size_mb:.2f} МБ, картинок: {len(gltf.get("images", []))}')
    if gltf.get('animations'):
        rep.fact('анимации: ' + '; '.join(
            f'{a.get("name")} → {short_list(sorted({nodes[c["target"]["node"]].get("name") for c in a["channels"]}), 6)}'
            for a in gltf['animations']))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('path', type=Path, help='архив <имя>.zip или файл .glb')
    ap.add_argument('--max-tris', type=int, default=110_000)
    ap.add_argument('--max-materials', type=int, default=9)
    ap.add_argument('--max-nodes', type=int, default=150)
    ap.add_argument('--max-texture', type=int, default=2048)
    ap.add_argument('--max-glb-mb', type=float, default=20)
    ap.add_argument('--max-blend-mb', type=float, default=50)
    ap.add_argument('--max-height', type=float, default=120)
    limits = ap.parse_args()

    rep = Report()
    path = limits.path
    if path.suffix.lower() == '.zip':
        stem, glb = check_zip(path, rep, limits)
    else:
        stem, glb = path.stem, path.read_bytes()
        rep.warn(9, 'проверен только .glb — сдавать нужно .zip с .glb и .blend')
    if glb is not None:
        check_glb(glb, stem, rep, limits)

    print(f'Проверка {path.name}')
    for f in rep.facts:
        print(f'  · {f}')
    print(f'\nОшибок: {len(rep.errors)}, предупреждений: {len(rep.warnings)}')
    for e in rep.errors:
        print(f'  ✗ {e}')
    for w in rep.warnings:
        print(f'  ! {w}')
    print('\nКодом не проверяются, смотреть глазами: внутренние грани, перекрытия в одной плоскости (z-fighting), '
          'начало подвижных частей на оси движения, упрощение до 30 000 треугольников.')
    if not rep.errors and not rep.warnings:
        print('\nГотово к сдаче: ни ошибок, ни предупреждений.')
    sys.exit(1 if rep.errors or rep.warnings else 0)


if __name__ == '__main__':
    main()
