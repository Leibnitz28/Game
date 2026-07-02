// ============================================================
// shared.js — Single source of truth for MediaPipe, gestures,
// coordinate mapping, and hologram/face rendering.
// ONE Hands instance, ONE FaceDetection instance, ONE Camera.
// ============================================================

// ===== DEBUG FLAG =====
// Set to true to enable console logging at key pipeline stages.
const DEBUG = false;

function debugLog(...args) {
  if (DEBUG) console.log('[HandGesture]', performance.now().toFixed(0), ...args);
}

// ===== SHARED DATA STORES =====
// Populated once in onResults, read by whichever experience is active.
const handsData = {
  landmarks: [],       // Array<Array<{x,y,z}>> — up to 2 hands, 21 landmarks each (normalized 0-1)
  handedness: [],      // Array<{label:"Left"|"Right", score:number}>
  worldLandmarks: [],  // Array<Array<{x,y,z}>> — world coords in meters
  image: null,         // The source video frame from last onResults
  timestamp: 0         // performance.now() when last updated
};

const faceData = {
  detections: [],      // Array of face detection objects
  timestamp: 0         // performance.now() when last updated
};

// ===== MEDIAPIPE SINGLETONS =====
let _handsInstance = null;
let _faceDetectionInstance = null;
let _cameraInstance = null;
let _cameraStarted = false;
let _cameraFrameCount = 0;
let _videoElement = null;

// ===== LANDMARK INDEX CONSTANTS =====
const LM = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20
};

const FINGERTIP_INDICES = [LM.THUMB_TIP, LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP];

// Hand skeleton bone connections (pairs of landmark indices)
const HAND_BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],           // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],           // index
  [0, 9], [9, 10], [10, 11], [11, 12],      // middle
  [0, 13], [13, 14], [14, 15], [15, 16],    // ring
  [0, 17], [17, 18], [18, 19], [19, 20],    // pinky
  [5, 9], [9, 13], [13, 17]                  // palm cross-connections
];

// ===== COORDINATE MAPPING =====
// Always recalculated from CURRENT canvas dimensions. Never hardcoded.

function toCanvasX(normalizedX, canvasWidth) {
  // Mirror for front camera (facingMode: "user")
  return (1.0 - normalizedX) * canvasWidth;
}

function toCanvasY(normalizedY, canvasHeight) {
  return normalizedY * canvasHeight;
}

// ===== TEMPORAL GESTURE TRACKER =====
class GestureTracker {
  constructor(bufferSize = 8) {
    this.bufferSize = bufferSize;
    // Store history per hand (Left, Right) and per gesture
    this.history = { Left: {}, Right: {} };
    this.state = { Left: {}, Right: {} };
  }

  // handLabel: "Left" or "Right"
  // gestureName: string (e.g. "fist", "thumbsUp")
  // rawValue: boolean (is it detected this frame?)
  // thresholdOn: number (e.g. 6/8 frames to turn ON)
  // thresholdOff: number (e.g. 6/8 frames to turn OFF)
  update(handLabel, gestureName, rawValue, thresholdOn = 6, thresholdOff = 6) {
    if (!this.history[handLabel][gestureName]) {
      this.history[handLabel][gestureName] = [];
      this.state[handLabel][gestureName] = false;
    }
    
    const hist = this.history[handLabel][gestureName];
    hist.push(rawValue);
    if (hist.length > this.bufferSize) {
      hist.shift();
    }

    // Only evaluate if buffer is full
    if (hist.length === this.bufferSize) {
      const positiveCount = hist.filter(v => v).length;
      const negativeCount = this.bufferSize - positiveCount;
      const currentState = this.state[handLabel][gestureName];

      if (!currentState && positiveCount >= thresholdOn) {
        this.state[handLabel][gestureName] = true;
      } else if (currentState && negativeCount >= thresholdOff) {
        this.state[handLabel][gestureName] = false;
      }
    }
    
    return this.state[handLabel][gestureName];
  }

  get(handLabel, gestureName) {
    return this.state[handLabel]?.[gestureName] || false;
  }
  
  clear() {
    this.history = { Left: {}, Right: {} };
    this.state = { Left: {}, Right: {} };
  }
}

const gestureTracker = new GestureTracker(8);


// ===== GESTURE DETECTION HELPERS (Using World Landmarks) =====
// All take a single hand's WORLD landmarks array (21 {x,y,z} objects, in physical meters).

/** Euclidean distance between two landmark points (3D). */
function _dist3D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Check if a specific finger is extended, using distance from wrist.
 */
