// ============================================================
// airdraw.js — Air Draw Experience (placeholder)
// ============================================================

function createAirDrawSketch(containerElement) {
  return new p5((p) => {
    p.setup = function () {
      p.createCanvas(containerElement.clientWidth, containerElement.clientHeight);
    };
    p.draw = function () {
      p.background(20, 15, 40);
      const video = getVideoElement();
      if (video && video.readyState >= 2) {
        p.push();
        p.translate(p.width, 0);
        p.scale(-1, 1);
        p.drawingContext.globalAlpha = 0.15;
        p.drawingContext.drawImage(video, 0, 0, p.width, p.height);
        p.drawingContext.globalAlpha = 1.0;
        p.pop();
      }
      drawHandHUD(p, handsData, p.width, p.height);
      p.fill(255);
      p.noStroke();
      p.textAlign(p.CENTER, p.CENTER);
      p.textSize(24);
      p.text('Air Draw — Loading...', p.width / 2, p.height / 2);
    };
    p.windowResized = function () {
      p.resizeCanvas(containerElement.clientWidth, containerElement.clientHeight);
    };
    p.cleanup = function () {};
  }, containerElement);
}
