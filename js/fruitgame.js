// ============================================================
// fruitgame.js — Fruit Slicing Experience
// ============================================================

function createFruitGameSketch(containerElement, initialDifficulty) {
  return new p5((p) => {
    
    // --- Constants & Config ---
    const DIFFICULTY_SETTINGS = {
      easy: { baseSpeed: 2.0, spawnInterval: 1200, bombChance: 0.05 },
      medium: { baseSpeed: 3.5, spawnInterval: 800, bombChance: 0.12 },
      hard: { baseSpeed: 5.0, spawnInterval: 500, bombChance: 0.20 }
    };
    
    const FRUIT_TYPES = [
      { name: 'apple', color1: [220, 30, 30], color2: [160, 10, 10], size: 40, weight: 10 },
      { name: 'orange', color1: [255, 140, 0], color2: [220, 90, 0], size: 38, weight: 10 },
      { name: 'watermelon', color1: [40, 200, 80], color2: [20, 120, 40], size: 55, weight: 15 },
      { name: 'banana', color1: [255, 230, 40], color2: [200, 180, 0], size: 45, weight: 12 }, // Drawn differently later
      { name: 'pineapple', color1: [255, 200, 50], color2: [180, 120, 20], size: 50, weight: 20 }
    ];
    
    const MAX_FRUITS = 30;
    const MAX_PARTICLES = 100;
    
    // --- State ---
    let difficultyKey = initialDifficulty || 'medium';
    let currentDiff = DIFFICULTY_SETTINGS[difficultyKey];
    
    let isPlaying = false; // False when difficulty menu is open
    let sessionStartTime = 0;
    
    let score = 0;
    let displayScore = 0; // For animated count-up
    let bestScore = parseInt(localStorage.getItem('fruitgame_best_' + difficultyKey)) || 0;
    
    let fruits = [];
    let particles = [];
    let sliceFlashes = []; // {x1, y1, x2, y2, life}
    let comboPopups = [];  // {x, y, count, life}
    
    let lastSpawnTime = 0;
    
    // Speed Modifiers
    let handHeightModifier = 1.0;
    let timeRampMultiplier = 1.0;
    
    // Combo System
    let comboCount = 0;
    let lastSliceTime = 0;
    const COMBO_WINDOW = 500; // ms
    
    // Screen Shake
    let shakeAmount = 0;
    
    // Blade History (last positions for each hand's index finger)
    let bladeHistory = { left: [], right: [] }; // each is array of {x, y}
    
    // DOM Overlay bindings
    let diffOverlay = null;
    let diffButtons = {};
    
    // --- Setup ---
    p.setup = function () {
      const cw = containerElement.clientWidth;
      const ch = containerElement.clientHeight;
      p.createCanvas(cw, ch);
      
      setupDifficultyMenu();
      startGame(difficultyKey);
    };
    
    function setupDifficultyMenu() {
      // Create DOM overlay for difficulty selector if it doesn't exist
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
      const openBtn = document.getElementById('fruitgame-difficulty-btn');
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
      bestScore = parseInt(localStorage.getItem('fruitgame_best_' + difficultyKey)) || 0;
      
      score = 0;
      displayScore = 0;
      comboCount = 0;
      fruits = [];
      particles = [];
      sliceFlashes = [];
      comboPopups = [];
      handHeightModifier = 1.0;
      
      sessionStartTime = performance.now();
      lastSpawnTime = sessionStartTime;
      isPlaying = true;
    }
    
    // --- Main Draw Loop ---
    p.draw = function () {
      p.clear();
      
      // 1. Draw Background
      p.background(25, 20, 45); // Dark purple
      drawWebcamBackground();
      
      if (!isPlaying) {
        drawHUD(); // Still draw HUD while menu is open
        return;
      }
      
      const now = performance.now();
      
      // 2. Process Game Logic
      updateModifiers(now);
      processSpawns(now);
      processHands(now); // Collision detection happens here
      updatePhysics();
      
      // 3. Draw Game World (with shake)
      p.push();
      if (shakeAmount > 0) {
        p.translate(p.random(-shakeAmount, shakeAmount), p.random(-shakeAmount, shakeAmount));
        shakeAmount *= 0.9;
        if (shakeAmount < 0.5) shakeAmount = 0;
      }
      
      drawFlashes();
      drawFruits();
      drawParticles();
      drawComboPopups();
      
      p.pop(); // End shake
      
      // 4. Draw Overlays
      drawFaceGlow(p, faceData, p.width, p.height);
      drawHandHUD(p, handsData, p.width, p.height);
      drawBlades();
      drawHUD(now);
    };
    
    // --- Core Systems ---
    
    function drawWebcamBackground() {
      const video = getVideoElement();
      if (video && video.readyState >= 2) {
        p.push();
        p.translate(p.width, 0);
        p.scale(-1, 1);
        p.tint(255, 40);
        p.image(video, 0, 0, p.width, p.height);
        p.pop();
      }
    }
    
    function updateModifiers(now) {
      const elapsedSec = (now - sessionStartTime) / 1000.0;
      // Time Ramp: fast early, asymptotes toward 2.5x around 4-5 mins
      timeRampMultiplier = 1.0 + 1.5 * (1.0 - Math.exp(-elapsedSec / 120.0));
      
      // Hand Height Modifier (calc'd in processHands)
      // Final Speed = base * handHeight * timeRamp
    }
    
    function processSpawns(now) {
      // Dynamic spawn interval based on modifiers
      const finalSpeedMult = handHeightModifier * timeRampMultiplier;
      const currentSpawnInterval = currentDiff.spawnInterval / finalSpeedMult;
      
      if (now - lastSpawnTime > currentSpawnInterval && fruits.length < MAX_FRUITS) {
        lastSpawnTime = now;
        spawnFruit();
      }
    }
    
    function spawnFruit() {
      const isBomb = Math.random() < currentDiff.bombChance;
      let fruitDef;
      
      if (isBomb) {
        fruitDef = { name: 'bomb', color1: [30, 30, 30], color2: [10, 10, 10], size: 42, weight: -15 };
      } else {
        // Weighted random fruit (could be uniform for simplicity)
        fruitDef = p.random(FRUIT_TYPES);
      }
      
      fruits.push({
        def: fruitDef,
        isBomb: isBomb,
        x: p.random(p.width * 0.15, p.width * 0.85),
        y: -50,
        vx: p.random(-1.5, 1.5),
        vy: 0, // Gravity takes over
        rotation: p.random(p.TWO_PI),
        rotSpeed: p.random(-0.1, 0.1),
        wobblePhase: p.random(p.TWO_PI),
        radius: fruitDef.size / 2,
        sliced: false,
        age: 0,
        halfData: null // Populated if sliced
      });
    }
    
    // Line Segment to Circle Collision
    function lineIntersectsCircle(x1, y1, x2, y2, cx, cy, r) {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const t = p.constrain(((cx - x1) * dx + (cy - y1) * dy) / (dx * dx + dy * dy + 0.001), 0, 1);
      const closestX = x1 + t * dx;
      const closestY = y1 + t * dy;
      const distSq = (cx - closestX) * (cx - closestX) + (cy - closestY) * (cy - closestY);
      return distSq <= r * r;
    }
    
    function processHands(now) {
      if (!handsData || !handsData.landmarks || handsData.landmarks.length === 0) {
        // No hands, slowly revert height modifier to 1.0
        handHeightModifier = p.lerp(handHeightModifier, 1.0, 0.01);
        bladeHistory.left = [];
        bladeHistory.right = [];
        return;
      }
      
      let sumY = 0;
      let handCount = 0;
      
      const currentBlades = { left: null, right: null };
      
      for (let i = 0; i < handsData.landmarks.length; i++) {
        const lm = handsData.landmarks[i];
        const isRight = handsData.handedness[i]?.label === 'Right';
        const side = isRight ? 'right' : 'left';
        
        // Accumulate Y for speed modifier (wrist)
        sumY += lm[LM.WRIST].y;
        handCount++;
        
        // Track Index Fingertip for slicing
        const tipX = toCanvasX(lm[LM.INDEX_TIP].x, p.width);
        const tipY = toCanvasY(lm[LM.INDEX_TIP].y, p.height);
        currentBlades[side] = { x: tipX, y: tipY };
      }
      
      // Update Speed Modifier based on height (0=top, 1=bottom -> map so high = faster)
      const avgY = sumY / handCount; // 0 to 1
      // Map y:0.2 (high) -> 1.5x speed, y:0.8 (low) -> 0.5x speed
      const targetHeightMod = p.constrain(p.map(avgY, 0.8, 0.2, 0.5, 1.5), 0.5, 1.5);
      handHeightModifier = p.lerp(handHeightModifier, targetHeightMod, 0.05);
      
      // Process Slicing per hand
      for (const side of ['left', 'right']) {
        const currentPos = currentBlades[side];
        const history = bladeHistory[side];
        
        if (currentPos) {
          history.push(currentPos);
          if (history.length > 5) history.shift();
          
          if (history.length >= 2) {
            const p1 = history[history.length - 2];
            const p2 = history[history.length - 1];
            
            // Check collision with all active unsliced fruits
            for (let f of fruits) {
              if (!f.sliced && lineIntersectsCircle(p1.x, p1.y, p2.x, p2.y, f.x, f.y, f.radius * 1.5)) {
                // Hit!
                sliceFruit(f, p1, p2, now);
              }
            }
          }
        } else {
          history.length = 0; // Clear if hand lost
        }
      }
    }
    
    function sliceFruit(f, p1, p2, now) {
      f.sliced = true;
      
      // Vector math for slice direction
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = dx / len;
      const ny = dy / len;
      
      // Sliced halves velocity: base fruit velocity + perpendicular split + slight forward momentum
      const splitForce = p.random(3, 6);
      f.halfData = [
        { vx: f.vx + ny * splitForce + nx * 2, vy: f.vy - nx * splitForce + ny * 2 },
        { vx: f.vx - ny * splitForce + nx * 2, vy: f.vy + nx * splitForce + ny * 2 }
      ];
      
      // Visuals
      sliceFlashes.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, life: 1.0 });
      spawnJuice(f.x, f.y, f.def.color1);
      
      if (f.isBomb) {
        shakeAmount = 15;
        score = Math.max(0, score + f.def.weight); // Penalty
        comboCount = 0; // Reset combo
        // Red flash overlay effect handled in drawFlashes
        sliceFlashes.push({ type: 'bomb', life: 1.0 });
        spawnJuice(f.x, f.y, [255, 50, 50], 30); // Explosion particles
      } else {
        shakeAmount = 3;
        
        // Combo logic
        if (now - lastSliceTime < COMBO_WINDOW) {
          comboCount++;
          const comboBonus = comboCount * 5;
          score += f.def.weight + comboBonus;
          if (comboCount > 1) {
            comboPopups.push({ x: f.x, y: f.y, count: comboCount, life: 1.0 });
          }
        } else {
          comboCount = 1;
          score += f.def.weight;
        }
        lastSliceTime = now;
      }
      
      // Update Best Score
      if (score > bestScore) {
        bestScore = score;
        localStorage.setItem('fruitgame_best_' + difficultyKey, bestScore.toString());
      }
    }
    
    function spawnJuice(x, y, color, count = 10) {
      for (let i = 0; i < count; i++) {
        if (particles.length > MAX_PARTICLES) break;
        const angle = p.random(p.TWO_PI);
        const speed = p.random(2, 7);
        particles.push({
          x: x, y: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color: color,
          life: 1.0,
          decay: p.random(0.02, 0.05)
        });
      }
    }
    
    function updatePhysics() {
      const finalSpeedMult = currentDiff.baseSpeed * handHeightModifier * timeRampMultiplier;
      const gravity = 0.15 * finalSpeedMult;
      
      // Fruits
      for (let i = fruits.length - 1; i >= 0; i--) {
        let f = fruits[i];
        f.age++;
        
        if (!f.sliced) {
          f.vy += gravity;
          f.x += f.vx * finalSpeedMult;
          f.y += f.vy * finalSpeedMult;
          f.rotation += f.rotSpeed;
          f.wobblePhase += 0.1;
        } else {
          // Update halves
          f.halfData[0].vy += gravity;
          f.halfData[1].vy += gravity;
          f.x += f.vx; // Center point drifts
          f.y += f.vy;
        }
        
        // Remove if off screen bottom
        if (f.y > p.height + 100) {
          fruits.splice(i, 1);
        }
      }
      
      // Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        let pt = particles[i];
        pt.vy += 0.2; // Constant gravity for juice
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.life -= pt.decay;
        if (pt.life <= 0) particles.splice(i, 1);
      }
      
      // Flashes & Popups
      for (let i = sliceFlashes.length - 1; i >= 0; i--) {
        sliceFlashes[i].life -= 0.08;
        if (sliceFlashes[i].life <= 0) sliceFlashes.splice(i, 1);
      }
      for (let i = comboPopups.length - 1; i >= 0; i--) {
        comboPopups[i].life -= 0.02;
        comboPopups[i].y -= 1; // Float up
        if (comboPopups[i].life <= 0) comboPopups.splice(i, 1);
      }
    }
    
    function drawFruits() {
      p.noStroke();
      p.colorMode(p.RGB);
      
      for (let f of fruits) {
        // Pop-in scale animation
        const scale = Math.min(1.0, f.age / 15.0);
        const wobble = Math.sin(f.wobblePhase) * 0.1;
        
        p.push();
        p.translate(f.x, f.y);
        p.scale(scale);
        p.rotate(f.rotation + wobble);
        
        if (!f.sliced) {
          drawSingleFruit(f.def, f.isBomb);
        } else {
          // Draw two halves flying apart
          const hd = f.halfData;
          // Offset based on age since slice (we just use halfData velocity directly, so we need to integrate it.
          // Wait, earlier physics step doesn't store pos for halves, just velocity. Let's do a simple offset trick:
          // Just move them apart over time based on their velocity relative to the center.
          // Actually, since they are drawn relative to f.x/f.y, let's track their local offset.
          if (!f.localOffsets) f.localOffsets = [{x:0, y:0}, {x:0, y:0}];
          f.localOffsets[0].x += hd[0].vx; f.localOffsets[0].y += hd[0].vy;
          f.localOffsets[1].x += hd[1].vx; f.localOffsets[1].y += hd[1].vy;
          
          p.push();
          p.translate(f.localOffsets[0].x, f.localOffsets[0].y);
          p.rotate(-0.2);
          drawHalfFruit(f.def, f.isBomb, -1);
          p.pop();
          
          p.push();
          p.translate(f.localOffsets[1].x, f.localOffsets[1].y);
          p.rotate(0.2);
          drawHalfFruit(f.def, f.isBomb, 1);
          p.pop();
        }
        
        p.pop();
      }
    }
    
    function drawSingleFruit(def, isBomb) {
      if (isBomb) {
        p.fill(def.color1);
        p.ellipse(0, 0, def.size, def.size);
        // Spikes
        p.fill(def.color2);
        for(let i=0; i<8; i++) {
          p.rotate(p.TWO_PI/8);
          p.triangle(-5, -def.size/2 + 5, 5, -def.size/2 + 5, 0, -def.size/2 - 10);
        }
        // Fuse
        p.stroke(200, 150, 50);
        p.strokeWeight(3);
        p.noFill();
        p.bezier(0, -def.size/2, 10, -def.size/2 - 10, -10, -def.size/2 - 20, 15, -def.size/2 - 25);
        // Spark
        p.noStroke();
        p.fill(255, p.random(150, 255), 0);
        p.ellipse(15, -def.size/2 - 25, p.random(4, 10));
        return;
      }
      
      if (def.name === 'banana') {
        p.fill(def.color1);
        p.arc(0, 0, def.size*1.5, def.size, p.PI, 0, p.CHORD);
        p.fill(def.color2);
        p.arc(0, -5, def.size*1.3, def.size*0.8, p.PI, 0, p.CHORD);
        return;
      }
      
      // Generic circular fruit (apple, orange, etc)
      // Fake gradient via nested circles
      p.fill(def.color2);
      p.ellipse(0, 0, def.size, def.size);
      p.fill(def.color1);
      p.ellipse(-def.size*0.1, -def.size*0.1, def.size*0.7, def.size*0.7);
      
      // Stem/leaf
      if (def.name === 'apple' || def.name === 'orange') {
        p.fill(30, 150, 30);
        p.ellipse(0, -def.size/2, 10, 15);
      } else if (def.name === 'pineapple') {
        p.fill(40, 180, 50);
        p.triangle(-10, -def.size/2, 10, -def.size/2, 0, -def.size);
        p.triangle(-15, -def.size/2+5, 0, -def.size/2, -10, -def.size+5);
        p.triangle(15, -def.size/2+5, 0, -def.size/2, 10, -def.size+5);
      }
    }
    
    function drawHalfFruit(def, isBomb, side) {
      p.push();
      // side: -1 (left half), 1 (right half)
      p.clip(() => {
        if (side === -1) p.rect(-def.size, -def.size, def.size, def.size*2);
        else p.rect(0, -def.size, def.size, def.size*2);
      });
      drawSingleFruit(def, isBomb);
      // Draw inside flesh
      if (!isBomb) {
        p.fill(255, 255, 200, 200);
        p.ellipse(0, 0, def.size*0.6, def.size*0.8);
      }
      p.pop();
    }
    
    function drawFlashes() {
      p.colorMode(p.RGB);
      for (let f of sliceFlashes) {
        if (f.type === 'bomb') {
          // Full screen red flash
          p.fill(255, 0, 0, f.life * 100);
          p.noStroke();
          p.rect(0, 0, p.width, p.height);
        } else {
          // Slash line flash
          p.stroke(255, 255, 255, f.life * 255);
          p.strokeWeight(f.life * 8 + 2);
          p.line(f.x1, f.y1, f.x2, f.y2);
        }
      }
    }
    
    function drawParticles() {
      p.noStroke();
      p.colorMode(p.RGB);
      for (let pt of particles) {
        p.fill(pt.color[0], pt.color[1], pt.color[2], pt.life * 255);
        const s = pt.life * 6 + 2;
        p.ellipse(pt.x, pt.y, s, s);
      }
    }
    
    function drawComboPopups() {
      p.textAlign(p.CENTER, p.CENTER);
      p.textStyle(p.BOLD);
      for (let c of comboPopups) {
        const scale = p.map(c.life, 0, 1, 0.5, 1.5); // Pop out then shrink
        p.push();
        p.translate(c.x, c.y);
        p.scale(scale);
        
        p.drawingContext.shadowColor = '#000';
        p.drawingContext.shadowBlur = 4;
        
        // Gradient text effect fake
        p.fill(255, 200, 0, c.life * 255);
        p.textSize(32);
        p.text("Combo x" + c.count + "!", 0, 0);
        p.pop();
      }
      p.textStyle(p.NORMAL);
    }
    
    function drawBlades() {
      p.colorMode(p.RGB);
      p.noFill();
      p.drawingContext.shadowBlur = 10;
      
      const drawSide = (history, colorHex) => {
        if (history.length < 2) return;
        p.drawingContext.shadowColor = colorHex;
        
        p.beginShape();
        for (let i = 0; i < history.length; i++) {
          const pt = history[i];
          const progress = i / (history.length - 1);
          p.strokeWeight(progress * 10);
          // Convert hex string back to rgba for fading is annoying in p5 w/o colorMode tweaks,
          // so we rely on shadowBlur for the glow, and stroke for the core.
          p.stroke(255, 255, 255, progress * 200);
          p.vertex(pt.x, pt.y);
        }
        p.endShape();
      };
      
      drawSide(bladeHistory.left, '#00FFFF');
      drawSide(bladeHistory.right, '#FF00FF');
      
      p.drawingContext.shadowBlur = 0;
    }
    
    function drawHUD(now) {
      p.push();
      p.colorMode(p.RGB);
      p.noStroke();
      p.textAlign(p.LEFT, p.TOP);
      
      p.drawingContext.shadowColor = 'rgba(0,0,0,0.8)';
      p.drawingContext.shadowBlur = 4;
      
      // Score Count-up Animation
      displayScore = p.lerp(displayScore, score, 0.2);
      if (Math.abs(score - displayScore) < 0.5) displayScore = score;
      
      // Top Left: Score
      p.fill(255);
      p.textSize(32);
      p.text(`Score: ${Math.round(displayScore)}`, 20, 20);
      
      p.textSize(16);
      p.fill(200);
      p.text(`Best (${difficultyKey}): ${bestScore}`, 20, 60);
      
      if (isPlaying) {
        // Time
        const elapsed = Math.floor((now - sessionStartTime) / 1000);
        const m = Math.floor(elapsed / 60);
        const s = (elapsed % 60).toString().padStart(2, '0');
        p.text(`Time: ${m}:${s}`, 20, 85);
        
        // Speed Meter (Right side)
        const finalSpeedMult = handHeightModifier * timeRampMultiplier;
        p.textAlign(p.RIGHT, p.TOP);
        p.text(`Speed`, p.width - 20, 60);
        
        // Meter Bar
        const barW = 10;
        const maxBarH = 100;
        const currentBarH = Math.min(1.0, finalSpeedMult / 4.0) * maxBarH; // Cap visual at 4x
        
        p.fill(0, 0, 0, 150);
        p.rect(p.width - 30, 85, barW, maxBarH, 5);
        
        // Color changes from green -> yellow -> red as speed increases
        if (finalSpeedMult < 1.5) p.fill(0, 255, 100);
        else if (finalSpeedMult < 2.5) p.fill(255, 200, 0);
        else p.fill(255, 50, 50);
        
        p.rect(p.width - 30, 85 + (maxBarH - currentBarH), barW, currentBarH, 5);
      }
      
      p.pop();
    }

    p.windowResized = function () {
      p.resizeCanvas(containerElement.clientWidth, containerElement.clientHeight);
    };

    p.cleanup = function () {
      isPlaying = false;
      fruits = [];
      particles = [];
      sliceFlashes = [];
      comboPopups = [];
      
      if (diffOverlay) {
        diffOverlay.remove();
        diffOverlay = null;
      }
      
      const openBtn = document.getElementById('fruitgame-difficulty-btn');
      if (openBtn) openBtn.onclick = null;
    };
    
  }, containerElement);
}
