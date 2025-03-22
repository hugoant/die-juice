document.addEventListener('DOMContentLoaded', function () {
  // Element references
  const fileInput = document.getElementById('fileInput');
  const uploadArea = document.getElementById('upload-area');
  const canvasContainer = document.getElementById('canvas-container');
  const canvas = document.getElementById('imageCanvas');
  const ctx = canvas.getContext('2d');
  const calibrateBtn = document.getElementById('calibrateBtn');
  const measureBtn = document.getElementById('measureBtn');
  const panBtn = document.getElementById('panBtn');
  const resetBtn = document.getElementById('resetBtn');
  const zoomInBtn = document.getElementById('zoomInBtn');
  const zoomOutBtn = document.getElementById('zoomOutBtn');
  const unitSelect = document.getElementById('unitSelect');
  const measurementsUl = document.getElementById('measurements');
  const calibrationInput = document.getElementById('calibrationInput');

  let img = new Image();
  let imageLoaded = false;
  let baseScale = 1;    // Scale to fit image in frame
  let zoomFactor = 1;   // Additional zoom factor
  let displayScale = 1; // Overall scale = baseScale * zoomFactor

  // For centering the image, we use a base offset plus a pan offset.
  let offsetX = 0, offsetY = 0; // Final computed offset
  let panOffsetX = 0, panOffsetY = 0; // Extra offset applied via panning
  let panStartOffsetX = 0, panStartOffsetY = 0; // store offset at pan start

  // Mode can be "calibration", "measurement", or "pan"
  let mode = null;
  let isDrawing = false;
  let isPanning = false;
  let startX, startY; // For drawing (in image coords)
  let panStartX, panStartY; // For panning (in screen coords)

  // Calibration info: {x, y, width, height, realArea}
  let calibration = null;
  let calibrationFactor = 1; // real area per pixel area

  // Measurements: each {x, y, width, height, realArea, color}
  let measurements = [];

  // Color palette for measurement rectangles
  const measurementColors = ["#1E90FF", "#00BFFF", "#3CB371", "#2E8B57", "#8A2BE2", "#9370DB"];

  // Update the canvas cursor based on current mode
  function updateCursor() {
    if (mode === 'calibration' || mode === 'measurement') {
      canvas.style.cursor = 'crosshair';
    } else if (mode === 'pan') {
      canvas.style.cursor = isPanning ? 'grabbing' : 'grab';
    } else {
      canvas.style.cursor = 'default';
    }
  }

  // --- Image upload handling ---
  uploadArea.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFile);
  
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });
  uploadArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
  });
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      handleFile({ target: { files: [file] } });
    }
  });

  function handleFile(e) {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = function(evt) {
        img.onload = function() {
          imageLoaded = true;
          // Hide the upload area.
          uploadArea.style.display = 'none';
          
          // Set canvas size to container size.
          canvas.width = canvasContainer.clientWidth;
          canvas.height = canvasContainer.clientHeight;

          // Reset pan/zoom
          panOffsetX = 0;
          panOffsetY = 0;
          baseScale = Math.min(canvas.width / img.width, canvas.height / img.height);
          zoomFactor = 1;
          displayScale = baseScale * zoomFactor;

          draw();
        };
        img.src = evt.target.result;
      };
      reader.readAsDataURL(file);
    }
  }

  // --- Mode buttons ---
  calibrateBtn.addEventListener('click', () => {
    mode = 'calibration';
    calibrateBtn.classList.add('active');
    measureBtn.classList.remove('active');
    panBtn.classList.remove('active');
    updateCursor();
    draw();
  });
  
  measureBtn.addEventListener('click', () => {
    mode = 'measurement';
    measureBtn.classList.add('active');
    calibrateBtn.classList.remove('active');
    panBtn.classList.remove('active');
    updateCursor();
    draw();
  });
  
  panBtn.addEventListener('click', () => {
    mode = 'pan';
    panBtn.classList.add('active');
    calibrateBtn.classList.remove('active');
    measureBtn.classList.remove('active');
    updateCursor();
    draw();
  });
  
  resetBtn.addEventListener('click', () => {
    calibration = null;
    calibrationInput.value = ""; // Clear the calibration input as well
    measurements = [];
    calibrationFactor = 1;
    panOffsetX = 0;
    panOffsetY = 0;
    draw();
    updateMeasurementsList();
  });

  // --- Zoom controls (buttons) ---
  zoomInBtn.addEventListener('click', () => {
    if (!imageLoaded) return;
    zoomFactor *= 1.2;
    displayScale = baseScale * zoomFactor;
    draw();
  });
  zoomOutBtn.addEventListener('click', () => {
    if (!imageLoaded) return;
    zoomFactor /= 1.2;
    displayScale = baseScale * zoomFactor;
    draw();
  });

  // --- Mouse wheel zoom ---
  canvas.addEventListener('wheel', (e) => {
    if (!imageLoaded) return;
    e.preventDefault(); // Prevent page scroll

    // Zoom in/out around the current center (could refine to zoom on cursor if desired)
    if (e.deltaY < 0) {
      // wheel up => zoom in
      zoomFactor *= 1.1;
    } else {
      // wheel down => zoom out
      zoomFactor /= 1.1;
    }
    displayScale = baseScale * zoomFactor;
    draw();
  }, { passive: false });

  // --- Unit conversion ---
  function getDisplayConversion() {
    const unit = unitSelect.value;
    if (unit === 'mm2') return 1; // store as mm²
    if (unit === 'cm2') return 0.01;
    if (unit === 'in2') return 1 / 645.16;
    return 1;
  }
  unitSelect.addEventListener('change', () => {
    draw();
    updateMeasurementsList();
  });

  // --- Manual editing of the calibration area ---
  calibrationInput.addEventListener('input', (e) => {
    if (calibration) {
      const newArea = parseFloat(e.target.value);
      if (!isNaN(newArea) && newArea > 0) {
        calibration.realArea = newArea;
        const pixelArea = calibration.width * calibration.height;
        calibrationFactor = newArea / pixelArea;

        // Recalculate each measurement realArea
        measurements = measurements.map(m => {
          const pArea = m.width * m.height;
          return { ...m, realArea: pArea * calibrationFactor };
        });

        draw();
        updateMeasurementsList();
      }
    }
  });

  // --- Mouse events on the canvas ---
  canvas.addEventListener('mousedown', (e) => {
    if (!imageLoaded || !mode) return;
    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    computeOffsets();
    if (mode === 'pan') {
      // Begin panning
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panStartOffsetX = panOffsetX;
      panStartOffsetY = panOffsetY;
      updateCursor();
      return;
    }

    // For calibration/measurement, ensure click is within image area
    if (canvasX < offsetX || canvasX > offsetX + img.width * displayScale ||
        canvasY < offsetY || canvasY > offsetY + img.height * displayScale) {
      return;
    }
    const imageX = (canvasX - offsetX) / displayScale;
    const imageY = (canvasY - offsetY) / displayScale;
    isDrawing = true;
    startX = imageX;
    startY = imageY;
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!imageLoaded) return;
    if (mode === 'pan' && isPanning) {
      // Update pan offset
      let deltaX = e.clientX - panStartX;
      let deltaY = e.clientY - panStartY;
      panOffsetX = panStartOffsetX + deltaX;
      panOffsetY = panStartOffsetY + deltaY;
      draw();
      return;
    }
    if (!isDrawing) return;

    // In calibration or measurement mode, draw a preview rectangle
    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    const imageX = (canvasX - offsetX) / displayScale;
    const imageY = (canvasY - offsetY) / displayScale;
    const width = imageX - startX;
    const height = imageY - startY;

    draw(); // Clear previous preview
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(displayScale, displayScale);

    if (mode === 'calibration') {
      ctx.strokeStyle = 'red';
      ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
    } else {
      ctx.strokeStyle = 'blue';
      ctx.fillStyle = 'rgba(0, 0, 255, 0.3)';
    }
    ctx.lineWidth = 2 / displayScale;
    ctx.strokeRect(startX, startY, width, height);
    ctx.fillRect(startX, startY, width, height);
    ctx.restore();
  });

  canvas.addEventListener('mouseup', (e) => {
    if (!imageLoaded) return;
    if (mode === 'pan' && isPanning) {
      isPanning = false;
      updateCursor();
      return;
    }
    if (!isDrawing) return;
    isDrawing = false;

    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;
    const imageX = (canvasX - offsetX) / displayScale;
    const imageY = (canvasY - offsetY) / displayScale;
    const width = imageX - startX;
    const height = imageY - startY;

    // Avoid rectangles too small to be meaningful
    if (Math.abs(width) < 10 || Math.abs(height) < 10) {
      draw();
      return;
    }

    const rectData = {
      x: Math.min(startX, imageX),
      y: Math.min(startY, imageY),
      width: Math.abs(width),
      height: Math.abs(height)
    };

    if (mode === 'calibration') {
      let realArea = parseFloat(prompt("Enter the real-world area of the calibration component (" + unitSelect.value + "):"));
      if (isNaN(realArea) || realArea <= 0) {
        draw();
        return;
      }
      calibration = { ...rectData, realArea };
      calibrationInput.value = realArea; // Fill the side input with this value

      const pixelArea = rectData.width * rectData.height;
      calibrationFactor = realArea / pixelArea;

      // Update any existing measurements
      measurements = measurements.map(m => {
        const pArea = m.width * m.height;
        return { ...m, realArea: pArea * calibrationFactor };
      });
    } else if (mode === 'measurement') {
      if (!calibration) {
        alert("Please perform calibration first.");
        draw();
        return;
      }
      const pixelArea = rectData.width * rectData.height;
      const realArea = pixelArea * calibrationFactor;
      const randomColor = measurementColors[Math.floor(Math.random() * measurementColors.length)];
      measurements.push({ ...rectData, realArea, color: randomColor });
    }

    draw();
    updateMeasurementsList();
  });

  // --- Compute offsets to center the image plus pan offsets ---
  function computeOffsets() {
    const baseX = (canvas.width - img.width * displayScale) / 2;
    const baseY = (canvas.height - img.height * displayScale) / 2;
    offsetX = baseX + panOffsetX;
    offsetY = baseY + panOffsetY;
  }

  // --- Drawing function ---
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!imageLoaded) return;

    computeOffsets();
    ctx.drawImage(img, offsetX, offsetY, img.width * displayScale, img.height * displayScale);

    // Draw calibration rectangle (if any)
    if (calibration) {
      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(displayScale, displayScale);
      ctx.strokeStyle = 'red';
      ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
      ctx.lineWidth = 2 / displayScale;
      ctx.strokeRect(calibration.x, calibration.y, calibration.width, calibration.height);
      ctx.fillRect(calibration.x, calibration.y, calibration.width, calibration.height);

      ctx.font = `${16 / displayScale}px sans-serif`;
      const conversion = getDisplayConversion();
      const calText = `Cal: ${Math.round(calibration.realArea * conversion)} ${unitSelect.value}`;
      const calPadding = 4 / displayScale;
      const calMetrics = ctx.measureText(calText);
      const calTextWidth = calMetrics.width + calPadding * 2;
      const calTextHeight = 16 / displayScale + calPadding * 2;

      // Label background
      ctx.fillStyle = 'red';
      ctx.fillRect(calibration.x + 5, calibration.y + 5, calTextWidth, calTextHeight);

      // Label text
      ctx.fillStyle = 'white';
      ctx.fillText(calText, calibration.x + 5 + calPadding, calibration.y + 5 + (16 / displayScale));
      ctx.restore();
    }

    // Draw measurement rectangles
    measurements.forEach(m => {
      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(displayScale, displayScale);
      ctx.strokeStyle = m.color;
      ctx.fillStyle = hexToRgba(m.color, 0.3);
      ctx.lineWidth = 2 / displayScale;
      ctx.strokeRect(m.x, m.y, m.width, m.height);
      ctx.fillRect(m.x, m.y, m.width, m.height);

      ctx.font = `${16 / displayScale}px sans-serif`;
      const conversion = getDisplayConversion();
      const displayArea = Math.round(m.realArea * conversion);
      const text = `${displayArea} ${unitSelect.value}`;
      const padding = 4 / displayScale;
      const textMetrics = ctx.measureText(text);
      const textWidth = textMetrics.width + padding * 2;
      const textHeight = 16 / displayScale + padding * 2;

      // Label background
      ctx.fillStyle = m.color;
      ctx.fillRect(m.x + 5, m.y + 5, textWidth, textHeight);

      // Label text
      ctx.fillStyle = 'white';
      ctx.fillText(text, m.x + 5 + padding, m.y + 5 + (16 / displayScale));
      ctx.restore();
    });
  }

  // --- Convert hex color to rgba string ---
  function hexToRgba(hex, alpha) {
    hex = hex.replace("#", "");
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // --- Update the measurements list in the right panel ---
  function updateMeasurementsList() {
    measurementsUl.innerHTML = "";
    const conversion = getDisplayConversion();
    measurements.forEach((m, index) => {
      const displayArea = Math.round(m.realArea * conversion);
      const li = document.createElement("li");
      
      // Measurement label
      const label = document.createElement("span");
      label.textContent = `Measurement ${index + 1}: ${displayArea} ${unitSelect.value}`;
      label.style.color = m.color;
      li.appendChild(label);

      // Delete button (small red box with a cross)
      const closeBtn = document.createElement("span");
      closeBtn.classList.add("delete-measure-btn");
      closeBtn.textContent = "✕";
      closeBtn.title = "Delete this measurement";
      closeBtn.addEventListener('click', () => {
        measurements.splice(index, 1);
        draw();
        updateMeasurementsList();
      });
      li.appendChild(closeBtn);

      measurementsUl.appendChild(li);
    });
  }
});
