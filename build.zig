const std = @import("std");

pub fn build(b: *std.Build) void {
    // Standard target options allows the person running `zig build` to choose
    // what target to build for. Here we want to force wasm32-freestanding.
    const target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
    });

    // Standard optimization options allow the person running `zig build` to select
    // between Debug, ReleaseSafe, ReleaseFast, and ReleaseSmall.
    const optimize = b.standardOptimizeOption(.{ .preferred_optimize_mode = .ReleaseFast });

    const lib = b.addExecutable(.{
        .name = "zig-image-proc",
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
    });

    // Just exporting the entry point isn't enough for freestanding WASM,
    // we need to tell it to be a library that exports its functions,
    // but addExecutable with rdynamic/freestanding is common for WASM modules
    // that own their entry or exports.
    // For raw DL/Module structure, addSharedLibrary might be used, but addExecutable 
    // with .entry = .disabled is often preferred for "bin" output or simple modules.
    lib.entry = .disabled;
    lib.rdynamic = true;

    b.installArtifact(lib);
}
