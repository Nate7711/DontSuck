// ==========================================
// Application Revision Counter
// Increment this string on every deploy to verify updates!
// ==========================================
const APP_VERSION = "v1.0.5";

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
const viewportContainer = document.getElementById('viewport-frame');
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

// Tracking State
let smoothedLandmarks = null;
const SMOOTHING_FACTOR = 0.25;

// ==========================================
// Canvas & Video Aspect-Ratio Layout Alignment
// ==========================================
function syncCanvasSize() {
  if (!videoElement || !canvasElement || !videoElement.videoWidth || !videoElement.videoHeight) return;

  canvasElement.width = videoElement.videoWidth;
  canvasElement.height = videoElement.videoHeight;

  const containerRect = viewportContainer.getBoundingClientRect();
  const videoRatio = videoElement.videoWidth / videoElement.videoHeight;
  const containerRatio = containerRect.width / containerRect.height;

  let displayWidth, displayHeight, topOffset, leftOffset;

  if (containerRatio > videoRatio) {
    displayHeight = containerRect.height;
    displayWidth = displayHeight * videoRatio;
    topOffset = 0;
    leftOffset = (containerRect.width - displayWidth) / 2;
  } else {
    displayWidth = containerRect.width;
    displayHeight = displayWidth / videoRatio;
    leftOffset = 0;
    topOffset = (containerRect.height - displayHeight) / 2;
  }

  canvasElement.style.width = `${displayWidth}px`;
  canvasElement.style.height = `${displayHeight}px`;
  canvasElement.style.top = `${topOffset}px`;
  canvasElement.style.left = `${leftOffset}px`;
}

window.addEventListener('resize', syncCanvasSize);

// ==========================================
// Helper Math & Smoothing Functions
// ==========================================

function smoothPoint(prev, current, factor) {
  if (!prev) return { x: current.x, y: current.y, visibility: current.visibility };
  return {
    x: prev.x + factor * (current.x - prev.x),
    y: prev.y + factor * (current.y - prev.y),
    visibility: current.visibility
  };
}

function calculateAngle(a, b, c) {
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs((radians * 180.0) / Math.PI);
  if (angle > 180.0) {
    angle = 360.0 - angle;
  }
  return angle;
}

