// ============================================================
// plant.js — Plant Experience
// Placeholder for Stage 1+2
// ============================================================

function createPlantSketch(containerElement) {
  return new p5((p) => {
    
    p.setup = function () {
      const cw = containerElement.clientWidth;
      const ch = containerElement.clientHeight;
      p.createCanvas(cw, ch);
    };
    
    p.draw = function () {
      p.background(30, 60, 40);
      
      const video = getVideoElement();
      if (video && video.readyState >= 2) {
        // Draw mirrored webcam faintly in background
        p.push();
        p.translate(p.width, 0);
        p.scale(-1, 1);
        p.tint(255, 60);
        p.image(video, 0, 0, p.width, p.height);
        p.pop();
      }
      
      // Draw shared overlays
      drawFaceGlow(p, faceData, p.width, p.height);
      drawHandHUD(p, handsData, p.width, p.height);
      
      p.fill(255);
      p.noStroke();
      p.textSize(24);
      p.textAlign(p.CENTER, p.CENTER);
      p.text('Plant Experience Placeholder', p.width / 2, p.height / 2);
    };

    p.windowResized = function () {
      p.resizeCanvas(containerElement.clientWidth, containerElement.clientHeight);
    };

    p.cleanup = function () {
      // Cleanup logic here
    };
    
  }, containerElement);
}