function isFingerExtended(worldLandmarks, fingerIndex, currentState = false) {
  if (fingerIndex === 0) {
    // Thumb: tip is farther from wrist than the IP joint
    const tipDist = _dist3D(worldLandmarks[LM.THUMB_TIP], worldLandmarks[LM.WRIST]);
    const ipDist = _dist3D(worldLandmarks[LM.THUMB_IP], worldLandmarks[LM.WRIST]);
    const multiplier = currentState ? 1.05 : 1.15; 
    return tipDist > ipDist * multiplier;
  }
  
  // Other fingers: compare tip-to-wrist distance vs pip-to-wrist distance
  const tipIndices = [0, LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP];
  const pipIndices = [0, LM.INDEX_PIP, LM.MIDDLE_PIP, LM.RING_PIP, LM.PINKY_PIP];
  
  const tipDist = _dist3D(worldLandmarks[tipIndices[fingerIndex]], worldLandmarks[LM.WRIST]);
  const pipDist = _dist3D(worldLandmarks[pipIndices[fingerIndex]], worldLandmarks[LM.WRIST]);
  
  // Hysteresis: Easier to stay open than to open initially
  const multiplier = currentState ? 1.1 : 1.25;
  return tipDist > pipDist * multiplier;
}

/** Count how many fingers are extended (0-5). */
function countExtendedFingers(worldLandmarks) {
  let count = 0;
  for (let i = 0; i < 5; i++) {
    if (isFingerExtended(worldLandmarks, i)) count++;
  }
  return count;
}

/** All fingers curled (no fingers extended). */
function isFist(worldLandmarks, currentState = false) {
  const count = countExtendedFingers(worldLandmarks);
  if (currentState) {
    return count <= 1; // Exit fist if 2 or more fingers open
  } else {
    return count === 0; // Enter fist only if 0 fingers open
  }
}

/**
 * Thumbs up: thumb extended and pointing upward, all other fingers curled.
 */
function isThumbsUp(worldLandmarks, currentState = false) {
  const thumbExt = isFingerExtended(worldLandmarks, 0);
  let otherExt = 0;
  for (let i = 1; i < 5; i++) {
    if (isFingerExtended(worldLandmarks, i)) otherExt++;
  }
  
  // Y-axis in world coords: negative is UP relative to hand center
  const isUp = worldLandmarks[LM.THUMB_TIP].y < worldLandmarks[LM.THUMB_MCP].y - 0.01;
  
  if (currentState) {
    return thumbExt && otherExt <= 1 && isUp;
  } else {
    return thumbExt && otherExt === 0 && isUp;
  }
}

/** Raw distance between thumb tip and index fingertip in meters. */
function getPinchDistance(worldLandmarks) {
  return _dist3D(worldLandmarks[LM.THUMB_TIP], worldLandmarks[LM.INDEX_TIP]);
}

/** Pinch detected when thumb-index distance is below physical threshold. */
function isPinch(worldLandmarks, currentState = false) {
  // 0.02 meters = 2cm. Hysteresis to 3cm.
  const threshold = currentState ? 0.03 : 0.02;
  return getPinchDistance(worldLandmarks) < threshold;
}

/**
 * Finger spread: average distance between adjacent fingertips.
 * Normalized 0-1 based on typical physical hand size in meters.
 */
function getSpread(worldLandmarks) {
  const tips = [LM.THUMB_TIP, LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP];
  let totalDist = 0;
  for (let i = 0; i < tips.length - 1; i++) {
    totalDist += _dist3D(worldLandmarks[tips[i]], worldLandmarks[tips[i + 1]]);
  }
  const avgDist = totalDist / (tips.length - 1);
  
  // Normalize: ~0.015m closed, ~0.06m fully spread
  return Math.min(1, Math.max(0, (avgDist - 0.015) / 0.045));
}

/**
 * Open hand detection: 3+ fingers extended.
 * Used for bird-catch grab transition (open→fist) and air-draw tool summoning.
 */
function isOpenHand(worldLandmarks) {
  return countExtendedFingers(worldLandmarks) >= 3;
}

// ===== HOLOGRAM / HAND HUD RENDERER =====

// Fingertip trail history — ring buffers, capped at MAX_TRAIL_LENGTH
const MAX_TRAIL_LENGTH = 12;
const _fingertipTrails = {}; // key: "h{handIdx}_t{tipLmIdx}" -> [{x,y}, ...]

function _trailKey(handIdx, tipLmIdx) {
  return 'h' + handIdx + '_t' + tipLmIdx;
}

