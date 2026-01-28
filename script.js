// BARE-METAL LOADER & BRIDGE

const statusEl = document.getElementById('status');
const btnReset = document.getElementById('btn-reset');
const uploadEl = document.getElementById('upload');
const logEl = document.getElementById('log');
const filterBtns = document.querySelectorAll('.filter-btn');

// Params
const paramThreshold = document.getElementById('param-threshold');
const valThreshold = document.getElementById('val-threshold');
const paramBrightness = document.getElementById('param-brightness');
const valBrightness = document.getElementById('val-brightness');
const paramBlur = document.getElementById('param-blur');
const valBlur = document.getElementById('val-blur');

// Sync sliders
[[paramThreshold, valThreshold], [paramBrightness, valBrightness], [paramBlur, valBlur]].forEach(([input, disp]) => {
    input.addEventListener('input', () => disp.textContent = input.value);
});

// Canvases
const canvasOriginal = document.getElementById('canvas-original');
const ctxOriginal = canvasOriginal.getContext('2d');
const canvasProcessed = document.getElementById('canvas-processed');
const ctxProcessed = canvasProcessed.getContext('2d');

// WASM State
let wasmInstance = null;
let wasmExports = null;

const log = (msg) => {
    const div = document.createElement('div');
    div.className = 'result-line';
    div.innerHTML = `> ${msg}`;
    logEl.prepend(div);
};

// 1. WASM LOADER
async function loadWasm() {
    try {
        const response = await fetch('zig-out/bin/zig-image-proc.wasm');
        if (!response.ok) throw new Error("Could not find .wasm file.");

        const bytes = await response.arrayBuffer();
        const obj = await WebAssembly.instantiate(bytes, { env: {} });

        wasmInstance = obj.instance;
        wasmExports = wasmInstance.exports;

        statusEl.textContent = "SYSTEM READY :: WASM LOADED";
        log("WASM Module Initialized.");

        // Enable UI
        if (currentImage) enableControls();

    } catch (e) {
        statusEl.textContent = "SYSTEM ERROR: " + e.message;
        statusEl.style.color = "red";
        console.error(e);
    }
}
loadWasm();

// 2. IMAGE HANDLING
let currentImage = null;

uploadEl.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
        const img = new Image();
        img.onload = () => {
            currentImage = img;
            canvasOriginal.width = img.width;
            canvasOriginal.height = img.height;
            canvasProcessed.width = img.width;
            canvasProcessed.height = img.height;
            ctxOriginal.drawImage(img, 0, 0);
            ctxProcessed.clearRect(0, 0, img.width, img.height);
            if (wasmInstance) enableControls();
            log(`Image Loaded: ${img.width}x${img.height}`);
        }
        img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
});

btnReset.addEventListener('click', () => {
    if (currentImage) ctxOriginal.drawImage(currentImage, 0, 0);
});

function enableControls() {
    btnReset.disabled = false;
    filterBtns.forEach(b => b.disabled = false);
}

// 3. CORE PROCESSING LOGIC
filterBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
        if (!currentImage || !wasmExports) return;

        const type = btn.dataset.type;
        const w = canvasOriginal.width;
        const h = canvasOriginal.height;

        // Get params
        const threshold = parseInt(paramThreshold.value);
        const brightness = parseInt(paramBrightness.value);
        const radius = parseInt(paramBlur.value);

        // --- RUN JS ---
        const startJS = performance.now();
        const jsData = ctxOriginal.getImageData(0, 0, w, h); // fresh copy
        runJS(type, jsData.data, w, h, { threshold, brightness, radius });
        const endJS = performance.now();
        const timeJS = (endJS - startJS).toFixed(2);

        // --- RUN ZIG ---
        const startZig = performance.now();
        const zigImageData = runZig(type, w, h, { threshold, brightness, radius });
        const endZig = performance.now();
        const timeZig = (endZig - startZig).toFixed(2);

        // Paint Result (Zig's result usually to show proof)
        ctxProcessed.putImageData(zigImageData, 0, 0);

        // Compare
        const speedup = (timeJS / timeZig).toFixed(1);
        let msg = `<b>${type.toUpperCase()}</b>: JS=${timeJS}ms | <span class="highlight-zig">Zig=${timeZig}ms</span>`;
        if (parseFloat(timeZig) < parseFloat(timeJS)) {
            msg += ` <span class="faster">(${speedup}x Faster)</span>`;
        } else {
            msg += ` <span class="faster" style="color:#aaa">(Wrapper overhead?)</span>`;
        }
        log(msg);
    });
});

