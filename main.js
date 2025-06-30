const { app, BrowserWindow, ipcMain, shell, session } = require("electron");
const { SerialPort } = require("serialport");
const { spawn } = require("child_process");
const path = require("path");
const { dialog } = require("electron");
const fs = require("fs");
const os = require("os");
const StaticServer = require("./static-server");

let mainWindow;
let currentPort = null;
let serialDataBuffer = ""; // Buffer untuk menggabungkan data serial
let staticServer = null; // Built-in static server
let nextProcess = null; // Next.js development process

// Function to start static server (no external dependencies)
function startStaticServer() {
  return new Promise((resolve, reject) => {
    console.log("[LAUNCHER] Starting built-in static server...");

    // Find static files directory
    const isDev = process.env.NODE_ENV === "development";
    const isPackaged = app.isPackaged;

    let staticDir = null;

    if (isPackaged) {
      // In packaged app, try different paths for production build output
      // 🔧 CRITICAL FIX: Proper path detection for portable executable
      console.log("[LAUNCHER] 🔍 Debugging packaged app paths:");
      console.log("[LAUNCHER] process.execPath:", process.execPath);
      console.log("[LAUNCHER] process.resourcesPath:", process.resourcesPath);
      console.log("[LAUNCHER] __dirname:", __dirname);
      console.log("[LAUNCHER] process.cwd():", process.cwd());

      const possiblePaths = [
        // Try resources path first (standard Electron packaging)
        path.join(process.resourcesPath, "client", "out"),
        path.join(process.resourcesPath, "app", "client", "out"),
        path.join(process.resourcesPath, "app.asar.unpacked", "client", "out"),

        // Try relative to executable directory
        path.join(path.dirname(process.execPath), "resources", "client", "out"),
        path.join(
          path.dirname(process.execPath),
          "resources",
          "app",
          "client",
          "out"
        ),
        path.join(path.dirname(process.execPath), "client", "out"),

        // Try relative to current working directory
        path.join(process.cwd(), "resources", "client", "out"),
        path.join(process.cwd(), "client", "out"),

        // Try relative to __dirname (current main.js location)
        path.join(__dirname, "client", "out"),
        path.join(__dirname, "..", "client", "out"),
        path.join(__dirname, "..", "..", "client", "out"),

        // Legacy Next.js paths (fallback)
        path.join(process.resourcesPath, "client", ".next", "standalone"),
        path.join(process.resourcesPath, "client", ".next", "static"),
        path.join(__dirname, "client", ".next", "standalone"),
        path.join(__dirname, "client", ".next", "static"),
      ];

      console.log("[LAUNCHER] Packaged app detected, trying static dirs:");
      for (const testPath of possiblePaths) {
        console.log("[LAUNCHER] Checking:", testPath);
        if (fs.existsSync(testPath)) {
          staticDir = testPath;
          console.log("[LAUNCHER] ✅ Found static files at:", staticDir);
          break;
        } else {
          console.log("[LAUNCHER] ✗ Not found:", testPath);
        }
      }
    } else {
      // Development mode - try different build outputs
      const possiblePaths = [
        path.join(__dirname, "..", "client", "out"),
        path.join(__dirname, "..", "client", ".next", "standalone"),
        path.join(__dirname, "..", "client", ".next", "static"),
        path.join(__dirname, "..", "client", ".next"),
      ];

      for (const testPath of possiblePaths) {
        if (fs.existsSync(testPath)) {
          staticDir = testPath;
          console.log(
            "[LAUNCHER] ✅ Found development static files at:",
            staticDir
          );
          break;
        }
      }
    }

    if (!staticDir || !fs.existsSync(staticDir)) {
      const error = new Error(
        "Static files directory not found. Please build the client first."
      );
      console.error("[LAUNCHER]", error.message);
      reject(error);
      return;
    }

    console.log("[LAUNCHER] Using static directory:", staticDir);

    // Start static server
    staticServer = new StaticServer(3000);
    staticServer
      .start(staticDir)
      .then(() => {
        console.log("[LAUNCHER] ✅ Static server started successfully");
        resolve();
      })
      .catch((error) => {
        console.error("[LAUNCHER] ❌ Failed to start static server:", error);
        reject(error);
      });
  });
}

// Function to stop static server
function stopStaticServer() {
  if (staticServer) {
    console.log("[LAUNCHER] Stopping static server...");
    staticServer.stop();
    staticServer = null;
  }
}

// Function to start Next.js server (development + packaged mode)
function startNextJS() {
  return new Promise((resolve, reject) => {
    console.log("[LAUNCHER] Starting Next.js server...");

    const isPackaged = app.isPackaged;

    // Determine the client path relative to electron folder
    let clientPath = path.join(__dirname, "..", "client");

    if (isPackaged) {
      // In packaged app, try different paths
      const possiblePaths = [
        path.join(process.resourcesPath, "client"),
        path.join(__dirname, "client"),
        path.join(__dirname, "..", "client"),
        path.join(path.dirname(process.execPath), "client"),
      ];

      console.log("[LAUNCHER] Packaged app detected, trying paths:");
      for (const testPath of possiblePaths) {
        console.log("[LAUNCHER] Checking:", testPath);
        if (fs.existsSync(testPath)) {
          clientPath = testPath;
          console.log("[LAUNCHER] ✓ Found client at:", clientPath);
          break;
        } else {
          console.log("[LAUNCHER] ✗ Not found:", testPath);
        }
      }
    }

    console.log("[LAUNCHER] Using client path:", clientPath);

    // Check if client folder exists
    if (!fs.existsSync(clientPath)) {
      reject(new Error("Client folder not found: " + clientPath));
      return;
    }

    console.log("[LAUNCHER] Starting Next.js server...");
    const startCommand = process.platform === "win32" ? "npm.cmd" : "npm";
    let startArgs;

    // Use production mode for better performance
    if (isPackaged) {
      console.log(
        "[LAUNCHER] Using production server for better performance..."
      );
      startArgs = ["start"];
    } else {
      console.log("[LAUNCHER] Using development server...");
      startArgs = ["run", "dev"];
    }

    console.log("[LAUNCHER] Command:", startCommand, startArgs.join(" "));
    console.log("[LAUNCHER] Working directory:", clientPath);

    nextProcess = spawn(startCommand, startArgs, {
      cwd: clientPath,
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });

    let serverReady = false;

    nextProcess.stdout.on("data", (data) => {
      const output = data.toString();
      console.log("[NEXT]", output);

      // Check if server is ready - improved detection for both dev and production
      if (
        output.includes("localhost:3000") ||
        output.includes("Ready on") ||
        output.includes("ready on") ||
        output.includes("Local:") ||
        output.includes("started server on") ||
        output.includes("Local:        http://localhost:3000") ||
        output.includes("- Local:      http://localhost:3000") ||
        output.includes("ready - started server") ||
        output.includes("▲ Next.js") ||
        output.match(/server.*(?:running|listening|started).*3000/i) ||
        output.match(/ready.*3000/i) ||
        output.match(/listening.*3000/i) ||
        output.match(/started.*server.*3000/i)
      ) {
        if (!serverReady) {
          serverReady = true;
          console.log("[LAUNCHER] ✅ Next.js development server is ready!");
          resolve();
        }
      }
    });

    nextProcess.stderr.on("data", (data) => {
      const output = data.toString();
      console.error("[NEXT ERROR]", output);

      // Some warnings are normal, only reject on severe errors
      if (
        output.includes("EADDRINUSE") ||
        output.includes("Error:") ||
        output.includes("MODULE_NOT_FOUND")
      ) {
        if (!serverReady) {
          reject(
            new Error("Next.js development server failed to start: " + output)
          );
        }
      }
    });

    nextProcess.on("error", (error) => {
      console.error(
        "[LAUNCHER] Failed to start Next.js development server:",
        error
      );
      if (!serverReady) {
        reject(error);
      }
    });

    nextProcess.on("close", (code) => {
      console.log(
        "[LAUNCHER] Next.js development server exited with code:",
        code
      );
      nextProcess = null;
    });

    // Extended timeout for packaged mode + fallback checking
    const timeoutDuration = isPackaged ? 120000 : 60000; // 2 minutes for packaged, 1 minute for dev
    setTimeout(() => {
      if (!serverReady) {
        console.log("[LAUNCHER] ⚠️ Timeout waiting for Next.js server");
        console.log(
          "[LAUNCHER] Attempting to connect to check if server is running..."
        );

        // Try to connect to localhost:3000 to check if server is actually running
        const http = require("http");
        const req = http.get("http://localhost:3000", (res) => {
          console.log(
            "[LAUNCHER] ✅ Server is actually running! Proceeding..."
          );
          if (!serverReady) {
            serverReady = true;
            resolve();
          }
        });

        req.on("error", (err) => {
          console.error("[LAUNCHER] ❌ Server is not responding:", err.message);
          reject(
            new Error(
              "Timeout waiting for Next.js server to start. Please try restarting the application."
            )
          );
        });

        req.setTimeout(10000, () => {
          req.destroy();
          reject(new Error("Timeout waiting for Next.js server to start"));
        });
      }
    }, timeoutDuration);
  });
}

