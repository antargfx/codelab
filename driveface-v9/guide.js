'use strict';

(() => {

  function injectStyles() {

    const css = `
    
    .df-guide-overlay{
      position:fixed;
      inset:0;
      background:rgba(0,0,0,.75);
      backdrop-filter:blur(10px);
      z-index:999999;
      display:none;
      align-items:center;
      justify-content:center;
      padding:20px;
    }

    .df-guide-modal{
      width:min(920px,100%);
      max-height:90vh;
      overflow:auto;
      background:#111827;
      border-radius:24px;
      border:1px solid rgba(255,255,255,.08);
      color:#fff;
      box-shadow:0 30px 80px rgba(0,0,0,.5);
      animation:guideIn .3s ease;
    }

    @keyframes guideIn{
      from{
        opacity:0;
        transform:translateY(20px) scale(.97);
      }
      to{
        opacity:1;
        transform:none;
      }
    }

    .df-guide-header{
      padding:28px 32px;
      border-bottom:1px solid rgba(255,255,255,.08);
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:20px;
    }

    .df-guide-title{
      font-size:28px;
      font-weight:700;
    }

    .df-guide-close{
      width:42px;
      height:42px;
      border:none;
      border-radius:12px;
      background:rgba(255,255,255,.08);
      color:#fff;
      cursor:pointer;
      font-size:18px;
    }

    .df-guide-content{
      padding:30px;
      display:flex;
      flex-direction:column;
      gap:24px;
    }

    .df-step{
      background:rgba(255,255,255,.04);
      border:1px solid rgba(255,255,255,.06);
      border-radius:22px;
      overflow:hidden;
    }

    .df-step-top{
      padding:18px 22px;
      border-bottom:1px solid rgba(255,255,255,.06);
      display:flex;
      align-items:center;
      gap:14px;
    }

    .df-step-num{
      width:40px;
      height:40px;
      border-radius:12px;
      background:linear-gradient(135deg,#ff6b35,#ff0055);
      display:flex;
      align-items:center;
      justify-content:center;
      font-weight:700;
    }

    .df-step-title{
      font-size:20px;
      font-weight:700;
    }

    .df-step-body{
      padding:24px;
      display:grid;
      grid-template-columns:1fr 320px;
      gap:24px;
    }

    .df-step-text{
      line-height:1.8;
      color:#d1d5db;
      font-size:15px;
    }

    .df-svg{
      width:100%;
      background:#0b1220;
      border-radius:18px;
      padding:18px;
      border:1px solid rgba(255,255,255,.06);
    }

    .df-note{
      background:#172554;
      border:1px solid rgba(96,165,250,.3);
      color:#dbeafe;
      padding:18px;
      border-radius:18px;
      line-height:1.7;
    }

    @media(max-width:780px){

      .df-step-body{
        grid-template-columns:1fr;
      }

      .df-guide-title{
        font-size:22px;
      }

    }

    `;

    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

  }

  function createModal() {

    const overlay = document.createElement('div');

    overlay.className = 'df-guide-overlay';

    overlay.id = 'dfGuideOverlay';

    overlay.innerHTML = `

      <div class="df-guide-modal">

        <div class="df-guide-header">

          <div>
            <div class="df-guide-title">
              How To Use DriveFace Finder
            </div>
          </div>

          <button class="df-guide-close" id="dfGuideClose">
            ✕
          </button>

        </div>

        <div class="df-guide-content">

          ${step1()}
          ${step2()}
          ${step3()}
          ${step4()}

          <div class="df-note">
            💡 Tip: Use a clear front-facing selfie for the best AI matching result.
            Avoid sunglasses, masks, blurry photos, or dark lighting.
          </div>

        </div>

      </div>

    `;

    document.body.appendChild(overlay);

  }

  function step1(){

    return `

    <div class="df-step">

      <div class="df-step-top">
        <div class="df-step-num">1</div>
        <div class="df-step-title">
          Upload Your Selfie
        </div>
      </div>

      <div class="df-step-body">

        <div class="df-step-text">
          Click the <b>Upload Photo</b> button or use
          <b>Take Selfie</b> to capture your face.

          <br><br>

          Make sure:
          <br>
          • Face is clearly visible
          <br>
          • Good lighting
          <br>
          • Front-facing photo
          <br>
          • No blur
        </div>

        ${svgUpload()}

      </div>

    </div>

    `;

  }

  function step2(){

    return `

    <div class="df-step">

      <div class="df-step-top">
        <div class="df-step-num">2</div>
        <div class="df-step-title">
          AI Face Scanning
        </div>
      </div>

      <div class="df-step-body">

        <div class="df-step-text">

          Our AI scans all event photos and compares faces
          with your uploaded selfie.

          <br><br>

          The process runs directly inside your browser
          for privacy and speed.

        </div>

        ${svgScan()}

      </div>

    </div>

    `;

  }

  function step3(){

    return `

    <div class="df-step">

      <div class="df-step-top">
        <div class="df-step-num">3</div>
        <div class="df-step-title">
          Review Your Results
        </div>
      </div>

      <div class="df-step-body">

        <div class="df-step-text">

          After scanning completes,
          all matched photos will appear automatically.

          <br><br>

          You can:
          <br>
          • Open full preview
          <br>
          • Download single photo
          <br>
          • Download all photos together

        </div>

        ${svgGallery()}

      </div>

    </div>

    `;

  }

  function step4(){

    return `

    <div class="df-step">

      <div class="df-step-top">
        <div class="df-step-num">4</div>
        <div class="df-step-title">
          Download Your Photos
        </div>
      </div>

      <div class="df-step-body">

        <div class="df-step-text">

          Click Download buttons to save your memories.

          <br><br>

          You can download:
          <br>
          • One photo
          <br>
          • Multiple photos
          <br>
          • Entire matched gallery ZIP

        </div>

        ${svgDownload()}

      </div>

    </div>

    `;

  }

  function svgUpload(){

    return `
    
    <svg class="df-svg" viewBox="0 0 300 220">

      <rect x="30" y="30" width="240" height="160" rx="20"
      fill="#111827" stroke="#374151"/>

      <circle cx="150" cy="95" r="35"
      fill="#ff6b35"/>

      <rect x="100" y="145" width="100" height="16"
      rx="8" fill="#374151"/>

      <path d="M150 55 L150 115"
      stroke="#fff" stroke-width="5"/>

      <path d="M130 75 L150 55 L170 75"
      stroke="#fff" stroke-width="5"
      fill="none"/>

    </svg>

    `;

  }

  function svgScan(){

    return `
    
    <svg class="df-svg" viewBox="0 0 300 220">

      <rect x="40" y="40" width="220" height="140"
      rx="20" fill="#111827" stroke="#374151"/>

      <circle cx="150" cy="105" r="40"
      fill="#ff0055"/>

      <rect x="100" y="55" width="100" height="100"
      rx="18" fill="none"
      stroke="#22c55e"
      stroke-width="5"
      stroke-dasharray="10 6"/>

    </svg>

    `;

  }

  function svgGallery(){

    return `
    
    <svg class="df-svg" viewBox="0 0 300 220">

      <rect x="30" y="40" width="70" height="70"
      rx="14" fill="#ff6b35"/>

      <rect x="115" y="40" width="70" height="70"
      rx="14" fill="#2563eb"/>

      <rect x="200" y="40" width="70" height="70"
      rx="14" fill="#22c55e"/>

      <rect x="30" y="125" width="70" height="70"
      rx="14" fill="#e11d48"/>

      <rect x="115" y="125" width="70" height="70"
      rx="14" fill="#9333ea"/>

      <rect x="200" y="125" width="70" height="70"
      rx="14" fill="#f59e0b"/>

    </svg>

    `;

  }

  function svgDownload(){

    return `
    
    <svg class="df-svg" viewBox="0 0 300 220">

      <circle cx="150" cy="85" r="45"
      fill="#2563eb"/>

      <path d="M150 55 L150 120"
      stroke="#fff"
      stroke-width="6"/>

      <path d="M125 95 L150 120 L175 95"
      stroke="#fff"
      stroke-width="6"
      fill="none"/>

      <rect x="85" y="145"
      width="130"
      height="18"
      rx="9"
      fill="#22c55e"/>

    </svg>

    `;

  }

  function openGuide(){
    document.getElementById(
      'dfGuideOverlay'
    ).style.display = 'flex';
  }

  function closeGuide(){
    document.getElementById(
      'dfGuideOverlay'
    ).style.display = 'none';
  }

  function bindEvents(){

    document.getElementById(
      'guideBtn'
    ).addEventListener(
      'click',
      openGuide
    );

    document.getElementById(
      'dfGuideClose'
    ).addEventListener(
      'click',
      closeGuide
    );

    document.getElementById(
      'dfGuideOverlay'
    ).addEventListener(
      'click',
      e => {
        if(
          e.target.id === 'dfGuideOverlay'
        ){
          closeGuide();
        }
      }
    );

  }

  function init(){

    injectStyles();

    createModal();

    bindEvents();

  }

  window.addEventListener(
    'DOMContentLoaded',
    init
  );

})();