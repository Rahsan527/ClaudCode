"""Сборка модели по ТЗ (MODEL_SPEC.md, п. 10) в Blender 5: .glb из three.js -> <имя>.blend + <имя>.glb -> <имя>.zip.

    python tools/finalize_model.py source.glb out_dir Cargo_Truck

Нужен Blender как Python-модуль (pip install bpy, Blender 5.x). Что делает:
  1. импортирует .glb, ставит один корень с именем модели;
  2. применяет поворот и масштаб у всех неподвижных объектов (у подвижных — проверяет, что поворот в покое 0);
  3. чистит сетки: слияние вершин 0,1 мм, висящие вершины и рёбра, вырожденные грани, n-гоны -> треугольники,
     нормали наружу, сглаживание по углу; одна UV, без цветов вершин и своих свойств;
  4. уменьшает текстуры до степени двойки не больше 2048;
  5. ставит самую низкую точку на Y = 0 и середину основания в X = Z = 0;
  6. убирает камеры, свет, пустые узлы и неиспользуемые данные;
  7. упаковывает картинки, сохраняет .blend, экспортирует .glb с настройками из ТЗ, собирает .zip
     и запускает tools/check_model.py.
Чего скрипт не исправляет (это задача генератора модели): бюджеты треугольников, материалов и узлов, имена,
UV за пределами 0…1, повёрнутые в покое подвижные части.
"""
import json
import math
import struct
import subprocess
import sys
import zipfile
from pathlib import Path

import bpy  # до bmesh и mathutils: в модуле bpy они появляются после его загрузки
import bmesh
from mathutils import Vector

MAX_TEXTURE = 2048


def fail(msg):
    print(f'ОСТАНОВКА: {msg}')
    sys.exit(2)


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.orphans_purge(do_recursive=True)


def read_source(path):
    """JSON исходного .glb: поворот узлов в покое и список анимированных узлов (в Blender 5 второй и
    следующие клипы лежат в NLA-дорожках, поэтому подвижные части берём из файла, а не из сцены)."""
    data = path.read_bytes()
    length = struct.unpack_from('<I', data, 12)[0]
    gltf = json.loads(data[20:20 + length])
    nodes = gltf.get('nodes', [])
    rest = {n.get('name'): n.get('rotation', [0, 0, 0, 1]) for n in nodes}
    moving = {nodes[c['target']['node']].get('name') for a in gltf.get('animations', []) for c in a['channels']}
    return rest, moving


def select_only(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objs:
        obj.select_set(True)
    if objs:
        bpy.context.view_layer.objects.active = objs[0]


def set_root(name):
    roots = [o for o in bpy.context.scene.objects if o.parent is None]
    if len(roots) == 1 and roots[0].type == 'EMPTY':
        root = roots[0]
    else:
        root = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(root)
        for obj in roots:
            matrix = obj.matrix_world.copy()
            obj.parent = root
            obj.matrix_world = matrix
    if root.name != name:
        clash = bpy.data.objects.get(name)
        if clash and clash is not root:
            clash.name = f'{name}_Part'
        root.name = name
    return root


def apply_rotation_scale(moving, rest):
    """Поворот и масштаб — в сетку. У подвижных частей поворот в покое должен быть уже нулевым."""
    bad = [o.name for o in moving if abs(abs(rest.get(o.name, [0, 0, 0, 1])[3]) - 1) > 1e-5]
    if bad:
        fail('у подвижных частей поворот в покое не 0, ключи анимации нельзя пересчитать автоматически: '
             + ', '.join(sorted(bad)[:10]) + ' — постройте их с нулевым поворотом, а повёрнутую геометрию запеките в сетку')
    still = [o for o in bpy.context.scene.objects if o not in moving]
    for obj in still:  # общую сетку (связанные копии) Blender не трансформирует — даём каждому свою
        if obj.data is not None and obj.data.users > 1:
            obj.data = obj.data.copy()
    select_only(still)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True, properties=False)
    scaled = [o.name for o in bpy.context.scene.objects if any(abs(v - 1) > 1e-6 for v in o.scale)]
    if scaled:
        fail('масштаб не 1 у подвижных частей: ' + ', '.join(scaled[:10]))


def clean_meshes(smooth_angle):
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for mesh in {o.data for o in meshes}:
        bm = bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0001)
        bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges)
        loose_edges = [e for e in bm.edges if not e.link_faces]
        if loose_edges:
            bmesh.ops.delete(bm, geom=loose_edges, context='EDGES')
        loose_verts = [v for v in bm.verts if not v.link_faces]
        if loose_verts:
            bmesh.ops.delete(bm, geom=loose_verts, context='VERTS')
        ngons = [f for f in bm.faces if len(f.verts) > 4]
        if ngons:
            bmesh.ops.triangulate(bm, faces=ngons, quad_method='BEAUTY', ngon_method='BEAUTY')
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(mesh)
        bm.free()
        for layer in list(mesh.uv_layers)[1:]:
            mesh.uv_layers.remove(layer)
        for attr in list(mesh.color_attributes):
            mesh.color_attributes.remove(attr)
        if 'custom_normal' in mesh.attributes:
            mesh.attributes.remove(mesh.attributes['custom_normal'])
        mesh.update()
    select_only(meshes)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle), keep_sharp_edges=True)


def fix_textures():
    for img in bpy.data.images:
        if img.source != 'FILE' or not img.size[0]:
            continue
        w, h = img.size
        fit = lambda v: min(MAX_TEXTURE, 2 ** round(math.log2(v)))
        nw, nh = fit(w), fit(h)
        if (nw, nh) != (w, h):
            print(f'  текстура {img.name}: {w}×{h} -> {nw}×{nh}')
            img.scale(nw, nh)
            img.pack()


