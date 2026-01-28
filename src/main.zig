const std = @import("std");

const allocator = std.heap.page_allocator;

export fn alloc(len: usize) [*]u8 {
    const slice = allocator.alloc(u8, len) catch @panic("Failed to allocate memory in WASM");
    return slice.ptr;
}

export fn free(ptr: [*]u8, len: usize) void {
    const slice = ptr[0..len];
    allocator.free(slice);
}

// 0. Grayscale (Original)
export fn process_grayscale(ptr: [*]u8, width: u32, height: u32) void {
    const len = width * height * 4;
    const buffer = ptr[0..len];
    var i: usize = 0;
    while (i < len) : (i += 4) {
        const r = @as(f32, @floatFromInt(buffer[i]));
        const g = @as(f32, @floatFromInt(buffer[i + 1]));
        const b = @as(f32, @floatFromInt(buffer[i + 2]));
        const gray = @as(u8, @intFromFloat(0.299 * r + 0.587 * g + 0.114 * b));
        buffer[i] = gray;
        buffer[i + 1] = gray;
        buffer[i + 2] = gray;
    }
}

// 1. Invert
export fn process_invert(ptr: [*]u8, width: u32, height: u32) void {
    const len = width * height * 4;
    const buffer = ptr[0..len];
    var i: usize = 0;
    while (i < len) : (i += 4) {
        buffer[i] = 255 - buffer[i];         // R
        buffer[i + 1] = 255 - buffer[i + 1]; // G
        buffer[i + 2] = 255 - buffer[i + 2]; // B
    }
}

// 2. Sepia
export fn process_sepia(ptr: [*]u8, width: u32, height: u32) void {
    const len = width * height * 4;
    const buffer = ptr[0..len];
    var i: usize = 0;
    while (i < len) : (i += 4) {
        const r = @as(f32, @floatFromInt(buffer[i]));
        const g = @as(f32, @floatFromInt(buffer[i + 1]));
        const b = @as(f32, @floatFromInt(buffer[i + 2]));

        const tr = 0.393 * r + 0.769 * g + 0.189 * b;
        const tg = 0.349 * r + 0.686 * g + 0.168 * b;
        const tb = 0.272 * r + 0.534 * g + 0.131 * b;

        buffer[i] = if (tr > 255.0) 255 else @as(u8, @intFromFloat(tr));
        buffer[i+1] = if (tg > 255.0) 255 else @as(u8, @intFromFloat(tg));
        buffer[i+2] = if (tb > 255.0) 255 else @as(u8, @intFromFloat(tb));
    }
}

// 3. Threshold
export fn process_threshold(ptr: [*]u8, width: u32, height: u32, threshold_val: u8) void {
    const len = width * height * 4;
    const buffer = ptr[0..len];
    var i: usize = 0;
    while (i < len) : (i += 4) {
        // Use simpler average for gray
        const total = @as(u16, buffer[i]) + @as(u16, buffer[i+1]) + @as(u16, buffer[i+2]);
        const avg = @as(u8, @intCast(total / 3));
        
        const val: u8 = if (avg >= threshold_val) 255 else 0;
        
        buffer[i] = val;
        buffer[i+1] = val;
        buffer[i+2] = val;
    }
}

// 4. Brightness
export fn process_brightness(ptr: [*]u8, width: u32, height: u32, factor: i32) void {
    const len = width * height * 4;
    const buffer = ptr[0..len];
    var i: usize = 0;
    while (i < len) : (i += 4) {
        // We use i32 for factor to allow negative brightness (darkening)
        var r = @as(i32, buffer[i]) + factor;
        var g = @as(i32, buffer[i+1]) + factor;
        var b = @as(i32, buffer[i+2]) + factor;

        if (r > 255) r = 255; if (r < 0) r = 0;
        if (g > 255) g = 255; if (g < 0) g = 0;
        if (b > 255) b = 255; if (b < 0) b = 0;

        buffer[i] = @as(u8, @intCast(r));
        buffer[i+1] = @as(u8, @intCast(g));
        buffer[i+2] = @as(u8, @intCast(b));
    }
}

