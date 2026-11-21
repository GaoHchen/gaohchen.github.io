import { DRACOLoader } from './vendor/three/addons/loaders/DRACOLoader.js';
import {
  AnimationMixer, Box3, BufferGeometry, CanvasTexture, Color, DirectionalLight, Group, HemisphereLight, NoToneMapping,
  LineBasicMaterial, LineSegments, Matrix4, MeshBasicMaterial, PerspectiveCamera, PropertyBinding, Scene, Raycaster, Sprite, SpriteMaterial, SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { GLTFLoader } from './vendor/three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from './vendor/three/addons/controls/OrbitControls.js';

function release(group) {
  if (!group) return;
  group.removeFromParent();
  const resources = new Set();
  group.traverse(({ geometry, material }) => {
    if (geometry) resources.add(geometry);
    for (const surface of (Array.isArray(material) ? material : [material])) {
      if (!surface) continue;
      resources.add(surface);
      for (const value of Object.values(surface)) if (value?.isTexture) resources.add(value);
    }
  });
  resources.forEach(resource => resource.dispose());
}

class ReviewLoader extends GLTFLoader {
  async loadAsync(input, onProgress) {
    const url = new URL(input, document.baseURI);
    if (!url.pathname.endsWith('.pack')) return super.loadAsync(input, onProgress);
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not load ' + url.pathname);
    const bytes = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    return this.parseAsync(bytes, new URL('.', url).href);
  }
}
export function createStage(canvas, { filmPlate = false } = {}) {
  const stage = new Scene();
  const renderer = new WebGLRenderer({ canvas, alpha: filmPlate, antialias: true, preserveDrawingBuffer: filmPlate });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  const view = new PerspectiveCamera(49, 1, .026, 125);
  const controls = new OrbitControls(view, canvas);
  controls.minDistance = .12;
  controls.maxDistance = 50;
  controls.maxPolarAngle = Math.PI * .95;
  controls.zoomToCursor = true;
  const sky = new HemisphereLight(0xffffff, 0xb8b8b8, 2.2);
  const sun = new DirectionalLight(0xffffff, 1.35);
  sun.position.set(2, 5, 3);
  const fill = new DirectionalLight(0xffffff, .45);
  fill.position.set(-3, 2, -4);
  stage.add(sky, sun, fill);
  const draco = new DRACOLoader().setDecoderPath(new URL('vendor/draco/', document.baseURI).href).setWorkerLimit(2);
  const loader = new ReviewLoader().setDRACOLoader(draco);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let serial = 0;
  let descriptor, prediction, context, groundTruth, gtJob, mixer, actions = [], moving = false;
  let denseCloud, denseJob, denseEnabled = false;
  let motionSet, motionJob, animatedStatic = [], motionRevision = 0;
  let home, activeName, tween;
  let frame, previous = 0;
  const instanceTintStrength = { value: 0 };
  const instanceRoots = new Map();
  const queryRoots = new Map();
  const queryMaterials = new Map();
  let selectedRoot, replacement, selectionVersion = 0;
  const walls = [];
  const cameraWorld = new Vector3();
  const beforeRender = stage.onBeforeRender;
  stage.onBeforeRender = function (...args) {
    beforeRender.apply(this, args);
    if (!walls.length) return;
    args[2].getWorldPosition(cameraWorld);
    for (const { node, nx, nz, distance, inside, ceiling } of walls) {
      node.visible = ceiling !== undefined ? cameraWorld.y < ceiling - .08
        : inside * (nx * cameraWorld.x + nz * cameraWorld.z - distance) > .12;
    }
  };
  const originalSurfaces = new Map();
  const tintedSurfaces = new Set();

  function redraw() {
    if (!frame && !canvas.hidden && !document.hidden && prediction) frame = requestAnimationFrame(render);
  }
  function render(now) {
    frame = null;
    if (!prediction || canvas.hidden || document.hidden) return;
    const { width, height } = canvas.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    const pixelRatio = Math.min(devicePixelRatio || 1, 1.65);
    if (canvas.width !== Math.floor(width * pixelRatio) || canvas.height !== Math.floor(height * pixelRatio)) {
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
      view.aspect = width / height;
      view.updateProjectionMatrix();
    }
    if (moving) mixer.update(previous ? Math.min(.05, (now - previous) / 1000) : 0);
    previous = now;
    if (tween) {
      const value = Math.min(1, (now - tween.start) / 530);
      const eased = value * value * (3 - 2 * value);
      view.position.lerpVectors(tween.fromEye, tween.eye, eased);
      controls.target.lerpVectors(tween.fromTarget, tween.target, eased);
      view.lookAt(controls.target);
      if (value === 1) {
        tween = null;
        controls.update();
      }
    }
    renderer.render(stage, view);
    if (tween || moving) redraw();
  }
  const resize = new ResizeObserver(redraw);
  resize.observe(canvas.parentElement);
  document.addEventListener('visibilitychange', redraw);
  controls.addEventListener('change', redraw);
  controls.addEventListener('start', () => { tween = null; });

  function look(eye, target, motion = false) {
    if (motion && !reduce.matches) {
      tween = { start: performance.now(), fromEye: view.position.clone(), fromTarget: controls.target.clone(), eye, target };
    } else {
      tween = null;
      view.position.copy(eye);
      controls.target.copy(target);
      controls.update();
    }
    redraw();
  }

  function fitted(visible, offset, factor) {
    const center = visible.getCenter(new Vector3());
    const dimensions = visible.getSize(new Vector3());
    const length = Math.max(.25, dimensions.x, dimensions.y, dimensions.z);
    return { eye: center.clone().addScaledVector(offset, length * factor), target: center };
  }
  let cameraPins;
  function fitGallery(angle = 'corner') {
    const bounds = [];
    prediction.updateWorldMatrix(true, true);
    prediction.traverse(({ geometry, matrixWorld }) => {
      if (!geometry) return;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      bounds.push(geometry.boundingBox.clone().applyMatrix4(matrixWorld));
    });
    if (cameraPins?.visible) bounds.push(new Box3().setFromObject(cameraPins));
    const extent = bounds.reduce((box, asset) => box.union(asset), new Box3());
    const target = extent.getCenter(new Vector3());
    const size = extent.getSize(new Vector3());
    const alongZ = size.z > size.x;
    const direction = new Vector3(alongZ ? 1.42 : .4, .93, alongZ ? .4 : 1.42);
    if (descriptor.kind === 'queryRoom') {
      direction.fromArray(descriptor.eye).sub(new Vector3(...descriptor.target));
      direction.y = Math.max(direction.y, .45 * Math.hypot(direction.x, direction.z));
    }
    if (angle === 'side') direction.set(alongZ ? 0 : 1, .31, alongZ ? 1 : 0);
    if (angle === 'overhead') direction.set(0, 1, .045);
    direction.normalize();
    const right = view.up.clone().cross(direction).normalize();
    const up = direction.clone().cross(right);
    const { width, height } = canvas.parentElement.getBoundingClientRect();
    const aspect = width && height ? width / height : 16 / 9;
    const tangent = Math.tan(view.fov * Math.PI / 360);
    let distance = .35;
    for (const { min, max } of bounds) {
      for (const x of [min.x, max.x]) {
        for (const y of [min.y, max.y]) {
          for (const z of [min.z, max.z]) {
            const point = new Vector3(x, y, z).sub(target);
            const span = Math.max(Math.abs(point.dot(up)), Math.abs(point.dot(right)) / aspect);
            distance = Math.max(distance, point.dot(direction) + 1.16 * span / tangent);
          }
        }
      }
    }
    return { target, eye: target.clone().addScaledVector(direction, distance) };
  }
  function frameRoom(angle = 'corner') {
    if (!prediction || descriptor?.kind !== 'gallery' || activeName) return;
    const pose = fitGallery(angle);
    look(pose.eye, pose.target, true);
  }

  function makeCameraPins() {
    const pins = new Group();
    const extent = new Box3().setFromObject(prediction).getSize(new Vector3());
    const size = Math.max(.08, Math.min(.55, extent.length() * .038));
    const corners = [[-.64,-.42,1],[.64,-.42,1],[.64,.42,1],[-.64,.42,1]];
    const edges = [];
    corners.forEach((corner, i) => edges.push(new Vector3(), new Vector3(...corner),
      new Vector3(...corner), new Vector3(...corners[(i + 1) % 4])));
    const lines = new BufferGeometry().setFromPoints(edges);
    const ink = new LineBasicMaterial({color: '#386f84', depthTest: false, depthWrite: false});
    descriptor.cameraViews.forEach((pose, index) => {
      if (!pose?.eye || !pose.target) return;
      const pin = new Group();
      pin.position.fromArray(pose.eye);
      pin.lookAt(new Vector3(...pose.target));
      pin.scale.setScalar(size);
      const wire = new LineSegments(lines, ink);
      wire.renderOrder = 8;
      pin.add(wire);
      const label = document.createElement('canvas');
      label.width = label.height = 96;
      const ctx = label.getContext('2d');
      ctx.beginPath(); ctx.arc(48,48,42,0,2*Math.PI);
      ctx.fillStyle = '#1b3f48'; ctx.fill();
      ctx.strokeStyle = '#f9f6ed'; ctx.lineWidth = 5; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = '600 44px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(index + 1),48,50);
      const texture = new CanvasTexture(label);
      texture.colorSpace = SRGBColorSpace;
      const badge = new Sprite(new SpriteMaterial({map: texture, depthTest:false, depthWrite:false}));
      badge.scale.setScalar(.96);
      badge.renderOrder = 9;
      badge.userData.inputCamera = index;
      pin.add(badge);
      pins.add(pin);
    });
    stage.add(pins);
    return pins;
  }

  function setCameraPositions(enabled) {
    if (descriptor?.kind !== 'gallery' || !prediction || !descriptor.cameraViews?.some(p => p?.eye && p.target)) return false;
    if (enabled && !cameraPins) cameraPins = makeCameraPins();
    if (cameraPins) cameraPins.visible = enabled && !activeName;
    if (enabled) frameRoom();
    redraw();
    return Boolean(cameraPins?.visible);
  }

  const picking = new AbortController();
  let pointerStart;
  canvas.addEventListener('pointerdown', event => {
    pointerStart = event.isPrimary && event.button === 0 && (cameraPins?.visible || queryRoots.size)
      ? {id:event.pointerId, x:event.clientX, y:event.clientY} : null;
  }, {signal:picking.signal});
  canvas.addEventListener('pointerup', event => {
    const start = pointerStart;
    pointerStart = null;
    if (start?.id !== event.pointerId || Math.hypot(event.clientX-start.x, event.clientY-start.y)>5) return;
    const rect = canvas.getBoundingClientRect();
    const ray = new Raycaster();
    ray.setFromCamera({x:2*(event.clientX-rect.left)/rect.width-1, y:1-2*(event.clientY-rect.top)/rect.height}, view);
    if (queryRoots.size) {
      const visible = [...queryRoots.values()].filter(root => root.visible);
      if (replacement) visible.push(replacement);
      let node = ray.intersectObjects(visible, true)[0]?.object;
      while (node && !node.userData.queryInstance) node = node.parent;
      if (node) canvas.dispatchEvent(new CustomEvent('album-instance-pick', {
        detail: { room: descriptor.sceneId, instance: node.userData.queryInstance },
      }));
      return;
    }
    if (!cameraPins?.visible) return;
    const badges = cameraPins.children.map(pin => pin.children[1]);
    const hit = ray.intersectObjects(badges, false)[0];
    if (hit) canvas.dispatchEvent(new CustomEvent('album-camera-pick',
      {detail: {scene: descriptor.sceneId, index: hit.object.userData.inputCamera}}));
  }, {signal:picking.signal});

  function setHome(model, room) {
    view.fov = model.fov || 49;
    view.updateProjectionMatrix();
    if (model.kind === 'gallery' || model.kind === 'queryRoom') home = fitGallery();
    else if (model.eye && model.target) home = { eye: new Vector3(...model.eye), target: new Vector3(...model.target) };
    else home = fitted(new Box3().setFromObject(prediction),
      new Vector3(1, room ? .82 : .48, 1.42).normalize(), room ? 1.36 : 1.52);
    look(home.eye, home.target);
  }
  function addPrediction(object, transform) {
    prediction = object;
    if (transform) prediction.applyMatrix4(new Matrix4().fromArray(transform));
    stage.add(prediction);
  }
  function colorInstances(parser, assets, colors) {
    const byName = new Map();
    prediction.traverse(node => {
      const index = parser.associations.get(node)?.nodes;
      // Multi-scene capture files can lose associations when empty scenes load.
      const name = parser.json.nodes[index]?.name || node.userData.name;
      if (name) byName.set(name, node);
    });
    for (const [index, asset] of assets.entries()) {
      const roots = (asset.parts || [asset.name]).map(name => byName.get(name)).filter(Boolean);
      if (!roots.length) continue;
      instanceRoots.set(asset.name, new Set(roots));
      const tint = new Color(colors[index % colors.length]);
      const copies = new Map();
      const shade = original => {
        if (copies.has(original)) return copies.get(original);
        const surface = original.clone();
        surface.onBeforeCompile = (shader, drawing) => {
          original.onBeforeCompile(shader, drawing);
          shader.uniforms.albumInstanceTint = { value: tint };
          shader.uniforms.albumInstanceStrength = instanceTintStrength;
          const fragment = shader.fragmentShader.replace('#include <color_fragment>', `
            #include <color_fragment>
            float albumBase = clamp(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
            diffuseColor.rgb = mix(diffuseColor.rgb, albumInstanceTint * (0.52 + 0.48 * albumBase), albumInstanceStrength);
          `).replace('#include <emissivemap_fragment>', `
            #include <emissivemap_fragment>
            float albumEmission = dot(totalEmissiveRadiance, vec3(0.2126, 0.7152, 0.0722));
            totalEmissiveRadiance = mix(totalEmissiveRadiance, albumInstanceTint * (0.10 + albumEmission), albumInstanceStrength);
          `);
          shader.fragmentShader = `
            uniform vec3 albumInstanceTint;
            uniform float albumInstanceStrength;
            ${fragment}
          `;
        };
        surface.customProgramCacheKey = () => original.customProgramCacheKey() + '|instance-tint';
        copies.set(original, surface);
        tintedSurfaces.add(surface);
        return surface;
      };
      for (const root of roots) root.traverse(node => {
        if (!node.isMesh || !node.material || originalSurfaces.has(node)) return;
        originalSurfaces.set(node, node.material);
        node.material = Array.isArray(node.material) ? node.material.map(shade) : shade(node.material);
      });
    }
  }
  function setInstanceHighlight(enabled) {
    instanceTintStrength.value = enabled ? .68 : 0;
    redraw();
  }
  function registerCutaway(node, center) {
    if (node.userData.cutawayCeiling !== undefined) {
      walls.push({node, ceiling: node.userData.cutawayCeiling});
    } else if (node.userData.cutawayPlane) {
      const [nx, nz, distance] = node.userData.cutawayPlane;
      const inside = Math.sign(nx * center.x + nz * center.z - distance);
      if (inside) walls.push({node, nx, nz, distance, inside});
    }
  }
  async function setDenseBackground(enabled) {
    denseEnabled = enabled;
    if (denseCloud) denseCloud.visible = enabled && !activeName;
    redraw();
    if (!enabled || !descriptor?.denseBackground || !prediction) return false;
    if (denseCloud) return true;
    const opened = serial;
    if (!denseJob) {
      denseJob = loader.loadAsync(descriptor.denseBackground).then(({scene: cloud}) => {
        if (opened !== serial) { release(cloud); return; }
        const bounds = new Box3().setFromObject(prediction);
        const center = bounds.getCenter(new Vector3());
        const halfExtent = bounds.getSize(new Vector3()).multiplyScalar(.5);
        const floor = cloud.userData.floorHeight ?? new Box3().setFromObject(cloud).min.y;
        cloud.traverse(node => {
          registerCutaway(node, center);
          if (!node.isPoints) return;
          const material = node.material;
          material.size = .062;
          material.sizeAttenuation = true;
          material.toneMapped = false;
          material.onBeforeCompile = shader => {
            shader.uniforms.roomCenter = {value: center};
            shader.uniforms.roomHalfExtent = {value: halfExtent};
            shader.uniforms.roomFloor = {value: floor};
            shader.vertexShader = `uniform vec3 roomCenter, roomHalfExtent;
              uniform float roomFloor;
            ` + shader.vertexShader.replace('#include <logdepthbuf_vertex>', `
              gl_PointSize = clamp(gl_PointSize, 1.2 * size / 0.062, 4.0 * size / 0.062);
              vec3 sampleWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
              vec2 eyeOffset = cameraPosition.xz - roomCenter.xz;
              float eyeDistance = length(eyeOffset);
              vec2 towardsEye = eyeOffset / max(eyeDistance, 0.001);
              float extent = dot(abs(towardsEye), roomHalfExtent.xz);
              float ahead = dot(sampleWorld.xz - roomCenter.xz, towardsEye);
              // Outside the room, open the near side while keeping its floor.
              if (eyeDistance > extent + 0.5 && ahead > 0.27 * extent + 0.1 && sampleWorld.y > roomFloor + 0.18)
                gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
              #include <logdepthbuf_vertex>`);
            shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `
              if (distance(gl_PointCoord, vec2(0.5)) > 0.5) discard;
              #include <clipping_planes_fragment>`);
          };
        });
        denseCloud = cloud;
        cloud.visible = denseEnabled && !activeName;
        stage.add(cloud);
        redraw();
      }).finally(() => { if (serial === opened) denseJob = null; });
    }
    await denseJob;
    return opened === serial && denseEnabled && Boolean(denseCloud);
  }
  function addRoomContext(object) {
    context = object;
    if (!context) return;
    const center = new Box3().setFromObject(prediction).getCenter(new Vector3());
    context.traverse(node => {
      if (descriptor.kind === 'room') registerCutaway(node, center);
      const surfaces = [node.material].flat().filter(Boolean);
      if (node.isMesh && node.geometry.hasAttribute('color') && surfaces.every(material => !material.map)) {
        surfaces.forEach(material => material.dispose());
        node.material = new MeshBasicMaterial({ vertexColors: true, side: surfaces[0]?.side });
      }
      for (const material of [node.material].flat().filter(Boolean)) {
        if (material.isMeshBasicMaterial || material.isPointsMaterial) material.toneMapped = false;
        if (node.isPoints) {
          material.size = .023;
          material.sizeAttenuation = true;
        }
      }
    });
    stage.add(context);
  }
  function clear() {
    serial++;
    selectionVersion++;
    restoreQueryInstance();
    queryRoots.clear();
    walls.length = 0;
    if (cameraPins) {
      // All sprites share Three's built-in quad. Only the frusta own geometry.
      cameraPins.traverse(node => { if (node.isSprite) { node.material.map.dispose(); node.material.dispose(); } });
      const wire = cameraPins.children[0]?.children[0];
      if (wire) { wire.geometry.dispose(); wire.material.dispose(); }
      cameraPins.removeFromParent();
      cameraPins = null;
    }
    if (frame) cancelAnimationFrame(frame);
    frame = null;
    motionRevision++;
    for (const [node, original] of originalSurfaces) node.material = original;
    for (const surface of tintedSurfaces) surface.dispose();
    originalSurfaces.clear();
    tintedSurfaces.clear();
    instanceRoots.clear();
    for (const node of [prediction, context, groundTruth, motionSet, denseCloud]) release(node);
    denseCloud = denseJob = null;
    denseEnabled = false;
    prediction = context = groundTruth = gtJob = mixer = home = activeName = tween = null;
    motionSet = motionJob = null;
    animatedStatic = [];
    actions = [];
    moving = false;
    previous = 0;
    renderer.renderLists.dispose();
  }
  async function open(model) {
    clear();
    descriptor = model;
    const opened = serial;
    const surroundings = model.environment || model.capture;
    const [result, shell, observation] = await Promise.allSettled([
      loader.loadAsync(model.prediction),
      surroundings && loader.loadAsync(surroundings),
      model.observation && loader.loadAsync(model.observation),
    ]);
    const needsRoom = model.kind === 'placement' && !shell.value?.scene;
    if (opened !== serial || result.status === 'rejected' || needsRoom || observation.status === 'rejected') {
      if (result.status === 'fulfilled') release(result.value.scene);
      if (shell.status === 'fulfilled') release(shell.value?.scene);
      if (observation.status === 'fulfilled') release(observation.value?.scene);
      if (opened === serial) throw result.reason || shell.reason || observation.reason || Error('The registered room is unavailable');
      return null;
    }
    addPrediction(result.value.scene, model.matrix);
    if (model.kind === 'queryRoom') {
      const slots = new Map(prediction.children.map(root => [root.userData.prompt, root]));
      if (observation.value) prediction.add(observation.value.scene);
      for (const item of model.instances) {
        const root = item.observation ? observation.value.scene : slots.get(item.slot);
        if (!root) throw Error('Missing saved room instance: ' + item.id);
        root.userData.queryInstance = item.id;
        queryRoots.set(item.id, root);
      }
    }
    if (model.kind === 'gallery' && model.instanceColors?.length) {
      colorInstances(result.value.parser, model.assets || [], model.instanceColors);
      setInstanceHighlight(Boolean(model.highlightInstances));
    }
    addRoomContext(shell.status === 'fulfilled' && shell.value?.scene || null);
    const room = ['room', 'dataset', 'placement', 'gallery', 'queryRoom'].includes(model.kind);
    stage.background = filmPlate ? null : new Color(room ? '#d9d9d0' : '#e0e2df');
    const clips = result.value.animations;
    if (clips.length) {
      mixer = new AnimationMixer(prediction);
      actions = clips.map(clip => mixer.clipAction(clip));
    }
    setHome(model, room);
    return { capture: Boolean(context), hasJoints: Boolean(mixer || model.motion), instanceCount: queryRoots.size };
  }
  function restoreQueryInstance() {
    const copies = new Set();
    for (const [mesh, original] of queryMaterials) {
      for (const m of [mesh.material].flat()) copies.add(m);
      mesh.material = original;
    }
    copies.forEach(m => m.dispose());
    queryMaterials.clear();
    if (replacement) release(replacement);
    if (selectedRoot) selectedRoot.visible = true;
    replacement = selectedRoot = null;
  }
  function highlightQueryRoot(root) {
    const copies = new Map();
    function highlight(original) {
      if (copies.has(original)) return copies.get(original);
      const material = original.clone();
      material.onBeforeCompile = (shader, renderer) => {
        original.onBeforeCompile(shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
          float lightness = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
          outgoingLight = mix(outgoingLight, vec3(0.035, 0.56, 1.0) * (0.7 + 0.3 * clamp(lightness, 0.0, 1.0)), 0.86);
          #include <opaque_fragment>`);
      };
      material.customProgramCacheKey = () => original.customProgramCacheKey() + '|query-selection';
      copies.set(original, material);
      return material;
    }
    root.traverse(mesh => {
      if (!mesh.isMesh) return;
      queryMaterials.set(mesh, mesh.material);
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(highlight) : highlight(mesh.material);
    });
  }
  async function selectInstance(sceneId, id, candidate) {
    if (descriptor?.kind !== 'queryRoom' || descriptor.sceneId !== sceneId) return false;
    const revision = ++selectionVersion;
    restoreQueryInstance();
    let root = queryRoots.get(id);
    if (id && !root) throw Error('Unknown room instance: ' + id);
    selectedRoot = root;
    if (candidate && root) {
      redraw();
      const { scene } = await loader.loadAsync(candidate.prediction);
      if (revision !== selectionVersion) { release(scene); return false; }
      scene.applyMatrix4(new Matrix4().fromArray(candidate.matrix));
      scene.userData.queryInstance = id;
      replacement = scene;
      stage.add(scene);
      root.visible = false;
      root = scene;
    }
    if (root) highlightQueryRoot(root);
    redraw();
    return true;
  }
  async function place(model) {
    const positioned = { ...model, kind: 'placement' };
    if (descriptor?.kind !== 'placement' || !context || descriptor.environment !== model.environment) {
      return open(positioned);
    }
    const requested = ++serial;
    const { scene } = await loader.loadAsync(model.prediction);
    if (requested !== serial) { release(scene); return null; }
    const newPoint = descriptor.promptKey !== model.promptKey;
    release(prediction);
    addPrediction(scene, model.matrix);
    descriptor = positioned;
    if (newPoint) setHome(positioned, true);
    redraw();
    return { capture: true };
  }
  function focus(name) {
    if (!prediction) return false;
    if (activeName) prediction.traverse(node => { if (node.userData.albumVisibility !== undefined) {
      node.visible = node.userData.albumVisibility;
      delete node.userData.albumVisibility;
    } });
    activeName = null;
    if (!name) {
      if (context) context.visible = true;
      if (denseCloud) denseCloud.visible = denseEnabled;
      look(home.eye, home.target, true);
      return true;
    }
    const selected = prediction.getObjectByName(name) || prediction.getObjectByName(PropertyBinding.sanitizeNodeName(name));
    const roots = instanceRoots.get(name) || (selected && new Set([selected]));
    if (!roots) return false;
    activeName = name;
    prediction.traverse(node => {
      if (!node.isMesh && !node.isPoints) return;
      for (let ancestor = node; ancestor; ancestor = ancestor.parent) if (roots.has(ancestor)) return;
      node.userData.albumVisibility = node.visible;
      node.visible = false;
    });
    if (context) context.visible = false;
    if (denseCloud) denseCloud.visible = false;
    const inspectDirection = descriptor?.assets?.find(asset => asset.name === name)?.inspectDirection;
    const angle = inspectDirection ? new Vector3(...inspectDirection) : view.position.clone().sub(controls.target);
    if (!inspectDirection) angle.y = Math.max(.25, Math.hypot(angle.x, angle.z) * .24);
    const bounds = new Box3();
    for (const root of roots) bounds.expandByObject(root);
    const focused = fitted(bounds, angle.normalize(), inspectDirection ? 1.9 : 1.6);
    look(focused.eye, focused.target, true);
    return true;
  }
  function reset() {
    if (!home) return;
    if (context) context.visible = !activeName;
    if (activeName) focus(activeName);
    else look(home.eye, home.target, true);
  }
  async function setGroundTruth(enabled) {
    if (!enabled) {
      if (groundTruth) groundTruth.visible = false;
      redraw();
      return false;
    }
    if (!descriptor?.groundTruth) return false;
    const opened = serial;
    gtJob ||= loader.loadAsync(descriptor.groundTruth).then(({ scene }) => {
      if (serial !== opened) {
        release(scene);
        return null;
      }
      groundTruth = new Group();
      const overlay = new MeshBasicMaterial({ color: '#2f999c', transparent: true, opacity: .43,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false });
      scene.updateMatrixWorld(true);
      scene.traverse(node => {
        if (!node.isMesh) return;
        const mesh = node.clone(false);
        mesh.geometry = node.geometry.clone();
        mesh.material = overlay;
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(node.matrixWorld);
        groundTruth.add(mesh);
      });
      release(scene);
      groundTruth.visible = false;
      stage.add(groundTruth);
      return groundTruth;
    }).catch(error => {
      if (opened === serial) gtJob = null;
      throw error;
    });
    const overlay = await gtJob;
    if (overlay && serial === opened) {
      overlay.visible = true;
      redraw();
    }
    return Boolean(overlay);
  }
  async function animateJoints(enabled) {
    const requested = ++motionRevision;
    if (enabled && descriptor?.motion && !motionSet) {
      const opened = serial;
      motionJob ||= loader.loadAsync(descriptor.motion).then(result => {
        if (serial !== opened) { release(result.scene); return; }
        const animated = [];
        result.scene.traverse(node => {
          const { articulated_reference: reference, articulated_slot: slot } = node.userData;
          if (slot === undefined) return;
          const counterpart = [];
          prediction.traverse(item => {
            if (String(item.userData.reference) === reference && item.userData.prompt === slot + 1) counterpart.push(item);
          });
          if (counterpart.length === 1) animated.push(counterpart[0]);
          else node.visible = false;
        });
        motionSet = result.scene;
        motionSet.visible = false;
        stage.add(motionSet);
        animatedStatic = animated;
        mixer = new AnimationMixer(motionSet);
        actions = result.animations.map(clip => mixer.clipAction(clip));
      }).catch(error => {
        if (serial === opened) motionJob = null;
        throw error;
      });
      await motionJob;
    }
    if (!mixer || requested !== motionRevision) return false;
    actions.forEach(action => enabled ? action.reset().play() : action.stop());
    if (motionSet) {
      motionSet.visible = enabled;
      for (const asset of animatedStatic) asset.visible = !enabled;
    }
    moving = enabled;
    previous = 0;
    redraw();
    return moving;
  }
  function zoom(amount) {
    if (!home) return;
    const offset = view.position.clone().sub(controls.target);
    offset.setLength(Math.max(.14, Math.min(45, offset.length() * amount)));
    look(controls.target.clone().add(offset), controls.target);
  }
  function focusPlacement() {
    const object = descriptor?.kind === 'queryRoom' ? replacement || selectedRoot
      : descriptor?.kind === 'placement' ? prediction : null;
    if (!object) return;
    const direction = view.position.clone().sub(controls.target).normalize();
    const focused = fitted(new Box3().setFromObject(object), direction, 1.45);
    look(focused.eye, focused.target, true);
  }
  canvas.tabIndex = 0;
  canvas.addEventListener('keydown', event => {
    if (!home) return;
    const key = event.key.toLowerCase();
    if (!['w', 'a', 's', 'd', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'home', '+', '=', '-'].includes(key)) return;
    event.preventDefault();
    if (key === 'home') { reset(); return; }
    if (['+', '=', '-'].includes(key)) { zoom(key === '-' ? 1.18 : 1 / 1.18); return; }
    const eye = view.position.clone();
    const target = controls.target.clone();
    const direction = target.clone().sub(eye).normalize();
    const right = direction.clone().cross(view.up).normalize();
    if (key.startsWith('arrow')) {
      const offset = key === 'arrowleft' ? right.multiplyScalar(-.16) : key === 'arrowright' ? right.multiplyScalar(.16)
        : new Vector3(0, key === 'arrowup' ? .16 : -.16, 0);
      target.add(offset);
    } else {
      const ahead = direction.setY(0).normalize();
      const offset = (key === 'w' || key === 's' ? ahead : right).multiplyScalar(key === 's' || key === 'a' ? -.23 : .23);
      eye.add(offset);
      target.add(offset);
    }
    look(eye, target);
  });

  return {
    open, place, clear, focusPlacement, selectInstance,
    focus(name) { const result = focus(name); if (context && !name) context.visible = true; return result; },
    reset, zoom, redraw, frameRoom, setCameraPositions, setGroundTruth, setDenseBackground, animateJoints, setInstanceHighlight,
    showCamera(position) {
      if (home && position?.eye && position?.target) look(new Vector3(...position.eye), new Vector3(...position.target), true);
    },
    renderView(position) {
      if (filmPlate) {
        moving = false;
        view.fov = position.fov;
        view.updateProjectionMatrix();
        mixer?.setTime(position.motionTime);
      }
      if (position?.eye && position?.target) look(new Vector3(...position.eye), new Vector3(...position.target));
      if (frame) cancelAnimationFrame(frame);
      render(performance.now());
    },
    dispose() {
      draco.dispose();
      clear();
      stage.onBeforeRender = beforeRender;
      picking.abort();
      resize.disconnect();
      document.removeEventListener('visibilitychange', redraw);
      controls.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
