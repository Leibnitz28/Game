// ============================================================
// app.js — App controller, menu logic, and experience switching
// ============================================================

document.addEventListener('DOMContentLoaded', function () {
  
  // DOM Elements
  const menuScreen = document.getElementById('menu-screen');
  const plantScreen = document.getElementById('plant-screen');
  const fruitgameScreen = document.getElementById('fruitgame-screen');
  const loadingOverlay = document.getElementById('loading-overlay');
  const errorOverlay = document.getElementById('error-overlay');
  const videoElement = document.getElementById('camera-video');
  
  // Buttons
  const btnPlant = document.getElementById('btn-plant');
  const btnFruitgame = document.getElementById('btn-fruitgame');
  const btnPlantBack = document.getElementById('plant-back');
  const btnFruitgameBack = document.getElementById('fruitgame-back');
  
  // State
  let currentExperience = 'menu'; // 'menu' | 'plant' | 'fruitgame'
  let activeSketch = null;        // Holds the active p5 instance

  // Hide element visually with transition
  function hideElement(el) {
    el.classList.add('fade-out');
    setTimeout(() => {
      el.classList.add('hidden');
    }, 600); // matches --transition-slow
  }

  // Show element visually with transition
  function showElement(el) {
    el.classList.remove('hidden');
    // force reflow
    void el.offsetWidth;
    el.classList.remove('fade-out');
  }

  // Ensure camera is started (lazy init)
  function ensureCameraStarted(onReady) {
    if (isCameraReady()) {
      if (onReady) onReady();
      return;
    }
    
    // Show loading spinner
    loadingOverlay.classList.remove('hidden');
    
    // initCamera from shared.js
    initCamera(videoElement, function () {
      // Called on first successful handsData result
      loadingOverlay.classList.add('hidden');
      if (onReady) onReady();
    });
  }

  // Switch to an experience
  function startExperience(name) {
    if (currentExperience !== 'menu') return;
    
    currentExperience = name;
    hideElement(menuScreen);
    
    ensureCameraStarted(function () {
      if (name === 'plant') {
        showElement(plantScreen);
        // Defined in plant.js
        if (typeof createPlantSketch === 'function') {
          activeSketch = createPlantSketch(document.getElementById('plant-canvas-container'));
        } else {
          console.warn('createPlantSketch not found');
        }
      } 
      else if (name === 'fruitgame') {
        showElement(fruitgameScreen);
        // Defined in fruitgame.js
        if (typeof createFruitGameSketch === 'function') {
          activeSketch = createFruitGameSketch(document.getElementById('fruitgame-canvas-container'), 'medium');
        } else {
          console.warn('createFruitGameSketch not found');
        }
      }
    });
  }

  // Switch back to menu
  function stopExperience() {
    if (currentExperience === 'menu') return;
    
    if (currentExperience === 'plant') {
      hideElement(plantScreen);
    } else if (currentExperience === 'fruitgame') {
      hideElement(fruitgameScreen);
    }
    
    // Stop and remove the p5 instance
    if (activeSketch) {
      if (typeof activeSketch.cleanup === 'function') {
        activeSketch.cleanup();
      }
      activeSketch.remove();
      activeSketch = null;
    }
    
    // Clear shared trails and gesture tracker
    if (typeof clearFingertipTrails === 'function') {
      clearFingertipTrails();
    }
    if (typeof resetFaceGlow === 'function') {
      resetFaceGlow();
    }
    if (typeof gestureTracker !== 'undefined') {
      gestureTracker.clear();
    }
    
    showElement(menuScreen);
    currentExperience = 'menu';
  }

  // Event Listeners
  btnPlant.addEventListener('click', () => startExperience('plant'));
  btnFruitgame.addEventListener('click', () => startExperience('fruitgame'));
  
  btnPlantBack.addEventListener('click', stopExperience);
  btnFruitgameBack.addEventListener('click', stopExperience);

  // Handle window resize for canvas (passes through to active sketch)
  window.addEventListener('resize', function () {
    if (activeSketch && typeof activeSketch.windowResized === 'function') {
      activeSketch.windowResized();
    }
  });

});
