'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const press = (button, active) => button.setAttribute('aria-pressed', String(active));
  const select = (group, active) => {
    for (const button of group.querySelectorAll('button')) press(button, button === active);
  };
  function button(label, handler) {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    press(node, false);
    node.addEventListener('click', handler);
    return node;
  }
  function thumbnail(label, src, handler, eager = false) {
    const node = button('', handler);
    const image = new Image();
    image.src = src;
    image.alt = '';
    image.loading = eager ? 'eager' : 'lazy';
    image.decoding = 'async';
    const name = document.createElement('span');
    name.textContent = label;
    node.append(image, name);
    return node;
  }

  if (location.hash === '#curation-pipeline') location.replace('#library');

  const route = document.querySelector('.reading-route');
  const chapters = $('chapters');
  const menu = route.querySelector('.route-toggle');
  const compact = matchMedia('(max-width: 1050px)');
  const stops = [...chapters.querySelectorAll('a')].map(link => ({
    link, section: $(link.hash.slice(1)), item: link.closest('li'),
  }));
  function setMenu(open) {
    route.classList.toggle('is-open', open);
    menu.setAttribute('aria-expanded', String(open));
  }
  menu.addEventListener('click', () => setMenu(!route.classList.contains('is-open')));
  chapters.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link || !compact.matches) return;
    setMenu(false);
    const section = $(link.hash.slice(1));
    section.setAttribute('tabindex', '-1');
    section.focus({ preventScroll: true });
  });
  document.addEventListener('pointerdown', event => {
    if (!route.contains(event.target)) setMenu(false);
  });
  route.addEventListener('focusout', event => {
    if (event.relatedTarget && !route.contains(event.relatedTarget)) setMenu(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && route.classList.contains('is-open')) {
      setMenu(false);
      menu.focus();
    }
  });
  compact.addEventListener('change', () => setMenu(false));

  let queued = false;
  function markChapter() {
    queued = false;
    const readingLine = Math.min(170, innerHeight * .26);
    const reading = stops[0].section.getBoundingClientRect().top <= readingLine;
    route.classList.toggle('is-reading', reading);
    let active = -1;
    for (const [i, stop] of stops.entries()) {
      if (stop.section.getBoundingClientRect().top <= readingLine) active = i;
    }
    // A short final section can reach the end before it reaches the reading line.
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) active = stops.length - 1;
    const inDataset = active >= stops.findIndex(stop => stop.section.id === 'dataset');
    route.classList.toggle('in-dataset', inDataset);
    for (const [i, stop] of stops.entries()) {
      if (i === active) stop.link.setAttribute('aria-current', 'location');
      else stop.link.removeAttribute('aria-current');
      stop.item.classList.toggle('passed', i < active);
    }
    if (!compact.matches && reading) {
      const navTop = chapters.getBoundingClientRect().top;
      const center = element => {
        const rect = element.getBoundingClientRect();
        return rect.top + rect.height / 2 - navTop;
      };
      const first = center(stops[0].link);
      const last = center(stops[inDataset ? stops.length - 1 : stops.length - 3].link);
      chapters.style.setProperty('--track-start', first + 'px');
      chapters.style.setProperty('--track-height', (last - first) + 'px');
      chapters.style.setProperty('--track-fill', (center(stops[active].link) - first) + 'px');
    }
  }
  function queueChapter() {
    if (!queued) requestAnimationFrame(markChapter);
    queued = true;
  }
  addEventListener('scroll', queueChapter, { passive: true });
  addEventListener('resize', queueChapter, { passive: true });
  new ResizeObserver(queueChapter).observe(document.querySelector('.chapters-content'));
  queueChapter();

  const overview = $('intro-film');
  const captionStrip = $('film-captions');
  const captionLabel = captionStrip.firstElementChild;
  const englishTrack = overview.querySelector('track');
  function syncCaptions() {
    const track = englishTrack.track;
    const nativePresentation = document.fullscreenElement === overview ||
      document.pictureInPictureElement === overview || overview.webkitDisplayingFullscreen ||
      ['fullscreen', 'picture-in-picture'].includes(overview.webkitPresentationMode);
    const inline = !nativePresentation && track.mode === 'showing' && englishTrack.readyState === 2;
    overview.classList.toggle('inline-captions', inline);
    captionStrip.hidden = !inline;
    captionLabel.textContent = inline
      ? Array.from(track.activeCues || [], cue => cue.getCueAsHTML().textContent.trim()).join(' ')
      : '';
  }
  englishTrack.addEventListener('load', syncCaptions);
  englishTrack.addEventListener('error', syncCaptions);
  englishTrack.track.addEventListener('cuechange', syncCaptions);
  overview.textTracks.addEventListener('change', syncCaptions);
  document.addEventListener('fullscreenchange', syncCaptions);
  for (const event of ['webkitpresentationmodechanged', 'webkitbeginfullscreen',
    'webkitendfullscreen', 'enterpictureinpicture', 'leavepictureinpicture']) {
    overview.addEventListener(event, syncCaptions);
  }
  syncCaptions();

  const shade = $('film-shade');
  let visible = false;
  function updateTheater() {
    document.body.classList.toggle('watching-overview',
      visible && !overview.paused && !overview.ended && !overview.error);
  }
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting && entry.intersectionRatio >= 0.2;
    updateTheater();
  }, { threshold: [0, 0.2] }).observe(overview);
  for (const event of ['play', 'playing', 'pause', 'ended', 'emptied', 'error'])
    overview.addEventListener(event, updateTheater);
  shade.addEventListener('click', () => overview.pause());
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.classList.contains('watching-overview'))
      overview.pause();
  });
  const filmChapters = [...document.querySelectorAll('[data-film-start]')];
  for (const node of filmChapters) {
    node.addEventListener('click', () => {
      overview.currentTime = Number(node.dataset.filmStart);
      overview.play().catch(() => {});
    });
  }
  overview.addEventListener('timeupdate', () => {
    const active = filmChapters.findLast(node => Number(node.dataset.filmStart) <= overview.currentTime);
    if (active) select(active.parentElement, active);
  });

  const research = window.ALBUM_CURATION || {};
  const additions = window.ALBUM_CURATION_3D || {};
  const libraryBoard = $('library-board');
  if (libraryBoard && 'IntersectionObserver' in window) {
    let onScreen = true;
    let resumeOnReturn = false;
    function pauseOffscreen() {
      if (!onScreen && !libraryBoard.paused) {
        resumeOnReturn = true;
        libraryBoard.pause();
      }
    }
    libraryBoard.addEventListener('play', pauseOffscreen);
    new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      if (onScreen && resumeOnReturn) {
        resumeOnReturn = false;
        libraryBoard.play().catch(() => {});
      } else pauseOffscreen();
    }).observe(libraryBoard);
  }
  function mountResearch(id, entries, groupName) {
    if (!entries?.length) return;
    const host = $(id);
    host.append($('research-template').content.cloneNode(true));
    const tabs = host.querySelector('.evidence-tabs');
    const title = host.querySelector('.evidence-title');
    const source = host.querySelector('.evidence-source');
    const caption = host.querySelector('.evidence-caption');
    const screen = host.querySelector('.evidence-screen');
    const image = host.querySelector('.evidence-image');
    const video = host.querySelector('.evidence-video');

    const modes = document.createElement('div');
    modes.className = 'choices evidence-modes';
    modes.setAttribute('role', 'group');
    modes.setAttribute('aria-label', 'Display options');
    screen.before(modes);

    const live = document.createElement('div');
    live.className = 'evidence-live';
    live.hidden = true;
    const canvas = document.createElement('canvas');
    const status = document.createElement('p');
    status.className = 'evidence-model-status';
    status.setAttribute('role', 'status');
    status.hidden = true;
    const controls = document.createElement('div');
    controls.className = 'evidence-model-tools';
    controls.hidden = true;
    controls.append(
      button('Reset view', () => controller.reset()),
      button('−', () => controller.zoom(1.18)),
      button('+', () => controller.zoom(1 / 1.18)),
    );
    controls.children[1].setAttribute('aria-label', 'Zoom out');
    controls.children[2].setAttribute('aria-label', 'Zoom in');
    for (const control of controls.children) control.removeAttribute('aria-pressed');
    live.append(canvas, controls);
    screen.append(live, status);

    let controller;
    let request;
    let revision = 0;
    let videoMode = false;
    let inView = !('IntersectionObserver' in window);
    tabs.setAttribute('aria-label', groupName);

    function closeModel(release = false) {
      revision++;
      if (release && controller) {
        controller.dispose();
        controller = null;
      } else if (request) controller?.clear();
      request = null;
      live.hidden = true;
      controls.hidden = true;
      status.hidden = true;
    }

    function startModel() {
      if (!inView || !request || request.started) return;
      const selected = request;
      selected.started = true;
      const sameSelection = revision;
      requestAnimationFrame(async () => {
        if (sameSelection !== revision) return;
        try {
          controller ||= window.albumPbrViewer(canvas);
          await controller.open(selected.item.model);
          if (sameSelection !== revision) return;
          controls.hidden = false;
          status.hidden = true;
          controller.redraw();
        } catch (error) {
          if (sameSelection !== revision) return;
          console.warn('Could not load ' + selected.item.id, error);
          selected.fallback();
          status.textContent = 'Interactive 3D is unavailable. Showing the room preview.';
          status.hidden = false;
        }
      });
    }
    if (!inView) {
      new IntersectionObserver(([entry]) => {
        inView = entry.isIntersecting;
        startModel();
      }, { rootMargin: '150px 0px' }).observe(screen);
    }

    function mountItem(original, selector) {
      const item = { ...original, ...additions[original.id] };
      closeModel();
      select(tabs, selector);
      title.textContent = item.title;
      source.textContent = item.source || '';
      caption.textContent = item.description || '';

      function showPoster() {
        closeModel();
        video.pause();
        video.hidden = true;
        image.hidden = false;
        image.src = item.poster;
        image.alt = item.title;
      }
      function showVideo() {
        videoMode = true;
        select(modes, trajectoryButton);
        closeModel(true);
        image.hidden = true;
        video.hidden = false;
        const trajectory = item.trajectory;
        video.poster = trajectory.poster;
        if (video.getAttribute('src') !== trajectory.video) video.src = trajectory.video;
        video.setAttribute('aria-label', item.title + ', full training trajectory');
        video.play().catch(() => {});
      }

      const modelButton = button('Interactive 3D', () => {
        if (request && !live.hidden) return;
        videoMode = false;
        select(modes, modelButton);
        video.pause();
        video.hidden = true;
        image.hidden = true;
        live.hidden = false;
        canvas.setAttribute('aria-label', item.title + ', interactive 3D');
        status.textContent = 'Loading textured 3D…';
        status.hidden = false;
        request = { item, fallback: showPoster };
        startModel();
      });
      const trajectoryButton = button('Full training trajectory', showVideo);
      modes.replaceChildren(modelButton, trajectoryButton);
      (videoMode ? trajectoryButton : modelButton).click();
    }

    const tabsItems = entries.map((entry, index) =>
      thumbnail(entry.title, entry.poster, () => mountItem(entry, tabsItems[index]), index < 5),
    );
    tabs.append(...tabsItems);
    tabsItems[0].click();
  }
  mountResearch('dataset-gallery', research.datasets, 'Dataset examples');
})();
