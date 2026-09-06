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

const FRAME_TIME = 1 / 30; // Approx 30 FPS frame duration (0.0333s)

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
  // Sync canvas size to internal video resolution
  if (canvasElement.width !== videoElement.videoWidth) {
    canvasElement.width = videoElement.videoWidth;
    canvasElement.height = videoElement.videoHeight;
  }

  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

  if (results.poseLandmarks) {
    // MediaPipe Indices: Left Hip = 23, Left Knee = 25, Left Ankle = 27
    // Right Hip = 24, Right Knee = 26, Right Ankle = 28
    const leftHip = results.poseLandmarks[23];
    const leftKnee = results.poseLandmarks[25];
    const leftAnkle = results.poseLandmarks[27];

    const rightHip = results.poseLandmarks[24];
    const rightKnee = results.poseLandmarks[26];
    const rightAnkle = results.poseLandmarks[28];

    // Select whichever leg side has higher visibility confidence
    const useLeft = (leftHip.visibility + leftKnee.visibility + leftAnkle.visibility) >=
                    (rightHip.visibility + rightKnee.visibility + rightAnkle.visibility);

    const hip = useLeft ? leftHip : rightHip;
    const knee = useLeft ? leftKnee : rightKnee;
    const ankle = useLeft ? leftAnkle : rightAnkle;

    if (hip.visibility > 0.4 && knee.visibility > 0.4 && ankle.visibility > 0.4) {
      const kneeAngle = calculateAngle(hip, knee, ankle);

      // Normalized coordinates: Y increases downwards.
      // Hip crease is at or below knee when Hip Y >= Knee Y.
      const isAtDepth = hip.y >= knee.y;

      // Update UI Metrics
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

      // Draw Joint Connectors
      const p1 = { x: hip.x * canvasElement.width, y: hip.y * canvasElement.height };
      const p2 = { x: knee.x * canvasElement.width, y: knee.y * canvasElement.height };
      const p3 = { x: ankle.x * canvasElement.width, y: ankle.y * canvasElement.height };

      canvasCtx.beginPath();
      canvasCtx.moveTo(p1.x, p1.y);
      canvasCtx.lineTo(p2.x, p2.y);
      canvasCtx.lineTo(p3.x, p3.y);
      canvasCtx.strokeStyle = isAtDepth ? '#34C759' : '#FF3B30';
      canvasCtx.lineWidth = 6;
      canvasCtx.stroke();

      // Draw Keypoint Joint Markers
      [p1, p2, p3].forEach(point => {
        canvasCtx.beginPath();
        canvasCtx.arc(point.x, point.y, 10, 0, 2 * Math.PI);
        canvasCtx.fillStyle = isAtDepth ? '#34C759' : '#FF3B30';
        canvasCtx.fill();
      });
    }
  }
  canvasCtx.restore();
}

// Initialize MediaPipe Pose Instance
const pose = new Pose({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
});

pose.setOptions({
  modelComplexity: 1,
  smoothLandmarks: true,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

pose.onResults(onResults);

// Process current frame
async function processFrame() {
  if (videoElement.readyState >= 2) {
    await pose.send({ image: videoElement });
  }
}

// Handle File Upload Event
fileInput.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) {
    const videoURL = URL.createObjectURL(file);
    videoElement.src = videoURL;
    videoElement.load();

    // Enable Control Buttons
    btnPlayPause.disabled = false;
    btnPrevFrame.disabled = false;
    btnNextFrame.disabled = false;

    statusBadge.innerText = "Video Loaded";
    statusBadge.className = "badge";
  }
});

// Play / Pause Toggle
btnPlayPause.addEventListener('click', () => {
  if (videoElement.paused) {
    videoElement.play();
    btnPlayPause.innerText = "Pause";
  } else {
    videoElement.pause();
    btnPlayPause.innerText = "Play";
  }
});

// Video Processing Loop
videoElement.addEventListener('play', () => {
  function loop() {
    if (!videoElement.paused && !videoElement.ended) {
      processFrame();
      requestAnimationFrame(loop);
    }
  }
  loop();
});

// Run Pose Estimation when Seeking or Pausing
videoElement.addEventListener('seeked', () => {
  processFrame();
});

// Frame-by-Frame Scrubbing Controls
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