function _updateFingertipTrails(handIdx, landmarks, cw, ch) {
  for (const tipIdx of FINGERTIP_INDICES) {
    const key = _trailKey(handIdx, tipIdx);
    if (!_fingertipTrails[key]) _fingertipTrails[key] = [];
    const trail = _fingertipTrails[key];
    trail.push({
      x: toCanvasX(landmarks[tipIdx].x, cw),
      y: toCanvasY(landmarks[tipIdx].y, ch)
    });
    // Cap at max length
    while (trail.length > MAX_TRAIL_LENGTH) trail.shift();
  }
}

/** Clear all fingertip trails (called on experience switch). */
function clearFingertipTrails() {
  for (const key in _fingertipTrails) {
    delete _fingertipTrails[key];
  }
}

// Wrist scan-ring animation phase
let _wristPulsePhase = 0;

/**
 * Draw the holographic hand skeleton overlay onto a p5 canvas.
 * Includes: glowing landmark dots, skeleton lines, fingertip trails, wrist pulse ring.
 * @param {p5} p - p5 instance
 * @param {object} data - handsData object
 * @param {number} cw - current canvas width
 * @param {number} ch - current canvas height
 */
function drawHandHUD(p, data, cw, ch) {
  if (!data || !data.landmarks || data.landmarks.length === 0) return;

  debugLog('drawHandHUD: rendering', data.landmarks.length, 'hand(s)');
  _wristPulsePhase += 0.06;

  for (let h = 0; h < data.landmarks.length; h++) {
    const lm = data.landmarks[h];
    const isRight = data.handedness[h] && data.handedness[h].label === 'Right';
    // Magenta for right hand, Cyan for left hand
    const gc = isRight ? [255, 0, 255] : [0, 255, 255];

    // Update fingertip trails
    _updateFingertipTrails(h, lm, cw, ch);

    p.push();

    // --- Skeleton lines ---
    p.drawingContext.shadowColor = 'rgba(' + gc[0] + ',' + gc[1] + ',' + gc[2] + ',0.5)';
    p.drawingContext.shadowBlur = 8;
    p.stroke(gc[0], gc[1], gc[2], 160);
    p.strokeWeight(2);
    p.noFill();

    for (let b = 0; b < HAND_BONES.length; b++) {
      const a = HAND_BONES[b][0];
      const bi = HAND_BONES[b][1];
      p.line(
        toCanvasX(lm[a].x, cw), toCanvasY(lm[a].y, ch),
        toCanvasX(lm[bi].x, cw), toCanvasY(lm[bi].y, ch)
      );
    }

    // --- Landmark dots ---
    p.drawingContext.shadowBlur = 14;
    p.noStroke();

    for (let i = 0; i < 21; i++) {
      const x = toCanvasX(lm[i].x, cw);
      const y = toCanvasY(lm[i].y, ch);
      const isTip = FINGERTIP_INDICES.indexOf(i) !== -1;
      const sz = isTip ? 9 : 5;
      p.fill(gc[0], gc[1], gc[2], isTip ? 240 : 180);
      p.ellipse(x, y, sz, sz);
    }

    // --- Fingertip motion trails ---
    p.drawingContext.shadowBlur = 5;
    p.noFill();
    for (const tipIdx of FINGERTIP_INDICES) {
      const key = _trailKey(h, tipIdx);
      const trail = _fingertipTrails[key];
      if (!trail || trail.length < 2) continue;

      for (let t = 1; t < trail.length; t++) {
        const progress = t / trail.length;
        const alpha = progress * 140;
        const weight = progress * 3.5;
        p.stroke(gc[0], gc[1], gc[2], alpha);
        p.strokeWeight(weight);
        p.line(trail[t - 1].x, trail[t - 1].y, trail[t].x, trail[t].y);
      }
    }

    // --- Wrist pulse scan-ring & Calibration Dot ---
    const wx = toCanvasX(lm[LM.WRIST].x, cw);
    const wy = toCanvasY(lm[LM.WRIST].y, ch);
    const ring1 = 25 + Math.sin(_wristPulsePhase + h) * 12;
    const ring2 = 35 + Math.sin(_wristPulsePhase * 0.7 + h) * 8;
    const ringAlpha1 = 140 + Math.sin(_wristPulsePhase + h) * 60;
    const ringAlpha2 = 80 + Math.sin(_wristPulsePhase * 0.7 + h) * 40;

    p.noFill();
    p.drawingContext.shadowBlur = 18;
    p.stroke(gc[0], gc[1], gc[2], ringAlpha1);
    p.strokeWeight(2);
    p.ellipse(wx, wy, ring1, ring1);
    p.stroke(gc[0], gc[1], gc[2], ringAlpha2);
    p.strokeWeight(1.2);
    p.ellipse(wx, wy, ring2, ring2);

    // Calibration Dot (confidence)
    const score = data.handedness[h] ? data.handedness[h].score : 0;
    let dotColor = [0, 255, 0]; // Green (High Confidence)
    if (score < 0.7) dotColor = [255, 0, 0]; // Red
    else if (score < 0.85) dotColor = [255, 200, 0]; // Yellow
    
    p.noStroke();
    p.fill(dotColor[0], dotColor[1], dotColor[2], 200);
    p.ellipse(wx, wy - 40, 8, 8); // Floating above wrist

    // Reset shadow
    p.drawingContext.shadowBlur = 0;
    p.pop();
  }
}

