const startButton = document.getElementById("startButton");
const volumeLevel = document.getElementById("volumeLevel");
const colorDisplay = document.getElementById("colorDisplay");
const sensitivitySlider = document.getElementById("sensitivity");
const volumeHistory = [];
const historyLength = 100; // number of frames to average ~10 seconds at 60fps

let audioContext;
let analyser;
let microphone;

startButton.addEventListener("click", async () => {

  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  microphone = audioContext.createMediaStreamSource(stream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;

  microphone.connect(analyser);

  const dataArray = new Uint8Array(analyser.frequencyBinCount);

 function checkVolume() {
    analyser.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
    }

    let instant = sum / dataArray.length;

    // Add to history
    volumeHistory.push(instant);
    if (volumeHistory.length > historyLength) {
        volumeHistory.shift();
    }

    // Compute average
    let average = volumeHistory.reduce((a,b) => a+b, 0) / volumeHistory.length;

    volumeLevel.textContent = Math.round(average);

    updateColor(average);

    requestAnimationFrame(checkVolume);

     }

  checkVolume();
});

function updateColor(level) {
    const greenMax = parseFloat(document.getElementById("greenMax").value);
    const yellowMax = parseFloat(document.getElementById("yellowMax").value);
    const orangeMax = parseFloat(document.getElementById("orangeMax").value);

    colorDisplay.className = "";

    if (level <= greenMax) {
        colorDisplay.classList.add("green");
    } else if (level <= yellowMax) {
        colorDisplay.classList.add("yellow");
    } else if (level <= orangeMax) {
        colorDisplay.classList.add("orange");
    } else {
        colorDisplay.classList.add("red");
    }
}
