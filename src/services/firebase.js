// services/firebase.js
let firebaseConfig;

// In production, use hardcoded config
// Always use hardcoded config in packaged app
// process.type exists in Electron and helps detect if we're in renderer or main
if (process.type === "renderer" || process.env.NODE_ENV === "production") {
  console.log("Using production Firebase config");
  firebaseConfig = {
    apiKey: "AIzaSyD5YXGZE8LMj_YLrPOh-nyjiLpqZoDouPE",
    authDomain: "msmlal.firebaseapp.com",
    projectId: "msmlal",
    storageBucket: "msmlal.appspot.com", // Fixed storage bucket URL
    messagingSenderId: "908418803307",
    appId: "1:908418803307:web:4889cb78186ef8305d732e",
  };
} else {
  // Only use env vars in development
  console.log("Using development Firebase config from environment");
  // In development, load from environment
  firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
  };
}

const { db, app, auth, isFirebaseConfigured } = require("./firebase-core");
const { sendPasswordResetEmail } = require("firebase/auth");

const {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  enableIndexedDbPersistence,
  CACHE_SIZE_UNLIMITED,
} = require("firebase/firestore");

const ElectronStore = require("electron-store");
const localStore = new ElectronStore({ name: "shop-billing-local-data" });
const { firebaseConfig: firebaseCoreConfig } = require("../config");

// Variables for tracking status
let isSyncing = false;
let isOnline = false;
let lastSyncTime = null;
let firebaseInitialized = false;
let syncListeners = [];

// Replace your current checkFirebaseConfig function with this:

function checkFirebaseConfig() {
  try {
    // Import firebase-core directly instead of trying to use getConfig()
    const firebaseCore = require("./firebase-core");

    // Access the firebaseConfig from the module if it's exposed
    const config = firebaseCore.firebaseConfig || {};

    // Alternatively check if Firebase is initialized by checking auth/db
    const isInitialized = !!firebaseCore.auth || !!firebaseCore.db;

    console.log("Firebase Config Check:");
    console.log(`- Firebase initialized: ${isInitialized ? "Yes" : "No"}`);
    console.log(`- API Key valid: ${config.apiKey ? "Yes" : "No"}`);

    if (
      firebaseCore.isFirebaseConfigured &&
      typeof firebaseCore.isFirebaseConfigured === "function"
    ) {
      console.log(
        `- Firebase properly configured: ${
          firebaseCore.isFirebaseConfigured() ? "Yes" : "No"
        }`
      );
    }

    return isInitialized;
  } catch (error) {
    console.error("Firebase config error:", error);
    return false;
  }
}

// Initialize Firebase with offline persistence
const initializeFirebase = async () => {
  try {
    // Check if Firebase config has been properly set
    if (!isFirebaseConfigured()) {
      console.error(
        "Firebase not properly configured. Please update the configuration."
      );
      return false;
    }

    // Call this during initialization
    checkFirebaseConfig();

    // Check if app is initialized
    if (!app || !db || !auth) {
      console.error("Firebase app not initialized");
      return false;
    }

    // Enable offline persistence
    try {
      await enableIndexedDbPersistence(db).catch((err) => {
        console.warn(
          `Persistence couldn't be enabled: ${err.code}. Using memory cache instead.`
        );
        // Continue without persistence - the app will still work
      });
      console.log("Offline persistence enabled");
    } catch (err) {
      if (err.code === "failed-precondition") {
        console.warn(
          "Multiple tabs open, persistence can only be enabled in one tab at a time."
        );
      } else if (err.code === "unimplemented") {
        console.warn(
          "The current browser does not support offline persistence."
        );
      } else {
        console.error("Error enabling offline persistence:", err);
      }
    }

    // Consider initialization successful
    firebaseInitialized = true;
    console.log("Firebase initialized with best available features");
    return true;
  } catch (error) {
    console.error("Error initializing Firebase:", error);
    return false;
  }
};

// Update online status
const updateOnlineStatus = (status) => {
  console.log("Updating online status to:", status);
  isOnline = status;
  notifySyncListeners();
};

// Register for sync status updates
const registerSyncListener = (callback) => {
  syncListeners.push(callback);
  return () => {
    syncListeners = syncListeners.filter((listener) => listener !== callback);
  };
};