function runZig(type, w, h, params) {
    const byteSize = w * h * 4;
    const ptr = wasmExports.alloc(byteSize);
    const wasmBuffer = new Uint8Array(wasmExports.memory.buffer, ptr, byteSize);

    // Copy in
    const src = ctxOriginal.getImageData(0, 0, w, h).data;
    wasmBuffer.set(src);

    // Call
    switch (type) {
        case 'grayscale': wasmExports.process_grayscale(ptr, w, h); break;
        case 'invert': wasmExports.process_invert(ptr, w, h); break;
        case 'sepia': wasmExports.process_sepia(ptr, w, h); break;
        case 'threshold': wasmExports.process_threshold(ptr, w, h, params.threshold); break;
        case 'brightness': wasmExports.process_brightness(ptr, w, h, params.brightness); break;
        case 'blur': wasmExports.process_blur(ptr, w, h, params.radius); break;
        case 'sobel': wasmExports.process_sobel(ptr, w, h); break;
    }

    // Copy out
    const resultView = new Uint8ClampedArray(wasmExports.memory.buffer, ptr, byteSize);
    const resultReq = new ImageData(resultView.slice(), w, h);

    wasmExports.free(ptr, byteSize);
    return resultReq;
}

function runJS(type, data, w, h, params) {
    if (type === 'blur') {
        jsBlur(data, w, h, params.radius);
        return;
    }
    if (type === 'sobel') {
        jsSobel(data, w, h);
        return;
    }

    // Pixel loops
    for (let i = 0; i < data.length; i += 4) {
        let r = data[i], g = data[i + 1], b = data[i + 2];

        if (type === 'grayscale') {
            const v = 0.299 * r + 0.587 * g + 0.114 * b;
            data[i] = data[i + 1] = data[i + 2] = v;
        }
        else if (type === 'invert') {
            data[i] = 255 - r;
            data[i + 1] = 255 - g;
            data[i + 2] = 255 - b;
        }
        else if (type === 'sepia') {
            const tr = 0.393 * r + 0.769 * g + 0.189 * b;
            const tg = 0.349 * r + 0.686 * g + 0.168 * b;
            const tb = 0.272 * r + 0.534 * g + 0.131 * b;
            data[i] = tr > 255 ? 255 : tr;
            data[i + 1] = tg > 255 ? 255 : tg;
            data[i + 2] = tb > 255 ? 255 : tb;
        }
        else if (type === 'threshold') {
            const avg = (r + g + b) / 3;
            const v = avg >= params.threshold ? 255 : 0;
            data[i] = data[i + 1] = data[i + 2] = v;
        }
        else if (type === 'brightness') {
            const f = params.brightness;
            data[i] = Math.min(255, Math.max(0, r + f));
            data[i + 1] = Math.min(255, Math.max(0, g + f));
            data[i + 2] = Math.min(255, Math.max(0, b + f));
        }
    }
}

function jsBlur(data, w, h, r) {
    const copy = new Uint8ClampedArray(data);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let rs = 0, gs = 0, bs = 0, c = 0;
            for (let ky = -r; ky <= r; ky++) {
                for (let kx = -r; kx <= r; kx++) {
                    const py = y + ky, px = x + kx;
                    if (px >= 0 && px < w && py >= 0 && py < h) {
                        const idx = (py * w + px) * 4;
                        rs += copy[idx]; gs += copy[idx + 1]; bs += copy[idx + 2]; c++;
                    }
                }
            }
            const i = (y * w + x) * 4;
            data[i] = rs / c; data[i + 1] = gs / c; data[i + 2] = bs / c;
        }
    }
}

function jsSobel(data, w, h) {
    // Simply convert to gray first for kernel usage to match Zig exactly? 
    // Or just read RGB and average.
    // We'll mimic Zig implementation: read from original, average to gray, apply kernel.
    const copy = new Uint8ClampedArray(data);
    const getGray = (arr, idx) => (arr[idx] + arr[idx + 1] + arr[idx + 2]) / 3;

    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            let gx = 0, gy = 0;
            // Kernel operations... (simplified for brevity in this JS version, but functionally similar)
            // -1 0 1
            // -2 0 2
            // -1 0 1
            const idxTL = ((y - 1) * w + (x - 1)) * 4; const valTL = getGray(copy, idxTL);
            const idxL = (y * w + (x - 1)) * 4; const valL = getGray(copy, idxL);
            const idxBL = ((y + 1) * w + (x - 1)) * 4; const valBL = getGray(copy, idxBL);

            const idxTR = ((y - 1) * w + (x + 1)) * 4; const valTR = getGray(copy, idxTR);
            const idxR = (y * w + (x + 1)) * 4; const valR = getGray(copy, idxR);
            const idxBR = ((y + 1) * w + (x + 1)) * 4; const valBR = getGray(copy, idxBR);

            const idxT = ((y - 1) * w + x) * 4; const valT = getGray(copy, idxT);
            const idxB = ((y + 1) * w + x) * 4; const valB = getGray(copy, idxB);

            gx = -valTL - 2 * valL - valBL + valTR + 2 * valR + valBR;
            gy = -valTL - 2 * valT - valTR + valBL + 2 * valB + valBR;

            let mag = Math.sqrt(gx * gx + gy * gy);
            if (mag > 255) mag = 255;

            const i = (y * w + x) * 4;
            data[i] = data[i + 1] = data[i + 2] = mag;
        }
    }
}
