// ==========================================
// DOM Elements Setup
// ==========================================
const videoElement = document.getElementById('video') || document.querySelector('video');
const canvasElement = document.getElementById('canvas') || document.querySelector('canvas');
const canvasCtx = canvasElement ? canvasElement.getContext('2d') : null;

// Frame processing lock state
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
  modelComplexity: 1,
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

    // Synchronize canvas size with video aspect ratio
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
        
        // ----------------------------------------------------
        // 1. Dynamic Anthropometric Knee-Top Offset Calculation
        // ----------------------------------------------------
        // Calculate 2D Euclidean length of the femur segment (Hip to Knee)
        const dx = hip.x - knee.x;
        const dy = hip.y - knee.y;
        const femurLength = Math.sqrt(dx * dx + dy * dy);

        // Top of knee cap surface is ~14% of total femur length above knee joint center
        const dynamicKneeOffset = femurLength * 0.14;
        const topOfKneeY = knee.y - dynamicKneeOffset;

        // ----------------------------------------------------
        // 2. Powerlifting Standard Depth Check
        // ----------------------------------------------------
        // Note: Y coordinates increase downward in screen space.
        // Depth is met when hip crease Y >= top of knee joint Y.
        const isAtDepth = hip.y >= topOfKneeY;
        
        // Calculate interior knee joint angle
        const kneeAngle = calculateAngle(hip, knee, ankle);

        // ----------------------------------------------------
        // 3. Safe DOM Updates (Prevents UI exceptions)
        // ----------------------------------------------------
        const angleEl = document.getElementById('kneeAngleLabel') || document.getElementById('angle');
        if (angleEl) {
          angleEl.innerText = `${Math.round(kneeAngle)}°`;
        }

        const statusEl = document.getElementById('depthStatusLabel') || document.getElementById('status');
        if (statusEl) {
          statusEl.innerText = isAtDepth ? "DEPTH MET" : "ABOVE PARALLEL";
          statusEl.style.color = isAtDepth ? "#34C759" : "#FF3B30";
        }

        const badgeEl = document.getElementById('statusBadge') || document.querySelector('.badge');
        if (badgeEl) {
          badgeEl.innerText = isAtDepth ? "DEPTH REACHED" : "ABOVE PARALLEL";
          badgeEl.className = isAtDepth ? "badge depth-reached" : "badge above-parallel";
        }

        // ----------------------------------------------------
        // 4. Canvas Overlay Visuals Drawing
        // ----------------------------------------------------
        // Convert normalized coordinates (0.0 - 1.0) to Canvas pixel dimensions
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
        canvasCtx.setLineDash([]); // Reset dash state

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
    console.error("Error inside onResults processing:", err);
  } finally {
    // Release frame processing state lock to ensure smooth playback loop
    isProcessingFrame = false;
  }
}

// ==========================================
// Frame Processing Loop Execution
// ==========================================
async function processVideoFrame() {
  if (videoElement && !videoElement.paused && !videoElement.ended) {
    if (!isProcessingFrame) {
      isProcessingFrame = true;
      await pose.send({ image: videoElement });
    }
    requestAnimationFrame(processVideoFrame);
  }
}

// Playback listener triggers frame processing automatically
if (videoElement) {
  videoElement.addEventListener('play', () => {
    processVideoFrame();
  });
  
  videoElement.addEventListener('seeked', async () => {
    if (videoElement.paused) {
      await pose.send({ image: videoElement });
    }
  });
}