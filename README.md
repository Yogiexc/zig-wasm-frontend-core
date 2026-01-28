# Bare-Metal Image Processor (Zig + WASM)

> “Bringing bare-metal performance to the browser using Zig and WebAssembly.”

Project ini mendemonstrasikan bagaimana **Zig** dan **WebAssembly** dapat digunakan untuk melakukan komputasi berat (pemrosesan gambar) di sisi klien dengan performa tinggi dan overhead yang minimal. Kita mengelola memori secara manual ("bare-metal") untuk menghindari biaya Garbage Collection dan penyalinan data yang tidak perlu.

## 📁 Struktur Project

- `src/main.zig`: **Otak utama**. Berisi logika alokasi memori dan algoritma pemrosesan gambar (grayscale) dalam bahasa Zig.
- `build.zig`: **Konfigurasi Compiler**. Mengatur Zig untuk memproduksi file `.wasm` yang optimal (`wasm32-freestanding`).
- `index.html`: **Antarmuka**. Minimal UI untuk memuat gambar dan menampilkan hasil.
- `script.js`: **Jembatan**. Memuat modul WASM, mengirim data gambar dari Canvas ke memori WASM, dan mengeksekusi fungsi Zig.

## 🚀 Cara Build & Run

1.  **Pastikan Zig terinstall**: [Download Zig](https://ziglang.org/download/) (versi 0.11.0 atau lebih baru).
2.  **Build Project**:
    Jalankan perintah berikut di terminal untuk mengkompilasi kode Zig menjadi WebAssembly dengan optimasi kecepatan penuh:
    ```bash
    zig build -Doptimize=ReleaseFast
    ```
    Outputnya akan ada di `zig-out/bin/zig-image-proc.wasm`.
3.  **Jalankan Server**:
    Karena browser memblokir loading file WASM dari protokol `file://`, Anda perlu menggunakan local server. Contoh menggunakan Python:
    ```bash
    python -m http.server
    ```
    Lalu buka `http://localhost:8000` di browser.

## 🧠 Penjelasan Teknis (Deep Dive)

### 1. Manual Memory Management: Kenapa `alloc` & `free`?
Di JavaScript, kita dimanjakan oleh **Garbage Collector (GC)**. Kita buat objek, dan JS akan menghapusnya saat tidak dipakai. Tapi GC itu "mahal" dan tidak bisa diprediksi kapan jalannya. Bisa saja saat animasi sedang berjalan, GC lewat dan menyebabkan *stutter* (lag).

Di Zig (dan WASM "freestanding"), **tidak ada GC**. Kita harus manual:
-   **Alokasi (`alloc`)**: Kita minta Zig menyiapkan blok memori sekian bytes untuk gambar kita.
-   **Dealokasi (`free`)**: Setelah selesai diproses dan disalin balik ke Canvas, kita WAJIB membersihkan memori itu. Jika tidak, browser akan kehabisan RAM (Memory Leak).

Ini memberikan performa yang **stabil dan dapat diprediksi**.

### 2. Shared Memory: Zero-Copy (Hampir)
Kekuatan utama WASM adalah **Linear Memory**. Ini adalah satu blok besar `ArrayBuffer` yang bisa diakses oleh JavaScript DAN WebAssembly.

-   **JavaScript** melihatnya sebagai heap object dari instance WASM.
-   **Zig** melihatnya sebagai pointer memori biasa.

Saat kita melakukan `ctx.getImageData`, kita mendapatkan array pixel di JS. Kita menyalin array ini *langsung* ke dalam `ArrayBuffer` milik WASM yang sudah kita alokasikan pointer-nya via Zig.
Zig kemudian memproses byte-byte tersebut *in-place* (langsung di lokasi memori yang sama). Hasilnya langsung tersedia bagi JS untuk diambil kembali. Tidak ada pengiriman pesan JSON yang lambat, hanya manipulasi bit langsung di memori.

### 3. Kenapa Zig?
Kenapa tidak C++ atau Rust?
-   **Zig vs C++**: Zig jauh lebih sederhana. Tidak ada *hidden control flow* (tidak ada konstruktor tersembunyi, operator overloading yang membingungkan, atau exception). Apa yang Anda baca, itu yang dieksekusi CPU.
-   **Zig vs Rust**: Rust sangat aman, tapi memelajari *Borrow Checker*-nya untuk manipulasi pointer mentah (raw pointers) di WASM bisa sangat rumit ("fighting the borrow checker"). Zig memeluk konsep pointer dan memori manual dengan sintaks yang modern dan aman (checked arithmetic, optional types), membuatnya sempurna untuk tugas "low-level" seperti ini tanpa kerumitan C++.

---
*Dibuat dengan ❤️ dan pointer arithmetic.*
