'use strict';

function mountViser(canvas) {
  const frame = document.createElement('iframe');
  frame.className = 'viser-frame';
  frame.title = canvas.getAttribute('aria-label') || 'Interactive 3D scene';
  frame.allow = 'fullscreen';
  const origin = location.origin;
  const listener = new AbortController();
  const requests = new Map();
  let sequence = 0;
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Viser did not start.')), 12000);
    window.addEventListener('message', event => {
      if (event.origin !== origin || event.source !== frame.contentWindow) return;
      const message = event.data;
      if (message?.type === 'album-camera-pick' || message?.type === 'album-instance-pick')
        canvas.dispatchEvent(new CustomEvent(message.type, { detail: message.detail }));
      if (message?.type === 'album-viser-ready') {
        clearTimeout(timer);
        resolve();
      }
      if (message?.type !== 'album-viser-result') return;
      const job = requests.get(message.id);
      if (!job) return;
      requests.delete(message.id);
      clearTimeout(job.timer);
      if (message.ok) job.resolve(message.value);
      else job.reject(Error(message.error || 'Viser could not display this scene.'));
    }, { signal: listener.signal });
  });
  frame.src = new URL('vendor/viser/index.html?album=1&v=a203bb063862', document.baseURI);
  canvas.after(frame);

  return {
    async send(action, payload) {
      await ready;
      if (listener.signal.aborted) return null;
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          requests.delete(id);
          reject(Error(`Viser ${action} timed out.`));
        }, 45000);
        requests.set(id, { resolve, reject, timer });
        frame.contentWindow.postMessage({ type: 'album-viser', id, action, ...payload }, origin);
      });
    },
    dispose() {
      for (const { resolve, timer } of requests.values()) {
        clearTimeout(timer);
        resolve(null);
      }
      requests.clear();
      listener.abort();
      frame.remove();
    },
  };
}

window.albumPbrViewer = canvas => {
  let bridge, fallback, fallbackLoad;
  let engine;
  let revision = 0;
  let useViser = location.origin !== 'null';

  function absoluteModel(model) {
    const sameOrigin = { ...model };
    for (const key of ['prediction', 'environment', 'capture', 'groundTruth', 'motion', 'denseBackground', 'observation']) {
      if (model[key]) sameOrigin[key] = new URL(model[key], document.baseURI).href;
    }
    return sameOrigin;
  }

  async function load(method, model) {
    const selected = ++revision;
    if (useViser) {
      bridge ||= mountViser(canvas);
      try {
        const result = await bridge.send(method, { model: absoluteModel(model) });
        if (selected !== revision || !result) return null;
        if (engine === 'fallback') fallback?.clear();
        engine = 'viser';
        canvas.dataset.viewer = 'viser';
        return result;
      } catch (error) {
        if (selected !== revision) return null;
        useViser = false;
        bridge.dispose();
        bridge = null;
        console.warn('Viser switched to the local renderer.', error);
      }
    }

    fallbackLoad ||= import('./pbr-stage.js?v=c663f4ea15cf').then(module => {
      fallback = module.createStage(canvas);
      return fallback;
    });
    const stage = await fallbackLoad;
    if (revision !== selected) return null;
    engine = 'fallback';
    delete canvas.dataset.viewer;
    return stage[method](model);
  }
  function send(action, args = []) {
    if (engine === 'fallback') return fallback?.[action](...args);
    return bridge?.send(action, { args }).catch(error => {
      if (engine === 'viser') console.warn(error);
      return false;
    });
  }
  return {
    open(descriptor) { return load('open', descriptor); },
    place(descriptor) { return load('place', descriptor); },
    clear() { revision++; send('clear'); },
    dispose() {
      revision++;
      bridge?.dispose();
      fallback?.dispose();
      bridge = fallback = fallbackLoad = engine = null;
      delete canvas.dataset.viewer;
    },
    redraw() { send('redraw'); },
    reset() { send('reset'); },
    zoom(amount) { send('zoom', [amount]); },
    focus(name) { return send('focus', [name]); },
    setInstanceHighlight(enabled) { send('setInstanceHighlight', [enabled]); },
    selectInstance(sceneId, id, candidate) {
      return send('selectInstance', [sceneId, id, candidate && absoluteModel(candidate)]);
    },
    focusPlacement() { send('focusPlacement'); },
    frameRoom(angle) { send('frameRoom', [angle]); },
    setCameraPositions(enabled) { return send('setCameraPositions', [enabled]); },
    showCamera(view) { send('showCamera', [view]); },
    setContactLayout(enabled) { return send('setContactLayout', [enabled]); },
    setGroundTruth(enabled) { return send('setGroundTruth', [enabled]); },
    setDenseBackground(enabled) { return send('setDenseBackground', [enabled]); },
    animateJoints(enabled) { return send('animateJoints', [enabled]); },
  };
};