// Function to stop Next.js server
function stopNextJS() {
  if (nextProcess) {
    console.log("[LAUNCHER] Stopping Next.js server...");
    nextProcess.kill();
    nextProcess = null;
  }
}

// Function to process serial data buffer and extract complete JSON objects
function processSerialBuffer() {
  if (!serialDataBuffer) return;

  console.log(
    "[MAIN] Processing serial buffer, length:",
    serialDataBuffer.length
  );

  // Look for complete JSON objects in the buffer
  let buffer = serialDataBuffer;
  let processedAny = false;

  while (buffer.length > 0) {
    // Find the start of a JSON object
    const jsonStart = buffer.indexOf("{");
    if (jsonStart === -1) {
      // No JSON found, clear non-JSON data
      buffer = "";
      break;
    }

    // Remove any non-JSON data before the first '{'
    if (jsonStart > 0) {
      buffer = buffer.substring(jsonStart);
    }

    // Find the matching closing brace
    let braceCount = 0;
    let inString = false;
    let escapeNext = false;
    let jsonEnd = -1;

    for (let i = 0; i < buffer.length; i++) {
      const char = buffer[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === "\\") {
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === "{") {
          braceCount++;
        } else if (char === "}") {
          braceCount--;
          if (braceCount === 0) {
            jsonEnd = i;
            break;
          }
        }
      }
    }

    if (jsonEnd !== -1) {
      // Found complete JSON object
      const completeJson = buffer.substring(0, jsonEnd + 1);
      console.log("[MAIN] Found complete JSON, length:", completeJson.length);
      console.log(
        "[MAIN] JSON preview:",
        completeJson.substring(0, 100) + "..."
      );

      // Send complete JSON to renderer
      if (mainWindow) {
        mainWindow.webContents.send("serial-data-received", completeJson);
      }

      // Remove processed JSON from buffer
      buffer = buffer.substring(jsonEnd + 1);
      processedAny = true;
    } else {
      // No complete JSON found, keep remaining buffer
      console.log(
        "[MAIN] No complete JSON found, keeping buffer length:",
        buffer.length
      );
      break;
    }
  }

  // Update the global buffer
  serialDataBuffer = buffer;

  // Prevent buffer from growing too large
  if (serialDataBuffer.length > 10000) {
    console.log("[MAIN] Buffer too large, trimming...");
    const lastBrace = serialDataBuffer.lastIndexOf("{");
    if (lastBrace !== -1) {
      serialDataBuffer = serialDataBuffer.substring(lastBrace);
    } else {
      serialDataBuffer = "";
    }
  }

  if (processedAny) {
    console.log(
      "[MAIN] Processed JSON objects, remaining buffer length:",
      serialDataBuffer.length
    );
  }
}

// Simple config file for base folder (used for reports, not separate images folder)
// Use a more accessible location - in the Documents/RoboGo folder
function getConfigPath() {
  // Use a default "RoboGo" folder in Documents for the config
  const documentsPath = path.join(require("os").homedir(), "Documents");
  const baseFolder = path.join(documentsPath, "RoboGo");

  // Create the folder if it doesn't exist
  if (!fs.existsSync(baseFolder)) {
    fs.mkdirSync(baseFolder, { recursive: true });
    console.log("📁 [CONFIG] Created default RoboGo folder:", baseFolder);
  }

  return path.join(baseFolder, "robogo-config.json");
}

// Dynamic config path
let configPath = null;

// Function to check if RoboGo folder and config are valid
function checkRoboGoSetupValidity() {
  if (!configPath) initializeConfigPath();

  const documentsPath = path.join(require("os").homedir(), "Documents");
  const baseFolder = path.join(documentsPath, "RoboGo");

  // Check if base RoboGo folder exists
  if (!fs.existsSync(baseFolder)) {
    console.log("❌ [CONFIG] RoboGo base folder missing:", baseFolder);
    resetConfigToWelcomeState();
    return false;
  }

  // Check if config file exists
  if (!fs.existsSync(configPath)) {
    console.log("❌ [CONFIG] Config file missing:", configPath);
    resetConfigToWelcomeState();
    return false;
  }

  // Check if config file is readable and has valid JSON
  try {
    const configContent = fs.readFileSync(configPath, "utf8");
    JSON.parse(configContent);
    console.log("✅ [CONFIG] RoboGo setup is valid");
    return true;
  } catch (e) {
    console.log("❌ [CONFIG] Config file corrupted:", e.message);
    resetConfigToWelcomeState();
    return false;
  }
}

// Function to reset config to welcome state (localMode = null)
function resetConfigToWelcomeState() {
  try {
    // Recreate base folder if needed
    const documentsPath = path.join(require("os").homedir(), "Documents");
    const baseFolder = path.join(documentsPath, "RoboGo");

    if (!fs.existsSync(baseFolder)) {
      fs.mkdirSync(baseFolder, { recursive: true });
      console.log("📁 [CONFIG] Recreated RoboGo base folder:", baseFolder);
    }

    // Create minimal config that will trigger welcome screen
    const resetConfig = {
      localMode: null, // This will trigger redirect to welcome
    };

    fs.writeFileSync(configPath, JSON.stringify(resetConfig, null, 2));
    console.log("🔄 [CONFIG] Reset config to welcome state");
  } catch (e) {
    console.error("❌ [CONFIG] Error resetting config:", e.message);
  }
}

// Initialize config path
function initializeConfigPath() {
  configPath = getConfigPath();
  console.log("📁 [CONFIG] Config file location:", configPath);
  console.log("📁 [CONFIG] Base folder:", path.dirname(configPath));
}

// Function to log current config contents
function logCurrentConfig() {
  if (!configPath) initializeConfigPath();

  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      console.log(
        "⚙️ [CONFIG] Current config contents:",
        JSON.stringify(config, null, 2)
      );
    } else {
      console.log("⚙️ [CONFIG] Config file does not exist yet");
    }
  } catch (e) {
    console.error("❌ [CONFIG] Error reading config:", e);
  }
}

// Log config at startup
logCurrentConfig();

function getPhotoSaveFolderFromConfig() {
  if (!configPath) initializeConfigPath();

  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      return config.photoSaveFolder || "";
    }
  } catch (e) {
    console.error(e);
  }
  return "";
}

function setPhotoSaveFolderToConfig(folderPath) {
  if (!configPath) initializeConfigPath();

  let config = {};
  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }
  } catch (e) {
    config = {};
  }
  config.photoSaveFolder = folderPath;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// Helper for logs folder config
function getLogsSaveFolderFromConfig() {
  if (!configPath) initializeConfigPath();

  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      return config.logsSaveFolder || "";
    }
  } catch (e) {
    console.error(e);
  }
  return "";
}

function setLogsSaveFolderToConfig(folderPath) {
  if (!configPath) initializeConfigPath();

  let config = {};
  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }
  } catch (e) {
    config = {};
  }
  config.logsSaveFolder = folderPath;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// Helper for localMode config
function getLocalModeFromConfig() {
  if (!configPath) initializeConfigPath();

  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      return !!config.localMode;
    }
  } catch (e) {
    console.error(e);
  }
  return false;
}