// Draw a line connecting two landmark points
function drawBone(ctx, p1, p2, color, width) {
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

// Draw a circular joint node
function drawJoint(ctx, point, radius, color) {
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#FFFFFF';
  ctx.stroke();
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

initMediaPipePose();

// ==========================================
// MediaPipe Frame Results & Multi-Joint Processing
// ==========================================
function onResults(results) {
  try {
    if (!canvasElement || !canvasCtx || !videoElement) return;

    syncCanvasSize();

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    if (results && results.poseLandmarks) {
      const raw = results.poseLandmarks;

      if (!smoothedLandmarks) {
        smoothedLandmarks = raw.map(p => ({ ...p }));
      } else {
        for (let i = 0; i < raw.length; i++) {
          smoothedLandmarks[i] = smoothPoint(smoothedLandmarks[i], raw[i], SMOOTHING_FACTOR);
        }
      }

      const w = canvasElement.width;
      const h = canvasElement.height;
      const point = (idx) => ({
        x: smoothedLandmarks[idx].x * w,
        y: smoothedLandmarks[idx].y * h,
        visibility: smoothedLandmarks[idx].visibility
      });

      // Joint Mapping (MediaPipe Indexes)
      const lShoulder = point(11), rShoulder = point(12);
      const lElbow = point(13),    rElbow = point(14);
      const lWrist = point(15),    rWrist = point(16);
      const lHip = point(23),      rHip = point(24);
      const lKnee = point(25),     rKnee = point(26);
      const lAnkle = point(27),    rAnkle = point(28);

      // Mid-Spine Calculation (Shoulder Midpoint -> Hip Midpoint)
      const midShoulder = { x: (lShoulder.x + rShoulder.x) / 2, y: (lShoulder.y + rShoulder.y) / 2 };
      const midHip = { x: (lHip.x + rHip.x) / 2, y: (lHip.y + rHip.y) / 2 };

      // Calculate Primary/Near Leg for Depth Checks based on higher visibility
      const leftVis = (lHip.visibility || 0) + (lKnee.visibility || 0) + (lAnkle.visibility || 0);
      const rightVis = (rHip.visibility || 0) + (rKnee.visibility || 0) + (rAnkle.visibility || 0);
      const primaryLeft = leftVis >= rightVis;

      const priHip = primaryLeft ? lHip : rHip;
      const priKnee = primaryLeft ? lKnee : rKnee;
      const priAnkle = primaryLeft ? lAnkle : rAnkle;

      // Dynamic Anthropometric Knee-Top Offset
      const dx = priHip.x - priKnee.x;
      const dy = priHip.y - priKnee.y;
      const femurLength = Math.sqrt(dx * dx + dy * dy);
      const dynamicKneeOffset = femurLength * 0.14;
      const topOfKneeY = priKnee.y - dynamicKneeOffset;

      // Depth & Knee Angle Calculation
      const isAtDepth = priHip.y >= topOfKneeY;
      const kneeAngle = calculateAngle(
        { x: priHip.x / w, y: priHip.y / h },
        { x: priKnee.x / w, y: priKnee.y / h },
        { x: priAnkle.x / w, y: priAnkle.y / h }
      );

      // Update UI Status Labels
      if (kneeAngleLabel) kneeAngleLabel.innerText = `${Math.round(kneeAngle)}°`;
      if (depthStatusLabel) {
        depthStatusLabel.innerText = isAtDepth ? "DEPTH MET" : "ABOVE PARALLEL";
        depthStatusLabel.style.color = isAtDepth ? "#34C759" : "#FF3B30";
      }
      if (statusBadge) {
        statusBadge.innerText = isAtDepth ? "DEPTH REACHED" : "ABOVE PARALLEL";
        statusBadge.className = isAtDepth ? "badge depth-reached" : "badge above-parallel";
      }

      const boneWidth = Math.max(3, Math.floor(w / 120));
      const nodeRadius = Math.max(5, Math.floor(w / 90));
      const accentColor = isAtDepth ? '#34C759' : '#FF3B30';

      // 1. Draw Mid-Spine Reference Line
      drawBone(canvasCtx, midShoulder, midHip, '#FFCC00', boneWidth + 1);

      // 2. Draw Shoulder & Hip Clavicle/Pelvis Cross-Bars
      drawBone(canvasCtx, lShoulder, rShoulder, '#0A84FF', boneWidth);
      drawBone(canvasCtx, lHip, rHip, '#0A84FF', boneWidth);

      // 3. Draw Arms (Shoulder -> Elbow -> Wrist)
      drawBone(canvasCtx, lShoulder, lElbow, '#0A84FF', boneWidth);
      drawBone(canvasCtx, lElbow, lWrist, '#0A84FF', boneWidth);
      drawBone(canvasCtx, rShoulder, rElbow, '#0A84FF', boneWidth);
      drawBone(canvasCtx, rElbow, rWrist, '#0A84FF', boneWidth);

      // 4. Draw Both Legs (Hip -> Knee -> Ankle)
      drawBone(canvasCtx, lHip, lKnee, accentColor, boneWidth);
      drawBone(canvasCtx, lKnee, lAnkle, accentColor, boneWidth);
      drawBone(canvasCtx, rHip, rKnee, accentColor, boneWidth);
      drawBone(canvasCtx, rKnee, rAnkle, accentColor, boneWidth);

      // 5. Draw Top-of-Knee Parallel Reference Horizon
      canvasCtx.beginPath();
      canvasCtx.moveTo(priHip.x - 90, topOfKneeY);
      canvasCtx.lineTo(priKnee.x + 90, topOfKneeY);
      canvasCtx.strokeStyle = '#FFCC00';
      canvasCtx.lineWidth = 2.5;
      canvasCtx.setLineDash([6, 6]);
      canvasCtx.stroke();
      canvasCtx.setLineDash([]);

      // 6. Draw Joint Nodes
      const allNodes = [
        lShoulder, rShoulder, lElbow, rElbow, lWrist, rWrist,
        lHip, rHip, lKnee, rKnee, lAnkle, rAnkle, midShoulder, midHip
      ];

      allNodes.forEach(node => {
        if (node.visibility > 0.3) {
          drawJoint(canvasCtx, node, nodeRadius, accentColor);
        }
      });
    }
    canvasCtx.restore();
  } catch (err) {
    console.error("Error drawing onResults overlay:", err);
  } finally {
    isProcessingFrame = false;
  }
}

// ==========================================
// Frame Processing Execution
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
// Event Listeners
// ==========================================

if (fileInput) {
  fileInput.addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    smoothedLandmarks = null;

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
  videoElement.addEventListener('loadedmetadata', () => {
    syncCanvasSize();

    if (btnPlayPause) btnPlayPause.disabled = false;
    if (btnPrevFrame) btnPrevFrame.disabled = false;
    if (btnNextFrame) btnNextFrame.disabled = false;

    if (statusBadge) {
      statusBadge.innerText = "READY TO PLAY";
      statusBadge.className = "badge";
    }

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

// Control Buttons
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