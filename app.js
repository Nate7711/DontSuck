// ==========================================
// DOM Elements Setup
// ==========================================
const videoElement = document.getElementById('uploaded-video') || document.querySelector('video');
const canvasElement = document.getElementById('output-canvas') || document.querySelector('canvas');
const canvasCtx = canvasElement ? canvasElement.getContext('2d') : null;
const fileInput = document.getElementById('video-upload');

const kneeAngleLabel = document.getElementById('knee-angle');
const depthStatusLabel = document.getElementById('depth-status');
const statusBadge = document.getElementById('status-badge');

const btnPlayPause = document.getElementById('btn-play-pause');
const btnPrevFrame = document.getElementById('btn-prev-frame');
const btnNextFrame = document.getElementById('btn-next-frame');

const FRAME_TIME = 1 / 30; // Approx 30 FPS frame duration
let isProcessingFrame = false;

// ==========================================
// Helper Math Functions
// ==========================================

/**
 * Calculates 2D interior angle in degrees between three points (A, B, C)
 * B is the vertex point (e.g., knee)
 */
function calculateAngle(a, b, c) {
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs((radians * 180.0) / Math.PI);
  if (angle > 180.0) {
    angle = 360.0 - angle;
  }
  return angle;
}

// ==========================================
// MediaPipe Pose Initialization
// ==========================================
const pose = new Pose({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
});