async function createWindow() {
  console.log("Starting RoboGo Electron App...");

  // Show loading window first
  const loadingWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Simple loading HTML
  loadingWindow.loadURL(`data:text/html,
    <html>
      <head>
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            margin: 0;
            padding: 40px;
            text-align: center;
            display: flex;
            flex-direction: column;
            justify-content: center;
            height: 100vh;
            box-sizing: border-box;
          }
          .spinner {
            border: 3px solid rgba(255,255,255,0.3);
            border-top: 3px solid white;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 20px auto;
          }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          .status { font-size: 14px; opacity: 0.9; margin-top: 10px; }
        </style>
      </head>
      <body>
        <h2>🤖 RoboGo Desktop</h2>
        <div class="spinner"></div>
        <div class="status">Starting application...</div>
        <div class="status">Please wait, this may take up to 2 minutes</div>
      </body>
    </html>
  `);
  // ✅ PORTABLE MODE: Use static server only (no Node.js/npm dependencies!)
  // This serves pre-built static files directly - instant startup!
  try {
    console.log(
      "🚀 Starting portable static server (NO Node.js/npm required)..."
    );
    await startStaticServer();
    console.log("✅ Portable app started successfully - INSTANT loading!");

    // 🔧 CRITICAL FIX: Set localMode=true for portable app immediately
    // This prevents the React app from getting stuck in loading/API calls
    console.log("🔧 Setting localMode=true for portable deployment...");
    try {
      if (!configPath) initializeConfigPath();

      let config = {};
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      }

      // Force local mode for portable app
      config.localMode = true;
      config.portableMode = true; // Flag to indicate this is portable deployment

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      console.log("✅ Forced localMode=true for portable app");
    } catch (configError) {
      console.error(
        "⚠️ Error setting localMode, but continuing...",
        configError
      );
    }

    // Close loading window
    loadingWindow.close();
  } catch (error) {
    console.error("❌ Failed to start static server:", error);
    console.log("🔧 This means the app needs to be built first.");

    // Show build instruction instead of trying Next.js fallback
    loadingWindow.loadURL(`data:text/html,
      <html>
        <head>
          <style>
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: #ff9800;
              color: white;
              margin: 0;
              padding: 40px;
              text-align: center;
              display: flex;
              flex-direction: column;
              justify-content: center;
              height: 100vh;
              box-sizing: border-box;
              line-height: 1.6;
            }
            .code { 
              background: rgba(0,0,0,0.2); 
              padding: 10px; 
              border-radius: 5px; 
              font-family: monospace;
              margin: 10px 0;
            }
          </style>
        </head>
        <body>
          <h2>🔧 App Not Built Yet</h2>
          <p>This portable app needs to be built first.</p>
          <p>Please run:</p>
          <div class="code">build-portable.bat</div>
          <p>Then restart the application.</p>
          <p style="font-size: 12px; opacity: 0.8;">This builds static files for portable deployment</p>
        </body>
      </html>
    `);

    setTimeout(() => {
      loadingWindow.close();
      app.quit();
    }, 5000);
    return;
  }

  // Set up permission request handler for geolocation
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      console.log(`🔐 [PERMISSION] Requesting permission for: ${permission}`);

      if (permission === "geolocation") {
        // Allow geolocation permission for weather functionality
        console.log("✅ [PERMISSION] Geolocation permission granted");
        callback(true);
      } else {
        // Deny other permissions for security
        console.log(`❌ [PERMISSION] Permission denied for: ${permission}`);
        callback(false);
      }
    }
  );

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      preload: path.join(__dirname, "preload.js"),
      // Disable background throttling to prevent refresh issues
      backgroundThrottling: false,
    },
    icon: path.join(__dirname, "assets", "icon.png"),
    // Prevent window from reloading when focus changes
    show: false, // Don't show initially
  });

  // Show window when ready to prevent flash
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  // Prevent automatic reload on focus
  mainWindow.on("focus", () => {
    // Don't trigger any reload on focus
    console.log("Window focused - no refresh triggered");
  });

  mainWindow.on("blur", () => {
    // Don't trigger any reload on blur
    console.log("Window blurred - no refresh triggered");
  });

  // Load the local client
  mainWindow.loadURL("http://localhost:3000");
  console.log("Loading client from: http://localhost:3000");

  // Open DevTools in development
  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools();
  }
}

// IPC Handler untuk mendapatkan daftar serial ports
ipcMain.handle("get-serial-ports", async () => {
  try {
    const ports = await SerialPort.list();
    console.log("All available ports:", ports); // Filter untuk ESP32/Arduino dengan pendekatan yang lebih permisif
    const filteredPorts = ports.filter((port) => {
      const vendorId = port.vendorId?.toLowerCase();
      const productId = port.productId?.toLowerCase();
      const manufacturer = port.manufacturer?.toLowerCase();
      const path = port.path?.toLowerCase();
      const friendlyName = port.friendlyName?.toLowerCase();

      console.log(`Checking port ${port.path}:`, {
        vendorId,
        productId,
        manufacturer,
        path,
        friendlyName,
      });

      // Expanded ESP32/Arduino vendor IDs dan product IDs
      const espVendorIds = [
        "10c4", // Silicon Labs (ESP32-CAM sering pakai ini)
        "1a86", // QinHeng Electronics (CH340/CH341)
        "0403", // FTDI
        "2341", // Arduino
        "1b4f", // SparkFun
        "303a", // Espressif Systems (ESP32 original)
        "067b", // Prolific
        "1cf1", // Dresden Elektronik
        "0483", // STMicroelectronics
        "239a", // Adafruit
        "16c0", // Van Ooijen Technische Informatica
        "04d8", // Microchip Technology
      ];

      // ESP32 Product IDs yang umum
      const espProductIds = [
        "ea60", // CP210x
        "6001", // FTDI
        "7523", // CH340
        "1001", // ESP32-S3 dan lainnya
        "0001", // Generic ESP32
        "8036", // CH341
        "2303", // Prolific
      ];

      const espManufacturers = [
        "silicon labs",
        "qinheng",
        "ftdi",
        "arduino",
        "espressif",
        "prolific",
        "cp210x",
        "ch340",
        "ch341",
        "microsoft", // Windows generic driver
      ];

      // Keywords yang menandakan ESP32/Arduino
      const espKeywords = [
        "esp32",
        "arduino",
        "usb serial",
        "usb-serial",
        "serial device",
        "cp210",
        "ch340",
        "ch341",
        "ftdi",
        "prolific",
        "comm port",
      ];

      // Check for Windows COM ports pattern
      const isComPort = path?.includes("com") || port.path?.match(/com\d+/i);

      // Multi-level matching untuk maksimal compatibility
      const vendorMatch = vendorId && espVendorIds.includes(vendorId);
      const productMatch = productId && espProductIds.includes(productId);
      const manufacturerMatch =
        manufacturer &&
        espManufacturers.some((mfg) => manufacturer.includes(mfg));
      const keywordMatch =
        friendlyName &&
        espKeywords.some((keyword) => friendlyName.includes(keyword));
      const comPortMatch = isComPort; // Include semua COM ports on Windows untuk safety

      const shouldInclude =
        vendorMatch ||
        productMatch ||
        manufacturerMatch ||
        keywordMatch ||
        comPortMatch;

      console.log(`Port ${port.path} - Include: ${shouldInclude}`, {
        vendorMatch,
        productMatch,
        manufacturerMatch,
        keywordMatch,
        comPortMatch,
      });

      return shouldInclude;
    });

    console.log("Filtered ports:", filteredPorts);
    return filteredPorts.map((port) => ({
      path: port.path,
      manufacturer: port.manufacturer || "Unknown",
      productId: port.productId,
      vendorId: port.vendorId,
      serialNumber: port.serialNumber,
      locationId: port.locationId,
      pnpId: port.pnpId,
      friendlyName: port.friendlyName,
    }));
  } catch (error) {
    console.error("Error listing serial ports:", error);
    throw error;
  }
});

// IPC Handlers untuk serial port functionality (dengan auto-detect baud rate)

// Handler untuk start-serial-reading

