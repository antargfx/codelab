/**
 * config.js
 * Firebase configuration file.
 * Replace the values below with your actual Firebase project credentials.
 * Get them from: https://console.firebase.google.com → Project Settings → Your Apps → Firebase SDK snippet
 */

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Export so firebase.js can import it
// (If not using ES modules, this is read as a global variable)
