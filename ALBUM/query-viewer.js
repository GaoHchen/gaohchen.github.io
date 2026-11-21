'use strict';

window.albumRoomPlacementViewer = canvas => {
  let viewer, loaded, revision = 0;
  return {
    async select(roomId, instance, candidate) {
      const ticket = ++revision;
      viewer ||= window.albumPbrViewer(canvas);
      if (loaded?.id !== roomId) {
        canvas.hidden = true;
        const room = window.ALBUM_IMMERSIVE_ROOMS[roomId];
        const instances = window.ALBUM_QUERY_INSTANCES[roomId];
        const job = { id: roomId, result: viewer.open({
          kind: 'queryRoom', sceneId: roomId, prediction: room.prediction,
          eye: room.eye, target: room.target, instances, observation: instances.find(i => i.observation)?.observation,
        }) };
        loaded = job;
        job.result.catch(() => { if (loaded === job) loaded = null; });
      }
      const room = await loaded.result;
      if (!room || ticket !== revision) return false;
      const selected = await viewer.selectInstance(roomId, instance?.id, candidate);
      if (!selected || ticket !== revision) return false;
      canvas.dataset.room = roomId;
      canvas.dataset.instance = instance?.id || '';
      canvas.dataset.instanceCount = room.instanceCount;
      canvas.hidden = false;
      viewer.redraw();
      return true;
    },
    zoom(amount) { viewer?.zoom(amount); },
    reset() { viewer?.reset(); },
    focusPlacement() { viewer?.focusPlacement(); },
  };
};

// The standalone reconstruction viewer also supports archived packed placements.
window.albumPlacementViewer = (nativeCanvas, fallbackCanvas) => {
  let textured, packed, loaded, active;
  let revision = 0;
  function hide() {
    revision++;
    active = null;
    nativeCanvas.hidden = true;
    fallbackCanvas.hidden = true;
  }
  async function select(queryId, promptId, referenceId) {
    hide();
    const requested = revision;
    const room = window.ALBUM_NATIVE_QUERY_PLACEMENTS?.[queryId];
    const prompt = room?.prompts?.[promptId];
    const candidate = prompt?.candidates?.[referenceId];
    let camera, canvas, source;
    if (candidate) {
      camera = textured ||= window.albumPbrViewer(nativeCanvas);
      canvas = nativeCanvas;
      const { environment, eye, target, fov } = prompt;
      const model = await camera.place({ environment, eye, target, fov, ...candidate, promptKey: `${queryId}/${promptId}` });
      if (!model || requested !== revision) return null;
      source = [candidate.poseSource, room.source].filter(Boolean).join(' · ');
    } else {
      const model = window.ALBUM_QUERY_PLACEMENTS?.[queryId];
      if (!model) throw Error('No saved placement is available for this query.');
      camera = packed ||= window.albumSceneViewer(fallbackCanvas);
      canvas = fallbackCanvas;
      if (loaded?.model !== model) {
        const job = { model, result: camera.open({
          ...model, singlePlacement: true, roomView: true,
          captureView: queryId.startsWith('img_') || queryId.startsWith('fixture-'),
        }) };
        loaded = job;
        job.result.catch(() => { if (loaded === job) loaded = null; });
      }
      if (!await loaded.result || requested !== revision) return null;
      if (!camera.choosePlacement(promptId, referenceId)) throw Error('No saved placement is available for this candidate.');
      source = model.source;
    }
    active = camera;
    Object.assign(canvas.dataset, { query: queryId, prompt: promptId, reference: referenceId });
    canvas.hidden = false;
    camera.redraw();
    return { source };
  }
  return {
    select, hide,
    redraw() { active?.redraw(); },
    zoom(amount) { active?.zoom(amount); },
    reset() { active?.reset(); },
    focusPlacement() { active?.focusPlacement(); },
  };
};