def place_on_ground(root):
    bpy.context.view_layer.update()
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        for v in obj.data.vertices:
            p = obj.matrix_world @ v.co
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    # Blender: вверх Z, перёд +X, правая сторона −Y (в glTF это Y вверх и +Z вправо)
    offset = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    for child in root.children:
        child.location -= offset
    root.location = (0, 0, 0)
    size = hi - lo
    print(f'  габариты Д×Ш×В: {size.x:.2f} × {size.y:.2f} × {size.z:.2f} м, сдвиг {tuple(round(v, 3) for v in offset)}')


def remove_clutter():
    for obj in list(bpy.context.scene.objects):
        if obj.type in {'CAMERA', 'LIGHT', 'CURVE', 'FONT', 'SURFACE', 'META'} or obj.hide_get() or obj.hide_render:
            bpy.data.objects.remove(obj, do_unlink=True)
    changed = True
    while changed:  # пустые узлы без детей, снизу вверх
        changed = False
        for obj in list(bpy.context.scene.objects):
            if obj.type == 'EMPTY' and not obj.children and obj.parent is not None:
                bpy.data.objects.remove(obj, do_unlink=True)
                changed = True
    for block in (*bpy.data.objects, *bpy.data.meshes, *bpy.data.materials, *bpy.data.actions):
        for key in list(block.keys()):
            del block[key]
    bpy.data.orphans_purge(do_recursive=True)


def unrequire_extensions(glb):
    """Экспортёр Blender 5.2 пишет KHR_texture_transform в extensionsRequired, а ТЗ требует пустой список.
    Оба допустимых расширения необязательны: без них картинка лишь теряет повтор, поэтому убираем их
    из extensionsRequired (в extensionsUsed они остаются)."""
    data = bytearray(glb.read_bytes())
    json_len = struct.unpack_from('<I', data, 12)[0]
    gltf = json.loads(data[20:20 + json_len])
    required = gltf.get('extensionsRequired', [])
    rest = [e for e in required if e not in ('KHR_texture_transform', 'KHR_materials_emissive_strength')]
    if rest == required:
        return
    if rest:
        gltf['extensionsRequired'] = rest
    else:
        gltf.pop('extensionsRequired')
    chunk = json.dumps(gltf, separators=(',', ':'), ensure_ascii=False).encode()
    chunk += b' ' * (-len(chunk) % 4)
    tail = data[20 + json_len:]
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(chunk) + len(tail))
    out += struct.pack('<II', len(chunk), 0x4E4F534A) + chunk + tail
    glb.write_bytes(out)
    print(f'  extensionsRequired: убраны {sorted(set(required) - set(rest))}')


def export(out_dir, name):
    bpy.ops.file.pack_all()
    blend = out_dir / f'{name}.blend'
    glb = out_dir / f'{name}.glb'
    bpy.ops.wm.save_as_mainfile(filepath=str(blend), compress=True)
    want = dict(
        filepath=str(glb), export_format='GLB', use_visible=True, export_yup=True, export_apply=True,
        export_texcoords=True, export_normals=True, export_tangents=False,
        export_vertex_color='NONE', export_attributes=False,
        export_materials='EXPORT', export_image_format='AUTO',
        export_cameras=False, export_lights=False, export_extras=False,
        export_animations=True, export_animation_mode='ACTIONS', export_merge_animation='ACTION',
        export_skins=False, export_morph=False,
        export_draco_mesh_compression_enable=False, export_meshopt_compression_enable=False,
        export_gpu_instances=False,
    )
    have = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    miss = [k for k in want if k not in have]
    assert not miss, f'нет параметров экспорта {miss} — это не Blender 5.x?'
    bpy.ops.export_scene.gltf(**want)
    unrequire_extensions(glb)
    zip_path = out_dir / f'{name}.zip'
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.write(glb, glb.name)
        z.write(blend, blend.name)
    for leftover in out_dir.glob(f'{name}.blend[0-9]*'):
        leftover.unlink()
    return zip_path


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    smooth_angle = 30.0
    for a in sys.argv[1:]:
        if a.startswith('--smooth-angle='):
            smooth_angle = float(a.split('=', 1)[1])
    if len(args) != 3:
        fail('использование: python tools/finalize_model.py source.glb out_dir Model_Name [--smooth-angle=30]')
    source, out_dir, name = Path(args[0]), Path(args[1]), args[2]
    out_dir.mkdir(parents=True, exist_ok=True)

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(source))
    if bpy.context.scene.render.fps != 24:
        print(f'  fps сцены {bpy.context.scene.render.fps}')
    rest, moving_names = read_source(source)
    moving = [o for o in bpy.context.scene.objects if o.name in moving_names]
    lost = moving_names - {o.name for o in moving}
    if lost:
        fail('подвижные части после импорта переименованы (повтор имени?): ' + ', '.join(sorted(lost)[:10]))
    print(f'Сборка {name}: объектов {len(bpy.context.scene.objects)}, подвижных {len(moving)}')
    root = set_root(name)
    remove_clutter()
    apply_rotation_scale(moving, rest)
    clean_meshes(smooth_angle)
    fix_textures()
    place_on_ground(root)
    ends = [int(a.frame_range[1]) for a in bpy.data.actions]
    if ends:
        bpy.context.scene.frame_start, bpy.context.scene.frame_end = 1, max(ends)
    zip_path = export(out_dir, name)
    print(f'Готово: {zip_path}\n')
    checker = Path(__file__).with_name('check_model.py')
    sys.exit(subprocess.call([sys.executable, str(checker), str(zip_path)]))


if __name__ == '__main__':
    main()
