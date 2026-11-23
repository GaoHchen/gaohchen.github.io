import { MirroredRepeatWrapping, SRGBColorSpace, TextureLoader, Vector3 } from 'three';

// Authored in Blender's local object coordinates. Three's Y-up export maps
// Blender (x, y, z) to (x, z, -y). Keep the grain fixed as an instance moves.
function bindSwatches(material, maps, description) {
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey();
  const span = new Vector3(...description.span);
  material.vertexColors = false; // These captures baked the same base color into COLOR_0.
  material.onBeforeCompile = function (shader, renderer) {
    previous.call(this, shader, renderer);
    shader.uniforms.captureXY = { value: maps[0] };
    shader.uniforms.captureXZ = { value: maps[1] };
    shader.uniforms.captureYZ = { value: maps[2] };
    shader.uniforms.captureSpan = { value: span };
    shader.uniforms.captureRelief = { value: description.bump };
    const varyings = 'varying vec3 captureLocal;\nvarying vec3 captureNormal;\n';
    shader.vertexShader = varyings + shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      captureLocal = vec3(position.x, -position.z, position.y);
      captureNormal = vec3(normal.x, -normal.z, normal.y);
    `);
    shader.fragmentShader = varyings + `
      uniform sampler2D captureXY, captureXZ, captureYZ;
      uniform vec3 captureSpan;
      uniform float captureRelief;
    ` + shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      vec3 sampleCoord = captureLocal / captureSpan + 0.5;
      vec3 weights = pow(abs(normalize(captureNormal)), vec3(6.0));
      weights /= max(dot(weights, vec3(1.0)), 0.00001);
      vec4 swatch = texture2D(captureXY, sampleCoord.xy) * weights.z
                  + texture2D(captureXZ, sampleCoord.xz) * weights.y
                  + texture2D(captureYZ, sampleCoord.yz) * weights.x;
      diffuseColor.rgb = swatch.rgb;
    `).replace('#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      // Surface gradient of the saved Blender height, in metres. Alpha is data,
      // independent of the sRGB conversion on the three color channels.
      vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
      vec3 rx = cross(dy, normal), ry = cross(normal, dx);
      float det = dot(dx, rx);
      vec3 gradient = rx * dFdx(swatch.a) + ry * dFdy(swatch.a);
      if (abs(det) > 1e-12) normal = normalize(abs(det) * normal - captureRelief * sign(det) * gradient);
    `);
  };
  material.customProgramCacheKey = () => previousKey + '|capture-surface';
  material.needsUpdate = true;
}

export function captureSurfaceLibrary(directory, renderer) {
  const loader = new TextureLoader();
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const jobs = new Map();
  const controller = new AbortController();
  let catalog;
  function load(description) {
    if (!jobs.has(description.file)) {
      const job = Promise.allSettled(['xy', 'xz', 'yz'].map(async plane => {
        const texture = await loader.loadAsync(new URL(description.file + '-' + plane + '.webp', directory).href);
        texture.colorSpace = SRGBColorSpace;
        texture.wrapS = texture.wrapT = MirroredRepeatWrapping;
        texture.anisotropy = anisotropy;
        return texture;
      })).then(results => {
        const maps = results.filter(r => r.status === 'fulfilled').map(r => r.value);
        if (maps.length === 3 && !controller.signal.aborted) return maps;
        maps.forEach(map => map.dispose());
        throw Error('Capture material unavailable: ' + description.file);
      }).catch(error => { jobs.delete(description.file); throw error; });
      jobs.set(description.file, job);
    }
    return jobs.get(description.file);
  }
  return {
    async apply(group) {
      const materials = new Set();
      group.traverse(mesh => {
        if (mesh.isMesh) for (const material of [mesh.material].flat()) {
          if (material.isMeshStandardMaterial && !material.map) materials.add(material);
        }
      });
      if (!materials.size) return;
      try {
        catalog ||= fetch(new URL('materials.json', directory), { signal: controller.signal }).then(response => {
          if (!response.ok) throw Error('Missing capture material catalog');
          return response.json();
        }).catch(error => { catalog = null; throw error; });
        const descriptions = await catalog;
        await Promise.all([...materials].map(async material => {
          const name = material.name.split(' · native base')[0].replace(/\.\d{3}$/, '');
          const entry = Object.hasOwn(descriptions, name) && descriptions[name];
          if (entry) bindSwatches(material, await load(entry), entry);
        }));
      } catch (error) {
        if (!controller.signal.aborted) console.warn('Using archived vertex colors.', error);
      }
    },
    dispose() {
      controller.abort();
      for (const job of jobs.values()) job.then(maps => maps.forEach(map => map.dispose()), () => {});
      jobs.clear();
    },
  };
}
