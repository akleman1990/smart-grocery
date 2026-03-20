// Import Firebase
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// Your Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCHfz1dggbHhf7KRToNgonJErI2hUv8Qu0",
  authDomain: "smart-grocery-planner-702ec.firebaseapp.com",
  projectId: "smart-grocery-planner-702ec",
  storageBucket: "smart-grocery-planner-702ec.firebasestorage.app",
  messagingSenderId: "407588666878",
  appId: "1:407588666878:web:a3507c3fc6be9bf7e854af"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const db = getFirestore(app);
export const auth = getAuth(app);