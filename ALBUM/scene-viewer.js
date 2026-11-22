'use strict';

(() => {
  const inFlight = new Map();
  const hexColor = value => /^#[0-9a-f]{6}$/i.test(value)
    ? [1, 3, 5].map(index => Number.parseInt(value.slice(index, index + 2), 16) / 255)
    : null;
  const defaultInstanceColors = [
    '#58acda', '#ee9665', '#74cdad', '#bf89e6', '#eec762', '#e782a7', '#93a6ed', '#afd978',
  ].map(hexColor);

  function fetchScene(file, key) {
    if (inFlight.has(file)) return inFlight.get(file);
    const request = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = file;
      script.onload = () => {
        const data = window.INSTANCE3R_SCENES?.[key];
        if (data) {
          delete window.INSTANCE3R_SCENES[key];
          resolve(data);
        } else {
          reject(Error('The scene file has no geometry for ' + key));
        }
        script.remove();
      };
      script.onerror = () => {
        script.remove();
        reject(Error('The scene geometry could not be loaded'));
      };
      document.head.append(script);
    }).finally(() => inFlight.delete(file));
    inFlight.set(file, request);
    return request;
  }

  function createViewer(canvas) {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    const gl = canvas.getContext('webgl', { antialias: true, alpha: true });
    const uintIndices = gl?.getExtension('OES_element_index_uint');
    const add = (a, b) => a.map((v, i) => v + b[i]);
    const sub = (a, b) => a.map((v, i) => v - b[i]);
    const scale = (a, s) => a.map(v => v * s);
    const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const norm = a => scale(a, 1 / (Math.hypot(...a) || 1));
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const mix = (a, b, t) => a + (b - a) * t;
    const ease = t => t * t * (3 - 2 * t);

    function makeProgram(vertex, fragment, names, uniforms) {
      const program = gl.createProgram();
      for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
        gl.attachShader(program, shader);
        gl.deleteShader(shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
      return {
        handle: program,
        attr: Object.fromEntries(names.map(name => [name, gl.getAttribLocation(program, name)])),
        uniform: Object.fromEntries(uniforms.map(name => [name, gl.getUniformLocation(program, name)])),
      };
    }

    const cameraShader = `
      uniform mat4 view;
      uniform vec4 projection;
      uniform float orthographic;
      vec4 project(vec3 position) {
        vec4 p = view * vec4(position, 1.0);
        return vec4(projection.x*p.x, projection.y*p.y, projection.z*p.z+projection.w, mix(-p.z, 1.0, orthographic));
      }`;
    let pointProgram, meshProgram;
    const identityPose = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const identityNormal = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

    function init() {
      pointProgram = makeProgram(`
        attribute vec3 xyz;
        attribute vec3 color;
        attribute float value;
        uniform float pixelScale;
        uniform bool useColor;
        uniform vec4 hiddenObject;
        ${cameraShader}
        varying vec3 tint;
        void main() {
          gl_Position = project(xyz);
          float size = mix(0.95 + 4.5 / max(1.0, gl_Position.w), 2.5, orthographic);
          gl_PointSize = clamp(pixelScale * size, 1.4, 8.0);
          if (useColor && (gl_Position.w < .19 || distance(xyz, hiddenObject.xyz) < hiddenObject.w)) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          }
          tint = useColor ? color : vec3((0.30 + 0.61 * value) / (1.0 + 0.031 * max(0.0, gl_Position.w)));
        }`, `
        precision mediump float;
        varying vec3 tint;
        uniform float opacity;
        uniform float brightness;
        void main() {
          float d = distance(gl_PointCoord, vec2(0.5));
          if (d > 0.5) discard;
          gl_FragColor = vec4(tint * brightness, opacity * (1.0 - smoothstep(0.26, 0.5, d)));
        }`, ['xyz', 'value', 'color'], ['view', 'projection', 'orthographic', 'pixelScale', 'opacity', 'brightness', 'useColor', 'hiddenObject']);
      meshProgram = makeProgram(`
        attribute vec3 xyz;
        attribute vec3 normal;
        attribute vec3 color;
        uniform vec4 position;
        uniform mat4 jointPose;
        uniform mat3 jointNormal;
        uniform vec3 instanceTint;
        uniform float instanceMix;
        ${cameraShader}
        varying vec3 rgb;
        void main() {
          gl_Position = project((jointPose * vec4(xyz * position.w + position.xyz, 1.0)).xyz);
          vec3 n = normalize(jointNormal * normal);
          vec3 light = normalize(vec3(0.25, -0.62, 0.74));
          float key = max(0.0, dot(n, light));
          float fill = max(0.0, dot(n, vec3(-0.72, 0.55, 0.4)));
          float detail = dot(color, vec3(0.2126, 0.7152, 0.0722));
          vec3 base = mix(color, instanceTint * (0.52 + 0.48 * detail), instanceMix);
          rgb = base * (0.64 + key*0.37 + fill*0.17) + vec3(0.028);
        }`, `
        precision mediump float;
        varying vec3 rgb;
        uniform float opacity;
        void main() { gl_FragColor = vec4(rgb, opacity); }
        `, ['xyz', 'normal', 'color'], ['view', 'projection', 'orthographic', 'position', 'jointPose', 'jointNormal', 'opacity', 'instanceTint', 'instanceMix']);
      gl.clearColor(0, 0, 0, 0);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    function readBytes(encoded) {
      const decoded = atob(encoded);
      const raw = new Uint8Array(decoded.length);
      for (let i = 0; i < raw.length; i++) raw[i] = decoded.charCodeAt(i);
      return raw;
    }
    function buffer(encoded, target = gl.ARRAY_BUFFER) {
      const raw = readBytes(encoded);
      const handle = gl.createBuffer();
      gl.bindBuffer(target, handle);
      gl.bufferData(target, raw, gl.STATIC_DRAW);
      return { handle, bytes: raw.length };
    }
    function packedMesh(asset) {
      if (asset.indexBytes === 4 && !uintIndices) throw Error('This browser cannot display large indexed meshes');
      return {
        ...asset, xyz: buffer(asset.xyz), normal: buffer(asset.normal), color: buffer(asset.color),
        index: asset.index ? buffer(asset.index, gl.ELEMENT_ARRAY_BUFFER) : null,
      };
    }
    function prepare(dataset) {
      const packedCloud = entry => entry && ({
        xyz: buffer(entry.xyz), value: entry.value && buffer(entry.value), rgb: entry.rgb && buffer(entry.rgb),
      });
      return {
        ...dataset,
        observation: packedCloud(dataset.observation),
        background: packedCloud(dataset.background),
        roomPoints: packedCloud(dataset.roomPoints),
        assets: dataset.assets.map(packedMesh),
      };
    }
    function bindAttribute(slot, item, size, type, normalized = false) {
      gl.bindBuffer(gl.ARRAY_BUFFER, item.handle);
      gl.vertexAttribPointer(slot, size, type, normalized, 0, 0);
      gl.enableVertexAttribArray(slot);
    }

    let dataset;
    let current;
    let camera;
    let activeObject = 0;
    let placementAnchor;
    let mode = 'assembly';
    let frame;
    let animation;
    let jointMotion;
    let jointStarted = null;
    let highlightInstances = false;
    let instanceColors = defaultInstanceColors;
    let revision = 0;
    let weights = { scan: 0, assembly: 1, instance: 0 };
    function orthographicDistance() {
      return Math.hypot(...sub(dataset.camera, dataset.focus));
    }
    function projectionLens(aspect) {
      const field = current.roomView ? Math.max(dataset.fov, dataset.orthoScale ? 1.07 : .76) : dataset.fov;
      return Math.min(1, aspect / 1.55) / Math.tan(field / 2);
    }
    function assetOverview(azimuth, elevation = .53) {
      const bounds = dataset.assets.map(({ bounds, center, radius }) =>
        bounds || [center.map(value => value - radius), center.map(value => value + radius)]);
      const target = [0, 1, 2].map(axis =>
        (Math.min(...bounds.map(([low]) => low[axis])) + Math.max(...bounds.map(([, high]) => high[axis]))) / 2);
      const outward = [Math.cos(elevation) * Math.cos(azimuth), Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation)];
      const right = norm(cross([0, 0, 1], outward));
      const up = cross(outward, right);
      const { width, height } = canvas.parentElement.getBoundingClientRect();
      const aspect = width && height ? width / height : 16 / 9;
      const lens = projectionLens(aspect);
      let distance = .35;
      for (const [[left, back, low], [rightEdge, front, high]] of bounds) {
        for (const x of [left, rightEdge]) {
          for (const y of [back, front]) {
            for (const z of [low, high]) {
              const point = sub([x, y, z], target);
              const span = Math.max(Math.abs(dot(point, right)), Math.abs(dot(point, up)) * aspect);
              distance = Math.max(distance, dot(point, outward) + 1.16 * lens * span);
            }
          }
        }
      }
      return { target, distance, azimuth, elevation };
    }
    function sceneCamera() {
      const ortho = Boolean(dataset.orthoScale);
      const distance = ortho ? orthographicDistance() : 3.8;
      const from = dataset.camera;
      const target = add(from, scale(dataset.direction, distance));
      const toward = scale(dataset.direction, -1);
      const azimuth = Math.atan2(toward[1], toward[0]) + (current.yaw || 0);
      if (current.assetsOnly && dataset.assets.length) return assetOverview(azimuth);
      if (current.roomView) {
        if (current.singlePlacement && dataset.assets[activeObject]) {
          const asset = dataset.assets[activeObject];
          const depth = clamp(asset.radius * 3.05 + .75, 1.7, 4.6);
          const target = add(asset.center, [0, 0, Math.min(.34, asset.radius * .31)]);
          const fromCapture = sub(from, target);
          const angle = current.captureView ? Math.atan2(fromCapture[1], fromCapture[0]) : azimuth;
          return { target, distance: depth, azimuth: angle, elevation: .25 };
        }
        if (current.captureView) {
          const direction = dataset.direction;
          const forward = norm([direction[0], direction[1], Math.max(-.23, direction[2])]);
          return { target: add(from, scale(forward, 3.8)), distance: 3.8,
            azimuth: Math.atan2(-forward[1], -forward[0]), elevation: Math.asin(-forward[2]) };
        }
        const center = dataset.viewport?.target || dataset.focus || target;
        const span = dataset.orthoScale || dataset.viewport?.distance || 5;
        if (!dataset.background && !dataset.observation) {
          return { target: center, distance: dataset.viewport?.distance || clamp(span, 3.2, 8), azimuth, elevation: .18 };
        }
        return { target: add(center, [0, 0, .43]), distance: clamp(span * .40, 2.0, 5.3), azimuth, elevation: .16 };
      }
      return {
        target: ortho ? dataset.focus : dataset.viewport?.target || add(target, [0, 0, -.11]),
        distance: ortho ? distance : dataset.viewport?.distance || distance + .42,
        azimuth,
        elevation: Math.asin(toward[2]),
      };
    }
    function objectCamera() {
      const asset = dataset.assets[activeObject];
      const fromFront = asset.front && Math.hypot(...asset.front.slice(0, 2)) > .001;
      return {
        target: asset.center,
        distance: dataset.orthoScale && !current.roomView ? Math.max(asset.radius * 9.5, .4) : Math.max(asset.radius * 3.4, .28),
        azimuth: fromFront ? Math.atan2(asset.front[1], asset.front[0]) + .47 : sceneCamera().azimuth + .5,
        elevation: .34,
      };
    }
    function desiredCamera() {
      return mode === 'instance' ? objectCamera() : sceneCamera();
    }
    function matrices() {
      const { target, distance, azimuth, elevation } = camera;
      const outward = [Math.cos(elevation) * Math.cos(azimuth), Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation)];
      const eye = add(target, scale(outward, distance));
      const right = norm(cross([0, 0, 1], outward));
      const up = cross(outward, right);
      const view = [
        right[0], up[0], outward[0], 0,
        right[1], up[1], outward[1], 0,
        right[2], up[2], outward[2], 0,
        -dot(eye, right), -dot(eye, up), -dot(eye, outward), 1,
      ];
      const aspect = canvas.width / canvas.height;
      const horizontal = projectionLens(aspect);
      const near = .015;
      const far = 85;
      if (dataset.orthoScale && !current.roomView) {
        const width = dataset.orthoScale * distance / orthographicDistance() * Math.max(1, aspect / (4 / 3));
        return { view, projection: [2 / width, 2 * aspect / width, -2 / (far - near), -(far + near) / (far - near)], ortho: 1 };
      }
      return { view, projection: [horizontal, horizontal * aspect, -(far + near) / (far - near), -2 * far * near / (far - near)], ortho: 0 };
    }
    function use(program, m) {
      gl.useProgram(program.handle);
      gl.uniformMatrix4fv(program.uniform.view, false, m.view);
      gl.uniform4fv(program.uniform.projection, m.projection);
      gl.uniform1f(program.uniform.orthographic, m.ortho);
    }
    function drawCloud(cloud, m, amount, brightness, anchor) {
      if (!cloud || amount < .005) return;
      const { attr, uniform } = pointProgram;
      Object.values(meshProgram.attr).forEach(slot => gl.disableVertexAttribArray(slot));
      use(pointProgram, m);
      bindAttribute(attr.xyz, cloud.xyz, 3, gl.FLOAT);
      if (cloud.value) bindAttribute(attr.value, cloud.value, 1, gl.UNSIGNED_BYTE, true);
      else gl.disableVertexAttribArray(attr.value);
      if (cloud.rgb) bindAttribute(attr.color, cloud.rgb, 3, gl.UNSIGNED_BYTE, true);
      else gl.disableVertexAttribArray(attr.color);
      gl.uniform1i(uniform.useColor, Number(Boolean(cloud.rgb)));
      gl.uniform4f(uniform.hiddenObject, ...(anchor?.center || [0, 0, 0]), anchor ? anchor.radius * .84 : 0);
      gl.uniform1f(uniform.pixelScale, Math.max(1, canvas.height / 650));
      gl.uniform1f(uniform.opacity, amount);
      gl.uniform1f(uniform.brightness, brightness);
      gl.drawArrays(gl.POINTS, 0, cloud.xyz.bytes / 12);
    }
    function drawMeshes(m, now) {
      const { attr, uniform } = meshProgram;
      Object.values(pointProgram.attr).forEach(slot => gl.disableVertexAttribArray(slot));
      use(meshProgram, m);
      gl.uniform1f(uniform.instanceMix, highlightInstances ? .67 : 0);
      const jointFrame = jointStarted === null ? null : Math.floor(
        ((Math.max(0, now - jointStarted) / 1000 % jointMotion.duration) * jointMotion.fps)
      );
      function drawMesh(asset, amount, instanceIndex) {
        const hasPose = jointFrame !== null && asset.poses;
        if (highlightInstances) gl.uniform3fv(uniform.instanceTint, instanceColors[instanceIndex % instanceColors.length]);
        gl.uniformMatrix4fv(uniform.jointPose, false, hasPose ? asset.poses.subarray(jointFrame * 16, (jointFrame + 1) * 16) : identityPose);
        gl.uniformMatrix3fv(uniform.jointNormal, false, hasPose ? asset.normals.subarray(jointFrame * 9, (jointFrame + 1) * 9) : identityNormal);
        bindAttribute(attr.xyz, asset.xyz, 3, gl.SHORT);
        bindAttribute(attr.normal, asset.normal, 3, gl.BYTE, true);
        bindAttribute(attr.color, asset.color, 3, gl.UNSIGNED_BYTE, true);
        gl.uniform4f(uniform.position, ...asset.center, asset.step);
        gl.uniform1f(uniform.opacity, amount);
        if (asset.index) {
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, asset.index.handle);
          gl.drawElements(gl.TRIANGLES, asset.index.bytes / asset.indexBytes, asset.indexBytes === 2 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT, 0);
        } else {
          gl.drawArrays(gl.TRIANGLES, 0, asset.xyz.bytes / 6);
        }
      }
      if (current.singlePlacement) {
        const asset = dataset.assets[activeObject];
        if (asset) drawMesh(asset, 1, activeObject);
        return;
      }
      dataset.assets.forEach((asset, index) => {
        const amount = weights.assembly + (index === activeObject ? weights.instance : 0);
        if (amount < .005) return;
        const parts = jointFrame === null ? null : jointMotion.byPrompt.get(asset.prompt);
        if (parts) parts.forEach(part => drawMesh(part, amount, index));
        else drawMesh(asset, amount, index);
      });
    }

    function queueDraw() {
      if (!frame) frame = requestAnimationFrame(draw);
    }
    function draw(now) {
      frame = null;
      if (!dataset || canvas.hidden || document.hidden) return;
      if (animation) {
        const t = ease(clamp((now - animation.start) / animation.duration, 0, 1));
        const { from, to, oldWeights, newWeights } = animation;
        camera = { target: from.target.map((v, i) => mix(v, to.target[i], t)) };
        for (const key of ['distance', 'azimuth', 'elevation']) camera[key] = mix(from[key], to[key], t);
        weights = Object.fromEntries(Object.keys(weights).map(key => [key, mix(oldWeights[key], newWeights[key], t)]));
        if (t < 1) queueDraw();
        else animation = null;
      }
      const size = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(1.7, devicePixelRatio || 1);
      const width = Math.max(1, Math.round(size.width * pixelRatio));
      const height = Math.max(1, Math.round(size.height * pixelRatio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
      const m = matrices();
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      drawMeshes(m, now);
      const roomPoints = current.singlePlacement ? dataset.roomPoints || dataset.observation || dataset.background
        : dataset.background || (current.roomView && dataset.observation);
      drawCloud(roomPoints, m, weights.assembly * (current.roomView ? .90 : .78),
        dataset.roomPoints ? 1.07 : current.roomView ? .83 : .68, placementAnchor);
      drawCloud(dataset.observation || dataset.background, m, weights.scan, 1.08);
      if (jointStarted !== null && mode !== 'scan') queueDraw();
    }
    function goTo(nextCamera, immediate = false) {
      const targetWeights = { scan: 0, assembly: 0, instance: 0 };
      targetWeights[mode] = 1;
      if (immediate || reduce.matches) {
        animation = null;
        camera = nextCamera;
        weights = targetWeights;
      } else {
        nextCamera.azimuth = camera.azimuth + Math.atan2(Math.sin(nextCamera.azimuth - camera.azimuth), Math.cos(nextCamera.azimuth - camera.azimuth));
        animation = { from: camera, to: nextCamera, oldWeights: weights, newWeights: targetWeights, start: performance.now(), duration: 750 };
      }
      queueDraw();
    }

    function clear() {
      revision++;
      if (!dataset) return;
      const parts = jointMotion ? [...jointMotion.byPrompt.values()].flat() : [];
      const layers = [dataset.observation, dataset.background, dataset.roomPoints, ...dataset.assets, ...parts].filter(Boolean);
      for (const layer of layers) {
        for (const field of ['xyz', 'value', 'rgb', 'normal', 'color', 'index']) {
          if (layer[field]) gl.deleteBuffer(layer[field].handle);
        }
      }
      dataset = null;
      current = null;
      animation = null;
      jointMotion = null;
      jointStarted = null;
      placementAnchor = null;
    }

    let ready = false;
    if (gl) {
      try {
        init();
        ready = true;
      } catch (error) {
        console.error(error);
      }
    }
    function setInstanceHighlight(enabled) {
      highlightInstances = Boolean(enabled);
      queueDraw();
    }
    function configureInstanceHighlights(descriptor) {
      const palette = descriptor.instanceColors?.map(hexColor).filter(Boolean);
      instanceColors = palette?.length ? palette : defaultInstanceColors;
      setInstanceHighlight(descriptor.highlightInstances);
    }
    async function open(descriptor) {
      if (!ready) throw Error('3D graphics are unavailable in this browser');
      if (dataset && current?.file === descriptor.file && current.key === descriptor.key && current.assetsOnly === descriptor.assetsOnly) {
        configureInstanceHighlights(descriptor);
        return dataset;
      }
      clear();
      const requested = revision;
      const [source, roomPoints] = await Promise.all([
        fetchScene(descriptor.file, descriptor.key),
        descriptor.roomPoints && !descriptor.assetsOnly ? fetchScene(descriptor.roomPoints.file, descriptor.roomPoints.key).catch(() => null) : null,
      ]);
      if (requested !== revision) return null;
      const hideContext = descriptor.assetsOnly && source.assets.length;
      dataset = prepare(hideContext
        ? { ...source, observation: null, background: null, roomPoints: null }
        : { ...source, roomPoints });
      current = descriptor;
      configureInstanceHighlights(descriptor);
      activeObject = descriptor.singlePlacement ? -1 : Math.min(descriptor.defaultObject || 0, dataset.assets.length - 1);
      mode = 'assembly';
      goTo(desiredCamera(), true);
      return dataset;
    }

    function setMode(next) {
      if (!dataset || mode === next) return;
      const wasIsolated = mode === 'instance';
      mode = next;
      if (next === 'instance' || wasIsolated) goTo(desiredCamera());
      else goTo({ ...camera, target: [...camera.target] });
    }
    function animateJoints(enabled) {
      const payload = dataset && current.rigs;
      if (!payload) return false;
      if (enabled && !jointMotion) {
        const byPrompt = new Map();
        for (const rig of payload.rigs) {
          if (!dataset.assets.some(asset => asset.prompt === rig.prompt && asset.reference === rig.reference)) continue;
          byPrompt.set(rig.prompt, rig.parts.map(part => ({
            ...packedMesh(part),
            poses: part.poses && new Float32Array(readBytes(part.poses).buffer),
            normals: part.normals && new Float32Array(readBytes(part.normals).buffer),
          })));
        }
        if (!byPrompt.size) return false;
        jointMotion = { byPrompt, duration: payload.duration, fps: payload.fps };
      }
      jointStarted = enabled ? performance.now() : null;
      queueDraw();
      return enabled;
    }
    function choose(index) {
      if (!dataset?.assets[index]) return;
      activeObject = index;
      const asset = dataset.assets[index];
      if (current.singlePlacement && placementAnchor?.prompt !== asset.prompt) placementAnchor = asset;
      if (mode === 'instance') goTo(objectCamera());
      else if (current.singlePlacement) queueDraw();
    }
    function choosePlacement(prompt, reference) {
      if (!current?.singlePlacement) return false;
      const index = dataset.assets.findIndex(asset =>
        String(asset.prompt) === String(prompt) && String(asset.reference) === String(reference));
      if (index < 0) {
        activeObject = -1;
        queueDraw();
        return false;
      }
      const newPrompt = placementAnchor?.prompt !== dataset.assets[index].prompt;
      choose(index);
      if (newPrompt) reset();
      return true;
    }
    function focusPlacement() {
      const asset = dataset?.assets[activeObject];
      if (!asset || !current.singlePlacement) return;
      const distance = Math.max(sceneCamera().distance * .58, asset.radius * 3.8);
      goTo({ ...camera, target: asset.center, distance });
    }
    function reset() {
      if (dataset) goTo(desiredCamera());
    }
    function zoom(amount) {
      if (!dataset) return;
      if (animation) goTo(animation.to, true);
      const home = desiredCamera().distance;
      camera.distance = clamp(camera.distance * amount, home * .24, home * 4);
      queueDraw();
    }
    let pointer;
    function adjust(azimuth, elevation) {
      if (!dataset) return;
      if (animation) goTo(animation.to, true);
      camera.azimuth += azimuth;
      camera.elevation = clamp(camera.elevation + elevation, -.64, 1.4);
      queueDraw();
    }
    canvas.tabIndex = 0;
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      pointer = [event.pointerId, event.clientX, event.clientY];
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
      if (pointer?.[0] !== event.pointerId) return;
      adjust((pointer[1] - event.clientX) * .006, (event.clientY - pointer[2]) * .005);
      pointer = [event.pointerId, event.clientX, event.clientY];
    });
    canvas.addEventListener('lostpointercapture', () => { pointer = null; });
    canvas.addEventListener('keydown', event => {
      const directions = { ArrowLeft: [-.12, 0], ArrowRight: [.12, 0], ArrowUp: [0, .12], ArrowDown: [0, -.12] };
      if (directions[event.key]) {
        event.preventDefault();
        adjust(...directions[event.key]);
      } else if (event.key === '+' || event.key === '=' || event.key === '-') {
        event.preventDefault();
        zoom(event.key === '-' ? 1.16 : 1 / 1.16);
      } else if (event.key === 'Home') {
        event.preventDefault();
        reset();
      }
    });

    new ResizeObserver(queueDraw).observe(canvas.parentElement);
    document.addEventListener('visibilitychange', queueDraw);
    function frameRoom(angle) {
      if (!dataset || !current.assetsOnly || mode !== 'assembly') return;
      const normal = sceneCamera();
      if (angle === 'corner') return goTo(normal);
      goTo(assetOverview(normal.azimuth + (angle === 'side' ? Math.PI / 2 : 0), angle === 'overhead' ? 1.525 : .28));
    }
    function renderView({ yaw = 0, tilt = 0, zoom: distanceFactor = 1, layer = mode } = {}) {
      if (!dataset) return;
      mode = layer;
      const view = desiredCamera();
      view.azimuth += yaw;
      view.elevation = clamp(view.elevation + tilt, -.64, 1.4);
      view.distance *= distanceFactor;
      goTo(view, true);
      if (frame) cancelAnimationFrame(frame);
      draw(performance.now());
    }
    return { ready, open, clear, setMode, setInstanceHighlight, choose, choosePlacement, focusPlacement, reset, zoom, frameRoom, renderView, animateJoints, redraw: queueDraw };
  }

  window.albumSceneViewer = createViewer;
  window.albumLoadSavedScene = fetchScene;
})();
