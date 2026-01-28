const std = @import("std");

// We use the page_allocator for simplicity in this demo, accessing raw OS/WASM pages.
const allocator = std.heap.page_allocator;

// Direct memory access imports/exports
export fn alloc(len: usize) [*]u8 {
    const slice = allocator.alloc(u8, len) catch @panic("Failed to allocate memory in WASM");
    return slice.ptr;
}

export fn free(ptr: [*]u8, len: usize) void {
    const slice = ptr[0..len];
    allocator.free(slice);
}

// BARE METAL IMAGE PROCESSING
// No fancy objects. Just raw pointers and linear memory.
// Grayscale algorithm: 0.299*R + 0.587*G + 0.114*B
export fn process_grayscale(ptr: [*]u8, width: u32, height: u32) void {
    const len = width * height * 4; // RGBA
    const buffer = ptr[0..len];

    var i: usize = 0;
    while (i < len) : (i += 4) {
        const r = @as(f32, @floatFromInt(buffer[i]));
        const g = @as(f32, @floatFromInt(buffer[i + 1]));
        const b = @as(f32, @floatFromInt(buffer[i + 2]));

        // Calculate luminance
        const gray = @as(u8, @intFromFloat(0.299 * r + 0.587 * g + 0.114 * b));

        buffer[i] = gray;     // R
        buffer[i + 1] = gray; // G
        buffer[i + 2] = gray; // B
        // Alpha (i+3) is left untouched
    }
}
