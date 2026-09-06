function onResults(results) {
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

    const leftVis = (leftHip?.visibility || 0) + (leftKnee?.visibility || 0) + (leftAnkle?.visibility || 0);
    const rightVis = (rightHip?.visibility || 0) + (rightKnee?.visibility || 0) + (rightAnkle?.visibility || 0);
    const useLeft = leftVis >= rightVis;

    const hip = useLeft ? leftHip : rightHip;
    const knee = useLeft ? leftKnee : rightKnee;
    const ankle = useLeft ? leftAnkle : rightAnkle;

    if (hip && knee && ankle && hip.visibility > 0.3 && knee.visibility > 0.3 && ankle.visibility > 0.3) {
      // 1. Calculate dynamic segment length (Femur)
      const dx = hip.x - knee.x;
      const dy = hip.y - knee.y;
      const femurLength = Math.sqrt(dx * dx + dy * dy);

      // 2. Automated Offset (14% of Femur Length)
      const dynamicKneeOffset = femurLength * 0.14;
      const topOfKneeY = knee.y - dynamicKneeOffset;

      // 3. Powerlifting Standard Depth Check
      const isAtDepth = hip.y >= topOfKneeY;
      const kneeAngle = calculateAngle(hip, knee, ankle);

      // Update UI Text
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

      // Convert normalized points to Canvas Pixels
      const p1 = { x: hip.x * canvasElement.width, y: hip.y * canvasElement.height };
      const p2 = { x: knee.x * canvasElement.width, y: knee.y * canvasElement.height };
      const p3 = { x: ankle.x * canvasElement.width, y: ankle.y * canvasElement.height };
      const topKneeYPx = topOfKneeY * canvasElement.height;

      // Draw Skeleton Segment
      canvasCtx.beginPath();
      canvasCtx.moveTo(p1.x, p1.y);
      canvasCtx.lineTo(p2.x, p2.y);
      canvasCtx.lineTo(p3.x, p3.y);
      canvasCtx.strokeStyle = isAtDepth ? '#34C759' : '#FF3B30';
      canvasCtx.lineWidth = Math.max(4, Math.floor(canvasElement.width / 100));
      canvasCtx.stroke();

      // Draw Automated Top-of-Knee Reference Line
      canvasCtx.beginPath();
      canvasCtx.moveTo(p1.x - 50, topKneeYPx);
      canvasCtx.lineTo(p2.x + 50, topKneeYPx);
      canvasCtx.strokeStyle = '#FFCC00';
      canvasCtx.lineWidth = 2;
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
  isProcessingFrame = false;
}