// IPC Handler untuk connect serial
ipcMain.handle("connect-serial", async (event, portPath) => {
  console.log("[MAIN] ===== CONNECT-SERIAL HANDLER CALLED =====");
  console.log("[MAIN] Port path:", portPath);

  try {
    if (currentPort && currentPort.isOpen) {
      await currentPort.close();
    }

    // Clear buffer when starting new connection
    serialDataBuffer = "";
    console.log("[MAIN] Starting new connection, buffer cleared");

    currentPort = new SerialPort({
      path: portPath,
      baudRate: 115200,
      autoOpen: false,
    });

    await new Promise((resolve, reject) => {
      currentPort.open((err) => {
        if (err) reject(err);
        else resolve();
      });
    }); // Setup data listener with block-based buffering for ESP32 multi-line data
    currentPort.on("data", (data) => {
      const chunk = data.toString();
      console.log("[MAIN] Received chunk:", chunk);

      // Add chunk to buffer
      serialDataBuffer += chunk;

      // Look for complete ESP32 blocks ending with multiple newlines or specific delimiters
      // ESP32 typically sends blocks like:
      // ====== SENT DATA ======
      // ...data...
      // ========================
      // [blank lines]

      let buffer = serialDataBuffer;
      let processedAny = false;

      // Process complete blocks (either JSON objects or ESP32 human-readable blocks)
      while (buffer.length > 0) {
        let blockEnd = -1;
        let isEsp32Block = false;
        let isJsonBlock = false;

        // Check for ESP32 human-readable block pattern
        if (buffer.includes("====== SENT DATA ======")) {
          // Look for the end of ESP32 block (======================== followed by newlines)
          const blockEndPattern = /========================\s*\n/;
          const match = buffer.match(blockEndPattern);
          if (match) {
            blockEnd = match.index + match[0].length;
            isEsp32Block = true;
            console.log("[MAIN] Found complete ESP32 block, length:", blockEnd);
          }
        }

        // Check for JSON block if no ESP32 block found
        if (!isEsp32Block && buffer.includes("{")) {
          const jsonStart = buffer.indexOf("{");
          if (jsonStart !== -1) {
            // Find matching closing brace for JSON
            let braceCount = 0;
            let inString = false;
            let escapeNext = false;

            for (let i = jsonStart; i < buffer.length; i++) {
              const char = buffer[i];

              if (escapeNext) {
                escapeNext = false;
                continue;
              }

              if (char === "\\") {
                escapeNext = true;
                continue;
              }

              if (char === '"') {
                inString = !inString;
                continue;
              }

              if (!inString) {
                if (char === "{") {
                  braceCount++;
                } else if (char === "}") {
                  braceCount--;
                  if (braceCount === 0) {
                    blockEnd = i + 1;
                    isJsonBlock = true;
                    console.log(
                      "[MAIN] Found complete JSON block, length:",
                      blockEnd - jsonStart
                    );
                    break;
                  }
                }
              }
            }
          }
        }

        // If we found a complete block, process it
        if (blockEnd !== -1) {
          const completeBlock = buffer.substring(0, blockEnd).trim();

          if (completeBlock.length > 0) {
            console.log(
              "[MAIN] Sending complete block:",
              isEsp32Block ? "ESP32 human-readable" : "JSON",
              "length:",
              completeBlock.length
            );
            console.log(
              "[MAIN] Block preview:",
              completeBlock.substring(0, 200) + "..."
            );

            if (mainWindow) {
              mainWindow.webContents.send(
                "serial-data-received",
                completeBlock
              );
            }
          }

          // Remove processed block from buffer
          buffer = buffer.substring(blockEnd);
          processedAny = true;
        } else {
          // No complete block found, keep remaining buffer
          console.log(
            "[MAIN] No complete block found, keeping buffer length:",
            buffer.length
          );
          break;
        }
      }

      // Update the global buffer
      serialDataBuffer = buffer;

      // Prevent buffer from growing too large
      if (serialDataBuffer.length > 50000) {
        console.log("[MAIN] Buffer too large, trimming...");
        // Keep only the last portion that might contain a partial block
        const lastBlockStart = Math.max(
          serialDataBuffer.lastIndexOf("====== SENT DATA ======"),
          serialDataBuffer.lastIndexOf("{")
        );
        if (lastBlockStart !== -1) {
          serialDataBuffer = serialDataBuffer.substring(lastBlockStart);
        } else {
          serialDataBuffer = serialDataBuffer.substring(-10000); // Keep last 10KB
        }
      }

      if (processedAny) {
        console.log(
          "[MAIN] Processed blocks, remaining buffer length:",
          serialDataBuffer.length
        );
      }
    });

    console.log(`Connected to ${portPath}`);
    return true;
  } catch (error) {
    console.error("Error connecting to serial port:", error);
    return false;
  }
});

