# Cleanroom — GitHub Pages Metadata Cleaner

A static, browser-side image/video processing demo built with HTML, CSS, and vanilla JavaScript. It does not have a backend and does not intentionally upload selected files. It creates cleaned copies while leaving original files untouched.

## Supported inputs

- Images: JPG/JPEG, PNG, WebP
- Videos: MP4, MOV, MKV
- Batch selection, individual downloads, ZIP export, and a JSON processing report

## Important limitations

This tool is deliberately not described as a forensic metadata remover.

### Images

Images are decoded and re-encoded through the browser Canvas API. Re-encoding typically discards embedded EXIF/IPTC/XMP metadata and may remove some embedded payloads, including many embedded provenance structures. However:

- There is no independent post-processing metadata inspection in this demo.
- Browser decoder/encoder behavior varies.
- JPEG is lossy and is re-encoded at high quality; PNG pixel data is generally lossless but ancillary chunks and color handling may change; WebP may be lossy depending on the browser encoder.
- Animation, ICC/color profiles, orientation handling, transparency behavior, and other file features may change.
- This method does not prove that every C2PA manifest, watermark, or provenance signal is removed.

### Videos

Videos are re-encoded with FFmpeg.wasm using H.264 video and AAC audio, with ordinary metadata mapping and chapters disabled. This is computationally expensive, may create large temporary buffers, and may fail on unsupported codecs, large files, or memory-constrained devices. It does not guarantee removal of all C2PA structures, custom container atoms, embedded attachments, stream-level metadata, watermarks, or externally stored provenance. Some streams and features (such as subtitles, HDR, rotation, timecode, and multiple audio/video tracks) may not be preserved.

FFmpeg.wasm is loaded from jsDelivr at runtime. A network connection is needed to load the JavaScript/WASM runtime, and the browser must permit WebAssembly. After loading, the selected media is processed in the browser. Hosting on GitHub Pages is static hosting; GitHub Pages does not process media on a server.

### Privacy and security

- The code does not include an upload endpoint or send selected files to an application server.
- External dependencies are loaded from jsDelivr; the browser makes requests to that CDN to retrieve libraries/runtime assets.
- Use files you own or are authorized to process. Do not use metadata cleaning to misrepresent authorship, evade provenance requirements, or violate platform policies.
- Large video processing may exhaust browser memory. The app has a 1 GiB soft guard, but practical limits may be lower.

## Run locally

Because `app.js` uses JavaScript modules, run a local static server rather than opening `index.html` as a `file://` URL.

For example, if Python is installed:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`.

## Publish with GitHub Pages

1. Create a new GitHub repository, for example `cleanroom-metadata`.
2. Upload `index.html`, `styles.css`, `app.js`, `.nojekyll`, and `README.md` to the repository root.
3. Open **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select branch `main` and folder `/(root)`, then save.
6. Wait for the deployment to finish. Open the URL shown in the Pages section, usually `https://YOUR-USERNAME.github.io/cleanroom-metadata/`.
7. Test with copies of small sample files first. Try one file per format and confirm the output plays/opens as expected.

## Browser compatibility

Use a recent desktop Chrome, Edge, or Firefox for video work. Mobile browsers can have much lower memory limits. The FFmpeg.wasm CDN versions are pinned in `app.js`; update them deliberately and test the complete app when upgrading.

## Project structure

```text
cleanroom-metadata/
├── index.html
├── styles.css
├── app.js
├── .nojekyll
└── README.md
```

## Troubleshooting

- **FFmpeg fails to load:** check network access, content blockers, and browser console errors. The FFmpeg runtime is loaded from jsDelivr.
- **Video processing fails:** try a smaller file or a file using a widely supported codec. Some container/codec combinations are unsupported in FFmpeg.wasm builds.
- **Browser tab crashes:** close other tabs, use a desktop browser, and reduce file size. Browser-side transcoding can require several times the input size in memory.
- **Output is larger or lower quality:** transcoding changes encoding. Use a dedicated desktop media tool if preserving the exact original stream is required.
- **A file cannot be opened:** the browser encoder may not support that format/feature. The original remains unchanged.

## License

MIT. See `LICENSE`.
