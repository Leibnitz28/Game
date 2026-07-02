// ============================================================
// airdraw.js — Air Draw Experience
// ============================================================

function createAirDrawSketch(containerElement) {
  return new p5((p) => {

    // --- State ---
    let pg; // p5.Graphics buffer for permanent drawing
    
    // Tools
    const COLORS = [
      { name: 'Red', val: [255, 50, 50] },
      { name: 'Orange', val: [255, 150, 50] },
      { name: 'Yellow', val: [255, 230, 50] },
      { name: 'Green', val: [50, 255, 100] },
      { name: 'Cyan', val: [50, 230, 255] },
      { name: 'Blue', val: [50, 100, 255] },
      { name: 'Purple', val: [180, 50, 255] },
      { name: 'Pink', val: [255, 100, 200] }
    ];
    let currentColorIdx = 4; // Default cyan
    
    const PEN_TYPES = ['Normal', 'Neon', 'Brush', 'Eraser'];
    let currentPenIdx = 1; // Default neon
    
    let isSymmetryMode = false;
    let bgThemeIdx = 0; // 0=Dark Space, 1=Whiteboard, 2=Grid Paper
    
    // Strokes & Undo
    let completedStrokes = []; // Array of strokes, each stroke is { points: [{x, y, w}], color, penType }
    let currentStroke = null;
    
    // Smooth drawing
    let lastPenX = 0;
    let lastPenY = 0;
    let smoothedSpeed = 0;
    
    // Particles
    let particles = [];
    const MAX_PARTICLES = 100;
    
    // Color Wheel State
    let showColorWheel = false;
    let wheelX = 0;
    let wheelY = 0;
    let wheelSummonTimer = 0;
    let hoveredColorIdx = -1;
    let hoveredPenIdx = -1;
    
    // Edge detection for gestures
    let wasLeftFist = false;
    let wasLeftThumbsUp = false;
    let wasRightPinch = false;
    let wasRightTwoFingers = false;
    let wasRightThreeFingers = false;
    
    // Feedback
    let flashAlpha = 0;

    p.setup = function () {
      const cw = containerElement.clientWidth;
      const ch = containerElement.clientHeight;
      p.createCanvas(cw, ch);
      
      pg = p.createGraphics(cw, ch);
      clearCanvas();

      // Bind Save Button
      const saveBtn = document.getElementById('airdraw-save');
      if (saveBtn) {
        saveBtn.onclick = () => {
          // Temporarily draw background to pg to save a complete image
          const tempPg = p.createGraphics(p.width, p.height);
          drawBackgroundToCanvas(tempPg);
          tempPg.image(pg, 0, 0);
          p.saveCanvas(tempPg, 'air-drawing', 'png');
          tempPg.remove();
        };
      }
    };

    function clearCanvas() {
      pg.clear();
      completedStrokes = [];
    }

    function redrawAllStrokes() {
      pg.clear();
      for (const stroke of completedStrokes) {
        renderStrokeToGraphics(pg, stroke);
      }
    }

    p.draw = function () {
      p.clear();
      
      // 1. Background Theme
      drawBackgroundToCanvas(p);
      
      // 2. Webcam faint overlay (unless whiteboard/grid makes it too messy, but we'll keep it low alpha)
      drawWebcamBackground();
      
      const now = performance.now();
      
      // 3. Process Gestures and Draw
      processHands(now);
      
      // 4. Render the drawing layer
      p.image(pg, 0, 0);
      
      // 5. Draw active stroke (not yet committed to graphics buffer for smooth preview)
      if (currentStroke) {
        renderStrokeToGraphics(p, currentStroke);
        if (isSymmetryMode) {
           p.push();
           p.translate(p.width, 0);
           p.scale(-1, 1);
           renderStrokeToGraphics(p, currentStroke);
           p.pop();
        }
      }
      
      // 6. Draw particles
      updateAndDrawParticles();
      
      // 7. UI / Overlays
      if (isSymmetryMode) {
        p.stroke(255, 100);
        p.strokeWeight(1);
        p.drawingContext.setLineDash([10, 10]);
        p.line(p.width / 2, 0, p.width / 2, p.height);
        p.drawingContext.setLineDash([]);
      }
      
      if (showColorWheel) {
        drawColorWheel();
      }
      
      drawHUD();
      drawHandOverlays();
      
      // Flash effect for clear
      if (flashAlpha > 0) {
        p.noStroke();
        p.fill(255, flashAlpha);
        p.rect(0, 0, p.width, p.height);
        flashAlpha *= 0.85;
        if (flashAlpha < 1) flashAlpha = 0;
      }
    };

    function processHands(now) {
      if (!handsData || !handsData.landmarks || handsData.landmarks.length === 0) {
        wheelSummonTimer = 0;
        showColorWheel = false;
        endStroke();
        return;
      }
      
      let rightHandIdx = -1;
      let leftHandIdx = -1;
      
      // Identify hands
      for (let i = 0; i < handsData.landmarks.length; i++) {
        const label = handsData.handedness[i]?.label;
        if (label === 'Right') rightHandIdx = i;
        if (label === 'Left') leftHandIdx = i;
      }
      
      // --- LEFT HAND (TOOLS & COLOR) ---
      if (leftHandIdx !== -1) {
        const lms = handsData.landmarks[leftHandIdx];
        const worldLms = handsData.worldLandmarks[leftHandIdx];
        
        const isFist = gestureTracker.get('Left', 'fist');
        const isThumbsUp = gestureTracker.get('Left', 'thumbsUp');
        const isPinch = gestureTracker.get('Left', 'pinch');
        const isOpen = gestureTracker.get('Left', 'openHand');
        
        // Wrist / Palm position
        const palmX = toCanvasX(lms[LM.WRIST].x, p.width);
        const palmY = toCanvasY(lms[LM.WRIST].y, p.height);
        
        // Summon color wheel
        if (isOpen && !isFist && !isPinch) {
          wheelSummonTimer++;
          if (wheelSummonTimer > 15) { // ~0.5s at 30fps
            if (!showColorWheel) {
              showColorWheel = true;
              wheelX = palmX;
              wheelY = Math.max(150, palmY - 80); // position above wrist
            }
          }
        } else {
          wheelSummonTimer = 0;
          if (isFist || isPinch) { // Hide on action
            showColorWheel = false;
          }
        }
        
        // Wheel interaction
        if (showColorWheel) {
          const indexX = toCanvasX(lms[LM.INDEX_TIP].x, p.width);
          const indexY = toCanvasY(lms[LM.INDEX_TIP].y, p.height);
          
          const dx = indexX - wheelX;
          const dy = indexY - wheelY;
          const dist = Math.sqrt(dx*dx + dy*dy);
          const angle = Math.atan2(dy, dx) + Math.PI; // 0 to 2PI
          
          hoveredColorIdx = -1;
          hoveredPenIdx = -1;
          
          if (dist > 40 && dist < 120) {
            // Inner ring (Pen types)
            hoveredPenIdx = Math.floor((angle / p.TWO_PI) * PEN_TYPES.length) % PEN_TYPES.length;
          } else if (dist >= 120 && dist < 200) {
            // Outer ring (Colors)
            hoveredColorIdx = Math.floor((angle / p.TWO_PI) * COLORS.length) % COLORS.length;
          }
          
          // Confirm selection on left pinch
          if (isPinch && !wasLeftFist) { 
            // Reuse wasLeftFist flag for debouncing tool select to avoid accidental undo
            if (hoveredColorIdx !== -1) currentColorIdx = hoveredColorIdx;
            if (hoveredPenIdx !== -1) currentPenIdx = hoveredPenIdx;
            showColorWheel = false; // Hide after selection
          }
        }
        
        // Undo (Fist edge detect)
        if (isFist && !wasLeftFist && !showColorWheel) {
          if (completedStrokes.length > 0) {
            completedStrokes.pop();
            redrawAllStrokes();
          }
        }
        
        // Clear (Thumbs up edge detect)
        if (isThumbsUp && !wasLeftThumbsUp) {
          clearCanvas();
          flashAlpha = 200;
        }
        
        wasLeftFist = isFist;
        wasLeftThumbsUp = isThumbsUp;
      } else {
        wheelSummonTimer = 0;
        showColorWheel = false;
        wasLeftFist = false;
        wasLeftThumbsUp = false;
      }
      
      // --- RIGHT HAND (DRAWING & BACKGROUND) ---
      if (rightHandIdx !== -1) {
        const lms = handsData.landmarks[rightHandIdx];
        const worldLms = handsData.worldLandmarks[rightHandIdx];
        
        const isPinch = gestureTracker.get('Right', 'pinch');
        
        const penX = toCanvasX(lms[LM.INDEX_TIP].x, p.width);
        const penY = toCanvasY(lms[LM.INDEX_TIP].y, p.height);
        
        // Background toggle (count fingers when not drawing)
        if (!isPinch) {
          const extCount = countExtendedFingers(worldLms);
          
          // Toggle symmetry with 2 fingers (peace sign)
          const isTwoFingers = extCount === 2;
          if (isTwoFingers && !wasRightTwoFingers) {
            isSymmetryMode = !isSymmetryMode;
          }
          wasRightTwoFingers = isTwoFingers;
          
          // Toggle background with 3 fingers
          const isThreeFingers = extCount === 3;
          if (isThreeFingers && !wasRightThreeFingers) {
            bgThemeIdx = (bgThemeIdx + 1) % 3;
            // Need to redraw strokes when bg changes, especially if eraser is used
            redrawAllStrokes(); 
          }
          wasRightThreeFingers = isThreeFingers;
        } else {
          wasRightTwoFingers = false;
          wasRightThreeFingers = false;
        }
        
        // Drawing Logic
        if (isPinch) {
          // Calculate speed for variable width
          const dx = penX - lastPenX;
          const dy = penY - lastPenY;
          const dist = Math.sqrt(dx*dx + dy*dy);
          
          // Smoothing speed
          if (wasRightPinch) {
            smoothedSpeed = p.lerp(smoothedSpeed, dist, 0.2);
          } else {
            smoothedSpeed = 0;
          }
          
          // Map speed to width (faster = thinner)
          // 0 speed -> 12px, 30 speed -> 2px
          const targetWeight = p.map(smoothedSpeed, 0, 30, 12, 2, true);
          
          if (!wasRightPinch) {
            // Start new stroke
            currentStroke = {
              color: COLORS[currentColorIdx].val,
              penType: PEN_TYPES[currentPenIdx],
              points: [{x: penX, y: penY, w: targetWeight}]
            };
          } else if (currentStroke) {
            // Add point to current stroke if moved enough
            if (dist > 1) {
               currentStroke.points.push({x: penX, y: penY, w: targetWeight});
               
               // Spawn spark particles if neon or normal
               if (currentStroke.penType !== 'Eraser' && Math.random() < 0.4) {
                 spawnSpark(penX, penY, currentStroke.color);
                 if (isSymmetryMode) {
                   spawnSpark(p.width - penX, penY, currentStroke.color);
                 }
               }
            }
          }
        } else if (wasRightPinch && currentStroke) {
          // End stroke
          endStroke();
        }
        
        wasRightPinch = isPinch;
        lastPenX = penX;
        lastPenY = penY;
        
        // Draw Pen Cursor (always visible)
        drawPenCursor(penX, penY, isPinch);
        if (isSymmetryMode) {
          drawPenCursor(p.width - penX, penY, isPinch);
        }
        
      } else {
        wasRightPinch = false;
        wasRightTwoFingers = false;
        wasRightThreeFingers = false;
        endStroke();
      }
    }
    
    function endStroke() {
      if (currentStroke && currentStroke.points.length > 1) {
        // Render it permanently to the graphics buffer
        renderStrokeToGraphics(pg, currentStroke);
        if (isSymmetryMode) {
           pg.push();
           pg.translate(pg.width, 0);
           pg.scale(-1, 1);
           renderStrokeToGraphics(pg, currentStroke);
           pg.pop();
        }
        completedStrokes.push(currentStroke);
      }
      currentStroke = null;
    }

    function renderStrokeToGraphics(target, stroke) {
      if (!stroke || stroke.points.length < 2) return;
      
      target.push();
      
      const isEraser = stroke.penType === 'Eraser';
      
      if (isEraser) {
        target.drawingContext.globalCompositeOperation = 'destination-out';
        target.stroke(0, 255); // Alpha channel matters for eraser
      } else {
        const c = stroke.color;
        target.stroke(c[0], c[1], c[2]);
        
        if (stroke.penType === 'Neon') {
          target.drawingContext.shadowColor = `rgba(${c[0]},${c[1]},${c[2]},0.8)`;
          target.drawingContext.shadowBlur = 15;
          target.stroke(c[0]+100, c[1]+100, c[2]+100); // Brighter core
        } else if (stroke.penType === 'Brush') {
          target.stroke(c[0], c[1], c[2], 180); // Slightly transparent
        }
      }
      
      target.noFill();
      
      // Draw as a series of connected line segments with varying weights
      for (let i = 1; i < stroke.points.length; i++) {
        const p1 = stroke.points[i-1];
        const p2 = stroke.points[i];
        
        let w = p1.w;
        if (isEraser) w *= 3; // Eraser is wider
        else if (stroke.penType === 'Brush') w *= (0.8 + Math.random()*0.4); // Jitter width for brush
        
        target.strokeWeight(w);
        target.strokeCap(p.ROUND);
        target.strokeJoin(p.ROUND);
        target.line(p1.x, p1.y, p2.x, p2.y);
      }
      
      target.pop();
    }

    // ============================
    // Visuals & HUD
    // ============================
    function drawBackgroundToCanvas(target) {
      if (bgThemeIdx === 0) {
        // Dark Space
        target.background(15, 12, 25);
      } else if (bgThemeIdx === 1) {
        // Whiteboard
        target.background(240, 240, 245);
      } else if (bgThemeIdx === 2) {
        // Grid Paper
        target.background(245, 245, 235);
        target.stroke(200, 210, 220);
        target.strokeWeight(1);
        const gridSize = 40;
        for (let x = 0; x < target.width; x += gridSize) target.line(x, 0, x, target.height);
        for (let y = 0; y < target.height; y += gridSize) target.line(0, y, target.width, y);
      }
    }
    
    function drawWebcamBackground() {
      const video = getVideoElement();
      if (video && video.readyState >= 2) {
        p.push();
        p.translate(p.width, 0);
        p.scale(-1, 1);
        p.drawingContext.globalAlpha = 0.05; // Very faint
        p.drawingContext.drawImage(video, 0, 0, p.width, p.height);
        p.drawingContext.globalAlpha = 1.0;
        p.pop();
      }
    }
    
    function drawHandOverlays() {
      drawFaceGlow(p, faceData, p.width, p.height);
      drawHandHUD(p, handsData, p.width, p.height);
    }
    
    function drawPenCursor(x, y, isDrawing) {
      const c = COLORS[currentColorIdx].val;
      const isEraser = PEN_TYPES[currentPenIdx] === 'Eraser';
      
      p.push();
      p.noStroke();
      if (isEraser) {
        p.fill(255);
        p.stroke(0);
        p.strokeWeight(2);
      } else {
        p.fill(c[0], c[1], c[2]);
        p.drawingContext.shadowColor = `rgba(${c[0]},${c[1]},${c[2]},0.8)`;
        p.drawingContext.shadowBlur = 10;
      }
      
      const sz = isDrawing ? 6 : 10;
      p.ellipse(x, y, sz, sz);
      
      if (!isDrawing && !isEraser) {
        p.noFill();
        p.stroke(c[0], c[1], c[2], 150);
        p.strokeWeight(1.5);
        p.ellipse(x, y, 20 + Math.sin(performance.now()*0.01)*5, 20 + Math.sin(performance.now()*0.01)*5);
      }
      p.pop();
    }
    
    function spawnSpark(x, y, color) {
      if (particles.length >= MAX_PARTICLES) return;
      particles.push({
        x: x, y: y,
        vx: p.random(-2, 2),
        vy: p.random(-2, 2),
        color: color,
        life: 1.0,
        decay: p.random(0.02, 0.05),
        size: p.random(2, 5)
      });
    }
    
    function updateAndDrawParticles() {
      p.push();
      p.noStroke();
      for (let i = particles.length - 1; i >= 0; i--) {
        const pt = particles[i];
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.life -= pt.decay;
        
        if (pt.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        
        p.fill(pt.color[0], pt.color[1], pt.color[2], pt.life * 255);
        p.ellipse(pt.x, pt.y, pt.size, pt.size);
      }
      p.pop();
    }
    
    function drawColorWheel() {
      p.push();
      p.translate(wheelX, wheelY);
      
      // Outer ring (Colors)
      const colorSegs = COLORS.length;
      for (let i = 0; i < colorSegs; i++) {
        const c = COLORS[i].val;
        const startAng = (i / colorSegs) * p.TWO_PI - p.PI;
        const endAng = ((i+1) / colorSegs) * p.TWO_PI - p.PI;
        
        p.fill(c[0], c[1], c[2], hoveredColorIdx === i ? 255 : 150);
        p.stroke(20);
        p.strokeWeight(2);
        
        p.beginShape();
        for(let a = startAng; a <= endAng; a += 0.1) p.vertex(Math.cos(a)*180, Math.sin(a)*180);
        for(let a = endAng; a >= startAng; a -= 0.1) p.vertex(Math.cos(a)*120, Math.sin(a)*120);
        p.endShape(p.CLOSE);
      }
      
      // Inner ring (Pen Types)
      const penSegs = PEN_TYPES.length;
      for (let i = 0; i < penSegs; i++) {
        const startAng = (i / penSegs) * p.TWO_PI - p.PI;
        const endAng = ((i+1) / penSegs) * p.TWO_PI - p.PI;
        
        p.fill(hoveredPenIdx === i ? 220 : 60, 200);
        p.stroke(40);
        
        p.beginShape();
        for(let a = startAng; a <= endAng; a += 0.1) p.vertex(Math.cos(a)*110, Math.sin(a)*110);
        for(let a = endAng; a >= startAng; a -= 0.1) p.vertex(Math.cos(a)*40, Math.sin(a)*40);
        p.endShape(p.CLOSE);
        
        // Label
        const midAng = (startAng + endAng) / 2;
        p.fill(hoveredPenIdx === i ? 0 : 255);
        p.noStroke();
        p.textAlign(p.CENTER, p.CENTER);
        p.textSize(12);
        p.text(PEN_TYPES[i], Math.cos(midAng)*75, Math.sin(midAng)*75);
      }
      
      p.pop();
    }
    
    function drawHUD() {
      // Top Right Indicator
      p.push();
      p.translate(p.width - 20, 20);
      
      p.fill(30, 30, 30, 200);
      p.stroke(80);
      p.strokeWeight(1);
      p.rect(-180, 0, 180, 50, 10);
      
      const isEraser = PEN_TYPES[currentPenIdx] === 'Eraser';
      const c = COLORS[currentColorIdx].val;
      
      p.noStroke();
      if (isEraser) {
        p.fill(255);
        p.stroke(0);
      } else {
        p.fill(c[0], c[1], c[2]);
        p.drawingContext.shadowColor = `rgba(${c[0]},${c[1]},${c[2]},0.8)`;
        p.drawingContext.shadowBlur = 10;
      }
      p.ellipse(-150, 25, 20, 20);
      
      p.drawingContext.shadowBlur = 0;
      p.fill(255);
      p.noStroke();
      p.textAlign(p.LEFT, p.CENTER);
      p.textSize(16);
      p.text(PEN_TYPES[currentPenIdx] + ' Pen', -130, 18);
      
      p.textSize(12);
      p.fill(200);
      const bgName = ['Space', 'Whiteboard', 'Grid'][bgThemeIdx];
      p.text(isSymmetryMode ? 'Mirror On | ' + bgName : bgName, -130, 35);
      
      p.pop();
    }

    p.windowResized = function () {
      const cw = containerElement.clientWidth;
      const ch = containerElement.clientHeight;
      p.resizeCanvas(cw, ch);
      
      // Resize offscreen graphics and redraw
      const newPg = p.createGraphics(cw, ch);
      newPg.image(pg, 0, 0); // Keep existing drawing visually if resizing larger
      pg.remove();
      pg = newPg;
      redrawAllStrokes(); // Redraw vector strokes cleanly at new resolution
    };

    p.cleanup = function () {
      if (pg) pg.remove();
      const saveBtn = document.getElementById('airdraw-save');
      if (saveBtn) saveBtn.onclick = null;
    };

  }, containerElement);
}