// IPC Handler untuk disconnect serial
ipcMain.handle("disconnect-serial", async () => {
  try {
    if (currentPort && currentPort.isOpen) {
      await new Promise((resolve, reject) => {
        currentPort.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      currentPort = null;
      // Clear the serial buffer when disconnecting
      serialDataBuffer = "";
      console.log("Disconnected from serial port and cleared buffer");
    }
    return true;
  } catch (error) {
    console.error("Error disconnecting:", error);
    return false;
  }
});

// IPC Handler untuk send serial command
ipcMain.handle("send-serial-command", async (event, command) => {
  try {
    if (!currentPort || !currentPort.isOpen) {
      throw new Error("No serial port connected");
    }

    await new Promise((resolve, reject) => {
      currentPort.write(command + "\n", (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log(`Sent command: ${command}`);
    return true;
  } catch (error) {
    console.error("Error sending command:", error);
    throw error;
  }
});

// IPC Handler untuk mendapatkan SEMUA serial ports (debug purpose)
ipcMain.handle("get-all-serial-ports", async () => {
  try {
    const ports = await SerialPort.list();
    console.log("All available serial ports (unfiltered):", ports);

    return ports.map((port) => ({
      path: port.path,
      manufacturer: port.manufacturer || "Unknown",
      productId: port.productId,
      vendorId: port.vendorId,
      serialNumber: port.serialNumber,
      locationId: port.locationId,
      pnpId: port.pnpId,
    }));
  } catch (error) {
    console.error("Error listing all serial ports:", error);
    throw error;
  }
});

// IPC Handler untuk open serial port dengan auto-detect baud rate
ipcMain.handle(
  "open-serial-port",
  async (event, portPath, baudRate = 115200) => {
    console.log("[MAIN] ===== OPEN-SERIAL-PORT HANDLER CALLED =====");
    console.log("[MAIN] Port path:", portPath);
    console.log("[MAIN] Baud rate:", baudRate);

    try {
      // Close existing port if open
      if (currentPort && currentPort.isOpen) {
        console.log("[SERIAL] Closing existing port...");
        try {
          await new Promise((resolve, reject) => {
            currentPort.close((err) => {
              if (err) reject(err);
              else resolve();
            });
          });
          console.log("[SERIAL] Existing port closed successfully");
        } catch (err) {
          console.log("[SERIAL] Error closing existing port:", err);
        }
      }

      // Clear buffer when starting new connection
      serialDataBuffer = "";
      console.log("[MAIN] Starting new connection, buffer cleared");

      // Common ESP32 baud rates (untuk auto-detect)
      const commonBaudRates = [
        115200, 921600, 460800, 230400, 57600, 38400, 19200, 9600,
      ];
      const baudRatesToTry = [
        baudRate,
        ...commonBaudRates.filter((rate) => rate !== baudRate),
      ];

      console.log(
        `[SERIAL] Attempting to connect to ${portPath} with baud rates:`,
        baudRatesToTry
      );

      // Try different baud rates
      for (const tryBaudRate of baudRatesToTry) {
        try {
          console.log(`[SERIAL] Trying baud rate: ${tryBaudRate}`);

          const result = await new Promise((resolve, reject) => {
            const port = new SerialPort({
              path: portPath,
              baudRate: tryBaudRate,
              // Add ESP32-friendly settings
              dataBits: 8,
              stopBits: 1,
              parity: "none",
              rtscts: false,
              xon: false,
              xoff: false,
              autoOpen: false,
            });

            // Set timeout for connection attempt
            const timeout = setTimeout(() => {
              console.log(`[SERIAL] Timeout for baud rate ${tryBaudRate}`);
              port.close(() => {});
              resolve({
                success: false,
                message: `Timeout for baud rate ${tryBaudRate}`,
              });
            }, 3000); // 3 second timeout per baud rate

            port.open((err) => {
              if (err) {
                clearTimeout(timeout);
                console.error(
                  `[SERIAL] Failed to open with baud rate ${tryBaudRate}:`,
                  err
                );
                resolve({ success: false, message: err.message });
                return;
              }

              clearTimeout(timeout);
              console.log(
                `[SERIAL] Serial port ${portPath} opened successfully with baud rate ${tryBaudRate}`
              ); // Setup data listener with block-based buffering (same as connect-serial handler)
              port.on("data", (data) => {
                const chunk = data.toString();
                console.log("[MAIN] Received chunk:", chunk);

                // Add chunk to buffer
                serialDataBuffer += chunk;

                // Look for complete ESP32 blocks ending with multiple newlines or specific delimiters
                let buffer = serialDataBuffer;
                let processedAny = false;

                // Process complete blocks (either JSON objects or ESP32 human-readable blocks)
                while (buffer.length > 0) {
                  let blockEnd = -1;
                  let isEsp32Block = false;
                  let isJsonBlock = false;

                  // Check for ESP32 human-readable block pattern
                  if (buffer.includes("====== SENT DATA ======")) {
                    // Look for the end of ESP32 block (======================== followed by newlines)
                    const blockEndPattern = /========================\s*\n/;
                    const match = buffer.match(blockEndPattern);
                    if (match) {
                      blockEnd = match.index + match[0].length;
                      isEsp32Block = true;
                      console.log(
                        "[MAIN] Found complete ESP32 block, length:",
                        blockEnd
                      );
                    }
                  }

                  // Check for JSON block if no ESP32 block found
                  if (!isEsp32Block && buffer.includes("{")) {
                    const jsonStart = buffer.indexOf("{");
                    if (jsonStart !== -1) {
                      // Find matching closing brace for JSON
                      let braceCount = 0;
                      let inString = false;
                      let escapeNext = false;

                      for (let i = jsonStart; i < buffer.length; i++) {
                        const char = buffer[i];

                        if (escapeNext) {
                          escapeNext = false;
                          continue;
                        }

                        if (char === "\\") {
                          escapeNext = true;
                          continue;
                        }

                        if (char === '"') {
                          inString = !inString;
                          continue;
                        }

                        if (!inString) {
                          if (char === "{") {
                            braceCount++;
                          } else if (char === "}") {
                            braceCount--;
                            if (braceCount === 0) {
                              blockEnd = i + 1;
                              isJsonBlock = true;
                              console.log(
                                "[MAIN] Found complete JSON block, length:",
                                blockEnd - jsonStart
                              );
                              break;
                            }
                          }
                        }
                      }
                    }
                  }

                  // If we found a complete block, process it
                  if (blockEnd !== -1) {
                    const completeBlock = buffer.substring(0, blockEnd).trim();

                    if (completeBlock.length > 0) {
                      console.log(
                        "[MAIN] Sending complete block:",
                        isEsp32Block ? "ESP32 human-readable" : "JSON",
                        "length:",
                        completeBlock.length
                      );
                      console.log(
                        "[MAIN] Block preview:",
                        completeBlock.substring(0, 200) + "..."
                      );

                      if (mainWindow) {
                        mainWindow.webContents.send(
                          "serial-data-received",
                          completeBlock
                        );
                      }
                    }

                    // Remove processed block from buffer
                    buffer = buffer.substring(blockEnd);
                    processedAny = true;
                  } else {
                    // No complete block found, keep remaining buffer
                    console.log(
                      "[MAIN] No complete block found, keeping buffer length:",
                      buffer.length
                    );
                    break;
                  }
                }

                // Update the global buffer
                serialDataBuffer = buffer;

                // Prevent buffer from growing too large
                if (serialDataBuffer.length > 50000) {
                  console.log("[MAIN] Buffer too large, trimming...");
                  // Keep only the last portion that might contain a partial block
                  const lastBlockStart = Math.max(
                    serialDataBuffer.lastIndexOf("====== SENT DATA ======"),
                    serialDataBuffer.lastIndexOf("{")
                  );
                  if (lastBlockStart !== -1) {
                    serialDataBuffer =
                      serialDataBuffer.substring(lastBlockStart);
                  } else {
                    serialDataBuffer = serialDataBuffer.substring(-10000); // Keep last 10KB
                  }
                }

                if (processedAny) {
                  console.log(
                    "[MAIN] Processed blocks, remaining buffer length:",
                    serialDataBuffer.length
                  );
                }
              });

              currentPort = port;
              resolve({
                success: true,
                message: `Port opened successfully with baud rate ${tryBaudRate}`,
                baudRate: tryBaudRate,
              });
            });
          });

          if (result.success) {
            console.log(`[SERIAL] Successfully connected with result:`, result);
            return result;
          }

          // Wait a bit before trying next baud rate
          await new Promise((resolve) => setTimeout(resolve, 500));
        } catch (err) {
          console.log(
            `[SERIAL] Failed with baud rate ${tryBaudRate}:`,
            err.message
          );
          continue;
        }
      }

      // If all baud rates failed
      const errorMsg = `Failed to connect to ${portPath} with any common baud rate. Tried: ${baudRatesToTry.join(
        ", "
      )}`;
      console.log(`[SERIAL] ${errorMsg}`);
      return {
        success: false,
        message: errorMsg,
      };
    } catch (error) {
      console.error("[SERIAL] Error opening serial port:", error);
      return { success: false, message: error.message };
    }
  }
);

// IPC Handler untuk close serial port
ipcMain.handle("close-serial-port", async () => {
  try {
    if (currentPort && currentPort.isOpen) {
      await new Promise((resolve, reject) => {
        currentPort.close((err) => {
          if (err) reject(err);
          else {
            currentPort = null;
            resolve();
          }
        });
      });
      return { success: true, message: "Port closed successfully" };
    }
    return { success: true, message: "No port was open" };
  } catch (error) {
    console.error("Error closing serial port:", error);
    return { success: false, message: error.message };
  }
});

// IPC Handler untuk start serial reading
ipcMain.handle("start-serial-reading", () => {
  try {
    if (currentPort && currentPort.isOpen) {
      console.log("[SERIAL] Serial reading already active");
      return { success: true, message: "Serial reading is active" };
    } else {
      console.log("[SERIAL] No serial port is open");
      return { success: false, message: "No serial port is open" };
    }
  } catch (error) {
    console.error("[SERIAL] Error starting serial reading:", error);
    return { success: false, message: error.message };
  }
});

// IPC handler: get current base folder (now used for reports structure)
ipcMain.handle("get-photo-save-folder", async () => {
  let photoFolder = getPhotoSaveFolderFromConfig();

  // If no photo folder configured, set up default
  if (!photoFolder) {
    console.log("[MAIN] No photo folder configured, setting up default...");
    const documentsPath = path.join(require("os").homedir(), "Documents");
    const defaultBaseFolder = path.join(documentsPath, "RoboGo");

    // Create base RoboGo folder if it doesn't exist
    if (!fs.existsSync(defaultBaseFolder)) {
      fs.mkdirSync(defaultBaseFolder, { recursive: true });
      console.log("[MAIN] Created default RoboGo folder:", defaultBaseFolder);
    }

    // Set as default photo folder
    setPhotoSaveFolderToConfig(defaultBaseFolder);
    photoFolder = defaultBaseFolder;
    console.log("[MAIN] Set default photo folder:", photoFolder);
  }

  return photoFolder;
});
// IPC handler: set base folder (now used for reports structure)
ipcMain.handle("set-photo-save-folder", async (event, folderPath) => {
  setPhotoSaveFolderToConfig(folderPath);
  return true;
});
// IPC handler: open dialog to select folder
ipcMain.handle("select-photo-save-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Select Folder to Save Photos",
  });
  if (!result.canceled && result.filePaths.length > 0) {
    setPhotoSaveFolderToConfig(result.filePaths[0]);
    return result.filePaths[0];
  }
  return null;
});

// IPC handler: get logs save folder
ipcMain.handle("get-logs-save-folder", async () => {
  let logsFolder = getLogsSaveFolderFromConfig();

  // If no logs folder configured, set up default
  if (!logsFolder) {
    console.log("[MAIN] No logs folder configured, setting up default...");
    const documentsPath = path.join(require("os").homedir(), "Documents");
    const defaultBaseFolder = path.join(documentsPath, "RoboGo");

    // Create base RoboGo folder if it doesn't exist
    if (!fs.existsSync(defaultBaseFolder)) {
      fs.mkdirSync(defaultBaseFolder, { recursive: true });
      console.log("[MAIN] Created default RoboGo folder:", defaultBaseFolder);
    }

    // Set as default logs folder
    setLogsSaveFolderToConfig(defaultBaseFolder);
    logsFolder = defaultBaseFolder;
    console.log("[MAIN] Set default logs folder:", logsFolder);
  }

  return logsFolder;
});
// IPC handler: set logs save folder
ipcMain.handle("set-logs-save-folder", async (event, folderPath) => {
  // Always save as <selected>/logs
  const logsFolder = path.join(folderPath, "logs");
  setLogsSaveFolderToConfig(logsFolder);
  // Auto-create folder if not exist
  if (!fs.existsSync(logsFolder)) {
    fs.mkdirSync(logsFolder, { recursive: true });
  }
  return true;
});
// IPC handler: open dialog to select logs folder
ipcMain.handle("select-logs-save-folder", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Select Folder to Save Logs",
  });
  if (!result.canceled && result.filePaths.length > 0) {
    // Always save as <selected>/logs
    const logsFolder = path.join(result.filePaths[0], "logs");
    setLogsSaveFolderToConfig(logsFolder);
    if (!fs.existsSync(logsFolder)) {
      fs.mkdirSync(logsFolder, { recursive: true });
    }
    return logsFolder;
  }
  return null;
});