// ===== FACE GLOW RENDERER =====

// Interpolated face position for smooth rendering between detections
let _interpFace = null;
const _FACE_LERP = 0.25;

/**
 * Draw a soft holographic rim-glow around the detected face.
 * Uses interpolation between detection frames for smoothness.
 * @param {p5} p - p5 instance
 * @param {object} fData - faceData object
 * @param {number} cw - canvas width
 * @param {number} ch - canvas height
 * @param {Array} [glowColor] - [r,g,b] glow color, default soft blue
 */
function drawFaceGlow(p, fData, cw, ch, glowColor) {
  const gc = glowColor || [100, 180, 255];

  if (fData && fData.detections && fData.detections.length > 0) {
    const det = fData.detections[0];
    const bb = det.boundingBox;

    // Compute mirrored target position
    const tx = (1.0 - bb.xCenter) * cw;
    const ty = bb.yCenter * ch;
    const tw = bb.width * cw * 1.3;  // Slightly larger than bbox for glow
    const th = bb.height * ch * 1.3;

    if (!_interpFace) {
      _interpFace = { x: tx, y: ty, w: tw, h: th, alpha: 200 };
    } else {
      _interpFace.x = p.lerp(_interpFace.x, tx, _FACE_LERP);
      _interpFace.y = p.lerp(_interpFace.y, ty, _FACE_LERP);
      _interpFace.w = p.lerp(_interpFace.w, tw, _FACE_LERP);
      _interpFace.h = p.lerp(_interpFace.h, th, _FACE_LERP);
      _interpFace.alpha = Math.min(200, _interpFace.alpha + 8);
    }
  } else if (_interpFace) {
    // No face detected — fade out
    _interpFace.alpha -= 4;
    if (_interpFace.alpha <= 0) {
      _interpFace = null;
      return;
    }
  } else {
    return; // No face, nothing to draw
  }

  const f = _interpFace;
  p.push();
  p.noFill();
  p.drawingContext.shadowColor = 'rgba(' + gc[0] + ',' + gc[1] + ',' + gc[2] + ',0.4)';
  p.drawingContext.shadowBlur = 30;

  // Multiple concentric glow ellipses
  for (let i = 0; i < 3; i++) {
    const expand = i * 12;
    const a = (f.alpha / 200) * (70 - i * 20);
    p.stroke(gc[0], gc[1], gc[2], a);
    p.strokeWeight(2.5 - i * 0.7);
    p.ellipse(f.x, f.y, f.w + expand, f.h + expand);
  }

  // Inner subtle fill
  const innerAlpha = (f.alpha / 200) * 12;
  p.noStroke();
  p.fill(gc[0], gc[1], gc[2], innerAlpha);
  p.ellipse(f.x, f.y, f.w - 10, f.h - 10);

  p.drawingContext.shadowBlur = 0;
  p.pop();
}

/** Reset interpolated face (called on experience switch). */
function resetFaceGlow() {
  _interpFace = null;
}

// ===== MEDIAPIPE INITIALIZATION =====

/**
 * Initialize the singleton Hands instance.
 * Does NOT start the camera — that's done by initCamera().
 */
