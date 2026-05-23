'use strict';

(() => {

  const LANG_KEY = 'dff_lang';

  let currentLang = localStorage.getItem(LANG_KEY) || 'en';

  const originalMap = new WeakMap();

  const dictionary = {

    // HEADER
    "History": "ইতিহাস",
    "Settings": "সেটিংস",
    "Upload or Capture your selfie to start.": "স্টার্ট করতে আপনার ছবি আপলোড করুন অথবা ছবি তুলুন",
    "Full Automated": "সম্পূর্ণ অটোমেটিক",
    "Max Images Per Scan": "প্রতি স্ক্যানে যতগুলো ছবি আসবে",
    "Loading AI Models": "এআই মডেলগুলো লোড হচ্ছে",
    "Downloading face recognition models…": "এ আই মডেলগুলো ডাউনলোড হচ্ছে",
    "First visit can take up to ~10 - 30 seconds": "প্রথমবার ১০ থেকে ৩০ সেকেন্ড এর অধিক সময় লাগতে পারে",
    "Please wait patiently.": "ধৈর্য ধরে অপেক্ষা করুন",

    // HERO
    "Find every photo of you.": "আপনার সব ছবি খুঁজে নিন।",
    "Take a selfie or upload a photo of yourself.":
      "একটি সেলফি তুলুন অথবা নিজের ছবি আপলোড করুন।",

    "Our AI scans the gallery and shows only your photos.":
      "আমাদের এআই গ্যালারি স্ক্যান করে শুধুমাত্র আপনার ছবিগুলো দেখাবে।",

    "Upload selfie": "সেলফি আপলোড করুন",
    "AI Face Recognition": "এআই ফেস রিকগনিশন",
    "Download your photos": "আপনার ছবি ডাউনলোড করুন",

    // FACE
    "Your Selfie": "আপনার সেলফি",
    "A clear, well-lit, front-facing photo of your face":
      "পরিষ্কার ও সামনে থেকে তোলা ছবি দিন",

    "No photo yet": "এখনও ছবি নেই",
    "Click Or drag & drop here": "ক্লিক করুন অথবা এখানে ড্র্যাগ করুন",

    "Upload Photo": "ছবি আপলোড করুন",
    "Take Selfie": "সেলফি তুলুন",

    // THRESHOLD
    "Similarity Controller": "সাদৃশ্য নিয়ন্ত্রণ",

    "Lower = stricter matching (Less Photos).":
      "কম হলে, কম ছবি দেখাবে।",

    "Higher = more results (may include strangers).":
      "বেশি হলে, বেশি ছবি দেখাবে।",

    // BUTTONS
    "Find My Photos": "ছবি খুঁজুন",
    "Download": "ডাউনলোড",
    "Close": "বন্ধ করুন",
    "Cancel": "বাতিল",
    "Copy": "কপি",
    "Export": "এক্সপোর্ট",

    // RESULTS
    "Your Photos": "আপনার ছবি",
    "Size": "সাইজ",

    // SETTINGS
    "Settings": "সেটিংস",
    "Similarity Threshold": "ম্যাচ থ্রেশহোল্ড",
    "Processing Quality": "প্রসেসিং কোয়ালিটি",
    "Clear Face Cache": "ক্যাশ মুছুন",
    "Clear": "মুছুন",
    "Recent Scans": "আগের করা স্ক্যানগুলো",
    "No scans yet": "এখনো স্ক্যান করা হয়নি",

    // LOADING
    "Loading": "লোড হচ্ছে",
    "Processing": "প্রসেসিং চলছে",
    "Scanning": "স্ক্যান হচ্ছে",

    // TOASTS
    "Folder loaded": "ফোল্ডার লোড হয়েছে",
    "History cleared.": "হিস্টোরি মুছে ফেলা হয়েছে",
    "Face cache cleared.": "ফেস ক্যাশ মুছে ফেলা হয়েছে",

    // ERRORS
    "Please upload an image file.":
      "অনুগ্রহ করে একটি ছবি আপলোড করুন।",

    "No face detected":
      "কোনো মুখ শনাক্ত করা যায়নি",

    "Could not load AI models":
      "এআই মডেল লোড করা যায়নি",

    "Checking folder…":
      "ফোল্ডার যাচাই করা হচ্ছে…",

    "Find every photo of you":
      "আপনার সব ছবি খুঁজে নিন"

  };

  const SKIP_TAGS = new Set([
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'IFRAME',
    'CODE',
    'PRE'
  ]);

  function shouldTranslate(node) {

    if (!node) return false;

    if (node.nodeType !== Node.TEXT_NODE) return false;

    if (!node.nodeValue.trim()) return false;

    const parent = node.parentElement;

    if (!parent) return false;

    if (SKIP_TAGS.has(parent.tagName)) return false;

    return true;
  }

  function saveOriginal(node) {

    if (!originalMap.has(node)) {
      originalMap.set(node, node.nodeValue);
    }
  }

  function translateText(text) {

    let output = text;

    Object.entries(dictionary).forEach(([en, bn]) => {
      output = output.replaceAll(en, bn);
    });

    return output;
  }

  function applyBN(root = document.body) {

    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT
    );

    let node;

    while ((node = walker.nextNode())) {

      if (!shouldTranslate(node)) continue;

      saveOriginal(node);

      node.nodeValue = translateText(
        originalMap.get(node)
      );
    }

    document.documentElement.lang = 'bn';
  }

  function applyEN() {

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT
    );

    let node;

    while ((node = walker.nextNode())) {

      if (!originalMap.has(node)) continue;

      node.nodeValue = originalMap.get(node);
    }

    document.documentElement.lang = 'en';
  }

  function setLanguage(lang) {

    currentLang = lang;

    localStorage.setItem(LANG_KEY, lang);

    if (lang === 'bn') {
      applyBN();
    } else {
      applyEN();
    }

    updateButton();
  }

  function toggleLanguage() {

    setLanguage(
      currentLang === 'en'
        ? 'bn'
        : 'en'
    );
  }

  function updateButton() {

    const span = document.querySelector(
      '#langToggleBtn span'
    );

    if (!span) return;

    span.textContent =
      currentLang === 'en'
        ? 'বাংলা'
        : 'EN';
  }

  function initObserver() {

    const observer = new MutationObserver(mutations => {

      if (currentLang !== 'bn') return;

      mutations.forEach(mutation => {

        mutation.addedNodes.forEach(node => {

          if (node.nodeType === 1) {
            applyBN(node);
          }

        });

      });

    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

  }

  function init() {

    updateButton();

    setLanguage(currentLang);

    initObserver();

    const btn = document.getElementById(
      'langToggleBtn'
    );

    if (btn) {
      btn.addEventListener(
        'click',
        toggleLanguage
      );
    }

  }

  window.addEventListener(
    'DOMContentLoaded',
    init
  );

})();