pose.setOptions({
  modelComplexity: 0, // Lower complexity for smooth GPU performance and crash-free playback on iOS Safari
  smoothLandmarks: true,
  enableSegmentation: false,
  smoothSegmentation: false,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

pose.onResults(onResults);

// ==========================================
// MediaPipe Frame Results & Depth Processing
// ==========================================
function onResults(results) {
  try {
    if (!canvasElement || !canvasCtx || !videoElement) return;

    // Synchronize canvas dimensions with actual video dimensions
    if (videoElement.videoWidth && canvasElement.width !== videoElement.videoWidth) {
      canvasElement.width = videoElement.videoWidth;
      canvasElement.height = videoElement.videoHeight;
    }

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    if (results && results.poseLandmarks) {
      // Left side joint landmarks
      const leftHip = results.poseLandmarks[23];
      const leftKnee = results.poseLandmarks[25];
      const leftAnkle = results.poseLandmarks[27];

      // Right side joint landmarks
      const rightHip = results.poseLandmarks[24];
      const rightKnee = results.poseLandmarks[26];
      const rightAnkle = results.poseLandmarks[28];

      // Determine which side is facing the camera best using visibility confidence
      const leftVis = (leftHip?.visibility || 0) + (leftKnee?.visibility || 0) + (leftAnkle?.visibility || 0);
      const rightVis = (rightHip?.visibility || 0) + (rightKnee?.visibility || 0) + (rightAnkle?.visibility || 0);
      const useLeft = leftVis >= rightVis;

      const hip = useLeft ? leftHip : rightHip;
      const knee = useLeft ? leftKnee : rightKnee;
      const ankle = useLeft ? leftAnkle : rightAnkle;

      // Ensure key landmarks are visible before evaluating depth
      if (hip && knee && ankle && hip.visibility > 0.3 && knee.visibility > 0.3 && ankle.visibility > 0.3) {
        
        // 1. Dynamic Anthropometric Knee-Top Offset Calculation
        const dx = hip.x - knee.x;
        const dy = hip.y - knee.y;
        const femurLength = Math.sqrt(dx * dx + dy * dy);

        // Top of knee cap surface is ~14% of total femur length above knee joint center
        const dynamicKneeOffset = femurLength * 0.14;
        const topOfKneeY = knee.y - dynamicKneeOffset;

        // 2. Powerlifting Standard Depth Check (hip crease below top of knee)
        const isAtDepth = hip.y >= topOfKneeY;
        const kneeAngle = calculateAngle(hip, knee, ankle);

        // 3. UI Label Updates
        if (kneeAngleLabel) {
          kneeAngleLabel.innerText = `${Math.round(kneeAngle)}°`;
        }

        if (depthStatusLabel) {
          depthStatusLabel.innerText = isAtDepth ? "DEPTH MET" : "ABOVE PARALLEL";
          depthStatusLabel.style.color = isAtDepth ? "#34C759" : "#FF3B30";
        }

        if (statusBadge) {
          statusBadge.innerText = isAtDepth ? "DEPTH REACHED" : "ABOVE PARALLEL";
          statusBadge.className = isAtDepth ? "badge depth-reached" : "badge above-parallel";
        }

        // 4. Canvas Overlay Visuals Drawing
        const p1 = { x: hip.x * canvasElement.width, y: hip.y * canvasElement.height };
        const p2 = { x: knee.x * canvasElement.width, y: knee.y * canvasElement.height };
        const p3 = { x: ankle.x * canvasElement.width, y: ankle.y * canvasElement.height };
        const topKneeYPx = topOfKneeY * canvasElement.height;

        // Draw Skeleton Lines (Hip -> Knee -> Ankle)
        canvasCtx.beginPath();
        canvasCtx.moveTo(p1.x, p1.y);
        canvasCtx.lineTo(p2.x, p2.y);
        canvasCtx.lineTo(p3.x, p3.y);
        canvasCtx.strokeStyle = isAtDepth ? '#34C759' : '#FF3B30';
        canvasCtx.lineWidth = Math.max(4, Math.floor(canvasElement.width / 100));
        canvasCtx.stroke();

        // Draw Top-of-Knee Reference Horizon Line (Dashed Yellow)
        canvasCtx.beginPath();
        canvasCtx.moveTo(p1.x - 60, topKneeYPx);
        canvasCtx.lineTo(p2.x + 60, topKneeYPx);
        canvasCtx.strokeStyle = '#FFCC00';
        canvasCtx.lineWidth = 2;
        canvasCtx.setLineDash([6, 6]);
        canvasCtx.stroke();
        canvasCtx.setLineDash([]);

        // Draw Joint Node Markers
        [p1, p2, p3].forEach(point => {
          canvasCtx.beginPath();
          canvasCtx.arc(point.x, point.y, Math.max(6, Math.floor(canvasElement.width / 80)), 0, 2 * Math.PI);
          canvasCtx.fillStyle = isAtDepth ? '#34C759' : '#FF3B30';
          canvasCtx.fill();
        });
      }
    }
    canvasCtx.restore();
  } catch (err) {
    console.error("Error in onResults execution:", err);
  } finally {
    // Release execution lock
    isProcessingFrame = false;
  }
}

// ==========================================
// Frame Processing Execution & Listeners
// ==========================================

async function sendFrameToMediaPipe() {
  if (videoElement && videoElement.readyState >= 2 && !isProcessingFrame) {
    isProcessingFrame = true;
    try {
      await pose.send({ image: videoElement });
    } catch (e) {
      console.error("MediaPipe frame send error:", e);
      isProcessingFrame = false;
    }
  }
}

function processVideoLoop() {
  if (videoElement && !videoElement.paused && !videoElement.ended) {
    sendFrameToMediaPipe();

    if ('requestVideoFrameCallback' in videoElement) {
      videoElement.requestVideoFrameCallback(processVideoLoop);
    } else {
      setTimeout(processVideoLoop, 1000 / 30);
    }
  }
}

// File Input Handler
if (fileInput) {
  fileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
      const videoURL = URL.createObjectURL(file);
      videoElement.src = videoURL;
      videoElement.load();

      if (btnPlayPause) btnPlayPause.disabled = false;
      if (btnPrevFrame) btnPrevFrame.disabled = false;
      if (btnNextFrame) btnNextFrame.disabled = false;

      if (statusBadge) {
        statusBadge.innerText = "Video Loaded";
        statusBadge.className = "badge";
      }
    }
  });
}

// Play / Pause Controls
if (btnPlayPause) {
  btnPlayPause.addEventListener('click', () => {
    if (videoElement.paused) {
      videoElement.play();
      btnPlayPause.innerText = "Pause";
    } else {
      videoElement.pause();
      btnPlayPause.innerText = "Play";
    }
  });
}

if (videoElement) {
  videoElement.addEventListener('play', () => {
    if ('requestVideoFrameCallback' in videoElement) {
      videoElement.requestVideoFrameCallback(processVideoLoop);
    } else {
      processVideoLoop();
    }
  });

  videoElement.addEventListener('seeked', () => {
    sendFrameToMediaPipe();
  });
}

// Frame Scrubbing Buttons
if (btnNextFrame) {
  btnNextFrame.addEventListener('click', () => {
    if (!videoElement) return;
    videoElement.pause();
    if (btnPlayPause) btnPlayPause.innerText = "Play";
    videoElement.currentTime = Math.min(videoElement.duration, videoElement.currentTime + FRAME_TIME);
  });
}

if (btnPrevFrame) {
  btnPrevFrame.addEventListener('click', () => {
    if (!videoElement) return;
    videoElement.pause();
    if (btnPlayPause) btnPlayPause.innerText = "Play";
    videoElement.currentTime = Math.max(0, videoElement.currentTime - FRAME_TIME);
  });
}