// Notify listeners of sync status changes
const notifySyncListeners = () => {
  const status = {
    isOnline,
    isSyncing,
    lastSyncTime,
  };

  syncListeners.forEach((listener) => listener(status));
};

// Get last sync time
const getLastSyncTime = () => {
  return lastSyncTime;
};

// Sync data between Firebase and local storage
const syncData = async () => {
  if (!isOnline || isSyncing || !firebaseInitialized) {
    return {
      success: false,
      message:
        "Cannot sync: Offline, already syncing, or Firebase not initialized",
    };
  }

  // Check if user is authenticated
  if (!auth.currentUser) {
    console.log("No authenticated user, attempting to authenticate");
    const authSuccess = await ensureFirebaseAuth(auth);

    if (!authSuccess) {
      return { success: false, message: "Authentication required for sync" };
    }
  }

  isSyncing = true;
  notifySyncListeners();

  try {
    const results = {};

    // Sync collections
    for (const collectionName of ["products", "invoices"]) {
      const result = await syncCollection(collectionName);
      results[collectionName] = result;
    }

    lastSyncTime = new Date().toISOString();
    console.log("Data sync completed at", lastSyncTime);

    return {
      success: true,
      timestamp: lastSyncTime,
      results,
    };
  } catch (error) {
    console.error("Error syncing data:", error);
    return { success: false, message: error.message };
  } finally {
    isSyncing = false;
    notifySyncListeners();
  }
};
/**
 * Send password reset email
 * @param {string} email - User's email address
 * @returns {Promise<Object>} - Result of the operation
 */
const sendPasswordReset = async (email) => {
  try {
    // Check if Firebase is initialized
    if (!firebaseInitialized || !auth) {
      return {
        success: false,
        message: "Firebase Auth not initialized",
      };
    }

    // Check if we're online
    if (!isOnline) {
      return {
        success: false,
        message: "You must be online to reset your password",
      };
    }

    // Send password reset email
    await sendPasswordResetEmail(auth, email);

    return {
      success: true,
      message: "Password reset email sent successfully",
    };
  } catch (error) {
    console.error("Error sending password reset email:", error);

    // Handle different Firebase errors
    let errorMessage = "An error occurred. Please try again.";

    if (error.code === "auth/user-not-found") {
      errorMessage = "No account found with this email address.";
    } else if (error.code === "auth/invalid-email") {
      errorMessage = "The email address is not valid.";
    } else if (error.code === "auth/too-many-requests") {
      errorMessage = "Too many unsuccessful attempts. Please try again later.";
    }

    return {
      success: false,
      message: errorMessage,
    };
  }
};
// Sync a specific collection between Firebase and local storage
const syncCollection = async (collectionName) => {
  try {
    if (!isFirebaseConfigured()) {
      console.error(
        `Cannot sync ${collectionName}: Firebase not properly configured`
      );
      return { success: false, message: "Firebase not configured" };
    }

    if (!firebaseInitialized) {
      console.error(`Cannot sync ${collectionName}: Firebase not initialized`);
      return { success: false, message: "Firebase not initialized" };
    }

    console.log(`Starting sync for collection: ${collectionName}`);

    // Get local data
    const localData = localStore.get(collectionName) || [];
    console.log(`Local ${collectionName} count:`, localData.length);

    // Get cloud data
    const querySnapshot = await getDocs(collection(db, collectionName));
    const cloudData = querySnapshot.docs.map((doc) => doc.data());
    console.log(`Cloud ${collectionName} count:`, cloudData.length);

    // Create maps for easier comparison
    const localMap = new Map(localData.map((item) => [item.id, item]));
    const cloudMap = new Map(cloudData.map((item) => [item.id, item]));

    // Track sync results
    const result = {
      uploaded: 0,
      downloaded: 0,
      conflicts: 0,
      resolved: 0,
    };

    // 1. Items that only exist locally (need to be uploaded)
    const localOnlyItems = localData.filter((item) => !cloudMap.has(item.id));
    console.log(`${localOnlyItems.length} items to upload`);

    for (const item of localOnlyItems) {
      await setDoc(doc(db, collectionName, item.id), item);
      result.uploaded++;
    }

    // 2. Items that only exist in cloud (need to be downloaded)
    const cloudOnlyItems = cloudData.filter((item) => !localMap.has(item.id));
    console.log(`${cloudOnlyItems.length} items to download`);

    for (const item of cloudOnlyItems) {
      localMap.set(item.id, item);
      result.downloaded++;
    }

    // 3. Items that exist in both places (need field-level merging)
    const itemsInBoth = localData.filter((item) => cloudMap.has(item.id));
    console.log(`${itemsInBoth.length} items to merge`);

    for (const localItem of itemsInBoth) {
      const cloudItem = cloudMap.get(localItem.id);

      // Check if they're different
      const localUpdated = localItem.updatedAt
        ? new Date(localItem.updatedAt)
        : new Date(0);
      const cloudUpdated = cloudItem.updatedAt
        ? new Date(cloudItem.updatedAt)
        : new Date(0);

      if (localUpdated.getTime() !== cloudUpdated.getTime()) {
        result.conflicts++;

        // Create a merged item with the latest version
        let mergedItem;

        if (localUpdated > cloudUpdated) {
          // Local is newer
          mergedItem = { ...localItem };
          await setDoc(doc(db, collectionName, localItem.id), mergedItem);
        } else {
          // Cloud is newer
          mergedItem = { ...cloudItem };
          localMap.set(mergedItem.id, mergedItem);
        }

        result.resolved++;
      }
    }

    // Save all updated data to local storage
    localStore.set(collectionName, Array.from(localMap.values()));
    console.log(`Sync completed for ${collectionName}`);

    return {
      success: true,
      uploaded: result.uploaded,
      downloaded: result.downloaded,
      conflicts: result.conflicts,
      resolved: result.resolved,
    };
  } catch (error) {
    console.error(`Error syncing ${collectionName}:`, error);
    return { success: false, message: error.message };
  }
};