// IPC handler: save image buffer to selected folder
ipcMain.handle(
  "save-image-to-folder",
  async (event, buffer, fileName, folderPath) => {
    try {
      let saveFolder;

      if (folderPath) {
        // If folderPath is provided, treat it as relative to logs base folder
        let baseFolder = getLogsSaveFolderFromConfig();

        // If no base folder configured, set up default
        if (!baseFolder) {
          console.log(
            "[MAIN] No base folder configured for image save, setting up default..."
          );
          const documentsPath = path.join(require("os").homedir(), "Documents");
          const defaultBaseFolder = path.join(documentsPath, "RoboGo");

          // Create base RoboGo folder if it doesn't exist
          if (!fs.existsSync(defaultBaseFolder)) {
            fs.mkdirSync(defaultBaseFolder, { recursive: true });
            console.log(
              "[MAIN] Created default RoboGo folder:",
              defaultBaseFolder
            );
          }

          // Set as default logs folder
          setLogsSaveFolderToConfig(defaultBaseFolder);
          baseFolder = defaultBaseFolder;
          console.log("[MAIN] Set default base folder for images:", baseFolder);
        }

        // Check if folderPath is already absolute to avoid path doubling
        if (path.isAbsolute(folderPath)) {
          console.log("[MAIN] folderPath is absolute, using as-is");
          saveFolder = path.normalize(folderPath);
        } else {
          console.log("[MAIN] folderPath is relative, joining with baseFolder");
          saveFolder = path.join(baseFolder, folderPath);
        }
      } else {
        // If no folderPath provided, use photo config folder
        let photoFolder = getPhotoSaveFolderFromConfig();

        // If no photo folder configured, set up default
        if (!photoFolder) {
          console.log(
            "[MAIN] No photo folder configured, setting up default..."
          );
          const documentsPath = path.join(require("os").homedir(), "Documents");
          const defaultBaseFolder = path.join(documentsPath, "RoboGo");

          // Create base RoboGo folder if it doesn't exist
          if (!fs.existsSync(defaultBaseFolder)) {
            fs.mkdirSync(defaultBaseFolder, { recursive: true });
            console.log(
              "[MAIN] Created default RoboGo folder:",
              defaultBaseFolder
            );
          }

          // Set as default photo folder
          setPhotoSaveFolderToConfig(defaultBaseFolder);
          photoFolder = defaultBaseFolder;
          console.log("[MAIN] Set default photo folder:", photoFolder);
        }

        saveFolder = photoFolder;
      }

      // Ensure folder exists
      if (!fs.existsSync(saveFolder)) {
        fs.mkdirSync(saveFolder, { recursive: true });
      }

      const filePath = path.join(saveFolder, fileName);
      fs.writeFileSync(filePath, Buffer.from(buffer));
      console.log("[MAIN] Image saved to:", filePath);
      return { success: true, filePath };
    } catch (e) {
      console.error("[MAIN] Error saving image:", e);
      return { success: false, error: e.message };
    }
  }
);

// IPC handler: create folder
ipcMain.handle("create-folder", async (event, folderPath) => {
  try {
    // Use logs base folder as root for relative paths
    let baseFolder = getLogsSaveFolderFromConfig();

    // If no base folder configured, set up default
    if (!baseFolder) {
      console.log("[MAIN] No base folder configured, setting up default...");
      const documentsPath = path.join(require("os").homedir(), "Documents");
      const defaultBaseFolder = path.join(documentsPath, "RoboGo");

      // Create base RoboGo folder if it doesn't exist
      if (!fs.existsSync(defaultBaseFolder)) {
        fs.mkdirSync(defaultBaseFolder, { recursive: true });
        console.log("[MAIN] Created default RoboGo folder:", defaultBaseFolder);
      }

      // Set as default logs folder
      setLogsSaveFolderToConfig(defaultBaseFolder);
      baseFolder = defaultBaseFolder;
      console.log("[MAIN] Set default base folder:", baseFolder);
    }

    const fullPath = path.join(baseFolder, folderPath);

    // Create folder recursively if it doesn't exist
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
      console.log("[MAIN] Created folder:", fullPath);
    }

    return { success: true };
  } catch (e) {
    console.error("[MAIN] Error creating folder:", e);
    return { success: false, error: e.message };
  }
});

// IPC handler: write logs to file
ipcMain.handle("write-logs-to-file", async (event, content, filename) => {
  console.log("[MAIN] write-logs-to-file handler called with:", {
    content: content?.substring(0, 100) + "...",
    filename,
  });
  try {
    let logsFolder = getLogsSaveFolderFromConfig();
    console.log("[MAIN] Logs folder from config:", logsFolder);

    // If no logs folder configured, set up default
    if (!logsFolder) {
      console.log("[MAIN] No logs folder configured, setting up default...");
      const documentsPath = path.join(require("os").homedir(), "Documents");
      const defaultBaseFolder = path.join(documentsPath, "RoboGo");

      // Create base RoboGo folder if it doesn't exist
      if (!fs.existsSync(defaultBaseFolder)) {
        fs.mkdirSync(defaultBaseFolder, { recursive: true });
        console.log("[MAIN] Created default RoboGo folder:", defaultBaseFolder);
      }

      // Set as default logs folder
      setLogsSaveFolderToConfig(defaultBaseFolder);
      logsFolder = defaultBaseFolder;
      console.log("[MAIN] Set default logs folder:", logsFolder);
    }

    // Create full path to logs subfolder
    const logsSubfolder = path.join(logsFolder, "logs");
    console.log("[MAIN] Creating logs subfolder at:", logsSubfolder);

    // Ensure logs subfolder exists (create logs folder inside the configured path)
    if (!fs.existsSync(logsSubfolder)) {
      console.log("[MAIN] Creating logs subfolder...");
      fs.mkdirSync(logsSubfolder, { recursive: true });
      console.log("[MAIN] Logs subfolder created successfully");
    } else {
      console.log("[MAIN] Logs subfolder already exists");
    }

    const filePath = path.join(logsSubfolder, filename);
    console.log("[MAIN] Writing to file:", filePath);

    // Append to file (or create if doesn't exist)
    fs.appendFileSync(filePath, content, "utf8");
    console.log("[MAIN] File written successfully");

    return { success: true, filePath };
  } catch (e) {
    console.error("[MAIN] Error writing logs to file:", e);
    return { success: false, error: e.message };
  }
});

// Read file handler
ipcMain.handle("read-file", async (event, filePath) => {
  try {
    console.log("[MAIN] Reading file:", filePath);

    let fullPath;

    // Check if the path is already absolute
    if (path.isAbsolute(filePath)) {
      fullPath = filePath;
      console.log("[MAIN] Using absolute path:", fullPath);
    } else {
      // Base path is Documents/RoboGo/
      const documentsPath = path.join(require("os").homedir(), "Documents");
      const baseFolder = path.join(documentsPath, "RoboGo");
      fullPath = path.join(baseFolder, filePath);
      console.log("[MAIN] Constructed path from relative:", fullPath);
    }

    // Check if file exists
    if (!fs.existsSync(fullPath)) {
      console.log("[MAIN] File does not exist:", fullPath);
      return { success: false, error: "File not found" };
    }

    // Read file content
    const content = fs.readFileSync(fullPath, "utf8");
    console.log(
      "[MAIN] File read successfully, content length:",
      content.length
    );

    return { success: true, content };
  } catch (e) {
    console.error("[MAIN] Error reading file:", e);
    return { success: false, error: e.message };
  }
});

// Ensure reports folder and subfolders exist, and update config
function ensureReportsFoldersExist() {
  const documentsPath = path.join(require("os").homedir(), "Documents");
  const baseFolder = path.join(documentsPath, "RoboGo");
  const reportsFolder = path.join(baseFolder, "reports");
  const subfolders = ["gallery", "ultrasonic", "imu", "paths"];

  if (!fs.existsSync(reportsFolder)) {
    fs.mkdirSync(reportsFolder, { recursive: true });
    console.log("[MAIN] Created reports folder:", reportsFolder);
  }
  for (const sub of subfolders) {
    const subPath = path.join(reportsFolder, sub);
    if (!fs.existsSync(subPath)) {
      fs.mkdirSync(subPath, { recursive: true });
      console.log(`[MAIN] Created reports subfolder: ${subPath}`);
    }

    // Create organized subfolders inside gallery
    if (sub === "gallery") {
      const gallerySubfolders = ["originals", "metadata", "json"];
      for (const gallerySub of gallerySubfolders) {
        const gallerySubPath = path.join(subPath, gallerySub);
        if (!fs.existsSync(gallerySubPath)) {
          fs.mkdirSync(gallerySubPath, { recursive: true });
          console.log(`[MAIN] Created gallery subfolder: ${gallerySubPath}`);
        }
      }
    }
  }
  // Update config
  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch (e) {
      config = {};
    }
  }
  config.reportsFolder = reportsFolder;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return reportsFolder;
}

