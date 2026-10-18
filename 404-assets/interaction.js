(() => {
  'use strict';

  let dispose = null;

  function boot() {
    if (dispose || !document.body) return;
    const body = document.body;
    const scene = document.getElementById('scene');
    const canvas = document.getElementById('debrisCanvas');
    const impact = document.getElementById('impact');
    if (!scene || !canvas || !impact) return;

    const toggle = document.getElementById('drillToggle');
    const soundButton = document.getElementById('soundToggle');
    const status = document.getElementById('statusLine');
    const cracks = document.getElementById('cracks');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let context = null;
    try { context = canvas.getContext('2d'); } catch (_) {}
    const state = {
      running: body.dataset.running !== 'false' && !motion.matches,
      soundEnabled: true, reducedMotion: motion.matches, elapsed: 0, destroyed: false
    };
    const particles = [];
    const listeners = [];
    const colors = ['#675258', '#806970', '#998087', '#ae9399'];
    let width = 1, height = 1, origin = { x: 0, y: 0 };
    let frameId = 0, lastFrame = 0, lastDamage = 0, emission = 0;
    let audio = null, audioTimer = 0, audioVersion = 0, audioError = '';

    function on(target, name, handler, options) {
      if (!target) return;
      target.addEventListener(name, handler, options);
      listeners.push(() => target.removeEventListener(name, handler, options));
    }

    const paths = cracks ? [...cracks.querySelectorAll('path, polyline, line')].map((element) => {
      let length = 0;
      try { length = element.getTotalLength(); } catch (_) {}
      if (length > 0) element.style.strokeDasharray = String(length);
      return { element, length };
    }) : [];

    function updateDamage() {
      if (!cracks) return;
      const progress = Math.min(1, state.elapsed / 48);
      cracks.style.setProperty('--crack-progress', progress.toFixed(4));
      cracks.style.opacity = String(Math.min(0.6, progress * 2));
      paths.forEach(({ element, length }, index) => {
        const delay = Math.min(0.5, index * 0.075);
        const visible = Math.max(0, Math.min(1, (progress - delay) / (1 - delay)));
        if (length > 0) element.style.strokeDashoffset = String(length * (1 - visible));
      });
    }

    function syncUI() {
      body.dataset.running = String(state.running && !document.hidden);
      body.dataset.sound = String(state.soundEnabled);
      body.dataset.reducedMotion = String(state.reducedMotion);
      if (toggle) {
        toggle.textContent = state.running ? 'stop' : 'start';
        toggle.setAttribute('aria-pressed', String(state.running));
        toggle.setAttribute('aria-label', state.running ? 'Stop drilling' : 'Start drilling');
      }
      if (soundButton) {
        soundButton.textContent = state.soundEnabled ? 'sound: on' : 'sound: off';
        soundButton.setAttribute('aria-pressed', String(state.soundEnabled));
        soundButton.setAttribute('aria-label', state.soundEnabled ? 'Turn sound off' : 'Turn sound on');
      }
      updateAudioStatus();
    }

    function resize() {
      if (state.destroyed) return;
      const rect = canvas.getBoundingClientRect();
      const point = impact.getBoundingClientRect();
      const oldWidth = width, oldHeight = height;
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context?.setTransform(dpr, 0, 0, dpr, 0, 0);
      origin = {
        x: point.left + point.width / 2 - rect.left,
        y: point.top + point.height / 2 - rect.top
      };
      particles.forEach((particle) => {
        particle.x *= width / oldWidth;
        particle.y *= height / oldHeight;
      });
      scheduleFrame();
    }

    function addDust() {
      const reduced = state.reducedMotion;
      if (particles.length >= (reduced ? 4 : 48)) return;
      particles.push({
        x: origin.x + (Math.random() - 0.5) * 5,
        y: origin.y + (Math.random() - 0.5) * 5,
        vx: reduced ? (Math.random() - 0.5) * 6 : Math.random() * 70 - 47,
        vy: reduced ? -4 : -14 - Math.random() * 48,
        gravity: reduced ? 18 : 165,
        size: 0.55 + Math.random() * 1.3,
        life: reduced ? 0.3 : 0.4 + Math.random() * 0.55,
        age: 0, color: colors[Math.floor(Math.random() * colors.length)]
      });
    }

    function drawDust(dt) {
      if (!context) return;
      context.clearRect(0, 0, width, height);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.age += dt;
        p.vy += p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.age >= p.life || p.y > height + 8 || p.x < -8 || p.x > width + 8) {
          particles.splice(i, 1);
          continue;
        }
        context.globalAlpha = Math.min(0.75, (1 - p.age / p.life) * 1.5);
        context.fillStyle = p.color;
        context.fillRect(p.x, p.y, p.size, p.size * 0.8);
      }
      context.globalAlpha = 1;
    }

    function scheduleFrame() {
      if (!frameId && !state.destroyed && !document.hidden &&
        (state.running || particles.length)) frameId = requestAnimationFrame(frame);
    }

    function frame(time) {
      frameId = 0;
      if (state.destroyed || document.hidden) return;
      const dt = lastFrame ? Math.min(0.05, (time - lastFrame) / 1000) : 0;
      lastFrame = time;
      if (state.running) {
        state.elapsed += dt;
        if (context) {
          emission += dt * (state.reducedMotion ? 1.3 : 16);
          while (emission >= 1) { addDust(); emission--; }
        }
      }
      drawDust(dt);
      if (time - lastDamage > 100) { updateDamage(); lastDamage = time; }
      if (state.running || particles.length) scheduleFrame();
      else { lastFrame = 0; updateDamage(); }
    }

    function createAudio() {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error('unsupported');
      const ctx = new AudioContext();
      try {
        const gain = ctx.createGain();
        gain.gain.value = 0;
        gain.connect(ctx.destination);
        const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) {
          const phase = (i / ctx.sampleRate * 22) % 1;
          samples[i] = (Math.random() * 2 - 1) * (0.055 + 0.8 * Math.exp(-phase * 16));
        }
        const hammer = ctx.createBufferSource();
        hammer.buffer = buffer;
        hammer.loop = true;
        const hammerFilter = ctx.createBiquadFilter();
        hammerFilter.type = 'bandpass';
        hammerFilter.frequency.value = 1800;
        hammerFilter.Q.value = 0.7;
        hammer.connect(hammerFilter);
        hammerFilter.connect(gain);
        const motor = ctx.createOscillator();
        motor.type = 'sawtooth';
        motor.frequency.value = 83;
        const motorFilter = ctx.createBiquadFilter();
        motorFilter.type = 'lowpass';
        motorFilter.frequency.value = 550;
        const motorGain = ctx.createGain();
        motorGain.gain.value = 0.11;
        motor.connect(motorFilter);
        motorFilter.connect(motorGain);
        motorGain.connect(gain);
        hammer.start();
        motor.start();
        return { ctx, gain, hammer, motor,
          nodes: [hammer, hammerFilter, motor, motorFilter, motorGain, gain] };
      } catch (error) {
        void ctx.close().catch(() => {});
        throw error;
      }
    }

    function wantsSound() {
      return !state.destroyed && state.soundEnabled && state.running && !document.hidden;
    }

    function updateAudioStatus() {
      if (!status) return;
      status.textContent = audioError ||
        (wantsSound() && audio?.ctx.state !== 'running' ? 'click anywhere for sound' : '');
    }

    function isAutoplayBlock(error) {
      return error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
    }

    function failSound(message = 'Could not enable sound. Try again.') {
      if (state.destroyed) return;
      audioVersion++;
      clearTimeout(audioTimer);
      state.soundEnabled = false;
      audioError = message;
      if (audio) {
        try {
          audio.gain.gain.cancelScheduledValues(audio.ctx.currentTime);
          audio.gain.gain.value = 0;
          if (audio.ctx.state !== 'closed') void audio.ctx.suspend().catch(() => {});
        } catch (_) {}
      }
      syncUI();
    }

    function applyAudioState(engine) {
      if (state.destroyed || audio !== engine) return;
      if (engine.ctx.state === 'closed') {
        failSound('Sound is unavailable. Try enabling it again.');
        return;
      }
      try {
        const now = engine.ctx.currentTime;
        engine.gain.gain.cancelScheduledValues(now);
        if (wantsSound() && engine.ctx.state === 'running') {
          engine.gain.gain.setTargetAtTime(0.25, now, 0.02);
        } else {
          engine.gain.gain.setValueAtTime(0, now);
          if (!wantsSound() && engine.ctx.state === 'running') {
            void engine.ctx.suspend().catch(() => {});
          }
        }
        updateAudioStatus();
      } catch (_) { failSound(); }
    }

    function ensureAudio() {
      if (audio && audio.ctx.state !== 'closed') return true;
      try {
        const engine = createAudio();
        audio = engine;
        audioError = '';
        on(engine.ctx, 'statechange', () => applyAudioState(engine));
        return true;
      } catch (error) {
        if (isAutoplayBlock(error)) {
          updateAudioStatus();
        } else {
          failSound(error?.message === 'unsupported' || error?.name === 'NotSupportedError'
            ? 'Sound is not supported in this browser.' : undefined);
        }
        return false;
      }
    }

    function syncAudio() {
      const version = ++audioVersion;
      clearTimeout(audioTimer);
      if (state.destroyed) return;
      if (state.soundEnabled && !ensureAudio()) return;
      if (!audio) { updateAudioStatus(); return; }
      const engine = audio;
      try {
        const now = engine.ctx.currentTime;
        engine.gain.gain.cancelScheduledValues(now);
        if (!wantsSound()) {
          engine.gain.gain.setTargetAtTime(0, now, 0.01);
          audioTimer = window.setTimeout(() => {
            if (version === audioVersion && engine.ctx.state !== 'closed') {
              void engine.ctx.suspend().catch(() => {});
            }
          }, 90);
          updateAudioStatus();
          return;
        }
        if (engine.ctx.state === 'running') {
          applyAudioState(engine);
          return;
        }
        // Call resume synchronously here so control handlers retain the user gesture.
        const resumed = engine.ctx.resume();
        updateAudioStatus();
        void Promise.resolve(resumed).then(() => {
          if (state.destroyed || version !== audioVersion) return;
          applyAudioState(engine);
        }).catch((error) => {
          if (state.destroyed || version !== audioVersion) return;
          if (isAutoplayBlock(error)) updateAudioStatus();
          else failSound(error?.name === 'NotSupportedError'
            ? 'Sound is not supported in this browser.' : undefined);
        });
      } catch (error) {
        if (isAutoplayBlock(error)) updateAudioStatus();
        else failSound();
      }
    }

    function setRunning(value) {
      if (state.destroyed) return;
      state.running = Boolean(value);
      lastFrame = 0;
      syncUI();
      syncAudio();
      scheduleFrame();
    }

    on(toggle, 'click', () => setRunning(!state.running));
    on(soundButton, 'click', () => {
      state.soundEnabled = !state.soundEnabled;
      audioError = '';
      syncUI();
      syncAudio();
    });
    on(document, 'keydown', (event) => {
      if (event.code !== 'Space' || event.repeat || event.isComposing ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof Element && (target.isContentEditable ||
        target.closest('form, button, input, textarea, select, a, [role="button"], [role="textbox"], [role="slider"], [role="combobox"]'))) return;
      event.preventDefault();
      setRunning(!state.running);
    });
    function unlockSound(event) {
      if (!wantsSound() || audio?.ctx.state === 'running') return;
      if (event.type === 'keydown' && (event.code === 'Space' || event.key === ' ' ||
        event.repeat || event.isComposing || event.altKey || event.ctrlKey || event.metaKey)) return;
      const target = event.target;
      // In particular, a first press on sound: on must only switch sound off.
      if (target instanceof Element && target.closest('button, a, [role="button"]')) return;
      syncAudio();
    }
    on(document, 'pointerdown', unlockSound, { passive: true });
    on(document, 'click', unlockSound);
    on(document, 'keydown', unlockSound);
    on(document, 'visibilitychange', () => {
      cancelAnimationFrame(frameId);
      frameId = 0;
      lastFrame = 0;
      syncUI();
      syncAudio();
      if (!document.hidden) resize();
    });
    on(window, 'resize', resize, { passive: true });
    const motionChange = (event) => {
      state.reducedMotion = event.matches;
      particles.length = 0;
      context?.clearRect(0, 0, width, height);
      if (event.matches) setRunning(false);
      else syncUI();
    };
    if (motion.addEventListener) on(motion, 'change', motionChange);
    else if (motion.addListener) {
      motion.addListener(motionChange);
      listeners.push(() => motion.removeListener(motionChange));
    }
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    observer?.observe(scene);
    observer?.observe(impact);

    const api = Object.freeze({
      play: () => setRunning(true), pause: () => setRunning(false),
      getState: () => Object.freeze({
        running: state.running, active: state.running && !document.hidden,
        soundEnabled: state.soundEnabled, reducedMotion: state.reducedMotion,
        audioState: audio?.ctx.state || 'unavailable'
      })
    });
    window.plovlover404 = api;
    dispose = () => {
      state.destroyed = true;
      audioVersion++;
      cancelAnimationFrame(frameId);
      clearTimeout(audioTimer);
      observer?.disconnect();
      listeners.forEach((remove) => remove());
      particles.length = 0;
      context?.clearRect(0, 0, width, height);
      body.dataset.running = 'false';
      body.dataset.sound = 'false';
      if (audio) {
        audio.gain.gain.value = 0;
        try { audio.hammer.stop(); audio.motor.stop(); } catch (_) {}
        audio.nodes.forEach((node) => { try { node.disconnect(); } catch (_) {} });
        if (audio.ctx.state !== 'closed') void audio.ctx.close().catch(() => {});
      }
      if (window.plovlover404 === api) delete window.plovlover404;
    };

    if (status) status.textContent = '';
    syncUI();
    updateDamage();
    resize();
    syncAudio();
  }

  window.addEventListener('pagehide', () => { dispose?.(); dispose = null; });
  window.addEventListener('pageshow', (event) => { if (event.persisted) boot(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