// CRUD Operations that work with both online and offline modes

// Get all items from a collection
const getAll = async (collectionName) => {
  try {
    const items = localStore.get(collectionName) || [];
    return items;
  } catch (error) {
    console.error(`Error getting ${collectionName}:`, error);
    return [];
  }
};

// Get a single item by ID
const getById = async (collectionName, id) => {
  try {
    const items = localStore.get(collectionName) || [];
    return items.find((item) => item.id === id);
  } catch (error) {
    console.error(`Error getting ${collectionName} item:`, error);
    return null;
  }
};

// Add a new item
const add = async (collectionName, item) => {
  try {
    // Ensure item has ID and timestamps
    const newItem = {
      ...item,
      id: item.id || Date.now().toString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Add to local storage
    const items = localStore.get(collectionName) || [];
    items.push(newItem);
    localStore.set(collectionName, items);

    // If online and Firebase initialized, add to Firestore
    if (isOnline && firebaseInitialized) {
      try {
        await setDoc(doc(db, collectionName, newItem.id), newItem);
      } catch (firestoreError) {
        console.error(
          `Error adding to Firestore: ${collectionName}/${newItem.id}`,
          firestoreError
        );
        // Still return success since we saved locally
      }
    }

    return newItem.id;
  } catch (error) {
    console.error(`Error adding ${collectionName} item:`, error);
    throw error;
  }
};

// Update an existing item
const update = async (collectionName, item) => {
  try {
    // Ensure item has timestamp
    const updatedItem = {
      ...item,
      updatedAt: new Date().toISOString(),
    };

    // Update in local storage
    const items = localStore.get(collectionName) || [];
    const index = items.findIndex((i) => i.id === item.id);

    if (index >= 0) {
      items[index] = updatedItem;
      localStore.set(collectionName, items);

      // If online and Firebase initialized, update in Firestore
      if (isOnline && firebaseInitialized) {
        await setDoc(doc(db, collectionName, updatedItem.id), updatedItem);
      }

      return true;
    }

    return false;
  } catch (error) {
    console.error(`Error updating ${collectionName} item:`, error);
    return false;
  }
};

// Delete an item
const remove = async (collectionName, id) => {
  try {
    // Remove from local storage
    const items = localStore.get(collectionName) || [];
    const newItems = items.filter((item) => item.id !== id);

    if (newItems.length !== items.length) {
      localStore.set(collectionName, newItems);

      // If online and Firebase initialized, remove from Firestore
      if (isOnline && firebaseInitialized) {
        await deleteDoc(doc(db, collectionName, id));
      }

      return true;
    }

    return false;
  } catch (error) {
    console.error(`Error removing ${collectionName} item:`, error);
    return false;
  }
};

// Create invoice with special handling for product stock
const createInvoice = async (invoice) => {
  try {
    // Ensure invoice has ID and timestamps
    const newInvoice = {
      ...invoice,
      id: invoice.id || Date.now().toString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: invoice.status || "completed",
    };

    // Add to local storage
    const invoices = localStore.get("invoices") || [];
    invoices.push(newInvoice);
    localStore.set("invoices", invoices);

    // Update product stock
    if (invoice.items && invoice.items.length > 0) {
      const products = localStore.get("products") || [];

      invoice.items.forEach((item) => {
        const productIndex = products.findIndex((p) => p.id === item.id);
        if (productIndex !== -1) {
          // Check if this is a refund (price < 0 or isRefund flag)
          const isRefund = item.price < 0 || item.isRefund === true;

          if (isRefund) {
            // For refunds, INCREASE the stock (return items to inventory)
            products[productIndex].stock += item.quantity;
          } else {
            // For sales, DECREASE the stock
            products[productIndex].stock -= item.quantity;
            if (products[productIndex].stock < 0) {
              products[productIndex].stock = 0;
            }
          }

          products[productIndex].updatedAt = new Date().toISOString();
        }
      });

      localStore.set("products", products);

      // If online and Firebase initialized, update products in Firestore
      if (isOnline && firebaseInitialized) {
        for (const product of products.filter((p) =>
          invoice.items.some((item) => item.id === p.id)
        )) {
          await setDoc(doc(db, "products", product.id), product);
        }
      }
    }

    // If online and Firebase initialized, add to Firestore
    if (isOnline && firebaseInitialized) {
      await setDoc(doc(db, "invoices", newInvoice.id), newInvoice);
    }

    return newInvoice.id;
  } catch (error) {
    console.error(`Error creating invoice:`, error);
    return null;
  }
};

// Subscribe to changes in a collection (online only)
const subscribeToCollection = (collectionName, callback) => {
  if (!isOnline || !firebaseInitialized) {
    return () => {}; // Return empty unsubscribe function
  }

  try {
    const q = collection(db, collectionName);
    return onSnapshot(q, (snapshot) => {
      const changes = [];
      snapshot.docChanges().forEach((change) => {
        changes.push({
          type: change.type,
          id: change.doc.id,
          data: change.doc.data(),
        });
      });

      callback(changes);
    });
  } catch (error) {
    console.error(`Error subscribing to ${collectionName}:`, error);
    return () => {};
  }
};

module.exports = {
  initializeFirebase,
  updateOnlineStatus,
  registerSyncListener,
  syncData,
  getAll,
  getById,
  add,
  update,
  remove,
  createInvoice,
  getLastSyncTime,
  subscribeToCollection,
  isFirebaseConfigured,
  sendPasswordReset,
};
/**
 * Ensure Firebase authentication when online
 * @param {Object} auth - Firebase auth instance
 * @returns {Promise<boolean>} - Authentication result
 */
async function ensureFirebaseAuth(auth) {
  return new Promise(async (resolve) => {
    // Check if we're already authenticated
    if (auth.currentUser) {
      console.log("User already authenticated with Firebase");
      resolve(true);
      return;
    }

    console.log("No authenticated user, attempting to authenticate");

    try {
      // Properly using the global callback approach
      if (global.requestFirebaseAuth) {
        const authResult = await global.requestFirebaseAuth();
        if (authResult && authResult.success) {
          console.log("Firebase authentication successful via global callback");
          resolve(true);
        } else {
          console.log("Firebase authentication failed via global callback");
          resolve(false);
        }
      } else {
        console.warn(
          "No firebase auth callback registered, cannot authenticate"
        );
        resolve(false);
      }
    } catch (error) {
      console.error("Error ensuring Firebase auth:", error);
      resolve(false);
    }
  });
}