// Ensure default folders exist on app start
app.whenReady().then(() => {
  console.log("[MAIN] App ready, creating default folders...");

  // Initialize config path first
  initializeConfigPath();

  // Check RoboGo setup validity on startup
  const isSetupValid = checkRoboGoSetupValidity();
  if (!isSetupValid) {
    console.log(
      "[MAIN] RoboGo setup invalid on startup, resetting to defaults..."
    );
    // Force recreation of default setup
  }

  // Get the base RoboGo folder
  const documentsPath = path.join(require("os").homedir(), "Documents");
  const defaultBaseFolder = path.join(documentsPath, "RoboGo");

  let imagesFolder = getPhotoSaveFolderFromConfig();
  let logsBaseFolder = getLogsSaveFolderFromConfig();

  // If no folders are configured, set up defaults in Documents/RoboGo
  if (!imagesFolder) {
    imagesFolder = defaultBaseFolder;
    setPhotoSaveFolderToConfig(defaultBaseFolder);
    console.log("[MAIN] Set default images folder:", imagesFolder);
  }

  if (!logsBaseFolder) {
    logsBaseFolder = defaultBaseFolder;
    setLogsSaveFolderToConfig(defaultBaseFolder);
    console.log("[MAIN] Set default logs folder:", logsBaseFolder);
  }
  // Create necessary subfolders
  // Note: Images are now stored in reports/gallery folder, not in separate images folder

  if (logsBaseFolder) {
    console.log("[MAIN] Logs base folder:", logsBaseFolder);
    const logsSubfolder = path.join(logsBaseFolder, "logs");
    if (!fs.existsSync(logsSubfolder)) {
      console.log("[MAIN] Creating logs subfolder:", logsSubfolder);
      fs.mkdirSync(logsSubfolder, { recursive: true });
    }

    // Create monitoring folder
    const monitoringSubfolder = path.join(logsBaseFolder, "monitoring");
    if (!fs.existsSync(monitoringSubfolder)) {
      console.log("[MAIN] Creating monitoring subfolder:", monitoringSubfolder);
      fs.mkdirSync(monitoringSubfolder, { recursive: true });
    }
  }

  // Ensure reports folder exists
  ensureReportsFoldersExist();
  console.log("[MAIN] Default structure:");
  console.log("  Config file:", configPath);
  console.log("  Base folder:", defaultBaseFolder);
  console.log("  Reports folder:", path.join(defaultBaseFolder, "reports"));
  console.log("  Logs folder:", path.join(logsBaseFolder, "logs"));
  console.log("  Monitoring folder:", path.join(logsBaseFolder, "monitoring"));

  createWindow();
});

app.on("window-all-closed", () => {
  // Cleanup serial port
  if (currentPort && currentPort.isOpen) {
    currentPort.close();
    currentPort = null;
  }

  // Stop servers
  stopNextJS();
  stopStaticServer();

  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle("get-local-mode", async () => {
  return getLocalModeFromConfig();
});

ipcMain.handle("set-local-mode", async (event, value) => {
  let config = {};
  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }
  } catch (e) {
    config = {};
  }
  config.localMode = !!value;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  // Jika localMode diaktifkan, pastikan folder reports dibuat dan config diupdate
  if (value === true) {
    ensureReportsFoldersExist();
  }
  return true;
});

ipcMain.handle("get-config", async (event, key) => {
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      return config[key];
    }
  } catch (e) {
    console.error(e);
  }
  return undefined;
});

// Check if RoboGo setup is valid (folder and config exist)
ipcMain.handle("check-robogo-setup-validity", async () => {
  return checkRoboGoSetupValidity();
});

ipcMain.handle("set-config", async (event, key, value) => {
  let config = {};
  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    }
  } catch (e) {
    config = {};
  }
  config[key] = value;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  // Jika localMode diaktifkan, pastikan folder reports dibuat dan config diupdate
  if (key === "localMode" && value === true) {
    ensureReportsFoldersExist();
  }
  return true;
});

ipcMain.handle("reset-config", async () => {
  try {
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
});

// Check if file exists handler
ipcMain.handle("check-file-exists", async (event, filePath) => {
  try {
    console.log("[MAIN] check-file-exists called with:", filePath);

    // Get the base logs save folder from config
    const baseFolder = getLogsSaveFolderFromConfig();
    if (!baseFolder) {
      console.log("[MAIN] No logs save folder configured");
      return false;
    }

    // Build full path
    const fullPath = path.join(baseFolder, filePath);
    console.log("[MAIN] Checking file exists:", fullPath);

    const exists = fs.existsSync(fullPath);
    console.log("[MAIN] File exists:", exists);

    return exists;
  } catch (e) {
    console.error("[MAIN] Error checking file exists:", e);
    return false;
  }
});

// Get config file location handler
ipcMain.handle("get-config-file-location", async () => {
  return {
    configPath: configPath,
    userDataPath: app.getPath("userData"),
    exists: fs.existsSync(configPath),
  };
});

// Get full config contents handler for debugging
ipcMain.handle("get-full-config", async () => {
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      return config;
    }
    return {};
  } catch (e) {
    console.error(e);
    return {};
  }
});

// Open RoboGo folder in file explorer
ipcMain.handle("open-robogo-folder", async () => {
  try {
    const documentsPath = path.join(require("os").homedir(), "Documents");
    const robogoFolder = path.join(documentsPath, "RoboGo");

    // Create folder if it doesn't exist
    if (!fs.existsSync(robogoFolder)) {
      fs.mkdirSync(robogoFolder, { recursive: true });
    }

    // Open folder in file explorer
    await shell.openPath(robogoFolder);
    return { success: true, path: robogoFolder };
  } catch (e) {
    console.error("[MAIN] Error opening RoboGo folder:", e);
    return { success: false, error: e.message };
  }
});

// Get images from folder handler (fixed version)
ipcMain.handle("get-images-from-folder", async (event, folderPath) => {
  try {
    console.log("[MAIN] ===============================================");
    console.log("[MAIN] GET IMAGES FROM FOLDER - START");
    console.log("[MAIN] Requested folder path:", folderPath);

    // Get the photo save folder from config
    const photoSaveFolder = getPhotoSaveFolderFromConfig();
    console.log("[MAIN] Photo save folder from config:", photoSaveFolder);
    if (!photoSaveFolder) {
      console.log("[MAIN] ERROR: Photo save folder not configured");
      return { success: false, error: "Photo save folder not configured" };
    }

    // Construct the full path to the folder
    // Check if folderPath is already absolute to avoid path doubling
    let fullFolderPath;
    if (path.isAbsolute(folderPath)) {
      console.log("[MAIN] folderPath is absolute, using as-is");
      fullFolderPath = path.normalize(folderPath);
    } else {
      console.log(
        "[MAIN] folderPath is relative, joining with photoSaveFolder"
      );
      fullFolderPath = path.join(photoSaveFolder, folderPath);
    }
    console.log("[MAIN] Full folder path:", fullFolderPath);

    // Check if folder exists
    if (!fs.existsSync(fullFolderPath)) {
      console.log("[MAIN] Folder does not exist, creating:", fullFolderPath);
      fs.mkdirSync(fullFolderPath, { recursive: true });
      console.log("[MAIN] Created folder, returning empty array");
      return { success: true, images: [] };
    }

    console.log("[MAIN] Folder exists, reading directory contents...");

    // Read directory contents
    const files = fs.readdirSync(fullFolderPath);
    console.log("[MAIN] Files found in directory:", files);

    const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"];
    const jsonExtensions = [".json"];
    console.log("[MAIN] Looking for image and JSON files...");

    const images = [];
    for (const file of files) {
      const filePath = path.join(fullFolderPath, file);
      const ext = path.extname(file).toLowerCase();

      try {
        const stats = fs.statSync(filePath);
        console.log(
          "[MAIN] Processing:",
          file,
          "isDirectory:",
          stats.isDirectory()
        );

        // Check if it's a directory (date folder like "2025-06-23")
        if (stats.isDirectory()) {
          console.log("[MAIN] Found directory:", file);
          const dirData = {
            fileName: file,
            filePath: filePath,
            dateCreated: stats.mtime.toISOString(),
            size: stats.size,
            isDirectory: true,
            stats: {
              mtime: stats.mtime,
              ctime: stats.ctime,
              size: stats.size,
            },
          };
          images.push(dirData);
        }
        // Check if it's an image file
        else if (imageExtensions.includes(ext)) {
          console.log("[MAIN] Found image file:", file);

          // Try to extract date from filename (format: YYYY-MM-DD_HH-MM-SS.jpg)
          let dateCreated = stats.mtime.toISOString(); // fallback
          const fileNameWithoutExt = path.parse(file).name;
          const dateTimeMatch = fileNameWithoutExt.match(
            /^(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})/
          );

          if (dateTimeMatch) {
            // Convert filename format to ISO string
            const [, datePart, timePart] = dateTimeMatch;
            const timeFormatted = timePart.replace(/-/g, ":");
            const isoString = `${datePart}T${timeFormatted}.000Z`;

            // Validate the parsed date
            const parsedDate = new Date(isoString);
            if (!isNaN(parsedDate.getTime())) {
              dateCreated = isoString;
              console.log(
                "[MAIN] Extracted date from filename:",
                file,
                "->",
                dateCreated
              );
            }
          }

          const imageData = {
            fileName: file,
            filePath: filePath,
            dateCreated: dateCreated,
            size: stats.size,
            stats: {
              mtime: stats.mtime,
              ctime: stats.ctime,
              size: stats.size,
            },
          };
          images.push(imageData);
        }
        // Check if it's a JSON file
        else if (jsonExtensions.includes(ext)) {
          console.log("[MAIN] Found JSON file:", file);
          const jsonData = {
            fileName: file,
            filePath: filePath,
            dateCreated: stats.mtime.toISOString(),
            size: stats.size,
            isJson: true,
            stats: {
              mtime: stats.mtime,
              ctime: stats.ctime,
              size: stats.size,
            },
          };
          images.push(jsonData);
        } else {
          console.log("[MAIN] Skipping unsupported file:", file);
        }
      } catch (statError) {
        console.error("[MAIN] Error getting file stats for:", file, statError);
      }
    }

    // Sort by creation date (newest first)
    images.sort((a, b) => new Date(b.dateCreated) - new Date(a.dateCreated));

    console.log("[MAIN] Final result:", images.length, "items found");
    console.log("[MAIN] GET IMAGES FROM FOLDER - END");
    console.log("[MAIN] ===============================================");

    return { success: true, images };
  } catch (error) {
    console.error("[MAIN] Error getting files from folder:", error);
    return { success: false, error: error.message };
  }
});

