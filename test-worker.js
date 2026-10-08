const width = 128;
const height = 128;

// Simulate a completely black frame
function isRowBlack(y) { return true; }

let topBar = 0;
for (let y = 0; y < height; y++) {
  if (!isRowBlack(y)) {
    topBar = y;
    break;
  }
}
console.log("topBar with bug:", topBar);

let topBarFixed = height;
for (let y = 0; y < height; y++) {
  if (!isRowBlack(y)) {
    topBarFixed = y;
    break;
  }
}
console.log("topBar fixed:", topBarFixed);
