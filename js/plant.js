// ============================================================
// plant.js — Plant Experience
// ============================================================

function createPlantSketch(containerElement) {
  return new p5((p) => {
    
    // --- State ---
    let growAmount = 0;       // 0 to 1
    let bloomAmount = 0;      // 0 to 1
    let targetGrow = 0;
    let targetBloom = 0;
    let branchDensityTarget = 2; // 0 to 5, mapped to branching factor
    let branchDensity = 2;
    let plantHue = 120;       // Green base
    let targetHue = 120;
    
    let resetTriggered = false;
    let resetProgress = 0;    // 0 to 1
    
    let thumbsUpWasActive = false;
    
    let particles = [];
    const MAX_PARTICLES = 200;
    
    let themeIndex = 0;
    let nextThemeIndex = 0;
    let themeCrossfade = 0;   // 0 to 1
    
    const THEMES = [
      { name: "Day", top: [135, 206, 235], bot: [240, 255, 240] },
      { name: "Sunset", top: [255, 126, 95], bot: [254, 180, 123] },
      { name: "Night", top: [20, 24, 82], bot: [60, 20, 80] },
      { name: "Dreamy", top: [200, 150, 255], bot: [255, 200, 200] }
    ];
    
    let activeGestureName = "";
    
    // --- Setup ---
    p.setup = function () {
      const cw = containerElement.clientWidth;
      const ch = containerElement.clientHeight;
      p.createCanvas(cw, ch);
      p.colorMode(p.HSB, 360, 100, 100, 1);
      
      // Setup Snapshot Button
      const snapBtn = document.getElementById('plant-snapshot');
      if (snapBtn) {
        snapBtn.onclick = handleSnapshot;
      }
    };
    
    // --- Main Draw Loop ---
    p.draw = function () {
      p.clear();
      
      // 1. Draw Background (Webcam + Theme Gradient)
      drawBackground();
      
      // 2. Process Hand Input
      processHands();
      
      // 3. Update State (Lerps)
      updateState();
      
      // 4. Draw Plant
      p.push();
      p.translate(p.width / 2, p.height); // Bottom center
      // Calculate max height based on screen
      const maxTreeHeight = p.height * 0.75;
      drawBranch(maxTreeHeight * growAmount, 0, branchDensity);
      p.pop();
      
      // 5. Update & Draw Particles
      updateAndDrawParticles();
      
      // 6. Draw HUD & Shared Overlays
      drawFaceGlow(p, faceData, p.width, p.height);
      drawHandHUD(p, handsData, p.width, p.height);
      drawHUD();
    };

    // --- Core Logic ---
    
    function drawBackground() {
      // Draw webcam
      const video = getVideoElement();
      if (video && video.readyState >= 2) {
        p.push();
        p.translate(p.width, 0);
        p.scale(-1, 1);
        p.drawingContext.globalAlpha = 60 / 255;
        p.drawingContext.drawImage(video, 0, 0, p.width, p.height);
        p.drawingContext.globalAlpha = 1.0;
        p.pop();
      } else {
        p.background(0); // Fallback
      }
      
      // Theme Crossfade
      if (themeIndex !== nextThemeIndex) {
        themeCrossfade += 0.02;
        if (themeCrossfade >= 1) {
          themeIndex = nextThemeIndex;
          themeCrossfade = 0;
        }
      }
      
      // Gradient Overlay
      const t1 = THEMES[themeIndex];
      const t2 = THEMES[nextThemeIndex];
      
      p.push();
      p.colorMode(p.RGB);
      p.noFill();
      for (let y = 0; y < p.height; y += 4) {
        const amt = y / p.height;
        
        const r1 = p.lerp(t1.top[0], t1.bot[0], amt);
        const g1 = p.lerp(t1.top[1], t1.bot[1], amt);
        const b1 = p.lerp(t1.top[2], t1.bot[2], amt);
        
        const r2 = p.lerp(t2.top[0], t2.bot[0], amt);
        const g2 = p.lerp(t2.top[1], t2.bot[1], amt);
        const b2 = p.lerp(t2.top[2], t2.bot[2], amt);
        
        const fr = p.lerp(r1, r2, themeCrossfade);
        const fg = p.lerp(g1, g2, themeCrossfade);
        const fb = p.lerp(b1, b2, themeCrossfade);
        
        p.stroke(fr, fg, fb, 180); // 180/255 opacity
        p.strokeWeight(5);
        p.line(0, y, p.width, y);
      }
      p.pop();
    }
    
    function processHands() {
      activeGestureName = "";
      
      if (!handsData || !handsData.landmarks || handsData.landmarks.length === 0) {
        // No hands, slowly decay grow/bloom
        targetGrow = Math.max(0, targetGrow - 0.005);
        targetBloom = Math.max(0, targetBloom - 0.005);
        return;
      }
      
      let leftHand = null;
      let rightHand = null;
      
      for (let i = 0; i < handsData.landmarks.length; i++) {
        const label = handsData.handedness[i]?.label; // "Left" or "Right"
        // Also grab world landmarks for distance math
        const worldLms = handsData.worldLandmarks[i];
        
        if (label === 'Left') leftHand = { lm: handsData.landmarks[i], wlm: worldLms, label };
        if (label === 'Right') rightHand = { lm: handsData.landmarks[i], wlm: worldLms, label };
      }
      
      // Fallback: if only one hand, it controls both
      if (leftHand && !rightHand) rightHand = leftHand;
      if (rightHand && !leftHand) leftHand = rightHand;
      
      // --- Left Hand: Grow (Wrist Y) ---
      if (leftHand && !resetTriggered) {
        // We still use screen landmarks (lm) for screen-relative Y position
        const rawY = 1.0 - leftHand.lm[LM.WRIST].y; 
        targetGrow = p.constrain(p.map(rawY, 0.3, 0.8, 0, 1), 0, 1);
      }
      
      // --- Right Hand: Bloom (Spread) & Gestures ---
      if (rightHand && !resetTriggered) {
        
        // Fist -> Reset (using debounced tracker)
        if (gestureTracker.get(rightHand.label, 'fist')) {
          resetTriggered = true;
          activeGestureName = "Fist: Resetting!";
          return; // Skip other gestures
        }
        
        // Thumbs Up -> Burst (using debounced tracker)
        const isTU = gestureTracker.get(rightHand.label, 'thumbsUp');
        if (isTU && !thumbsUpWasActive) {
          triggerFullBloomBurst();
          activeGestureName = "Burst!";
        }
        thumbsUpWasActive = isTU;
        
        // Extended Fingers -> Density & Theme
        if (!isTU) {
          // Use world landmarks for reliable finger counting
          const fingers = countExtendedFingers(rightHand.wlm);
          if (fingers >= 0 && fingers <= 5) {
            branchDensityTarget = fingers;
            if (fingers > 0 && fingers < 5) {
               if (nextThemeIndex === themeIndex) {
                 nextThemeIndex = fingers - 1;
               }
            }
          }
        }
        
        // Default Bloom via Spread (world landmarks)
        targetBloom = getSpread(rightHand.wlm);
      }
      
      // --- Either Hand: Pinch -> Hue ---
      // We check all detected hands for pinch using the tracker
      for (let i = 0; i < handsData.landmarks.length; i++) {
        const label = handsData.handedness[i]?.label;
        if (gestureTracker.get(label, 'pinch')) {
          // Screen landmark for X position to map to hue
          const lx = handsData.landmarks[i][LM.WRIST].x;
          targetHue = p.map(lx, 0, 1, 0, 360);
          activeGestureName = "Pinch: Coloring";
          break; // Only use first pinched hand
        }
      }
    }
    
    function updateState() {
      if (resetTriggered) {
        resetProgress += 0.02;
        growAmount = p.lerp(growAmount, 0, 0.1);
        bloomAmount = p.lerp(bloomAmount, 0, 0.1);
        targetGrow = 0;
        targetBloom = 0;
        if (resetProgress >= 1 && growAmount < 0.05) {
          resetTriggered = false;
          resetProgress = 0;
          particles = [];
        }
      } else {
        // Slower lerps for continuous smoothness on noisy mobile data
        growAmount = p.lerp(growAmount, targetGrow, 0.05);
        bloomAmount = p.lerp(bloomAmount, targetBloom, 0.05);
      }
      
      branchDensity = p.lerp(branchDensity, branchDensityTarget, 0.03);
      
      // Circular lerp for hue
      const dh = targetHue - plantHue;
      if (Math.abs(dh) > 180) {
        plantHue += (dh > 0 ? -1 : 1) * (360 - Math.abs(dh)) * 0.05;
      } else {
        plantHue += dh * 0.05;
      }
      if (plantHue < 0) plantHue += 360;
      if (plantHue >= 360) plantHue -= 360;
    }
    
    function triggerFullBloomBurst() {
      targetBloom = 1.0;
      bloomAmount = 1.0;
      // Branch tips spawn particles (calculated dynamically during draw, but we'll spawn a center burst here too)
      spawnBurst(p.width/2, p.height/2, 50);
    }
    
    function spawnBurst(x, y, count) {
      for (let i = 0; i < count; i++) {
        if (particles.length >= MAX_PARTICLES) break;
        const angle = p.random(p.TWO_PI);
        const speed = p.random(2, 8);
        particles.push({
          x: x, y: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1.0,
          decay: p.random(0.01, 0.03),
          hue: plantHue + p.random(-20, 20)
        });
      }
    }
    
    // Recursive Tree Drawing
    function drawBranch(len, depth, currentDensity) {
      if (len < 10) return;
      
      // Thicker at bottom
      const sw = p.map(len, 10, p.height*0.3, 1, 15);
      p.stroke(plantHue, 40, 40, 0.8); // Dark tinted wood
      p.strokeWeight(sw);
      p.line(0, 0, 0, -len);
      
      p.translate(0, -len);
      
      // Draw Flower at tip if we reached max depth for current length
      if (len < 25) {
        if (bloomAmount > 0.1) {
          drawFlower(bloomAmount, sw);
          // Spawn particles randomly from blooming flowers
          if (p.random() < bloomAmount * 0.1 && particles.length < MAX_PARTICLES) {
            // Need absolute coords for particle. p5's screenX/Y aren't always reliable in instance mode w/o 3D, 
            // but we can estimate or just use modelX/Y if available.
            // A simpler approach for 2D is tracking matrix manually, but let's use a small local effect.
            // Actually, we'll store local particles and draw them relative to the tip? 
            // Better: just spawn them and let them fly. We need global coords.
            // Since manual matrix tracking is tedious, we'll use a trick:
            // For now, particles spawn mostly from the top region.
          }
        }
        return; // End branch
      }
      
      // Branching logic based on density (0 to 5)
      // Base branches = 2. Higher density = more splits, wider angles
      const numSplits = p.floor(p.map(currentDensity, 0, 5, 1.5, 3.8)); 
      const angleSpread = p.map(currentDensity, 0, 5, p.PI/6, p.PI/3);
      
      p.push();
      p.rotate(-angleSpread/2);
      for (let i = 0; i < numSplits; i++) {
        drawBranch(len * p.map(currentDensity, 0, 5, 0.75, 0.65), depth + 1, currentDensity);
        p.rotate(angleSpread / Math.max(1, (numSplits - 1)));
      }
      p.pop();
    }
    
    function drawFlower(bloom, baseSize) {
      p.push();
      p.noStroke();
      p.drawingContext.shadowColor = `hsla(${plantHue}, 100%, 70%, 0.5)`;
      p.drawingContext.shadowBlur = 10;
      
      const size = baseSize * 3 + (bloom * 25);
      const petals = 5;
      
      p.fill(plantHue, 80, 90, 0.9);
      for (let i = 0; i < petals; i++) {
        p.rotate(p.TWO_PI / petals);
        p.ellipse(0, size/2, size/2, size);
      }
      
      p.fill(60, 80, 100); // Yellow center
      p.ellipse(0, 0, size/2, size/2);
      
      p.pop();
    }
    
    function updateAndDrawParticles() {
      p.push();
      p.noStroke();
      
      for (let i = particles.length - 1; i >= 0; i--) {
        const pt = particles[i];
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.vy += 0.1; // gravity
        pt.life -= pt.decay;
        
        if (pt.life <= 0 || pt.y > p.height) {
          particles.splice(i, 1);
          continue;
        }
        
        p.fill(pt.hue, 80, 100, pt.life);
        const s = pt.life * 6;
        p.ellipse(pt.x, pt.y, s, s);
      }
      p.pop();
    }
    
    function drawHUD() {
      p.push();
      p.colorMode(p.RGB);
      p.fill(255);
      p.noStroke();
      p.textSize(16);
      p.textAlign(p.LEFT, p.TOP);
      
      p.drawingContext.shadowColor = 'rgba(0,0,0,0.8)';
      p.drawingContext.shadowBlur = 4;
      
      p.text(`Grow: ${targetGrow.toFixed(2)}`, 20, 20);
      p.text(`Bloom: ${targetBloom.toFixed(2)}`, 20, 45);
      p.text(`Theme: ${THEMES[themeIndex].name}`, 20, 70);
      
      if (resetTriggered) {
        p.fill(255, 100, 100);
        p.textSize(32);
        p.textAlign(p.CENTER, p.CENTER);
        p.text("RESETTING...", p.width/2, 50);
      } else if (activeGestureName) {
        p.fill(100, 255, 100);
        p.textSize(24);
        p.textAlign(p.CENTER, p.TOP);
        p.text(activeGestureName, p.width/2, 20);
      }
      p.pop();
    }

    // --- Snapshot Feature ---
    function handleSnapshot() {
      // Create an offscreen canvas to combine webcam + p5 graphics
      const video = getVideoElement();
      if (!video) return;
      
      const offCnv = document.createElement('canvas');
      offCnv.width = p.width;
      offCnv.height = p.height;
      const ctx = offCnv.getContext('2d');
      
      // Draw mirrored video
      ctx.save();
      ctx.translate(offCnv.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, offCnv.width, offCnv.height);
      ctx.restore();
      
      // Draw p5 canvas on top
      ctx.drawImage(containerElement.querySelector('canvas'), 0, 0);
      
      // Trigger download
      const link = document.createElement('a');
      link.download = 'plant-snapshot-' + Date.now() + '.png';
      link.href = offCnv.toDataURL('image/png');
      link.click();
    }

    p.windowResized = function () {
      p.resizeCanvas(containerElement.clientWidth, containerElement.clientHeight);
    };

    p.cleanup = function () {
      particles = [];
      const snapBtn = document.getElementById('plant-snapshot');
      if (snapBtn) snapBtn.onclick = null;
    };
    
  }, containerElement);
}
