# Конвертация .glb -> .blend: python glb2blend.py input.glb output.blend
import sys, bpy

src, dst = sys.argv[-2], sys.argv[-1]
# Чистим стартовую сцену (куб, камера, свет) вместе с их данными
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
    for block in list(coll):
        coll.remove(block)
bpy.ops.import_scene.gltf(filepath=src)
bpy.ops.file.pack_all()  # текстуры внутрь .blend
scene = bpy.context.scene
# Таймлайн под самую длинную анимацию
ends = [int(a.frame_range[1]) for a in bpy.data.actions]
if ends:
    scene.frame_start, scene.frame_end = 1, max(ends)
bpy.ops.wm.save_as_mainfile(filepath=dst, compress=True)
print("SAVED", dst)
