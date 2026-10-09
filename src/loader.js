// Общий загрузчик glTF/GLB с поддержкой сжатия Draco и Meshopt
// (оба варианта выдаёт `gltf-transform optimize` и экспортёр Blender).
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const draco = new DRACOLoader();
draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');

export const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(draco);
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

// Включает тени у всех мешей модели.
export function enableShadows(object) {
  object.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
}
