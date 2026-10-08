self.onmessage = function(e) {
  const imgData = e.data.imageData;
  const width = e.data.width;
  const height = e.data.height;
  const data = imgData.data;
  
  const threshold = 25;
  
  function isBlack(x, y) {
    const i = (y * width + x) * 4;
    return data[i] <= threshold && data[i+1] <= threshold && data[i+2] <= threshold;
  }
  
  function isRowBlack(y) {
    const startX = Math.floor(width * 0.25);
    const endX = Math.floor(width * 0.75);
    const tolerance = Math.max(1, Math.floor((endX - startX) * 0.05));
    let nonBlack = 0;
    for (let x = startX; x < endX; x++) {
      if (!isBlack(x, y)) {
        nonBlack++;
        if (nonBlack > tolerance) return false;
      }
    }
    return true;
  }
  
  function isColBlack(x) {
    const startY = Math.floor(height * 0.25);
    const endY = Math.floor(height * 0.75);
    const tolerance = Math.max(1, Math.floor((endY - startY) * 0.05));
    let nonBlack = 0;
    for (let y = startY; y < endY; y++) {
      if (!isBlack(x, y)) {
        nonBlack++;
        if (nonBlack > tolerance) return false;
      }
    }
    return true;
  }
  
  let topBar = height;
  for (let y = 0; y < height; y++) {
    if (!isRowBlack(y)) {
      topBar = y;
      break;
    }
  }
  
  let bottomBar = height;
  for (let y = height - 1; y >= 0; y--) {
    if (!isRowBlack(y)) {
      bottomBar = height - 1 - y;
      break;
    }
  }
  
  let leftBar = width;
  for (let x = 0; x < width; x++) {
    if (!isColBlack(x)) {
      leftBar = x;
      break;
    }
  }
  
  let rightBar = width;
  for (let x = width - 1; x >= 0; x--) {
    if (!isColBlack(x)) {
      rightBar = width - 1 - x;
      break;
    }
  }
  
  const cropTop = topBar / height;
  const cropBottom = bottomBar / height;
  const cropLeft = leftBar / width;
  const cropRight = rightBar / width;
  
  self.postMessage({ cropTop, cropBottom, cropLeft, cropRight });
};
