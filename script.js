// BARE-METAL LOADER & BRIDGE

const statusEl = document.getElementById('status');
const btnJs = document.getElementById('btn-js');
const btnZig = document.getElementById('btn-zig');
const btnReset = document.getElementById('btn-reset');
const uploadEl = document.getElementById('upload');
const logEl = document.getElementById('log');

// Canvases
const canvasOriginal = document.getElementById('canvas-original');
const ctxOriginal = canvasOriginal.getContext('2d');
const canvasProcessed = document.getElementById('canvas-processed');
const ctxProcessed = canvasProcessed.getContext('2d');

// WASM State
let wasmInstance = null;
let wasmMemory = null;
let wasmExports = null;

// Helpers
const log = (msg) => {
    const div = document.createElement('div');
    div.className = 'result-line';
    div.innerHTML = `> ${msg}`;
    logEl.appendChild(div);
};

// 1. WASM LOADER
async function loadWasm() {
    try {
        // In a real scenario, this matches the output path from zig build
        // We assume the user runs a server or we fetch locally.
        // For 'zig build', the file is usually in zig-out/bin/zig-image-proc.wasm
        const response = await fetch('zig-out/bin/zig-image-proc.wasm');
        if (!response.ok) throw new Error("Could not find .wasm file. Did you run 'zig build -Doptimize=ReleaseFast'?");
        
        const bytes = await response.arrayBuffer();
        const obj = await WebAssembly.instantiate(bytes, {
            env: {
                // If Zig needs any imports, they go here.
                // Minimal freestanding usually doesn't need much unless we use std.debug.print
            }
        });

        wasmInstance = obj.instance;
        wasmExports = wasmInstance.exports;
        wasmMemory = wasmExports.memory;

        statusEl.textContent = "SYSTEM READY :: WASM LOADED";
        log("WASM Module Initialized.");
        log(`Memory Size: ${wasmMemory.buffer.byteLength} bytes`);

    } catch (e) {
        statusEl.textContent = "SYSTEM ERROR";
        statusEl.style.color = "red";
        log(`Error loading WASM: ${e.message}`);
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
            
            // Resize canvas
            canvasOriginal.width = img.width;
            canvasOriginal.height = img.height;
            canvasProcessed.width = img.width;
            canvasProcessed.height = img.height;

            // Draw original
            ctxOriginal.drawImage(img, 0, 0);
            
            // Clear processed
            ctxProcessed.clearRect(0, 0, img.width, img.height);

            // Enable buttons
            if (wasmInstance) {
                btnJs.disabled = false;
                btnZig.disabled = false;
                btnReset.disabled = false;
            }
            log(`Image Loaded: ${img.width}x${img.height}`);
        }
        img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
});

btnReset.addEventListener('click', () => {
    if(currentImage) ctxProcessed.clearRect(0, 0, currentImage.width, currentImage.height);
    log("Canvas cleared.");
});

// 3. IMPLEMENTATION: PURE JS (The control group)
btnJs.addEventListener('click', () => {
    if (!currentImage) return;
    const w = canvasOriginal.width;
    const h = canvasOriginal.height;
    
    // Get data
    const imageData = ctxOriginal.getImageData(0, 0, w, h);
    const data = imageData.data; // Uint8ClampedArray

    const start = performance.now();

    // Process: Grayscale (0.299R + 0.587G + 0.114B)
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i+1];
        const b = data[i+2];
        
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        
        data[i] = gray;
        data[i+1] = gray;
        data[i+2] = gray;
        // alpha unchanged
    }

    const end = performance.now();
    
    ctxProcessed.putImageData(imageData, 0, 0);
    log(`JS Execution Time: <span class="highlight">${(end - start).toFixed(2)} ms</span>`);
});

// 4. IMPLEMENTATION: ZIG (The Bare Metal)
btnZig.addEventListener('click', () => {
    if (!currentImage || !wasmExports) return;

    const w = canvasOriginal.width;
    const h = canvasOriginal.height;
    const byteSize = w * h * 4;

    // 1. Get Data from Canvas
    const imageData = ctxOriginal.getImageData(0, 0, w, h);
    const sourceData = imageData.data; // Uint8ClampedArray

    const start = performance.now();

    // 2. Allocate Memory in WASM
    // Call exposed 'alloc' function
    const ptr = wasmExports.alloc(byteSize);
    
    // 3. Create a view into WASM memory at the allocated pointer
    // We are DIRECTLY writing to Zig's linear memory here.
    const wasmBufferView = new Uint8Array(wasmExports.memory.buffer, ptr, byteSize);

    // 4. Copy data to WASM
    // This is the unavoidable overhead of the browser's security model (Canvas <-> WASM split).
    // However, TypedArray.set() is extremely optimized (memcpy).
    wasmBufferView.set(sourceData);

    // 5. Process in Zig
    // We pass the pointer, width, height. Zig crunches bytes.
    wasmExports.process_grayscale(ptr, w, h);

    // 6. Copy back (or create ImageData from the buffer)
    // We can create a new Uint8ClampedArray view on the same generic buffer, 
    // IF the buffer hasn't grown/detached. 
    // Safest is to get the view again in case allocation moved things (unlikely with just one alloc active, but good practice).
    const resultView = new Uint8ClampedArray(wasmExports.memory.buffer, ptr, byteSize);
    
    // We can't pass the WASM view directly to putImageData effectively because putImageData expects a standalone ImageData object
    // or we populate one.
    // Constructing a new ImageData takes a Uint8ClampedArray. 
    // Note: Creating 'new ImageData(resultView, w, h)' creates a COPY in some browsers, or references it.
    // To be safe and measure "processing" mostly, we'll assume we need to get it out.
    const resultImageData = new ImageData(resultView.slice(), w, h); // .slice() to copy out of WASM memory before freeing

    // 7. Free Memory
    wasmExports.free(ptr, byteSize);

    const end = performance.now();

    // 8. Paint
    ctxProcessed.putImageData(resultImageData, 0, 0);
    
    log(`ZIG Execution Time: <span class="highlight">${(end - start).toFixed(2)} ms</span> (incl. allocation & copy)`);
});
