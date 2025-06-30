const http = require("http");
const path = require("path");
const fs = require("fs");
const url = require("url");

class StaticServer {
  constructor(port = 3000) {
    this.port = port;
    this.server = null;
  }

  getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".webp": "image/webp",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
      ".eot": "application/vnd.ms-fontobject",
    };
    return mimeTypes[ext] || "text/plain";
  }

  start(staticDir) {
    return new Promise((resolve, reject) => {
      console.log("[STATIC-SERVER] Starting server with directory:", staticDir);

      // Check if static directory exists and list contents
      if (!fs.existsSync(staticDir)) {
        console.error(
          "[STATIC-SERVER] ❌ Static directory does not exist:",
          staticDir
        );
        reject(new Error(`Static directory not found: ${staticDir}`));
        return;
      }

      console.log("[STATIC-SERVER] 📁 Static directory contents:");
      try {
        const files = fs.readdirSync(staticDir);
        files.forEach((file) => {
          console.log("[STATIC-SERVER]   -", file);
        });
      } catch (err) {
        console.error("[STATIC-SERVER] Error reading directory:", err);
      }

      this.server = http.createServer((req, res) => {
        const parsedUrl = url.parse(req.url, true);
        let pathname = parsedUrl.pathname;

        console.log("[STATIC-SERVER] 📥 Request:", req.method, pathname);

        // Add CORS headers for development
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader(
          "Access-Control-Allow-Methods",
          "GET, POST, PUT, DELETE, OPTIONS"
        );
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization"
        );

        if (req.method === "OPTIONS") {
          res.writeHead(200);
          res.end();
          return;
        }

        // Handle root path
        if (pathname === "/") {
          pathname = "/index.html";
        }

        // Security: prevent directory traversal
        if (pathname.includes("..")) {
          console.log(
            "[STATIC-SERVER] ❌ Directory traversal attempt blocked:",
            pathname
          );
          res.writeHead(403);
          res.end("Forbidden");
          return;
        }

        const filePath = path.join(staticDir, pathname);
        console.log("[STATIC-SERVER] 🔍 Looking for file:", filePath);

        // Check if file exists
        fs.access(filePath, fs.constants.F_OK, (err) => {
          if (err) {
            console.log("[STATIC-SERVER] ❌ File not found:", filePath);
            // Try with .html extension for Next.js routing
            const htmlPath = path.join(staticDir, pathname + ".html");
            console.log("[STATIC-SERVER] 🔍 Trying with .html:", htmlPath);

            fs.access(htmlPath, fs.constants.F_OK, (htmlErr) => {
              if (htmlErr) {
                console.log(
                  "[STATIC-SERVER] ❌ .html file not found:",
                  htmlPath
                );
                // For Next.js SPA routing - serve index.html for unknown routes
                const indexPath = path.join(staticDir, "index.html");
                console.log(
                  "[STATIC-SERVER] 🔄 Fallback to index.html:",
                  indexPath
                );
                this.serveFile(
                  indexPath,
                  res,
                  "Fallback to index.html for SPA routing"
                );
              } else {
                console.log("[STATIC-SERVER] ✅ Found .html file:", htmlPath);
                this.serveFile(htmlPath, res);
              }
            });
          } else {
            console.log("[STATIC-SERVER] ✅ File exists:", filePath);
            // Check if it's a directory
            fs.stat(filePath, (statErr, stats) => {
              if (statErr) {
                console.error("[STATIC-SERVER] ❌ Stat error:", statErr);
                res.writeHead(500);
                res.end("Internal Server Error");
                return;
              }

              if (stats.isDirectory()) {
                // Try to serve index.html in directory
                const indexPath = path.join(filePath, "index.html");
                console.log(
                  "[STATIC-SERVER] 📁 Directory found, looking for index:",
                  indexPath
                );
                this.serveFile(indexPath, res, "Directory index");
              } else {
                console.log("[STATIC-SERVER] 📄 Serving file:", filePath);
                this.serveFile(filePath, res);
              }
            });
          }
        });
      });

      this.server.listen(this.port, (err) => {
        if (err) {
          console.error("[STATIC-SERVER] Error starting server:", err);
          reject(err);
        } else {
          console.log(
            `[STATIC-SERVER] ✅ Server running on http://localhost:${this.port}`
          );
          resolve();
        }
      });

      this.server.on("error", (err) => {
        if (err.code === "EADDRINUSE") {
          console.log(
            `[STATIC-SERVER] Port ${this.port} is busy, trying ${this.port + 1}`
          );
          this.port = this.port + 1;
          this.server.listen(this.port);
        } else {
          reject(err);
        }
      });
    });
  }

  serveFile(filePath, res, context = "") {
    console.log(
      "[STATIC-SERVER] 📤 Serving file:",
      filePath,
      context ? `(${context})` : ""
    );

    fs.readFile(filePath, (err, data) => {
      if (err) {
        if (err.code === "ENOENT") {
          console.log("[STATIC-SERVER] ❌ File not found:", filePath);
          res.writeHead(404, { "Content-Type": "text/html" });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>404 Not Found</title></head>
            <body>
              <h1>404 - File Not Found</h1>
              <p>The requested file was not found:</p>
              <p><code>${filePath}</code></p>
              <p><a href="/">← Back to Home</a></p>
            </body>
            </html>
          `);
        } else {
          console.error("[STATIC-SERVER] ❌ Read error:", err);
          res.writeHead(500);
          res.end("Internal Server Error");
        }
      } else {
        const mimeType = this.getMimeType(filePath);
        const fileSize = data.length;

        console.log("[STATIC-SERVER] ✅ File served successfully:", {
          file: path.basename(filePath),
          size: `${fileSize} bytes`,
          type: mimeType,
        });

        res.writeHead(200, {
          "Content-Type": mimeType,
          "Content-Length": fileSize,
          "Cache-Control": "public, max-age=31536000",
        });
        res.end(data);
      }
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
      console.log("[STATIC-SERVER] Server stopped");
    }
  }
}

module.exports = StaticServer;
