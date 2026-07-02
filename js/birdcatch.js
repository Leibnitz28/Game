// ============================================================
// birdcatch.js — Catch Birds Experience
// ============================================================

function createBirdCatchSketch(containerElement, initialDifficulty) {
  return new p5((p) => {

    // --- Constants & Config ---
    const DIFFICULTY_SETTINGS = {
      easy:   { baseSpeed: 1.8, spawnInterval: 1400 },
      medium: { baseSpeed: 2.8, spawnInterval: 950 },
      hard:   { baseSpeed: 4.2, spawnInterval: 600 }
    };

    // Bird type definitions
    // weight = spawn chance out of 100
    const BIRD_TYPES = {
      common: {
        weight: 60, points: 10, radiusBase: 18,
        colors: [
          { body: [139, 119, 101], wing: [160, 140, 120] },
          { body: [120, 120, 130], wing: [145, 145, 155] },
          { body: [150, 130, 100], wing: [175, 155, 120] }
        ]
      },
      rare: {
        weight: 25, points: 25, radiusBase: 24,
        colors: [
          { body: [50, 140, 220], wing: [80, 180, 255] },
          { body: [220, 60, 120], wing: [255, 100, 160] },
          { body: [80, 200, 120], wing: [130, 240, 160] }
        ]
      },
      golden: {
        weight: 8, points: 50, radiusBase: 21,
        colors: [
          { body: [255, 215, 0], wing: [255, 240, 100] }
        ]
      },
      hazard: {
        weight: 7, points: -20, radiusBase: 20,
        colors: [
          { body: [140, 20, 20], wing: [60, 10, 10] }
        ]
      }
    };

    const MAX_BIRDS = 20;
    const MAX_PARTICLES = 150;
    const MAX_CLOUDS = 15;
    const COMBO_WINDOW = 800; // ms

    // --- State ---
    let difficultyKey = initialDifficulty || 'medium';
    let currentDiff = DIFFICULTY_SETTINGS[difficultyKey];

    let isPlaying = false;
    let sessionStartTime = 0;

    let score = 0;
    let displayScore = 0;
    let bestScore = 0;

    let birds = [];
    let particles = [];   // feather particles
    let clouds = [];       // parallax cloud layers
    let comboPopups = [];  // {x, y, text, life, color}

    let lastSpawnTime = 0;

    // Speed Modifiers
    let handHeightModifier = 1.0;
    let timeRampMultiplier = 1.0;

    // Combo System
    let comboCount = 0;
    let lastCatchTime = 0;

    // Screen Shake
    let shakeAmount = 0;

    // Red flash overlay (hazard catch)
    let redFlashAlpha = 0;

    // Grab detection: track open hand state per label
    let wasOpenHand = { Left: false, Right: false };
    // Prevent double-grab on same fist hold
    let grabConsumed = { Left: false, Right: false };

    // DOM overlay
    let diffOverlay = null;
    let diffButtons = {};

    // --- Setup ---
    p.setup = function () {
      const cw = containerElement.clientWidth;
      const ch = containerElement.clientHeight;
      p.createCanvas(cw, ch);

      setupDifficultyMenu();
      initClouds();
      startGame(difficultyKey);
    };

    // ============================
    // Difficulty Menu (DOM overlay)
    // ============================
    function setupDifficultyMenu() {
      diffOverlay = document.createElement('div');
      diffOverlay.className = 'difficulty-overlay hidden';
      diffOverlay.innerHTML = `
        <div class="difficulty-content">
          <h2>Select Difficulty</h2>
          <p>This will reset your current game session.</p>
          <div class="difficulty-buttons">
            <button class="diff-btn easy" data-diff="easy">Easy</button>
            <button class="diff-btn medium" data-diff="medium">Medium</button>
            <button class="diff-btn hard" data-diff="hard">Hard</button>
          </div>
        </div>
      `;
      containerElement.appendChild(diffOverlay);

      const btns = diffOverlay.querySelectorAll('.diff-btn');
      btns.forEach(btn => {
        const d = btn.getAttribute('data-diff');
        diffButtons[d] = btn;
        btn.addEventListener('click', () => {
          diffOverlay.classList.add('hidden');
          startGame(d);
        });
      });

      // Bind header button
      const openBtn = document.getElementById('birdcatch-difficulty-btn');
      if (openBtn) {
        openBtn.onclick = () => {
          updateDiffButtons();
          diffOverlay.classList.remove('hidden');
          isPlaying = false;
        };
      }
    }

    function updateDiffButtons() {
      for (const k in diffButtons) {
        if (k === difficultyKey) diffButtons[k].classList.add('active');
        else diffButtons[k].classList.remove('active');
      }
    }

    function startGame(newDiffKey) {
      difficultyKey = newDiffKey;
      currentDiff = DIFFICULTY_SETTINGS[difficultyKey];
      bestScore = parseInt(localStorage.getItem('birdcatch_best_' + difficultyKey)) || 0;

      score = 0;
      displayScore = 0;
      comboCount = 0;
      birds = [];
      particles = [];
      comboPopups = [];
      handHeightModifier = 1.0;
      timeRampMultiplier = 1.0;
      shakeAmount = 0;
      redFlashAlpha = 0;
      wasOpenHand = { Left: false, Right: false };
      grabConsumed = { Left: false, Right: false };

      sessionStartTime = performance.now();
      lastSpawnTime = sessionStartTime;
      lastCatchTime = 0;
      isPlaying = true;
    }

    // ============================
    // Clouds (parallax background)
    // ============================
    function initClouds() {
      clouds = [];
      for (let i = 0; i < MAX_CLOUDS; i++) {
        clouds.push(makeCloud());
      }
    }

    function makeCloud(startOffscreen) {
      const layer = Math.floor(Math.random() * 3); // 0=far, 1=mid, 2=near
      const speedFactor = [0.15, 0.35, 0.6][layer];
      const sizeFactor = [0.6, 1.0, 1.4][layer];
      const alphaFactor = [30, 50, 70][layer];
      const w = (50 + Math.random() * 120) * sizeFactor;
      const h = (20 + Math.random() * 40) * sizeFactor;
      return {
        x: startOffscreen ? -w - Math.random() * 200 : Math.random() * (p.width + 200) - 100,
        y: Math.random() * p.height * 0.6,
        w: w,
        h: h,
        speed: (0.2 + Math.random() * 0.5) * speedFactor,
        alpha: alphaFactor + Math.random() * 20,
        layer: layer
      };
    }

    function updateAndDrawClouds() {
      p.noStroke();
      for (let i = 0; i < clouds.length; i++) {
        const c = clouds[i];
        c.x += c.speed;
        // Recycle if offscreen right
        if (c.x > p.width + c.w) {
          clouds[i] = makeCloud(true);
          clouds[i].x = -clouds[i].w;
          continue;
        }
        p.fill(255, 255, 255, c.alpha);
        // Draw cloud as cluster of overlapping ellipses
        p.ellipse(c.x, c.y, c.w, c.h);
        p.ellipse(c.x - c.w * 0.25, c.y + c.h * 0.1, c.w * 0.6, c.h * 0.8);
        p.ellipse(c.x + c.w * 0.3, c.y + c.h * 0.05, c.w * 0.5, c.h * 0.7);
      }
    }

    // ============================
    // Main Draw Loop
    // ============================
    p.draw = function () {
      p.clear();

      // 1. Sky gradient background
      drawSkyGradient();

      // 2. Webcam faint overlay
      drawWebcamBackground();

      // 3. Parallax clouds (behind everything game-related)
      updateAndDrawClouds();

      if (!isPlaying) {
        drawHUD();
        return;
      }

      const now = performance.now();

      // 4. Process game logic
      updateModifiers(now);
      processSpawns(now);
      processHands(now);
      updatePhysics(now);

      // 5. Draw game world (with shake)
      p.push();
      if (shakeAmount > 0) {
        p.translate(p.random(-shakeAmount, shakeAmount), p.random(-shakeAmount, shakeAmount));
        shakeAmount *= 0.88;
        if (shakeAmount < 0.5) shakeAmount = 0;
      }

      drawBirds(now);
      drawParticles();
      drawComboPopups();

      p.pop(); // end shake

      // 6. Red flash overlay (hazard)
      if (redFlashAlpha > 0) {
        p.noStroke();
        p.fill(255, 30, 30, redFlashAlpha);
        p.rect(0, 0, p.width, p.height);
        redFlashAlpha *= 0.88;
        if (redFlashAlpha < 1) redFlashAlpha = 0;
      }

      // 7. Shared overlays
      drawFaceGlow(p, faceData, p.width, p.height);
      drawHandHUD(p, handsData, p.width, p.height);

      // 8. HUD
      drawHUD(now);
    };

    // ============================
    // Background Renderers
    // ============================
    function drawSkyGradient() {
      const ctx = p.drawingContext;
      const grad = ctx.createLinearGradient(0, 0, 0, p.height);
      grad.addColorStop(0, '#87CEEB');
      grad.addColorStop(1, '#E0F0FF');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, p.width, p.height);
    }

    function drawWebcamBackground() {
      const video = getVideoElement();
      if (video && video.readyState >= 2) {
        p.push();
        p.translate(p.width, 0);
        p.scale(-1, 1);
        p.drawingContext.globalAlpha = 30 / 255;
        p.drawingContext.drawImage(video, 0, 0, p.width, p.height);
        p.drawingContext.globalAlpha = 1.0;
        p.pop();
      }
    }

    // ============================
    // Core Systems
    // ============================
    function updateModifiers(now) {
      const elapsedSec = (now - sessionStartTime) / 1000.0;
      // Same time ramp formula as fruit game
      timeRampMultiplier = 1.0 + 1.5 * (1.0 - Math.exp(-elapsedSec / 120.0));
    }

    function processSpawns(now) {
      const finalSpeedMult = handHeightModifier * timeRampMultiplier;
      const currentSpawnInterval = currentDiff.spawnInterval / finalSpeedMult;

      if (now - lastSpawnTime > currentSpawnInterval && birds.length < MAX_BIRDS) {
        lastSpawnTime = now;
        spawnBird();
      }
    }

    function pickBirdType() {
      const roll = Math.random() * 100;
      let cumulative = 0;
      for (const key of ['common', 'rare', 'golden', 'hazard']) {
        cumulative += BIRD_TYPES[key].weight;
        if (roll < cumulative) return key;
      }
      return 'common';
    }

    function spawnBird() {
      const typeName = pickBirdType();
      const typeDef = BIRD_TYPES[typeName];
      const colorSet = typeDef.colors[Math.floor(Math.random() * typeDef.colors.length)];

      const fromLeft = Math.random() < 0.5;
      const startX = fromLeft ? -30 : p.width + 30;
      const startY = p.random(p.height * 0.08, p.height * 0.75);
      const dirX = fromLeft ? 1 : -1;

      // Flight pattern
      const patterns = ['straight', 'sine', 'diagonal'];
      const pattern = patterns[Math.floor(Math.random() * patterns.length)];

      let baseVx = (1.0 + Math.random() * 1.5) * dirX;
      let baseVy = 0;

      if (pattern === 'diagonal') {
        baseVy = (Math.random() - 0.5) * 1.2;
      }

      // Hazard birds are faster and more erratic
      if (typeName === 'hazard') {
        baseVx *= 1.4;
        baseVy += (Math.random() - 0.5) * 0.8;
      }

      const radius = typeDef.radiusBase + Math.random() * 6;

      birds.push({
        x: startX,
        y: startY,
        vx: baseVx,
        vy: baseVy,
        type: typeName,
        points: typeDef.points,
        bodyColor: colorSet.body,
        wingColor: colorSet.wing,
        radius: radius,
        flapPhase: Math.random() * p.TWO_PI,
        flapSpeed: 0.15 + Math.random() * 0.1,
        pattern: pattern,
        sineAmp: 30 + Math.random() * 40,
        sineFreq: 0.02 + Math.random() * 0.015,
        originY: startY,
        age: 0,
        caught: false,
        // Golden sparkle phase
        sparklePhase: 0
      });
    }

    // ============================
    // Hand Processing & Grab Detection
    // ============================
    function processHands(now) {
      if (!handsData || !handsData.landmarks || handsData.landmarks.length === 0) {
        handHeightModifier = p.lerp(handHeightModifier, 1.0, 0.01);
        // Reset open hand tracking when no hands visible
        wasOpenHand.Left = false;
        wasOpenHand.Right = false;
        grabConsumed.Left = false;
        grabConsumed.Right = false;
        return;
      }

      let sumY = 0;
      let handCount = 0;
      const seenLabels = new Set();

      for (let i = 0; i < handsData.landmarks.length; i++) {
        const lm = handsData.landmarks[i];
        const worldLms = handsData.worldLandmarks[i];
        const label = handsData.handedness[i]?.label || 'Right';
        seenLabels.add(label);

        // Accumulate Y for speed modifier
        sumY += lm[LM.WRIST].y;
        handCount++;

        // Hand position (wrist) on canvas
        const handX = toCanvasX(lm[LM.WRIST].x, p.width);
        const handY = toCanvasY(lm[LM.WRIST].y, p.height);

        // Determine open hand state: 3+ extended fingers = open
        const extFingers = countExtendedFingers(worldLms);
        const isOpen = extFingers >= 3;
        const isFistNow = gestureTracker.get(label, 'fist');

        // Detect TRANSITION: was open → now fist (and not already consumed)
        if (wasOpenHand[label] && isFistNow && !grabConsumed[label]) {
          // Grab attempt! Check collision with birds
          grabConsumed[label] = true;
          attemptGrab(handX, handY, now);
        }

        // Update wasOpen state
        if (isOpen) {
          wasOpenHand[label] = true;
          grabConsumed[label] = false; // Reset consumed when hand re-opens
        } else if (!isFistNow) {
          // Transitional state (partially closed) — keep wasOpen as is
        }

        // If fist released (no longer fist), allow future grabs
        if (!isFistNow) {
          grabConsumed[label] = false;
        }
      }

      // Reset labels not seen
      for (const label of ['Left', 'Right']) {
        if (!seenLabels.has(label)) {
          wasOpenHand[label] = false;
          grabConsumed[label] = false;
        }
      }

      // Update hand height speed modifier
      const avgY = sumY / handCount;
      const targetHeightMod = p.constrain(p.map(avgY, 0.8, 0.2, 0.5, 1.5), 0.5, 1.5);
      handHeightModifier = p.lerp(handHeightModifier, targetHeightMod, 0.03);
    }

    function attemptGrab(handX, handY, now) {
      // Find closest uncaught bird within grab range
      let closestBird = null;
      let closestDist = Infinity;

      for (let b of birds) {
        if (b.caught) continue;
        const dx = handX - b.x;
        const dy = handY - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const hitRadius = b.radius * 2.5; // generous hitbox
        if (dist < hitRadius && dist < closestDist) {
          closestDist = dist;
          closestBird = b;
        }
      }

      if (closestBird) {
        catchBird(closestBird, now);
      }
    }

    function catchBird(bird, now) {
      bird.caught = true;

      if (bird.type === 'hazard') {
        // PENALTY
        shakeAmount = 15;
        redFlashAlpha = 120;
        score = Math.max(0, score + bird.points); // -20
        comboCount = 0;

        comboPopups.push({
          x: bird.x, y: bird.y,
          text: bird.points.toString(),
          life: 1.0,
          color: [255, 60, 60]
        });

        // Angry particles
        spawnFeathers(bird.x, bird.y, [80, 10, 10], 8);

      } else {
        // SCORE
        // Combo logic
        if (now - lastCatchTime < COMBO_WINDOW && lastCatchTime > 0) {
          comboCount++;
        } else {
          comboCount = 1;
        }
        lastCatchTime = now;

        const comboMultiplier = 1 + comboCount * 0.5;
        const earnedPoints = Math.round(bird.points * comboMultiplier);
        score += earnedPoints;

        // Shake
        shakeAmount = bird.type === 'golden' ? 8 : 3;

        // Combo popup
        if (comboCount > 1) {
          comboPopups.push({
            x: bird.x, y: bird.y - 20,
            text: 'Combo x' + comboCount + '!',
            life: 1.0,
            color: [255, 220, 50]
          });
        }

        // Points popup
        comboPopups.push({
          x: bird.x, y: bird.y,
          text: '+' + earnedPoints,
          life: 1.0,
          color: bird.type === 'golden' ? [255, 240, 80] : [255, 255, 255]
        });

        // Feather burst
        const featherColor = bird.type === 'golden'
          ? [255, 240, 150]
          : [230, 225, 220];
        const featherCount = bird.type === 'golden' ? 20 : p.floor(p.random(6, 11));
        spawnFeathers(bird.x, bird.y, featherColor, featherCount);
      }

      // Update best score
      if (score > bestScore) {
        bestScore = score;
        localStorage.setItem('birdcatch_best_' + difficultyKey, bestScore.toString());
      }
    }

    // ============================
    // Particles (feathers)
    // ============================
    function spawnFeathers(x, y, baseColor, count) {
      for (let i = 0; i < count; i++) {
        if (particles.length >= MAX_PARTICLES) break;
        const angle = p.random(p.TWO_PI);
        const speed = p.random(1.5, 5);
        particles.push({
          x: x,
          y: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - p.random(1, 3), // slight upward bias
          color: [
            baseColor[0] + p.random(-20, 20),
            baseColor[1] + p.random(-20, 20),
            baseColor[2] + p.random(-20, 20)
          ],
          rotation: p.random(p.TWO_PI),
          rotSpeed: p.random(-0.15, 0.15),
          life: 1.0,
          decay: p.random(0.012, 0.03),
          size: p.random(4, 9)
        });
      }
    }

    // ============================
    // Physics Update
    // ============================
    function updatePhysics(now) {
      const finalSpeedMult = currentDiff.baseSpeed * handHeightModifier * timeRampMultiplier;

      // --- Birds ---
      for (let i = birds.length - 1; i >= 0; i--) {
        const b = birds[i];
        b.age++;
        b.flapPhase += b.flapSpeed;
        b.sparklePhase += 0.1;

        if (b.caught) {
          // Fall down after caught
          b.vy += 0.4;
          b.x += b.vx * 0.3;
          b.y += b.vy;
          b.flapSpeed = 0; // stop flapping
          // Remove when off screen
          if (b.y > p.height + 60) {
            birds.splice(i, 1);
          }
          continue;
        }

        // Normal flight
        b.x += b.vx * finalSpeedMult;

        if (b.pattern === 'sine') {
          b.y = b.originY + Math.sin(b.age * b.sineFreq) * b.sineAmp;
        } else if (b.pattern === 'diagonal') {
          b.y += b.vy * finalSpeedMult;
        }
        // straight: y stays constant

        // Hazard erratic jitter
        if (b.type === 'hazard') {
          b.y += Math.sin(b.age * 0.12) * 1.5;
        }

        // Remove if flown offscreen
        if ((b.vx > 0 && b.x > p.width + 60) || (b.vx < 0 && b.x < -60)) {
          birds.splice(i, 1);
          continue;
        }
        // Also remove if too far off vertically
        if (b.y > p.height + 80 || b.y < -80) {
          birds.splice(i, 1);
        }
      }

      // --- Particles ---
      for (let i = particles.length - 1; i >= 0; i--) {
        const pt = particles[i];
        pt.vy += 0.08; // gentle gravity
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.vx *= 0.98; // air resistance
        pt.rotation += pt.rotSpeed;
        pt.life -= pt.decay;
        if (pt.life <= 0) particles.splice(i, 1);
      }

      // --- Combo popups ---
      for (let i = comboPopups.length - 1; i >= 0; i--) {
        comboPopups[i].life -= 0.018;
        comboPopups[i].y -= 1.2; // float up
        if (comboPopups[i].life <= 0) comboPopups.splice(i, 1);
      }
    }

    // ============================
    // Bird Rendering
    // ============================
    function drawBirds(now) {
      for (const b of birds) {
        p.push();
        p.translate(b.x, b.y);

        // Pop-in scale
        const popScale = Math.min(1.0, b.age / 12.0);
        p.scale(popScale);

        // Face direction of travel
        if (b.vx < 0) p.scale(-1, 1);

        // Wing flap value: -1 to 1
        const flap = Math.sin(b.flapPhase);

        if (b.type === 'hazard') {
          drawHazardBird(b, flap);
        } else {
          drawNormalBird(b, flap);
        }

        // Golden glow & sparkles
        if (b.type === 'golden' && !b.caught) {
          drawGoldenEffects(b);
        }

        p.pop();
      }
    }

    function drawNormalBird(b, flap) {
      const r = b.radius;
      const bodyW = r * 2.2;
      const bodyH = r * 1.5;

      // --- Wings (behind body) ---
      p.push();
      p.noStroke();
      p.fill(b.wingColor[0], b.wingColor[1], b.wingColor[2]);

      // Upper wing (flapping)
      const wingAngle = flap * 0.6; // radians of flap rotation

      // Left wing (top)
      p.push();
      p.translate(-r * 0.2, -r * 0.1);
      p.rotate(-0.3 + wingAngle);
      p.triangle(0, 0, -r * 1.6, -r * 0.8, -r * 0.6, r * 0.3);
      p.pop();

      // Right wing (bottom — since we mirror for direction, this is the other wing visually)
      p.push();
      p.translate(-r * 0.2, r * 0.1);
      p.rotate(0.3 - wingAngle);
      p.triangle(0, 0, -r * 1.6, r * 0.8, -r * 0.6, -r * 0.3);
      p.pop();

      p.pop();

      // --- Body ---
      p.noStroke();

      // Rare birds: gradient body (two-color fill via overlapping ellipses)
      if (b.type === 'rare') {
        p.fill(b.wingColor[0], b.wingColor[1], b.wingColor[2]);
        p.ellipse(0, 0, bodyW * 1.05, bodyH * 1.05);
      }

      p.fill(b.bodyColor[0], b.bodyColor[1], b.bodyColor[2]);
      p.ellipse(0, 0, bodyW, bodyH);

      // --- Head ---
      const headR = r * 0.65;
      p.fill(b.bodyColor[0] + 15, b.bodyColor[1] + 15, b.bodyColor[2] + 15);
      p.ellipse(r * 0.9, -r * 0.15, headR * 2, headR * 1.8);

      // Eye
      p.fill(20);
      p.ellipse(r * 1.1, -r * 0.25, 4, 4);
      p.fill(255);
      p.ellipse(r * 1.15, -r * 0.3, 1.5, 1.5);

      // Beak
      p.fill(230, 180, 50);
      p.triangle(r * 1.4, -r * 0.15, r * 1.8, -r * 0.05, r * 1.4, r * 0.05);

      // Tail feathers
      p.fill(b.wingColor[0], b.wingColor[1], b.wingColor[2], 200);
      p.triangle(-r * 0.9, -r * 0.1, -r * 1.8, -r * 0.5, -r * 1.2, r * 0.1);
      p.triangle(-r * 0.9, r * 0.1, -r * 1.7, r * 0.4, -r * 1.1, -r * 0.05);
    }

    function drawHazardBird(b, flap) {
      const r = b.radius;

      // Spiky body — angular shape
      p.noStroke();
      p.fill(b.bodyColor[0], b.bodyColor[1], b.bodyColor[2]);

      // Main body: angular ellipse
      p.ellipse(0, 0, r * 2, r * 1.3);

      // Spikes around body
      p.fill(30, 5, 5);
      const spikeCount = 6;
      for (let s = 0; s < spikeCount; s++) {
        const a = (s / spikeCount) * p.TWO_PI + b.sparklePhase * 0.5;
        const bx = Math.cos(a) * r * 0.8;
        const by = Math.sin(a) * r * 0.5;
        const tx = Math.cos(a) * r * 1.4;
        const ty = Math.sin(a) * r * 0.9;
        p.triangle(
          bx - 3, by,
          bx + 3, by,
          tx, ty
        );
      }

      // Wings (dark, angular)
      p.fill(b.wingColor[0], b.wingColor[1], b.wingColor[2]);
      const wingAngle = flap * 0.5;

      p.push();
      p.translate(0, -r * 0.1);
      p.rotate(-0.2 + wingAngle);
      p.triangle(0, 0, -r * 1.4, -r * 0.9, -r * 0.5, r * 0.2);
      p.pop();

      p.push();
      p.translate(0, r * 0.1);
      p.rotate(0.2 - wingAngle);
      p.triangle(0, 0, -r * 1.4, r * 0.9, -r * 0.5, -r * 0.2);
      p.pop();

      // Angry eyes
      p.fill(255, 50, 0);
      p.ellipse(r * 0.5, -r * 0.2, 6, 6);
      p.fill(20);
      p.ellipse(r * 0.55, -r * 0.2, 3, 3);

      // Stinger/beak
      p.fill(200, 160, 0);
      p.triangle(r * 0.8, 0, r * 1.5, 0, r * 0.8, r * 0.15);
    }

    function drawGoldenEffects(b) {
      const r = b.radius;

      // Glow aura
      p.noStroke();
      p.drawingContext.shadowColor = 'rgba(255, 215, 0, 0.6)';
      p.drawingContext.shadowBlur = 20;
      p.fill(255, 240, 100, 30);
      p.ellipse(0, 0, r * 3.5, r * 3);
      p.drawingContext.shadowBlur = 0;

      // Sparkle particles (drawn directly, not added to particle array)
      const sparkleCount = 5;
      for (let s = 0; s < sparkleCount; s++) {
        const angle = b.sparklePhase * 1.5 + (s / sparkleCount) * p.TWO_PI;
        const dist = r * 1.2 + Math.sin(b.sparklePhase * 2 + s) * r * 0.5;
        const sx = Math.cos(angle) * dist;
        const sy = Math.sin(angle) * dist * 0.7;
        const sparkSize = 2 + Math.sin(b.sparklePhase * 3 + s * 1.5) * 2;
        p.fill(255, 255, 200, 180 + Math.sin(b.sparklePhase + s) * 60);
        p.ellipse(sx, sy, sparkSize, sparkSize);
      }
    }

    // ============================
    // Particle Rendering
    // ============================
    function drawParticles() {
      p.noStroke();
      for (const pt of particles) {
        p.push();
        p.translate(pt.x, pt.y);
        p.rotate(pt.rotation);
        p.fill(pt.color[0], pt.color[1], pt.color[2], pt.life * 220);
        // Feather shape: thin elongated ellipse
        p.ellipse(0, 0, pt.size * 1.5, pt.size * 0.5);
        p.pop();
      }
    }

    // ============================
    // Combo Popups
    // ============================
    function drawComboPopups() {
      p.textAlign(p.CENTER, p.CENTER);
      p.textStyle(p.BOLD);

      for (const c of comboPopups) {
        const scale = p.map(c.life, 0, 1, 0.6, 1.3);
        p.push();
        p.translate(c.x, c.y);
        p.scale(scale);

        p.drawingContext.shadowColor = 'rgba(0,0,0,0.7)';
        p.drawingContext.shadowBlur = 4;

        p.fill(c.color[0], c.color[1], c.color[2], c.life * 255);
        p.textSize(c.text.startsWith('Combo') ? 28 : 22);
        p.text(c.text, 0, 0);

        p.drawingContext.shadowBlur = 0;
        p.pop();
      }
      p.textStyle(p.NORMAL);
    }

    // ============================
    // HUD
    // ============================
    function drawHUD(now) {
      p.push();
      p.colorMode(p.RGB);
      p.noStroke();
      p.textAlign(p.LEFT, p.TOP);

      p.drawingContext.shadowColor = 'rgba(0,0,0,0.8)';
      p.drawingContext.shadowBlur = 4;

      // Score count-up animation
      displayScore = p.lerp(displayScore, score, 0.2);
      if (Math.abs(score - displayScore) < 0.5) displayScore = score;

      // Top Left: Score
      p.fill(255);
      p.textSize(32);
      p.text('Score: ' + Math.round(displayScore), 20, 20);

      p.textSize(16);
      p.fill(220);
      p.text('Best (' + difficultyKey + '): ' + bestScore, 20, 60);

      if (isPlaying && now) {
        // Time
        const elapsed = Math.floor((now - sessionStartTime) / 1000);
        const m = Math.floor(elapsed / 60);
        const s = (elapsed % 60).toString().padStart(2, '0');
        p.text('Time: ' + m + ':' + s, 20, 85);

        // Combo indicator
        if (comboCount > 1) {
          p.fill(255, 220, 50);
          p.textSize(18);
          p.text('Combo: x' + comboCount, 20, 110);
        }

        // Speed Meter (right side)
        const finalSpeedMult = handHeightModifier * timeRampMultiplier;
        p.textAlign(p.RIGHT, p.TOP);
        p.fill(220);
        p.textSize(16);
        p.text('Speed', p.width - 20, 60);

        // Meter bar
        const barW = 10;
        const maxBarH = 100;
        const currentBarH = Math.min(1.0, finalSpeedMult / 4.0) * maxBarH;

        p.fill(0, 0, 0, 150);
        p.rect(p.width - 30, 85, barW, maxBarH, 5);

        // Color: green → yellow → red
        if (finalSpeedMult < 1.5) p.fill(0, 255, 100);
        else if (finalSpeedMult < 2.5) p.fill(255, 200, 0);
        else p.fill(255, 50, 50);

        p.rect(p.width - 30, 85 + (maxBarH - currentBarH), barW, currentBarH, 5);
      }

      p.drawingContext.shadowBlur = 0;
      p.pop();
    }

    // ============================
    // Resize & Cleanup
    // ============================
    p.windowResized = function () {
      p.resizeCanvas(containerElement.clientWidth, containerElement.clientHeight);
    };

    p.cleanup = function () {
      isPlaying = false;
      birds = [];
      particles = [];
      clouds = [];
      comboPopups = [];
      score = 0;
      displayScore = 0;
      comboCount = 0;
      shakeAmount = 0;
      redFlashAlpha = 0;
      wasOpenHand = { Left: false, Right: false };
      grabConsumed = { Left: false, Right: false };

      if (diffOverlay) {
        diffOverlay.remove();
        diffOverlay = null;
      }
      diffButtons = {};

      const openBtn = document.getElementById('birdcatch-difficulty-btn');
      if (openBtn) openBtn.onclick = null;
    };

  }, containerElement);
}
