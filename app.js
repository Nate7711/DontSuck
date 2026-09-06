// ==========================================
// Application Revision Counter
// Increment this string on every deploy to verify updates!
// ==========================================
const APP_VERSION = "v1.0.1";

// Populate version tag as soon as DOM loads
function updateVersionDisplay() {
  const versionElement = document.getElementById('app-version');
  if (versionElement) {
    versionElement.innerText = APP_VERSION;
  }
  console.log(`[App Initialization] Loaded Version: ${APP_VERSION}`);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', updateVersionDisplay);
} else {
  updateVersionDisplay();
}

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

const FRAME_TIME = 1 / 30; // ~30 FPS step duration
let isProcessingFrame = false;
let poseInstance = null;

// ==========================================
// Helper Math Functions
// ==========================================

/**
 * Calculates 2D interior angle in degrees between three points (A, B, C)
 * B is the vertex point (knee)
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
function initMediaPipePose() {
  if (typeof Pose === 'undefined') {
    console.warn("MediaPipe Pose CDN script not detected yet. Retrying...");
    setTimeout(initMediaPipePose, 200);
    return;
  }

  poseInstance = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
  });

  poseInstance.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    enableSegmentation: false,
    smoothSegmentation: false,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });

  poseInstance.onResults(onResults);
  console.log("MediaPipe Pose initialized successfully.");
}

// Start MediaPipe initialization
initMediaPipePose();

// ==========================================
// MediaPipe Frame Results & Depth Processing
// ==========================================
function onResults(results) {
  try {
    if (!canvasElement || !canvasCtx || !videoElement) return;

    // Match canvas dimensions to actual video resolution
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

      // Select side facing camera based on highest landmark visibility
      const leftVis = (leftHip?.visibility || 0) + (leftKnee?.visibility || 0) + (leftAnkle?.visibility || 0);
      const rightVis = (rightHip?.visibility || 0) + (rightKnee?.visibility || 0) + (rightAnkle?.visibility || 0);
      const useLeft = leftVis >= rightVis;

      const hip = useLeft ? leftHip : rightHip;
      const knee = useLeft ? leftKnee : rightKnee;
      const ankle = useLeft ? leftAnkle : rightAnkle;

      if (hip && knee && ankle && hip.visibility > 0.3 && knee.visibility > 0.3 && ankle.visibility > 0.3) {
        
        // 1. Dynamic Anthropometric Knee-Top Offset Calculation
        const dx = hip.x - knee.x;
        const dy = hip.y - knee.y;
        const femurLength = Math.sqrt(dx * dx + dy * dy);

        // Knee joint top surface is ~14% of femur length above joint pivot
        const dynamicKneeOffset = femurLength * 0.14;
        const topOfKneeY = knee.y - dynamicKneeOffset;

        // 2. Powerlifting Standard Depth Check
        const isAtDepth = hip.y >= topOfKneeY;
        const kneeAngle = calculateAngle(hip, knee, ankle);

        // 3. UI Status Label Updates
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

        // 4. Canvas Overlay Visuals
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

        // Draw Top-of-Knee Reference Line (Dashed Horizon)
        canvasCtx.beginPath();
        canvasCtx.moveTo(p1.x - 80, topKneeYPx);
        canvasCtx.lineTo(p2.x + 80, topKneeYPx);
        canvasCtx.strokeStyle = '#FFCC00';
        canvasCtx.lineWidth = 3;
        canvasCtx.setLineDash([6, 6]);
        canvasCtx.stroke();
        canvasCtx.setLineDash([]);

        // Draw Joint Markers
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
    console.error("Error drawing onResults overlay:", err);
  } finally {
    isProcessingFrame = false;
  }
}

// ==========================================
// Frame Processing Pipeline
// ==========================================

async function sendFrameToMediaPipe() {
  if (!poseInstance || !videoElement || videoElement.readyState < 2 || isProcessingFrame) return;

  isProcessingFrame = true;
  try {
    await poseInstance.send({ image: videoElement });
  } catch (e) {
    console.error("MediaPipe frame send error:", e);
    isProcessingFrame = false;
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

// ==========================================
// File Input & Video Event Handlers
// ==========================================

if (fileInput) {
  fileInput.addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    // Set crossOrigin attribute to bypass WebGL canvas taint errors
    if (videoElement) {
      videoElement.crossOrigin = "anonymous";
    }

    const videoURL = URL.createObjectURL(file);
    videoElement.pause();
    videoElement.src = videoURL;
    videoElement.load();

    if (statusBadge) {
      statusBadge.innerText = "LOADING METADATA...";
      statusBadge.className = "badge";
    }
  });
}

if (videoElement) {
  // Triggered when video metadata (dimensions, duration) is ready
  videoElement.addEventListener('loadedmetadata', () => {
    if (canvasElement && videoElement.videoWidth) {
      canvasElement.width = videoElement.videoWidth;
      canvasElement.height = videoElement.videoHeight;
    }

    if (btnPlayPause) btnPlayPause.disabled = false;
    if (btnPrevFrame) btnPrevFrame.disabled = false;
    if (btnNextFrame) btnNextFrame.disabled = false;

    if (statusBadge) {
      statusBadge.innerText = "READY TO PLAY";
      statusBadge.className = "badge";
    }

    // Process initial frame so overlay shows on paused start frame
    sendFrameToMediaPipe();
  });

  videoElement.addEventListener('play', () => {
    if (btnPlayPause) btnPlayPause.innerText = "Pause";
    processVideoLoop();
  });

  videoElement.addEventListener('pause', () => {
    if (btnPlayPause) btnPlayPause.innerText = "Play";
  });

  videoElement.addEventListener('seeked', () => {
    sendFrameToMediaPipe();
  });
}

// ==========================================
// Control Buttons Event Listeners
// ==========================================

if (btnPlayPause) {
  btnPlayPause.addEventListener('click', async () => {
    if (!videoElement || !videoElement.src) return;

    if (videoElement.paused) {
      try {
        await videoElement.play();
      } catch (err) {
        console.error("Playback trigger blocked by browser:", err);
      }
    } else {
      videoElement.pause();
    }
  });
}

if (btnNextFrame) {
  btnNextFrame.addEventListener('click', () => {
    if (!videoElement) return;
    videoElement.pause();
    videoElement.currentTime = Math.min(videoElement.duration || 0, videoElement.currentTime + FRAME_TIME);
  });
}

if (btnPrevFrame) {
  btnPrevFrame.addEventListener('click', () => {
    if (!videoElement) return;
    videoElement.pause();
    videoElement.currentTime = Math.max(0, videoElement.currentTime - FRAME_TIME);
  });
}