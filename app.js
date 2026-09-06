const videoElement = document.getElementById('uploaded-video');
const fileInput = document.getElementById('video-upload');
const canvasElement = document.getElementById('output-canvas');
const canvasCtx = canvasElement.getContext('2d');

const kneeAngleLabel = document.getElementById('knee-angle');
const depthStatusLabel = document.getElementById('depth-status');
const statusBadge = document.getElementById('status-badge');

const btnPlayPause = document.getElementById('btn-play-pause');
const btnPrevFrame = document.getElementById('btn-prev-frame');
const btnNextFrame = document.getElementById('btn-next-frame');

const FRAME_TIME = 1 / 30; // Approx 30 FPS
let isProcessingFrame = false;
let frameCallbackId = null;

// Trigonometric calculation for joint angles
function calculateAngle(a, b, c) {
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs((radians * 180.0) / Math.PI);
  if (angle > 180.0) {
    angle = 360.0 - angle;
  }
  return angle;
}

// MediaPipe Results Processing
function onResults(results) {
  // Match canvas rendering context to natural video dimensions
  if (videoElement.videoWidth && canvasElement.width !== videoElement.videoWidth) {
    canvasElement.width = videoElement.videoWidth;
    canvasElement.height = videoElement.videoHeight;
  }

  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

  if (results && results.poseLandmarks) {
    const leftHip = results.poseLandmarks[23];
    const leftKnee = results.poseLandmarks[25];
    const leftAnkle = results.poseLandmarks[27];

    const rightHip = results.poseLandmarks[24];
    const rightKnee = results.poseLandmarks[26];
    const rightAnkle = results.poseLandmarks[28];

    // Determine side visibility
    const leftVis = (leftHip?.visibility || 0) + (leftKnee?.visibility || 0) + (leftAnkle?.visibility || 0);
    const rightVis = (rightHip?.visibility || 0) + (rightKnee?.visibility || 0) + (rightAnkle?.visibility || 0);
    const useLeft = leftVis >= rightVis;

    const hip = useLeft ? leftHip : rightHip;
    const knee = useLeft ? leftKnee : rightKnee;
    const ankle = useLeft ? leftAnkle : rightAnkle;

    if (hip && knee && ankle && hip.visibility > 0.3 && knee.visibility > 0.3 && ankle.visibility > 0.3) {
      const kneeAngle = calculateAngle(hip, knee, ankle);
      const isAtDepth = hip.y >= knee.y;

      // Update UI Text Labels
      kneeAngleLabel.innerText = `${Math.round(kneeAngle)}°`;
      if (isAtDepth) {
        depthStatusLabel.innerText = "DEPTH MET";
        depthStatusLabel.style.color = "#34C759";
        statusBadge.innerText = "DEPTH REACHED";
        statusBadge.className = "badge depth-reached";
      } else {
        depthStatusLabel.innerText = "ABOVE PARALLEL";
        depthStatusLabel.style.color = "#FF3B30";
        statusBadge.innerText = "ABOVE PARALLEL";
        statusBadge.className = "badge above-parallel";
      }

      // Coordinates for overlay drawing
      const p1 = { x: hip.x * canvasElement.width, y: hip.y * canvasElement.height };
      const p2 = { x: knee.x * canvasElement.width, y: knee.y * canvasElement.height };
      const p3 = { x: ankle.x * canvasElement.width, y: ankle.y * canvasElement.height };

      // Draw Skeleton Lines
      canvasCtx.beginPath();
      canvasCtx.moveTo(p1.x, p1.y);
      canvasCtx.lineTo(p2.x, p2.y);
      canvasCtx.lineTo(p3.x, p3.y);
      canvasCtx.strokeStyle = isAtDepth ? '#34C759' : '#FF3B30';
      canvasCtx.lineWidth = Math.max(4, Math.floor(canvasElement.width / 100));
      canvasCtx.stroke();

      // Draw Keypoint Markers
      [p1, p2, p3].forEach(point => {
        canvasCtx.beginPath();
        canvasCtx.arc(point.x, point.y, Math.max(6, Math.floor(canvasElement.width / 80)), 0, 2 * Math.PI);
        canvasCtx.fillStyle = isAtDepth ? '#34C759' : '#FF3B30';
        canvasCtx.fill();
      });
    }
  }
  canvasCtx.restore();
  isProcessingFrame = false;
}

// Initialize MediaPipe Pose Model
const pose = new Pose({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
});

pose.setOptions({
  modelComplexity: 0, // Lowered to 0 for mobile stability & fast GPU execution on iOS
  smoothLandmarks: true,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

pose.onResults(onResults);

// Core Frame Processing Function
async function analyzeCurrentFrame() {
  if (videoElement.readyState >= 2 && !isProcessingFrame) {
    isProcessingFrame = true;
    try {
      await pose.send({ image: videoElement });
    } catch (e) {
      console.error("Pose processing error:", e);
      isProcessingFrame = false;
    }
  }
}

// Native Video Frame Callback for iOS Safari
function processVideoLoop() {
  if (!videoElement.paused && !videoElement.ended) {
    analyzeCurrentFrame();
    if ('requestVideoFrameCallback' in videoElement) {
      videoElement.requestVideoFrameCallback(processVideoLoop);
    } else {
      setTimeout(processVideoLoop, 1000 / 30);
    }
  }
}

// File Input Selection
fileInput.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) {
    const videoURL = URL.createObjectURL(file);
    videoElement.src = videoURL;
    videoElement.load();

    btnPlayPause.disabled = false;
    btnPrevFrame.disabled = false;
    btnNextFrame.disabled = false;

    statusBadge.innerText = "Video Loaded";
    statusBadge.className = "badge";
  }
});

// Play / Pause Handlers
btnPlayPause.addEventListener('click', () => {
  if (videoElement.paused) {
    videoElement.play();
    btnPlayPause.innerText = "Pause";
  } else {
    videoElement.pause();
    btnPlayPause.innerText = "Play";
  }
});

videoElement.addEventListener('play', () => {
  if ('requestVideoFrameCallback' in videoElement) {
    videoElement.requestVideoFrameCallback(processVideoLoop);
  } else {
    processVideoLoop();
  }
});

// Analyze individual frames when seeking or scrubbing
videoElement.addEventListener('seeked', () => {
  analyzeCurrentFrame();
});

btnNextFrame.addEventListener('click', () => {
  videoElement.pause();
  btnPlayPause.innerText = "Play";
  videoElement.currentTime = Math.min(videoElement.duration, videoElement.currentTime + FRAME_TIME);
});

btnPrevFrame.addEventListener('click', () => {
  videoElement.pause();
  btnPlayPause.innerText = "Play";
  videoElement.currentTime = Math.max(0, videoElement.currentTime - FRAME_TIME);
});