const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

let nextProcess = null;

function startNextJS() {
  return new Promise((resolve, reject) => {
    console.log("[LAUNCHER] Starting Next.js server...");

    // Determine the client path relative to electron folder
    const clientPath = path.join(__dirname, "..", "client");
    console.log("[LAUNCHER] Client path:", clientPath);

    // Check if client folder exists
    if (!fs.existsSync(clientPath)) {
      reject(new Error("Client folder not found at: " + clientPath));
      return;
    }

    // Check if build output exists (out folder or .next folder)
    const outPath = path.join(clientPath, "out");
    const nextPath = path.join(clientPath, ".next");

    let startCommand, startArgs;

    if (fs.existsSync(outPath)) {
      // Use static export with serve
      console.log("[LAUNCHER] Found static export, using serve...");
      startCommand = process.platform === "win32" ? "npx.cmd" : "npx";
      startArgs = ["serve", "out", "-p", "3000"];
    } else if (fs.existsSync(nextPath)) {
      // Use Next.js production server
      console.log("[LAUNCHER] Found Next.js build, using next start...");
      startCommand = process.platform === "win32" ? "npm.cmd" : "npm";
      startArgs = ["start"];
    } else {
      // Development mode
      console.log("[LAUNCHER] No build found, using development mode...");
      startCommand = process.platform === "win32" ? "npm.cmd" : "npm";
      startArgs = ["run", "dev"];
    }

    console.log("[LAUNCHER] Command:", startCommand, startArgs.join(" "));

    nextProcess = spawn(startCommand, startArgs, {
      cwd: clientPath,
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
    });

    let serverReady = false;

    nextProcess.stdout.on("data", (data) => {
      const output = data.toString();
      console.log("[NEXT]", output);

      // Check if server is ready
      if (
        output.includes("localhost:3000") ||
        output.includes("Ready on") ||
        output.includes("Accepting connections") ||
        output.includes("ready on")
      ) {
        if (!serverReady) {
          serverReady = true;
          console.log("[LAUNCHER] Next.js server is ready!");
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
          reject(new Error("Next.js failed to start: " + output));
        }
      }
    });

    nextProcess.on("error", (error) => {
      console.error("[LAUNCHER] Failed to start Next.js:", error);
      if (!serverReady) {
        reject(error);
      }
    });

    nextProcess.on("close", (code) => {
      console.log("[LAUNCHER] Next.js process exited with code:", code);
      nextProcess = null;
    });

    // Timeout after 30 seconds
    setTimeout(() => {
      if (!serverReady) {
        console.log("[LAUNCHER] Timeout waiting for Next.js server");
        reject(new Error("Timeout waiting for Next.js server to start"));
      }
    }, 30000);
  });
}

function stopNextJS() {
  if (nextProcess) {
    console.log("[LAUNCHER] Stopping Next.js server...");
    nextProcess.kill();
    nextProcess = null;
  }
}

module.exports = {
  startNextJS,
  stopNextJS,
};