// Fixed handler for reading ultrasonic folder (supports JSON and directories)
ipcMain.handle("get-ultrasonic-files", async (event, folderPath) => {
  try {
    console.log("[MAIN] ===============================================");
    console.log("[MAIN] GET ULTRASONIC FILES - START");
    console.log("[MAIN] Requested folder path:", folderPath);

    // Get the photo save folder from config (this is our base folder)
    const photoSaveFolder = getPhotoSaveFolderFromConfig();
    console.log("[MAIN] Base folder from config:", photoSaveFolder);
    if (!photoSaveFolder) {
      console.log("[MAIN] ERROR: Base folder not configured");
      return { success: false, error: "Base folder not configured" };
    }

    // Construct the full path to the folder
    // Check if folderPath is already absolute to avoid path doubling
    let fullFolderPath;
    if (path.isAbsolute(folderPath)) {
      console.log("[MAIN] folderPath is absolute, using as-is");
      fullFolderPath = path.normalize(folderPath);
    } else {
      console.log(
        "[MAIN] folderPath is relative, joining with photoSaveFolder"
      );
      fullFolderPath = path.join(photoSaveFolder, folderPath);
    }
    console.log("[MAIN] Full folder path:", fullFolderPath);

    // Check if folder exists
    if (!fs.existsSync(fullFolderPath)) {
      console.log("[MAIN] Folder does not exist, creating:", fullFolderPath);
      fs.mkdirSync(fullFolderPath, { recursive: true });
      console.log("[MAIN] Created folder, returning empty array");
      return { success: true, images: [] };
    }

    console.log("[MAIN] Folder exists, reading directory contents...");

    // Read directory contents
    const files = fs.readdirSync(fullFolderPath);
    console.log("[MAIN] Files found in directory:", files);

    const results = [];
    for (const file of files) {
      const filePath = path.join(fullFolderPath, file);

      try {
        const stats = fs.statSync(filePath);
        console.log(
          "[MAIN] Processing:",
          file,
          "isDirectory:",
          stats.isDirectory()
        );

        // Include all files and directories
        const fileData = {
          fileName: file,
          filePath: filePath,
          dateCreated: stats.mtime.toISOString(),
          size: stats.size,
          isDirectory: stats.isDirectory(),
          stats: {
            mtime: stats.mtime,
            ctime: stats.ctime,
            size: stats.size,
          },
        };

        results.push(fileData);
        console.log("[MAIN] Added:", fileData);
      } catch (statError) {
        console.error("[MAIN] Error getting file stats for:", file, statError);
      }
    }

    // Sort by creation date (newest first)
    results.sort((a, b) => new Date(b.dateCreated) - new Date(a.dateCreated));

    console.log("[MAIN] Final result:", results.length, "items found");
    console.log("[MAIN] GET ULTRASONIC FILES - END");
    console.log("[MAIN] ===============================================");

    return { success: true, images: results };
  } catch (error) {
    console.error("[MAIN] Error getting ultrasonic files:", error);
    return { success: false, error: error.message };
  }
});

// Handler for reading file content (for JSON files)
ipcMain.handle("read-file-content", async (event, filePath) => {
  try {
    console.log("[MAIN] ===============================================");
    console.log("[MAIN] READ FILE CONTENT - START");
    console.log("[MAIN] Requested file path:", filePath);

    // Get the photo save folder from config (this is our base folder)
    const photoSaveFolder = getPhotoSaveFolderFromConfig();
    console.log("[MAIN] Base folder from config:", photoSaveFolder);
    if (!photoSaveFolder) {
      console.log("[MAIN] ERROR: Base folder not configured");
      return { success: false, error: "Base folder not configured" };
    }

    // Construct the full path to the file
    // Check if filePath is already absolute to avoid path doubling
    let fullFilePath;
    if (path.isAbsolute(filePath)) {
      console.log("[MAIN] filePath is absolute, using as-is");
      fullFilePath = path.normalize(filePath);
    } else {
      console.log("[MAIN] filePath is relative, joining with photoSaveFolder");
      fullFilePath = path.join(photoSaveFolder, filePath);
    }
    console.log("[MAIN] Full file path:", fullFilePath);

    // Check if file exists
    if (!fs.existsSync(fullFilePath)) {
      console.log("[MAIN] File does not exist:", fullFilePath);
      return { success: false, error: "File does not exist" };
    }

    console.log("[MAIN] File exists, reading content...");

    // Read file content
    const content = fs.readFileSync(fullFilePath, "utf8");
    console.log("[MAIN] File content length:", content.length);

    console.log("[MAIN] READ FILE CONTENT - END");
    console.log("[MAIN] ===============================================");

    return { success: true, content: content };
  } catch (error) {
    console.error("[MAIN] Error reading file content:", error);
    return { success: false, error: error.message };
  }
});

// Handler untuk menampilkan file di file explorer
ipcMain.handle("show-item-in-folder", async (event, filePath) => {
  try {
    console.log("[MAIN] SHOW ITEM IN FOLDER - START");
    console.log("[MAIN] ===============================================");
    console.log("[MAIN] Requested file path:", filePath);
    console.log("[MAIN] File path type:", typeof filePath);

    // Handle different path formats
    let targetPath = filePath;

    // If it's a URL (starts with http/https), we can't open it locally
    if (
      typeof filePath === "string" &&
      (filePath.startsWith("http://") || filePath.startsWith("https://"))
    ) {
      console.error("[MAIN] Cannot open URL in file explorer:", filePath);
      return {
        success: false,
        error:
          "Cannot open web URLs in file explorer. This feature only works with local files.",
      };
    }

    // If it's a file:// URL, extract the path
    if (typeof filePath === "string" && filePath.startsWith("file://")) {
      targetPath = filePath.replace("file://", "");
      console.log("[MAIN] Converted file:// URL to path:", targetPath);
    }

    // Handle Windows paths that might have forward slashes
    if (process.platform === "win32" && typeof targetPath === "string") {
      targetPath = targetPath.replace(/\//g, "\\");
      console.log("[MAIN] Converted to Windows path:", targetPath);
    }

    // Normalize the path and resolve it
    const normalizedPath = path.normalize(targetPath);
    console.log("[MAIN] Normalized path:", normalizedPath);

    // If path is relative, try to resolve it from common base paths
    let fullPath = normalizedPath;
    if (!path.isAbsolute(normalizedPath)) {
      const possibleBasePaths = [
        process.cwd(),
        path.join(os.homedir(), "Documents", "RoboGo"),
        path.join(process.cwd(), "reports"),
      ];

      for (const basePath of possibleBasePaths) {
        const testPath = path.join(basePath, normalizedPath);
        console.log("[MAIN] Trying path:", testPath);
        if (fs.existsSync(testPath)) {
          fullPath = testPath;
          console.log("[MAIN] Found file at:", fullPath);
          break;
        }
      }
    }

    console.log("[MAIN] Final path to check:", fullPath);

    // Check if file exists
    if (!fs.existsSync(fullPath)) {
      console.error("[MAIN] File does not exist:", fullPath);
      console.log("[MAIN] Current working directory:", process.cwd());
      console.log("[MAIN] User home directory:", os.homedir());

      // List directory contents for debugging
      const parentDir = path.dirname(fullPath);
      if (fs.existsSync(parentDir)) {
        console.log("[MAIN] Parent directory exists:", parentDir);
        try {
          const dirContents = fs.readdirSync(parentDir);
          console.log(
            "[MAIN] Parent directory contents:",
            dirContents.slice(0, 10)
          ); // Show first 10 items
        } catch (e) {
          console.log(
            "[MAIN] Could not read parent directory contents:",
            e.message
          );
        }
      } else {
        console.log("[MAIN] Parent directory does not exist:", parentDir);
      }

      return { success: false, error: `File not found: ${fullPath}` };
    }

    // Show the file in the system's file manager
    shell.showItemInFolder(fullPath);
    console.log("[MAIN] Successfully showed item in folder");

    console.log("[MAIN] SHOW ITEM IN FOLDER - END");
    console.log("[MAIN] ===============================================");

    return { success: true };
  } catch (error) {
    console.error("[MAIN] Error showing item in folder:", error);
    return { success: false, error: error.message };
  }
});
