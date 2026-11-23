'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const { queries: savedQueries = [], cases: savedCases = [] } = window.INSTANCE3R || {};
  const queries = [...savedQueries, ...(window.ALBUM_FIXTURE_QUERIES || [])];
  const caseModels = window.ALBUM_SCENE_RESULTS || {};
  const immersive = window.ALBUM_IMMERSIVE_ROOMS || {};
  const denseBackgroundFor = id => window.ALBUM_DENSE_BACKGROUNDS?.[id] || immersive[id]?.capture;
  const assetLibrary = {
    'ScanNet++': 'ALBUM curated assets',
    'ALBUM-Bench': 'ALBUM curated assets',
    'Replica': 'Replica ground-truth asset library',
    'In-house captures': 'Agent-created library for this room',
  };
  const featuredScenes = new Set([
    // Saved ScanNet++ v6 layouts.
    'scannet-living', 'scannet-office', 'scannet-lab', 'scannet-bedroom', 'scannet-studio',
    // Selected Replica scenes.
    'replica-office', 'replica-dining', 'replica-study', 'replica-open-living', 'replica-art-lounge',
    // The thirteen native ALBUM-Bench layouts.
    'album-living', 'album-wood-bedroom', 'album-blue-media', 'album-shelving-lounge',
    'album-cream-bedroom', 'album-pink-bedroom', 'album-timber-living', 'album-white-office',
    'album-blue-cabinet', 'album-red-cabinet', 'album-wood-storage', 'album-stone-bedroom', 'album-kitchen-pantry',
  ]);
  const openingScenes = ['img_3562', 'img_3561', 'scannet-living', 'replica-room-2', 'replica-office-4'];
  function casePriority(id) {
    const openingIndex = openingScenes.indexOf(id);
    if (openingIndex !== -1) return openingIndex;
    if (featuredScenes.has(id)) return openingScenes.length;
    return openingScenes.length + (id.startsWith('scannet-147k-') ? 2 : 1);
  }
  // The 3D-FRONT archive entries all use the 3D-FUTURE reference inventory.
  const publicRooms = new Map([...savedCases, ...(window.ALBUM_MORE_CASES || []), ...(window.ALBUM_ADDITIONAL_ROOMS || [])]
    .filter(({ id, dataset, group }) => !id.startsWith('front-') && !id.startsWith('studio-') && (dataset || group) !== 'Scene Studio')
    .map(item => [item.id, item]));
  const orderedRooms = [...publicRooms.values()].sort((a, b) => casePriority(a.id) - casePriority(b.id));
  window.ALBUM_PUBLIC_ROOMS = new Map(orderedRooms.map(room => [room.id, room]));
  const cases = orderedRooms.filter(({ id }) => {
    const native = immersive[id];
    const assets = native?.assets || window.ALBUM_BENCH_INSTANCE_PARTS?.[id];
    return caseModels[id] && native?.prediction && assets?.length;
  });
  const toggle = (button, selected) => button.setAttribute('aria-pressed', String(selected));

  const hero = $('top');
  const reel = $('reel');
  const reelButton = document.querySelector('.reel-toggle');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let previewVisible = true;
  let runPreview = !reduce.matches;
  function updatePreview() {
    if (reel.readyState === 0) return;
    if (runPreview && previewVisible && !document.hidden) reel.play().catch(() => {});
    else reel.pause();
  }
  function labelPreview() {
    const action = reel.paused ? 'Play' : 'Pause';
    reelButton.dataset.playing = String(!reel.paused);
    reelButton.setAttribute('aria-label', `${action} preview`);
  }
  function showPreview() {
    if (reel.readyState >= 2 && !reel.seeking) reel.classList.add('is-ready');
  }
  function preparePreview() {
    reelButton.hidden = false;
    updatePreview();
  }
  reel.addEventListener('loadeddata', showPreview);
  reel.addEventListener('canplay', showPreview);
  reel.addEventListener('playing', () => {
    showPreview();
    labelPreview();
  });
  reel.addEventListener('pause', labelPreview);
  reel.addEventListener('loadedmetadata', preparePreview);
  reelButton.addEventListener('click', () => {
    runPreview = reel.paused;
    updatePreview();
  });
  reduce.addEventListener('change', () => {
    runPreview = !reduce.matches;
    updatePreview();
  });
  document.addEventListener('visibilitychange', updatePreview);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      previewVisible = entry.intersectionRatio >= .15;
      updatePreview();
    }, { threshold: [.15] }).observe(hero);
  }
  if (reel.readyState > 0) preparePreview();
  document.querySelector('a[href="#film"]').addEventListener('click', () => {
    $('intro-film').play().catch(() => {});
  });

  function makeButton(text, onClick, selected = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    toggle(button, selected);
    button.addEventListener('click', onClick);
    return button;
  }
  function pressOnly(group, button) {
    for (const child of group.querySelectorAll('button')) toggle(child, child === button);
  }

  const queryScenes = $('query-scenes');
  const queryImage = $('query-image');
  const queryPoints = $('query-points');
  const queryRanks = $('query-ranks');
  const placementFigure = $('query-placement');
  const placementControls = $('query-placement-controls');
  const placementStatus = $('query-placement-status');
  const queryCanvas = $('query-placement-canvas');
  const placementViewer = window.albumRoomPlacementViewer(queryCanvas);
  const roomInstances = window.ALBUM_QUERY_INSTANCES;
  const roomForQuery = id => ({
    'fixture-bar-pendants': 'img_3561', 'fixture-lounge-planter': 'img_3562',
  })[id] || id;
  let currentQuery, selectedInstance, placementSelection, requestedPlacement;

  function placementNearViewport() {
    const { top, bottom } = placementFigure.getBoundingClientRect();
    return top < innerHeight + 160 && bottom > -160;
  }

  async function showPlacement() {
    if (!placementSelection || requestedPlacement === placementSelection) return;
    const selection = placementSelection;
    requestedPlacement = selection;
    const { roomId, instance, candidate } = selection;
    const switchingRooms = queryCanvas.dataset.room !== roomId;
    if (switchingRooms) placementControls.hidden = true;
    placementStatus.textContent = switchingRooms ? 'Loading room…' : candidate ? 'Loading candidate…' : '';
    try {
      const opened = await placementViewer.select(roomId, instance, candidate);
      if (selection !== placementSelection) return;
      if (!opened) throw Error('Could not display the saved selection');
      placementStatus.textContent = '';
      placementControls.hidden = false;
    } catch {
      if (selection === placementSelection) {
        requestedPlacement = null;
        placementStatus.textContent = 'Could not load this placement. Select the room or candidate to retry.';
      }
    }
  }

  function updatePlacement(candidate) {
    placementSelection = { roomId: roomForQuery(currentQuery.id), instance: selectedInstance, candidate };
    if (!('IntersectionObserver' in window) || placementNearViewport()) showPlacement();
  }

  function selectRank(query, point, rank, button) {
    const nativeRoom = window.ALBUM_NATIVE_QUERY_PLACEMENTS[query.id];
    const candidate = nativeRoom.prompts[point.id].candidates[rank.id];
    pressOnly(queryRanks, button);
    $('query-placement-asset').textContent = `${rank.label} · Reference ${rank.id}`;
    $('query-placement-source').textContent = [candidate.poseSource, 'Cached candidate placement'].filter(Boolean).join(' · ');
    updatePlacement(candidate);
  }

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      if (entries.at(-1).isIntersecting && placementNearViewport()) showPlacement();
    }, { rootMargin: '160px' });
    observer.observe(placementFigure);
  }
  $('query-zoom-out').addEventListener('click', () => placementViewer?.zoom(1.18));
  $('query-zoom-in').addEventListener('click', () => placementViewer?.zoom(1 / 1.18));
  $('query-focus').addEventListener('click', () => placementViewer?.focusPlacement());
  $('query-reset').addEventListener('click', () => placementViewer?.reset());

  function showRanks(query, point) {
    $('query-title').textContent = point.label;
    const hasScores = point.ranks.some(rank => Number.isFinite(rank.score));
    $('rank-detail').textContent = point.description || (hasScores ? 'Candidates are ranked by the shared matcher’s compatibility score (raw logit).' : 'Candidates are shown in the model’s saved rank order.');
    queryRanks.replaceChildren(...point.ranks.map((rank, index) => {
      const li = document.createElement('li');
      const place = document.createElement('span');
      place.className = 'rank-index';
      place.textContent = String(index + 1);
      const item = document.createElement('span');
      item.className = 'rank-main';
      if (rank.image) {
        const image = new Image();
        image.src = rank.image;
        image.alt = '';
        item.append(image);
      }
      const name = document.createElement('span');
      const label = document.createElement('strong');
      label.textContent = rank.label || `Asset ${rank.id}`;
      name.append(label);
      if (rank.id != null && rank.label && !rank.label.includes(String(rank.id))) {
        const id = document.createElement('span');
        id.className = 'rank-id';
        id.textContent = `Reference ${rank.id}`;
        name.append(id);
      }
      item.append(name);
      const score = document.createElement('span');
      score.className = 'rank-score';
      if (Number.isFinite(rank.score)) {
        score.textContent = String(Number(rank.score.toFixed(3)));
        score.title = 'Raw retrieval logit';
        score.setAttribute('aria-label', `Raw retrieval logit ${score.textContent}`);
      }
      const button = makeButton('', () => selectRank(query, point, rank, button));
      button.className = 'rank-choice';
      button.dataset.reference = rank.id;
      button.setAttribute('aria-controls', 'query-placement');
      button.append(place, item, score);
      li.append(button);
      return li;
    }));
  }

  const queryButtons = new Map();
  const instanceList = $('query-instances');
  const clearSelection = $('query-clear');
  function selectRoomInstance(id) {
    const roomId = roomForQuery(currentQuery.id);
    const instance = roomInstances[roomId].find(item => item.id === id);
    if (!instance) return;
    // Fixture close-ups and the main capture share one registered room.
    const sourceQuery = queries.find(q => roomForQuery(q.id) === roomId && q.points.some(p => p.id === id));
    if (sourceQuery && sourceQuery !== currentQuery) setQuery(sourceQuery, false);
    selectedInstance = instance;
    const point = sourceQuery?.points.find(p => p.id === id);
    pressOnly(queryPoints, [...queryPoints.children].find(marker => marker.dataset.instance === id));
    pressOnly(instanceList, [...instanceList.children].find(button => button.dataset.instance === id));
    clearSelection.hidden = false;
    $('query-focus').hidden = false;
    $('query-title').textContent = instance.label;
    $('query-placement-asset').textContent = instance.observation ? 'Observed instance' : `Saved room placement · Reference ${instance.reference}`;
    $('query-placement-source').textContent = instance.observation ? 'Registered ScanNet++ scan' : '';
    queryRanks.replaceChildren();
    instanceList.hidden = Boolean(point);
    if (point) showRanks(sourceQuery, point);
    else $('rank-detail').textContent = 'This instance is part of the saved room layout. No point query was recorded for it.';
    updatePlacement();
  }

  function overview() {
    selectedInstance = null;
    const items = roomInstances[roomForQuery(currentQuery.id)];
    pressOnly(queryPoints, null);
    pressOnly(instanceList, null);
    $('query-title').textContent = currentQuery.title;
    $('query-placement-asset').textContent = `${items.length} room instances`;
    $('query-placement-source').textContent = '';
    $('query-focus').hidden = true;
    clearSelection.hidden = true;
    instanceList.hidden = false;
    queryRanks.replaceChildren();
    $('rank-detail').textContent = 'Select an instance in the room, image or list.';
    updatePlacement();
  }
  clearSelection.addEventListener('click', () => {
    if (currentQuery.id === roomForQuery(currentQuery.id)) overview();
    else queryButtons.get(roomForQuery(currentQuery.id)).click();
    placementViewer.reset();
  });
  queryCanvas.addEventListener('album-instance-pick', event => {
    if (event.detail.room === roomForQuery(currentQuery.id)) selectRoomInstance(event.detail.instance);
  });

  function setQuery(query, showRoom = true) {
    currentQuery = query;
    pressOnly(queryScenes, queryButtons.get(roomForQuery(query.id)));
    queryImage.alt = query.alt || `Model input for ${query.title}`;
    queryImage.src = query.image;
    queryImage.hidden = false;
    if (query.width && query.height) $('query-picture').style.aspectRatio = `${query.width}/${query.height}`;
    else $('query-picture').style.removeProperty('aspect-ratio');
    $('query-source').textContent = query.source;
    $('query-library').textContent = assetLibrary[groupFor(query)];
    queryPoints.replaceChildren(...query.points.map((point, index) => {
      const marker = makeButton(String(index + 1), () => selectRoomInstance(point.id));
      marker.className = 'marker';
      marker.dataset.instance = point.id;
      marker.title = point.label;
      marker.setAttribute('aria-label', `Point ${index + 1}, ${point.label}`);
      marker.style.left = `${100 * point.x}%`;
      marker.style.top = `${100 * point.y}%`;
      return marker;
    }));
    const items = roomInstances[roomForQuery(query.id)];
    instanceList.replaceChildren(...items.map(item => {
      const repeated = items.some(other => other !== item && other.label === item.label);
      const button = makeButton(repeated ? `${item.label} · ${item.id}` : item.label, () => selectRoomInstance(item.id));
      button.dataset.instance = item.id;
      return button;
    }));
    if (showRoom) overview();
  }
  queries.filter(query => query.points?.length && query.id === roomForQuery(query.id)).forEach(query => {
    const button = makeButton(query.title, () => setQuery(query));
    queryButtons.set(query.id, button);
    queryScenes.append(button);
  });
  queryScenes.firstElementChild?.click();

  const caseTabs = $('case-tabs');
  const caseGroups = $('case-groups');
  const originalPreviews = window.ALBUM_CASE_PREVIEWS || {};
  const galleryCanvas = $('case-canvas');
  const galleryPbrCanvas = $('case-pbr-canvas');
  const layerControls = $('case-geometry');
  const geometryLayers = [...layerControls.querySelectorAll('[data-case-layer]')];
  const galleryPicker = $('case-picker');
  const highlightButton = $('case-instance-colors');
  const gtButton = $('case-ground-truth');
  const jointsButton = $('case-joints');
  const inputs = $('case-inputs');
  const inputStrip = $('case-input-views');
  const inputImage = $('case-input-image');
  const compareButton = $('case-compare');
  const positionsButton = $('case-map');
  const denseButton = $('case-dense');
  const denseStatus = $('case-dense-status');
  let preferDense = true;
  let denseRevision = 0;
  const workspace = $('gallery-workspace');
  let currentInput = 0;
  let selectInput;
  inputImage.addEventListener('load', () => {
    if (inputImage.naturalHeight) workspace.style.setProperty('--input-aspect',
      String(inputImage.naturalWidth / inputImage.naturalHeight));
  });
  let comparing = false;
  const instanceColors = [
    '#2879ce', '#d65635', '#2e9b74', '#9c59c6', '#d7a121', '#36adc0', '#ce527d', '#5949b1',
    '#87a732', '#bc6832', '#3e93b0', '#ac3f49', '#32a997', '#cb7929', '#7160a8', '#697a31',
    '#478cdd', '#d36ca0', '#127d77', '#aa5841', '#b48cdc', '#c3a353', '#258f4c', '#6b467a',
    '#737fc3', '#aa9939', '#7a5350', '#369fa0', '#d68b78', '#695a97', '#7fad78', '#9a7247',
  ];
  let highlightInstances = false;
  let galleryRenderer;
  let galleryPbr;
  let galleryNative = false;
  let galleryDataset;
  let modelRequested;
  let viewportNear = !('IntersectionObserver' in window);
  let viewRevision = 0;
  let activeCase = new URLSearchParams(location.search).get('scene');
  let activeLayer;
  let layerRevision = 0;

  function groupFor(example) {
    if (example.group || example.dataset) return example.group || example.dataset;
    const lookup = [
      ['scannet', 'ScanNet++'],
      ['img_', 'In-house captures'],
      ['fixture-', 'In-house captures'],
      ['replica', 'Replica'],
      ['album', 'ALBUM-Bench'],
    ];
    return lookup.find(([prefix]) => example.id.startsWith(prefix))?.[1] || example.source;
  }

  function galleryPhoto(id, index, thumbnail = false) {
    const base = immersive[id]?.displayViewBase;
    return base && base + String(index + 1).padStart(2, '0') + (thumbnail ? '-thumb.webp' : '.webp');
  }

  function setInputs(example) {
    const room = immersive[example.id];
    const views = (room?.views || example.views || []).map(view =>
      typeof view === 'string' ? view : view.src || view.image);
    const group = groupFor(example);
    const info = $('case-photo-info');
    const fullSize = $('case-photo-link');
    const modelInput = $('case-model-input');
    inputs.hidden = !views.length;
    $('case-view-count').textContent = views.length;
    inputImage.removeAttribute('src');
    fullSize.removeAttribute('href');
    modelInput.hidden = true;
    selectInput = (i, fly = false) => {
      if (i < 0 || i >= views.length) return;
      currentInput = i;
      const large = galleryPhoto(example.id, i);
      const source = large || views[i];
      inputImage.src = source;
      inputImage.alt = `${example.title}, camera view ${i + 1}`;
      fullSize.href = source;
      const detail = large && (room.displayViewLabel || ({
        'Replica': 'Same-camera Ptex render',
        'ScanNet++': 'Original camera frame',
        'In-house captures': 'Original camera frame',
        'ALBUM-Bench': 'Original dataset render',
      })[group]);
      info.textContent = `${i + 1} / ${views.length}`;
      fullSize.title = detail ? `Open full-size image · ${detail}` : 'Open full-size input';
      modelInput.href = views[i];
      modelInput.textContent = ['ScanNet++', 'In-house captures'].includes(group) ? 'Open saved input crop' : 'Open saved input';
      modelInput.hidden = !large;
      pressOnly(inputStrip, inputStrip.children[i]);
      if (fly) {
        const tab = inputStrip.children[i].getBoundingClientRect();
        const strip = inputStrip.getBoundingClientRect();
        const offset = tab.left < strip.left ? tab.left - strip.left : Math.max(0, tab.right - strip.right);
        if (offset) inputStrip.scrollBy({left: offset, behavior: reduce.matches ? 'instant' : 'smooth'});
        setComparison(true);
      }
    };
    inputStrip.replaceChildren(...views.map((src, i) => {
      const button = makeButton('', () => selectInput(i, true), i === 0);
      button.setAttribute('aria-label', `Input view ${i + 1}`);
      const image = new Image();
      image.loading = 'lazy';
      image.decoding = 'async';
      image.alt = '';
      image.src = galleryPhoto(example.id, i, true) || src;
      const number = document.createElement('span');
      number.textContent = String(i + 1).padStart(2, '0');
      button.append(image, number);
      return button;
    }));
    compareButton.hidden = !views.length;
    if (views.length) selectInput(0);
  }

  function hideCameraPositions() {
    if (positionsButton.getAttribute('aria-pressed') === 'true') {
      toggle(positionsButton, false);
      galleryPbr?.setCameraPositions(false);
    }
  }
  function matchInput() {
    const pose = immersive[activeCase]?.cameraViews?.[currentInput];
    if (pose && galleryNative && activeLayer === 'assembly') galleryPbr.showCamera(pose);
  }
  function setComparison(enabled) {
    comparing = enabled;
    toggle(compareButton, enabled);
    $('case-current-view').hidden = !enabled;
    workspace.classList.toggle('with-input', enabled);
    if (enabled) {
      hideCameraPositions();
      if (activeLayer === 'instance') showLayer('assembly');
      matchInput();
    }
    galleryView()?.redraw();
  }
  compareButton.addEventListener('click', () => setComparison(!comparing));
  positionsButton.addEventListener('click', () => {
    const enabled = positionsButton.getAttribute('aria-pressed') !== 'true';
    if (enabled) setComparison(false);
    toggle(positionsButton, enabled);
    galleryPbr.setCameraPositions(enabled);
    if (!enabled) galleryPbr.frameRoom('corner');
  });
  galleryPbrCanvas.addEventListener('album-camera-pick', event => {
    if (event.detail?.scene !== activeCase || !Number.isInteger(event.detail.index)) return;
    selectInput(event.detail.index, true);
  });
  for (const button of document.querySelectorAll('[data-gallery-angle]')) {
    button.addEventListener('click', () => {
      if (!galleryDataset) return;
      if (activeLayer === 'instance') showLayer('assembly');
      galleryView().frameRoom(button.dataset.galleryAngle);
    });
  }

  $('case-query-link').addEventListener('click', () => queryButtons.get(activeCase)?.click());

  function overlayControl(button, action) {
    button.addEventListener('click', async () => {
      const revision = viewRevision;
      const layer = layerRevision;
      const enabled = button.getAttribute('aria-pressed') !== 'true';
      button.disabled = true;
      try {
        const applied = await galleryView()[action](enabled);
        if (revision !== viewRevision) return;
        if (layer === layerRevision) {
          toggle(button, Boolean(applied));
          if (button === gtButton) $('case-gt-key').hidden = !applied;
        } else if (applied) await galleryView()[action](false);
      } catch {
        if (revision === viewRevision) $('case-model-note').textContent = 'This saved layer could not be loaded.';
      } finally {
        if (revision === viewRevision) button.disabled = false;
      }
    });
  }
  function contactNote(id) {
    return id === 'scannet-living'
      ? 'Dining chairs stay on their table side and the kitchen stools meet the floor. The ceiling fixture combines two retrieved parts, aligned to the hub and globe in four RGB views.'
      : 'Saved placements include collision correction.';
  }
  overlayControl(gtButton, 'setGroundTruth');
  overlayControl(jointsButton, 'animateJoints');

  function showLayer(layer) {
    if (!galleryDataset) return;
    if (layer !== activeLayer) layerRevision++;
    activeLayer = layer;
    const assembly = layer === 'assembly';
    denseButton.hidden = !(assembly && galleryNative && denseBackgroundFor(activeCase));
    gtButton.hidden = !(assembly && galleryNative && immersive[activeCase]?.groundTruth);
    jointsButton.hidden = !(assembly && (galleryNative ? galleryDataset.hasJoints : window.ALBUM_ROOM_RIGS?.[activeCase]));
    positionsButton.hidden = !(assembly && galleryNative && immersive[activeCase]?.cameraViews?.some(pose => pose?.eye && pose.target));
    if (!assembly) {
      hideCameraPositions();
      setComparison(false);
      if (galleryNative) galleryPbr.setGroundTruth(false);
      galleryView().animateJoints(false);
      toggle(gtButton, false);
      $('case-gt-key').hidden = true;
      toggle(jointsButton, false);
    }
    for (const node of geometryLayers) toggle(node, node.dataset.caseLayer === layer);
    $('case-picker-label').hidden = layer !== 'instance';
    if (galleryNative) galleryPbr.focus(layer === 'instance' ? galleryPicker.value : null);
    else galleryRenderer.setMode(layer);
  }
  layerControls.addEventListener('click', event => {
    const layer = event.target.dataset.caseLayer;
    if (layer) showLayer(layer);
  });
  galleryPicker.addEventListener('change', () => {
    if (galleryNative) galleryPbr.focus(galleryPicker.value);
    else galleryRenderer?.choose(Number(galleryPicker.value));
  });
  const galleryView = () => galleryNative ? galleryPbr : galleryRenderer;
  async function displayDense(enabled) {
    const revision = ++denseRevision;
    denseStatus.hidden = true;
    toggle(denseButton, enabled);
    denseButton.setAttribute('aria-busy', String(enabled));
    let applied = false;
    try {
      applied = await galleryPbr.setDenseBackground(enabled);
    } finally {
      if (revision === denseRevision) {
        denseButton.removeAttribute('aria-busy');
        toggle(denseButton, Boolean(applied));
        denseStatus.hidden = !enabled || Boolean(applied);
      }
    }
  }
  denseButton.addEventListener('click', () => {
    preferDense = denseButton.getAttribute('aria-pressed') !== 'true';
    displayDense(preferDense).catch(console.warn);
  });
  highlightButton.addEventListener('click', () => {
    highlightInstances = !highlightInstances;
    toggle(highlightButton, highlightInstances);
    galleryView()?.setInstanceHighlight(highlightInstances);
  });
  $('case-zoom-out').addEventListener('click', () => galleryView()?.zoom(1.18));
  $('case-zoom-in').addEventListener('click', () => galleryView()?.zoom(1 / 1.18));
  $('case-reset').addEventListener('click', () => galleryView()?.reset());

  function showGallery(assets, note, canvas) {
    $('case-stage-status').textContent = '';
    $('case-model-note').textContent = immersive[activeCase]?.displayNote || note;
    canvas.hidden = false;
    $('case-camera').hidden = false;
    $('gallery-tools').hidden = false;
    layerControls.hidden = !assets.length;
    galleryPicker.replaceChildren(...assets.map(({ label, value }) => new Option(label, value)));
    gtButton.disabled = false;
    showLayer(assets.length ? 'assembly' : 'scan');
    galleryView().setInstanceHighlight(highlightInstances);
    if (!denseButton.hidden && preferDense) displayDense(true).catch(console.warn);
    if (comparing) matchInput();
    galleryView().redraw();
  }

  async function loadModel() {
    if (!modelRequested || !viewportNear) return;
    const job = modelRequested;
    modelRequested = null;
    const status = $('case-stage-status');
    status.textContent = 'Loading saved 3D geometry…';
    const { model, id, revision } = job;
    const collisionNote = id.startsWith('scannet-147k-') && model.note?.match(/(?:Collision checks|Detected intersecting pairs).*/)?.[0];
    const native = window.ALBUM_IMMERSIVE_ROOMS?.[id];
    const nativeAssets = native?.assets || window.ALBUM_BENCH_INSTANCE_PARTS?.[id];
    try {
      const saved = true;
      const assets = nativeAssets;
      galleryPbr ||= window.albumPbrViewer(galleryPbrCanvas);
      const opened = await galleryPbr.open({
        prediction: native.prediction, matrix: saved ? native.matrix : undefined,
        groundTruth: saved ? native.groundTruth : undefined, motion: saved ? native.motion : undefined,
        kind: 'gallery', sceneId: id, cameraViews: saved ? native.cameraViews : undefined,
        denseBackground: saved ? denseBackgroundFor(id) : undefined,
        assets, instanceColors, highlightInstances,
      });
      if (revision !== viewRevision || !opened) return;
      galleryDataset = opened;
      galleryNative = true;
      const materialNote = saved ? (id.startsWith('replica-')
        ? 'Saved placements with Replica’s original scan colors.' : 'Saved placements with original asset materials.')
        : 'Saved placements with archived vertex colors.';
      showGallery(assets.map(({ label, name }) => ({ label: label.replace(/^\d+\s+|\.\d{3}$/g, ''), value: name })),
        opened.hasContactLayout
          ? contactNote(id)
          : [materialNote, collisionNote].filter(Boolean).join(' '), galleryPbrCanvas);
      return;
    } catch (error) {
      if (revision !== viewRevision) return;
      status.textContent = 'The room could not load. Select it again to retry.';
      console.warn(error);
    }
  }
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      viewportNear = entries.at(-1).isIntersecting;
      if (viewportNear) loadModel();
    }, { rootMargin: '320px' });
    observer.observe($('case-browser-region'));
  }

  function resetModel() {
    viewRevision++;
    denseRevision++;
    denseButton.hidden = denseStatus.hidden = true;
    denseButton.removeAttribute('aria-busy');
    toggle(denseButton, false);
    setComparison(false);
    currentInput = 0;
    selectInput = null;
    $('gallery-tools').hidden = true;
    positionsButton.hidden = true;
    toggle(positionsButton, false);
    modelRequested = null;
    galleryDataset = null;
    galleryRenderer?.clear();
    galleryPbr?.clear();
    galleryNative = false;
    activeLayer = null;
    for (const button of [gtButton, jointsButton]) {
      button.hidden = true;
      button.disabled = false;
      toggle(button, false);
    }
    $('case-gt-key').hidden = true;
    galleryCanvas.hidden = true;
    galleryPbrCanvas.hidden = true;
    $('case-camera').hidden = true;
    $('case-geometry').hidden = true;
    $('case-picker-label').hidden = true;
    $('case-live').hidden = true;
    $('case-stage-status').textContent = '';
  }

  function setCase(example, button) {
    resetModel();
    activeCase = example.id;
    pressOnly(caseTabs, button);
    $('case-figure').hidden = false;
    $('case-title').textContent = example.title;
    $('case-source').textContent = example.source;
    $('case-library').textContent = immersive[example.id]?.libraryLabel || assetLibrary[groupFor(example)];
    $('case-query-link').hidden = !queryButtons.has(example.id);
    setInputs(example);
    $('case-description').textContent = example.description;
    const model = caseModels[example.id];
    $('case-live').hidden = false;
    gtButton.hidden = !immersive[example.id]?.groundTruth;
    gtButton.disabled = true;
    $('case-model-note').textContent = '';
    $('case-stage-status').textContent = 'Opening saved 3D scene…';
    modelRequested = { model, id: example.id, revision: viewRevision };
    loadModel();
  }

  function updatePaging() {
    const end = caseTabs.scrollWidth - caseTabs.clientWidth;
    $('case-prev').disabled = caseTabs.scrollLeft < 2;
    $('case-next').disabled = caseTabs.scrollLeft >= end - 2;
  }
  for (const [id, direction] of [['case-prev', -1], ['case-next', 1]]) {
    $(id).addEventListener('click', () => caseTabs.scrollBy({
      left: direction * caseTabs.clientWidth * .87,
      behavior: reduce.matches ? 'instant' : 'smooth',
    }));
  }
  caseTabs.addEventListener('scroll', updatePaging, { passive: true });
  new ResizeObserver(updatePaging).observe(caseTabs);

  const expanded = $('case-live');
  const expandButton = $('case-expand');
  if (document.fullscreenEnabled && expanded.requestFullscreen) {
    expandButton.hidden = false;
    expandButton.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement === expanded) await document.exitFullscreen();
        else await expanded.requestFullscreen();
      } catch { expandButton.hidden = true; }
    });
    document.addEventListener('fullscreenchange', () => {
      const label = document.fullscreenElement === expanded ? 'Exit fullscreen' : 'Enter fullscreen';
      expandButton.title = label;
      expandButton.setAttribute('aria-label', label);
      galleryView()?.redraw();
    });
  }

  function showGroup(group, filter) {
    pressOnly(caseGroups, filter);
    const shown = cases.filter(example => !group || groupFor(example) === group);
    $('case-count').textContent = `${shown.length} interactive 3D scenes`;
    const sceneButtons = shown.map((example, index) => {
      const button = makeButton('', () => setCase(example, button));
      button.dataset.caseId = example.id;
      const preview = galleryPhoto(example.id, 0, true) || originalPreviews[example.id] || example.input || example.views?.[0] || example.preview || example.thumbnail;
      if (preview) {
        const picture = new Image();
        picture.alt = '';
        picture.loading = index < 6 ? 'eager' : 'lazy';
        picture.decoding = 'async';
        picture.addEventListener('error', () => picture.remove(), { once: true });
        picture.src = preview;
        button.append(picture);
      }
      const name = document.createElement('span');
      name.textContent = example.tab || example.title;
      button.append(name);
      if (!group) {
        const dataset = document.createElement('small');
        dataset.textContent = groupFor(example);
        button.append(dataset);
      }
      return button;
    });
    caseTabs.replaceChildren(...sceneButtons);
    caseTabs.scrollTop = 0;
    caseTabs.scrollLeft = 0;
    requestAnimationFrame(updatePaging);
    const selected = shown.findIndex(example => example.id === activeCase);
    const activeButton = sceneButtons[Math.max(0, selected)];
    if (activeButton) {
      activeButton.click();
      if (selected > 0) {
        const list = caseTabs.getBoundingClientRect();
        const card = activeButton.getBoundingClientRect();
        caseTabs.scrollTop = Math.max(0, card.bottom - list.bottom);
        caseTabs.scrollLeft = Math.max(0, card.right - list.right);
      }
    } else {
      resetModel();
      $('case-figure').hidden = true;
    }
  }

  const groups = new Map();
  for (const example of cases) {
    const group = groupFor(example);
    groups.set(group, (groups.get(group) || 0) + 1);
  }
  for (const [group, count] of [[null, cases.length], ...groups]) {
    const title = group || 'All scenes';
    const filter = makeButton(title, () => showGroup(group, filter));
    filter.dataset.caseGroup = group || 'all';
    filter.setAttribute('aria-label', `${title}, ${count} scenes`);
    const total = document.createElement('span');
    total.className = 'case-group-total';
    total.setAttribute('aria-hidden', 'true');
    total.textContent = count;
    filter.append(total);
    caseGroups.append(filter);
  }
  caseGroups.firstElementChild?.click();
})();
