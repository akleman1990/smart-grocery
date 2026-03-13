// Import Firebase
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Your Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCHFz1dggbhHFfZKRToNgonJErT2hIv80u",
  authDomain: "smart-grocery-planner-702ec.firebaseapp.com",
  projectId: "smart-grocery-planner-702ec",
  storageBucket: "smart-grocery-planner-702ec.firebasestorage.app",
  messagingSenderId: "407588666878",
  appId: "1:407588666878:web:aa801fb8f0b1aeae854af"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore
export const db = getFirestore(app);