// 5. Box Blur (Simple implementation)
// Requires a copy to avoid reading modified values
export fn process_blur(ptr: [*]u8, width: u32, height: u32, radius: u32) void {
    const len = width * height * 4;
    const buffer = ptr[0..len];
    
    // Allocate temp buffer
    const temp_slice = allocator.alloc(u8, len) catch @panic("OOM for blur");
    defer allocator.free(temp_slice);
    
    // Copy original data to temp
    @memcpy(temp_slice, buffer);

    const w_int = @as(i32, @intCast(width));
    const h_int = @as(i32, @intCast(height));
    const r_int = @as(i32, @intCast(radius));

    var y: i32 = 0;
    while (y < h_int) : (y += 1) {
        var x: i32 = 0;
        while (x < w_int) : (x += 1) {
            var r_sum: i32 = 0;
            var g_sum: i32 = 0;
            var b_sum: i32 = 0;
            var count: i32 = 0;

            var ky = -r_int;
            while (ky <= r_int) : (ky += 1) {
                var kx = -r_int;
                while (kx <= r_int) : (kx += 1) {
                    const py = y + ky;
                    const px = x + kx;

                    if (px >= 0 and px < w_int and py >= 0 and py < h_int) {
                        const idx = @as(usize, @intCast((py * w_int + px) * 4));
                        r_sum += temp_slice[idx];
                        g_sum += temp_slice[idx+1];
                        b_sum += temp_slice[idx+2];
                        count += 1;
                    }
                }
            }

            const idx = @as(usize, @intCast((y * w_int + x) * 4));
            buffer[idx] = @as(u8, @intCast(@divTrunc(r_sum, count)));
            buffer[idx+1] = @as(u8, @intCast(@divTrunc(g_sum, count)));
            buffer[idx+2] = @as(u8, @intCast(@divTrunc(b_sum, count)));
        }
    }
}

// 6. Sobel Edge Detection
// Converts to grayscale implicitly and checks edges
export fn process_sobel(ptr: [*]u8, width: u32, height: u32) void {
     const len = width * height * 4;
    const buffer = ptr[0..len];
    
    // Temp buffer for grayscale version first, or just read RGB and convert on fly.
    // Standard Sobel works best on grayscale. 
    // We'll output to buffer, so source needs to be preserved.
    const temp_slice = allocator.alloc(u8, len) catch @panic("OOM for sobel");
    defer allocator.free(temp_slice);
    @memcpy(temp_slice, buffer);

    const w_int = @as(i32, @intCast(width));
    const h_int = @as(i32, @intCast(height));

    // Grayscale helper for temp buffer
    const get_gray = struct {
        fn get(buf: []u8, idx: usize) i32 {
            const r = @as(i32, buf[idx]);
            const g = @as(i32, buf[idx+1]);
            const b = @as(i32, buf[idx+2]);
            return @divTrunc(r+g+b, 3);
        }
    }.get;

    var y: i32 = 1; 
    while (y < h_int - 1) : (y += 1) {
        var x: i32 = 1; 
        while (x < w_int - 1) : (x += 1) {
            // Sobel Kernels
            // Gx: -1 0 1
            //     -2 0 2
            //     -1 0 1
            // Gy: -1 -2 -1
            //      0  0  0
            //      1  2  1
            
            var gx: i32 = 0;
            var gy: i32 = 0;

            // Unroll loops for speed? Let's just do it manually for clarity
            // Row -1
            var idx = @as(usize, @intCast(((y-1) * w_int + (x-1)) * 4));
            var val = get_gray(temp_slice, idx);
            gx += -1 * val; gy += -1 * val; 

            idx = @as(usize, @intCast(((y-1) * w_int + x) * 4));
            val = get_gray(temp_slice, idx);
            gy += -2 * val; // Gx is 0

            idx = @as(usize, @intCast(((y-1) * w_int + (x+1)) * 4));
            val = get_gray(temp_slice, idx);
            gx += 1 * val; gy += -1 * val;

            // Row 0
            idx = @as(usize, @intCast((y * w_int + (x-1)) * 4));
            val = get_gray(temp_slice, idx);
            gx += -2 * val; // Gy is 0

            idx = @as(usize, @intCast((y * w_int + (x+1)) * 4));
            val = get_gray(temp_slice, idx);
            gx += 2 * val; // Gy is 0

            // Row +1
            idx = @as(usize, @intCast(((y+1) * w_int + (x-1)) * 4));
            val = get_gray(temp_slice, idx);
            gx += -1 * val; gy += 1 * val;

            idx = @as(usize, @intCast(((y+1) * w_int + x) * 4));
            val = get_gray(temp_slice, idx);
            gy += 2 * val;

            idx = @as(usize, @intCast(((y+1) * w_int + (x+1)) * 4));
            val = get_gray(temp_slice, idx);
            gx += 1 * val; gy += 1 * val;

            const mag = std.math.sqrt(@as(f32, @floatFromInt(gx*gx + gy*gy)));
            var out_val = @as(u8, @intFromFloat(mag));
            if (out_val > 255) out_val = 255; // clamp? floatFromInt above might overflow u8 if not clamped before cast, but typical image data... sqrt of sqr sum. max can be ~1000. So we need clamp.
            
            // Correction: cast mag to int first? Actually clamp logic:
            if (mag > 255.0) out_val = 255;

            const out_idx = @as(usize, @intCast((y * w_int + x) * 4));
            buffer[out_idx] = out_val;
            buffer[out_idx+1] = out_val;
            buffer[out_idx+2] = out_val;
            // alpha untouched
        }
    }
}