function initHands() {
  if (_handsInstance) return _handsInstance;

  debugLog('Initializing MediaPipe Hands...');

  _handsInstance = new Hands({
    locateFile: function (file) {
      return 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/' + file;
    }
  });

  _handsInstance.setOptions({
    maxNumHands: 2,
    modelComplexity: 0,  // 0=Lite (faster), 1=Full (more accurate). See implementation_plan.md.
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.5
  });

  _handsInstance.onResults(function (results) {
    debugLog('onResults fired — hands detected:', (results.multiHandLandmarks || []).length);

    handsData.landmarks = results.multiHandLandmarks || [];
    handsData.handedness = results.multiHandedness || [];
    handsData.worldLandmarks = results.multiHandWorldLandmarks || [];
    handsData.image = results.image;
    handsData.timestamp = performance.now();
    
    // Update GestureTracker with debouncing & confidence gating
    if (handsData.landmarks.length > 0) {
      // Track which hands were seen this frame
      const seenHands = new Set();
      
      for (let i = 0; i < handsData.landmarks.length; i++) {
        const score = handsData.handedness[i].score;
        const label = handsData.handedness[i].label; // 'Left' or 'Right'
        seenHands.add(label);
        
        // Skip voting on very low confidence frames (noise rejection)
        if (score < 0.75) continue;
        
        const worldLms = handsData.worldLandmarks[i];
        
        const fistRaw = isFist(worldLms, gestureTracker.get(label, 'fist'));
        gestureTracker.update(label, 'fist', fistRaw, 5, 5); // 5/8 frames
        
        const thumbsUpRaw = isThumbsUp(worldLms, gestureTracker.get(label, 'thumbsUp'));
        gestureTracker.update(label, 'thumbsUp', thumbsUpRaw, 5, 5);
        
        const pinchRaw = isPinch(worldLms, gestureTracker.get(label, 'pinch'));
        gestureTracker.update(label, 'pinch', pinchRaw, 4, 5); // Faster pinch ON
        
        const openRaw = isOpenHand(worldLms);
        gestureTracker.update(label, 'openHand', openRaw, 4, 4); // Quick response
      }
      
      // Decay hands that are missing in this frame
      for (const label of ['Left', 'Right']) {
        if (!seenHands.has(label)) {
          gestureTracker.update(label, 'fist', false);
          gestureTracker.update(label, 'thumbsUp', false);
          gestureTracker.update(label, 'pinch', false);
          gestureTracker.update(label, 'openHand', false);
        }
      }
    } else {
      // No hands at all — decay all trackers to prevent stuck gestures
      for (const label of ['Left', 'Right']) {
        gestureTracker.update(label, 'fist', false);
        gestureTracker.update(label, 'thumbsUp', false);
        gestureTracker.update(label, 'pinch', false);
        gestureTracker.update(label, 'openHand', false);
      }
    }

    debugLog('handsData stored:', handsData.landmarks.length, 'hand(s)');
  });

  return _handsInstance;
}

/**
 * Initialize the singleton FaceDetection instance.
 */
function initFaceDetection() {
  if (_faceDetectionInstance) return _faceDetectionInstance;

  debugLog('Initializing MediaPipe Face Detection...');

  _faceDetectionInstance = new FaceDetection({
    locateFile: function (file) {
      return 'https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@0.4/' + file;
    }
  });

  _faceDetectionInstance.setOptions({
    model: 'short',            // short-range model (faster, good for webcam)
    minDetectionConfidence: 0.5
  });

  _faceDetectionInstance.onResults(function (results) {
    debugLog('Face detection onResults — faces:', (results.detections || []).length);
    faceData.detections = results.detections || [];
    faceData.timestamp = performance.now();
  });

  return _faceDetectionInstance;
}

/**
 * Initialize and start the singleton Camera.
 * Sends frames to both Hands and FaceDetection (face at reduced frequency).
 * @param {HTMLVideoElement} videoEl - the hidden <video> element
 * @param {Function} [onReady] - called once when first hand results arrive
 */
function initCamera(videoEl, onReady) {
  if (_cameraStarted) {
    debugLog('Camera already started — skipping re-init');
    if (onReady) onReady();
    return;
  }

  _videoElement = videoEl;

  var hands = initHands();
  var face = initFaceDetection();

  debugLog('Creating Camera instance...');

  _cameraInstance = new Camera(videoEl, {
    onFrame: async function () {
      _cameraFrameCount++;
      // Always send to hands
      await hands.send({ image: videoEl });
      // Face detection only every 3rd frame for performance
      if (_cameraFrameCount % 3 === 0) {
        await face.send({ image: videoEl });
      }
    },
    facingMode: 'user',
    width: 640,
    height: 480
  });

  _cameraInstance.start()
    .then(function () {
      _cameraStarted = true;
      debugLog('Camera started successfully');
      if (onReady) onReady();
    })
    .catch(function (err) {
      console.error('Camera start failed:', err);
      var errorOverlay = document.getElementById('error-overlay');
      if (errorOverlay) errorOverlay.classList.remove('hidden');
      var loadingOverlay = document.getElementById('loading-overlay');
      if (loadingOverlay) loadingOverlay.classList.add('hidden');
    });
}

/** Get the video element (for drawing webcam feed onto p5 canvas). */
function getVideoElement() {
  return _videoElement;
}

/** Check if camera has been started. */
function isCameraReady() {
  return _cameraStarted;
}
